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
  Strich,
  StempelTakt,
  wendeVorgang,
  type Aenderung,
  type Werkzeug,
} from './gelaendePinsel';
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
  einstellung(): { werkzeug: Werkzeug; radius: number; staerke: number };
  meldung(text: string): void;
  kreis: { zeige(x: number, z: number, r: number, gesperrt: boolean): void; verberge(): void };
  /** After a stroke was written: put loose objects back on the new ground. */
  nachStrich(): void;
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
    this.abh.kreis.zeige(p.x, p.z, e.radius, gesperrtDurch(this.sperrkreiseHolen(), p.x, p.z, e.radius) !== null);
  }

  verberge(): void {
    this.abh.kreis.verberge();
  }

  /** Mouse down on the ground: starts a stroke with its first stamp. */
  druecken(p: { x: number; z: number }, shift: boolean): void {
    if (this.strich || !this.bereit() || !this.karte) return;
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
    const werkzeug: Werkzeug = e.werkzeug === 'glaetten' ? 'glaetten' : (e.werkzeug === 'anheben') !== shift ? 'anheben' : 'absenken';
    const sperre = gesperrtDurch(this.sperrkreiseHolen(), p.x, p.z, radius);
    const r = strich.stempel(
      { x: p.x, z: p.z, radius, staerke: e.staerke, werkzeug, hoehe: (ix, iz) => this.abh.hoehe(ix, iz) },
      sperre !== null
    );
    this.abh.kreis.zeige(p.x, p.z, radius, sperre !== null);
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
    const v = strich.ende();
    if (!v) return;
    const r = this.abh.aktionen.strichAbschliessen(v);
    if (r.ok) {
      this.abh.meldung(t('testflug.gelaende.strich_gespeichert', { n: v.aenderungen.length }));
      // The ground under loose objects moved: put them back on it (buildings are locked and did not move).
      this.abh.nachStrich();
      return;
    }
    // The draft refused: take the stroke back from the live ground too, so ground and draft agree.
    const zurueck = invertiere(v);
    if (wendeVorgang(this.karte, zurueck).ok) this.neuBauen(zurueck.aenderungen);
    this.abh.meldung(t('testflug.gelaende.abgelehnt', { grund: r.message }));
  }

  /** Tool ended while the mouse may still be down (Esc, right click, other tab): the open stroke is finished, not dropped. */
  beenden(): void {
    this.loslassen();
    this.abh.kreis.verberge();
  }
}
