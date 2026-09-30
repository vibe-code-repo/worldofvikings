/**
 * The brush of the terrain tab, wired to the running ground of the flight but
 * free of DOM and scene: everything it touches comes in through `GelaendeAbh`
 * (ground height, rebuild, catalogue, draft, HUD, circle), so the tests drive
 * it with fakes and count what it does.
 *
 * Der Geländepinsel des Reiters, an das laufende Gelände angeschlossen, aber
 * ohne DOM und Szene: Alles, was er anfasst, kommt über `GelaendeAbh` herein.
 *
 * Life of a stroke: `druecken` starts it (first stamp), `bewegen` and `tick`
 * add stamps at the pace of `StempelTakt`, `loslassen` ends it and writes the ONE
 * Vorgang into the draft. What happens to the ground while the mouse is down is
 * live: each stamp changes the live layer (`DeltaKarte`, seen by the ground
 * through `gelaendeGeo.ts`) and the affected zones are rebuilt.
 */
import { RegionGeo } from '@wov/shared';
import { installiereKorrekturSicht } from './gelaendeGeo';
import type { GelaendeAktionen } from './GelaendeAktionen';
import { grenzText } from './GelaendeAktionen';
import {
  DeltaKarte,
  invertiere,
  klemmeRadius,
  pipette,
  Strich,
  wirkRadius,
  StempelTakt,
  wendeVorgang,
  type Aenderung,
  type GelaendeVorgang,
  type Werkzeug,
} from './gelaendePinsel';
import { GelaendeVerlauf } from './gelaendeVerlauf';
import { loseIndizes } from './gelaendeLose';
import { gesperrtDurch, sperrKreise, type SperrKatalog, type SperrKreis, type SperrPlatzierung } from './gelaendeSperre';
import { t } from '../i18n';

/** Bounding box of changed vertices, in world coordinates. */
export interface Kasten {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface GelaendeAbh {
  /** Ground height at a world position (the live ground). */
  hoehe(x: number, z: number): number;
  /** The geo of the running world (`world.geo`). */
  geo(): unknown;
  /** Rebuild the ground (zones, collision, grass) inside the box. */
  neuBauen(kasten: Kasten): void;
  /** Placements of the draft, for the lock circles. */
  platzierungen(): readonly SperrPlatzierung[] | undefined;
  katalog: SperrKatalog;
  aktionen: GelaendeAktionen;
  einstellung(): { werkzeug: Werkzeug; radius: number; staerke: number; ziel: number | null };
  /** The pipette / a number in the target field: show the new target height in the panel. */
  setzeZiel(hoehe: number): void;
  meldung(text: string): void;
  kreis: { zeige(x: number, z: number, r: number, gesperrt: boolean): void; verberge(): void };
  /**
   * After a stroke, an undo, a redo or a takeover: put the LOOSE placements (list positions in
   * `platzierungen()`, see `gelaendeLose.ts`) back on the ground; buildings and plinths are not in the list.
   */
  nachStrich(lose: number[]): void;
  jetztMs(): number;
  vorgangId(): string;
}

/** How long the lock circles of the draft are reused (placements only change through other tools). */
const SPERRKREISE_MAX_ALTER_MS = 1000;

export class GelaendeSteuerung {
  private karte: DeltaKarte | null = null;
  private strich: Strich | null = null;
  private takt = new StempelTakt();
  private kreise: SperrKreis[] = [];
  private kreiseZeit = -Infinity;
  private gesperrtGemeldet = false;
  /** Another tab changed the draft while a stroke was open: the ground is compared with the draft when the stroke ends. */
  private ausstehend = false;
  /** The draft's layer is unusable (message), the brush stays locked until a draft comes back that can be used. */
  private entwurfKaputt: string | null = null;
  private readonly verlauf = new GelaendeVerlauf();

  constructor(private readonly abh: GelaendeAbh) {}

  /**
   * Prepares the brush the first time it is needed: takes the layer the
   * running ground was BUILT from (`geo.layout.heightDeltas`, not the draft,
   * which another tab may have changed since) and puts the live view into the
   * ground. Says why when that is impossible. `true` = ready.
   */
  bereit(): boolean {
    if (this.karte) return true;
    const geo = this.abh.geo();
    if (!(geo instanceof RegionGeo)) {
      this.abh.meldung(t('testflug.gelaende.kein_geo'));
      return false;
    }
    const karte = DeltaKarte.ausZonen(geo.layout.heightDeltas);
    if (!installiereKorrekturSicht(geo, karte)) {
      this.abh.meldung(t('testflug.gelaende.kein_geo'));
      return false;
    }
    // A draft field that cannot be written back unchanged locks the brush before the first stroke.
    const geladen = this.abh.aktionen.ladeKarte();
    if (!geladen.ok) {
      this.abh.meldung(geladen.message);
      return false;
    }
    this.karte = karte;
    return true;
  }

  /**
   * Another tab changed the draft (`storage` event): the flight takes the new
   * `heightDeltas` layer into the live ground and rebuilds what differs. A stroke
   * that is running is not torn: the takeover waits for its end.
   */
  entwurfGeaendert(): void {
    if (!this.karte) return;
    if (this.strich) {
      this.ausstehend = true;
      return;
    }
    this.abgleichen();
  }

  /**
   * Makes the live layer equal to the draft's. Changes are rebuilt zone by zone
   * (a box around scattered points would rebuild half the map); loose objects
   * are put back on the new ground.
   */
  private abgleichen(): void {
    const karte = this.karte;
    if (!karte) return;
    const geladen = this.abh.aktionen.ladeKarte();
    if (!geladen.ok) {
      if (this.entwurfKaputt !== geladen.message) this.abh.meldung(geladen.message);
      this.entwurfKaputt = geladen.message;
      return;
    }
    this.entwurfKaputt = null;
    const geaendert = karte.abgleichenMit(geladen.karte);
    if (geaendert.length === 0) return;
    // Somebody else changed the layer: the steps of this flight refer to a ground that is gone.
    this.verlauf.leeren();
    this.neuBauenJeZone(geaendert);
    this.loseNachfuehren(geaendert);
    this.abh.meldung(t('testflug.gelaende.entwurf_uebernommen', { n: geaendert.length }));
  }

  private loseNachfuehren(aenderungen: readonly Aenderung[]): void {
    this.abh.nachStrich(loseIndizes(this.abh.platzierungen(), this.abh.katalog, aenderungen));
  }

  get strichOffen(): boolean {
    return this.strich !== null;
  }

  private sperrkreiseHolen(): SperrKreis[] {
    const jetzt = this.abh.jetztMs();
    if (jetzt - this.kreiseZeit > SPERRKREISE_MAX_ALTER_MS) {
      this.kreise = sperrKreise(this.abh.platzierungen(), this.abh.katalog);
      this.kreiseZeit = jetzt;
    }
    return this.kreise;
  }

  /** Forget the cached lock circles (a placement was moved, set or deleted). */
  sperrkreiseNeu(): void {
    this.kreiseZeit = -Infinity;
  }

  /** The circle under the pointer (red when locked); call while the tool is active. */
  vorschau(p: { x: number; z: number } | null): void {
    if (!p) {
      this.abh.kreis.verberge();
      return;
    }
    const e = this.abh.einstellung();
    const r = wirkRadius(e.werkzeug, klemmeRadius(e.radius), e.staerke);
    this.abh.kreis.zeige(p.x, p.z, r, gesperrtDurch(this.sperrkreiseHolen(), p.x, p.z, r) !== null);
  }

  verberge(): void {
    this.abh.kreis.verberge();
  }

  /** Mouse down on the ground: starts a stroke with its first stamp. */
  druecken(p: { x: number; z: number }, shift: boolean): void {
    if (this.strich || !this.bereit() || !this.karte) return;
    // The ground must show the draft before a stroke lands on it (also when the event was missed).
    this.abgleichen();
    if (this.entwurfKaputt) return;
    // Levelling needs a target: say so instead of a stroke that does nothing.
    if (this.abh.einstellung().werkzeug === 'ebnen' && this.abh.einstellung().ziel === null) {
      this.abh.meldung(t('testflug.gelaende.ziel_fehlt'));
      return;
    }
    this.strich = new Strich(this.karte, this.abh.vorgangId());
    this.takt = new StempelTakt();
    this.gesperrtGemeldet = false;
    this.kreiseZeit = -Infinity;
    this.stempeln(p, shift);
  }

  /** Pointer moved with the button down. */
  bewegen(p: { x: number; z: number }, shift: boolean): void {
    if (!this.strich) return;
    this.stempeln(p, shift);
  }

  /** Once per frame with the button down: a motionless brush repeats its stamp. */
  tick(p: { x: number; z: number } | null, shift: boolean): void {
    if (!this.strich || !p) return;
    this.stempeln(p, shift);
  }

  private stempeln(p: { x: number; z: number }, shift: boolean): void {
    const strich = this.strich;
    if (!strich) return;
    const e = this.abh.einstellung();
    const radius = klemmeRadius(e.radius);
    if (!this.takt.faellig(p.x, p.z, radius, this.abh.jetztMs())) {
      this.vorschau(p);
      return;
    }
    // Shift turns raise into lower and back; it does nothing for the other tools.
    const werkzeug: Werkzeug =
      e.werkzeug === 'anheben' || e.werkzeug === 'absenken' ? ((e.werkzeug === 'anheben') !== shift ? 'anheben' : 'absenken') : e.werkzeug;
    // The circle and the lock use the radius the stamp really reaches (a weak stamp is narrower than the radius).
    const wirk = wirkRadius(werkzeug, radius, e.staerke);
    const sperre = gesperrtDurch(this.sperrkreiseHolen(), p.x, p.z, wirk);
    const r = strich.stempel(
      { x: p.x, z: p.z, radius, staerke: e.staerke, werkzeug, hoehe: (ix, iz) => this.abh.hoehe(ix, iz), ziel: e.ziel ?? undefined },
      sperre !== null
    );
    this.abh.kreis.zeige(p.x, p.z, wirk, sperre !== null);
    switch (r.art) {
      case 'ok':
        this.neuBauen(r.geaendert);
        break;
      case 'gesperrt': {
        if (!this.gesperrtGemeldet && sperre) {
          this.gesperrtGemeldet = true;
          this.abh.meldung(
            t('testflug.gelaende.gesperrt', {
              art: t(sperre.art === 'sockel' ? 'testflug.gelaende.sperre.sockel' : 'testflug.gelaende.sperre.gebaeude'),
              prefab: sperre.prefab,
            })
          );
        }
        break;
      }
      case 'grenze':
        this.neuBauen(r.zurueckgenommen);
        this.abh.meldung(t('testflug.gelaende.abgelehnt', { grund: grenzText(r.grund) }));
        break;
      case 'abgelehnt':
        break;
    }
  }

  /** One rebuild per zone that has changes: scattered changes must not become one giant box. */
  private neuBauenJeZone(aenderungen: readonly Aenderung[]): void {
    const jeZone = new Map<string, Aenderung[]>();
    for (const a of aenderungen) {
      const schluessel = `${a.zx},${a.zz}`;
      const liste = jeZone.get(schluessel);
      if (liste) liste.push(a);
      else jeZone.set(schluessel, [a]);
    }
    for (const liste of jeZone.values()) this.neuBauen(liste);
  }

  private neuBauen(aenderungen: readonly Aenderung[]): void {
    if (aenderungen.length === 0) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const a of aenderungen) {
      const wx = a.zx * 64 - 32 + (a.index % 64);
      const wz = a.zz * 64 - 32 + Math.floor(a.index / 64);
      if (wx < minX) minX = wx;
      if (wx > maxX) maxX = wx;
      if (wz < minZ) minZ = wz;
      if (wz > maxZ) maxZ = wz;
    }
    this.abh.neuBauen({ minX, maxX, minZ, maxZ });
  }

  /** Mouse up: the stroke ends and becomes ONE Vorgang in the draft. */
  loslassen(): void {
    const strich = this.strich;
    this.strich = null;
    if (!strich || !this.karte) return;
    try {
      this.strichAbschliessen(strich);
    } finally {
      // Another tab changed the draft during the stroke: take it over now that the stroke is written or taken back.
      if (this.ausstehend) {
        this.ausstehend = false;
        this.abgleichen();
      }
    }
  }

  private strichAbschliessen(strich: Strich): void {
    if (!this.karte) return;
    const v = strich.ende();
    if (!v) return;
    const r = this.abh.aktionen.strichAbschliessen(v);
    if (r.ok) {
      this.abh.meldung(t('testflug.gelaende.strich_gespeichert', { n: v.aenderungen.length }));
      // The ground under loose objects moved: put them back on it (buildings are locked and did not move).
      this.verlauf.neu(v);
      this.loseNachfuehren(v.aenderungen);
      return;
    }
    // The draft refused: take the stroke back from the live ground too, so ground and draft agree.
    const zurueck = invertiere(v);
    if (wendeVorgang(this.karte, zurueck).ok) this.neuBauen(zurueck.aenderungen);
    // The draft is what counts: if it was changed elsewhere, the ground follows it (also when no event arrived).
    this.abgleichen();
    this.abh.meldung(t('testflug.gelaende.abgelehnt', { grund: r.message }));
  }

  /**
   * Pipette: takes the ground height at a point into the target field (whole cm). Also while a stroke is
   * open it only reads; it never changes the ground.
   */
  pipetteAn(p: { x: number; z: number }): number {
    const h = pipette((x, z) => this.abh.hoehe(x, z), p.x, p.z);
    this.abh.setzeZiel(h);
    this.abh.meldung(t('testflug.gelaende.pipette', { h: h.toFixed(2) }));
    return h;
  }

  /** Ctrl+Z: takes back the last stroke (draft, live ground and loose objects). `true` = a stroke was taken back. */
  rueckgaengig(): boolean {
    return this.schritt('rueckgaengig');
  }

  /** Ctrl+Y / Ctrl+Shift+Z: puts the last taken-back stroke in again, bit-equal to before. */
  wiederholen(): boolean {
    return this.schritt('wiederholen');
  }

  private schritt(art: 'rueckgaengig' | 'wiederholen'): boolean {
    // A stroke that is open is finished first (the mouse is still down): undo never tears it.
    if (this.strich || !this.karte) return false;
    // Compare with the draft first: a foreign change empties the history (nothing to undo then).
    this.abgleichen();
    const karte = this.karte;
    let angewandt: GelaendeVorgang | null = null;
    const anwenden = (v: GelaendeVorgang): boolean => {
      const r = this.abh.aktionen.strichAbschliessen(v);
      if (!r.ok) {
        this.abh.meldung(r.message);
        return false;
      }
      // The draft stands; the live layer follows (same values, so this cannot conflict; if it does, the draft wins).
      if (!wendeVorgang(karte, v).ok) this.abgleichen();
      angewandt = v;
      return true;
    };
    const v = art === 'rueckgaengig' ? this.verlauf.rueckgaengig(anwenden) : this.verlauf.wiederholen(anwenden);
    if (!v || !angewandt) {
      if (!this.verlauf.kannRueckgaengig && art === 'rueckgaengig') this.abh.meldung(t('testflug.gelaende.nichts_rueckgaengig'));
      if (!this.verlauf.kannWiederholen && art === 'wiederholen') this.abh.meldung(t('testflug.gelaende.nichts_wiederholen'));
      return false;
    }
    const a = angewandt as GelaendeVorgang;
    this.neuBauenJeZone(a.aenderungen);
    this.loseNachfuehren(a.aenderungen);
    this.abh.meldung(t(art === 'rueckgaengig' ? 'testflug.gelaende.rueckgaengig' : 'testflug.gelaende.wiederholt', { n: a.aenderungen.length }));
    return true;
  }

  /** Tool ended while the mouse may still be down (Esc, right click, other tab): the open stroke is finished, not dropped. */
  beenden(): void {
    this.loslassen();
    this.abh.kreis.verberge();
  }
}
