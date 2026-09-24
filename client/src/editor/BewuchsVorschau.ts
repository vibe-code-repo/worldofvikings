/**
 * Bewuchs-Vorschau im Testflug — zeigt, was der Server streuen wird.
 *
 * ── Warum es sie gibt ────────────────────────────────────────────────
 * Der Testflug laeuft OFFLINE (`?offline=1&layout=editor`). Dort gibt es
 * keinen Server und damit keinen ZoneManager: Der Client zeichnete nur
 * die handplatzierten `placements`. Wer im Editor auf "Grasland
 * bewachsen" drueckte und dann in den Testflug ging, sah eine kahle
 * Insel — die Liste stand im Dokument, aber niemand streute danach.
 *
 * ── Warum sie nicht selbst rechnet ───────────────────────────────────
 * Sie ruft `streueZone` aus `@wov/shared` auf, dieselbe Funktion, die
 * der Server benutzt. Eine Vorschau, die anders rechnet als der Server,
 * waere schlimmer als keine: Man gestaltet nach einem Bild, das die
 * Welt spaeter nicht einloest. Der einzige Unterschied liegt darin, was
 * mit dem Ergebnis geschieht — hier Instanzen statt ZDOs.
 *
 * Zwei bewusste Abweichungen, beide unschaedlich beim Gestalten:
 *  - `clearAreas` nur aus den Platzierungen (gemeinsame Funktion
 *    `freiflaechenAusPlatzierungen`), nicht aus den Locations, die der
 *    Server vorab platziert. Es koennen also ein paar Pflanzen dort
 *    stehen, wo spaeter ein Bauwerk freiraeumt.
 *  - Nur die Zonen um den Spieler, nicht die ganze Welt.
 *
 * ── Zeitbudget ───────────────────────────────────────────────────────
 * Eine Zone kostet gemessen 13,4 ms (5x5 Zonen: 334 ms, 3.303 Pflanzen).
 * Das ist zu viel fuer einen Bildaufbau, aber unproblematisch, wenn je
 * Bild HOECHSTENS EINE Zone gestreut wird: Nach gut einer Sekunde steht
 * der Umkreis, und bis dahin waechst die Welt sichtbar zu — was beim
 * Gestalten eher hilft, als zu stoeren.
 *
 * ── Aufraeumen (K2.1) ────────────────────────────────────────────────
 * Die Vorschau hielt bis dahin JEDE je gestreute Zone, auch wenn der
 * Spieler laengst weitergeflogen war: Der Bestand wuchs mit der
 * Flugstrecke ohne Grenze (Messung M2.0, Insel 18, 60 s bei 45 m/s:
 * 7.900 -> 48.293 Pflanzen, Dreiecke je Bild 106 -> 328 Mio.). Jetzt
 * bleibt nur der Ring um den Spieler stehen; was herausfaellt, wird
 * abgebaut (`removeZDO` gibt die Instanz frei), und zwar wie beim
 * Aufbau HOECHSTENS EINE Zone je Bild.
 *
 * Eine Zone faellt erst NACHLAUF_MS Millisekunden nach dem Verlassen des
 * Rings weg. Ohne diese Frist flackerte der Rand: Wer an einer
 * Zonengrenze hin- und herfliegt, liesse jedes Mal eine Randzone bauen
 * (11 ms) und wieder abbauen. In Ruhe (nach der Frist) steht genau der
 * Ring, nicht mehr.
 *
 * Grenzen der Frist (Angriff auf K2.1, bekannt und hingenommen): Der
 * Bestand ist bewegungsabhaengig. Im geraden Flug stehen hoechstens etwa
 * 30 Zonen. Bei Spruengen im Sekundentakt gilt die Schranke
 *   Zonen <= 25 (Ring) + Frist [s] x Bildrate [Hz]   (ein Bau je Bild),
 * sie waechst also mit der Bildrate. Gemessen (DOM-frei, Pruefung nach der
 * Umstellung auf Millisekunden): 31 Zonen bei 30 Hz, 62 bei 60 Hz, 145 bei
 * 144 Hz, 242 bei 240 Hz; auf dichter Insel mit Sprungtakt 85 Zonen /
 * 15.012 Pflanzen bei 60 Hz gegen 100 / 17.584 bei 144 Hz.
 *
 * Und wer die Kamera innerhalb der Frist immer wieder in alle Zonen
 * zurueckbringt (Rundtour mit Umlauf
 * unter einer Sekunde, nur per Sprung oder Messhaken erreichbar), haelt
 * jeden Stempel frisch, dann wird nichts abgebaut. Ein harter Deckel
 * (z. B. hoechstens zwei Ringe) waere eine eigene Aenderung.
 *
 * ── Stufen (K2.1) ────────────────────────────────────────────────────
 * `voll` = der bisherige 5x5-Ring, `klein` = 3x3, `aus` = nichts. Die
 * Vorschau ist der groesste Einzelposten im Bild (Messung M2.0: ruhig
 * 14,1 -> 9,2 ms ohne sie), und wer Objekte setzt, braucht den Bewuchs
 * nicht in voller Dichte. Ein Wechsel baut die ueberzaehligen Zonen
 * ebenfalls eine je Bild ab, ohne Frist.
 */

import {
  freiflaechenAusPlatzierungen,
  freiflaechenFuerZone,
  freiflaechenHuellen,
  streueZone,
  type ClientWorldLike,
  type StreuFund,
} from './bewuchsTypen';
import type { ClearArea, PlacementDef } from '@wov/shared';
import type { EntityManager } from '../entities/EntityManager';

/** Wie viel die Vorschau zeigt: voll = 5x5 Zonen, klein = 3x3, aus = nichts. */
export type BewuchsStufe = 'voll' | 'klein' | 'aus';

/** Die Stufen in der Reihenfolge, in der die Taste sie durchschaltet. */
export const BEWUCHS_STUFEN_LISTE: readonly BewuchsStufe[] = ['voll', 'klein', 'aus'];

/** Radius in Zonen um den Spieler je Stufe (2 = 5x5 Zonen = 320 m Kantenlaenge); -1 = leer. */
export const STUFEN_RADIUS: Readonly<Record<BewuchsStufe, number>> = { voll: 2, klein: 1, aus: -1 };

/**
 * Zeit in Millisekunden, die eine Zone ausserhalb des Rings noch stehen
 * bleibt, bevor sie abgebaut wird. 1000 ms = die 60 Bilder bei 60 Hz, mit
 * denen die Frist zuerst gemessen wurde; gerechnet wird mit der
 * VERSTRICHENEN ZEIT, nicht mit einem Bildzaehler: 60 Bilder waeren bei
 * 144 Hz nur 0,42 s, und das Pendelmuster unten fiele wieder durch
 * (Angriff auf K2.1: 42,2 statt 2,2 ms/s Streuarbeit).
 *
 * Gehalten wird genau dann, wenn die Kamera hoechstens so lange auf der
 * anderen Seite einer Zonengrenze bleibt (Halbperiode <= Frist). Gemessen
 * (client/test/bewuchs-vorschau.ts, Hin-und-her ueber eine Grenze):
 * Halbperiode 0,75 s kostet bei einer Frist von 0,25 oder 0,5 s je 135
 * Zonenbauten je 1.200 Bilder bei 60 Hz (rund 80 ms je Sekunde Ruckler),
 * bei 1 s nur die 5 der ersten Reihe, auf 30, 60 und 144 Hz gleich. Preis
 * der 1 s statt 0,25 s: im geraden Flug mit 45 m/s im Mittel 28,5 statt
 * 25,9 Zonen (Hoechstwert 30 in beiden Faellen); in Ruhe nichts, dann
 * steht genau der Ring.
 */
export const NACHLAUF_MS = 1000;

/** Praefix der Entity-Schluessel — muss sich von `edplace-` unterscheiden. */
const SCHLUESSEL = 'bewuchs';

export class BewuchsVorschau {
  /** Bereits gestreute Zonen (Schluessel "zx,zy") mit ihren Entity-Keys. */
  private readonly fertig = new Map<string, string[]>();
  /** Noch zu streuende Zonen, naechste zuerst. */
  private warteschlange: Array<{ zx: number; zy: number }> = [];
  /**
   * Zonen ausserhalb des Rings und die Uhrzeit (ms), zu der sie ihn verlassen haben.
   * Kehrt der Spieler zurueck, verschwindet der Eintrag; ist die Frist um,
   * baut `abbauSchritt` die Zone ab.
   */
  private readonly draussen = new Map<string, number>();
  private letzteZone = '';
  private mitte = { zx: 0, zy: 0 };
  private aktuelleStufe: BewuchsStufe = 'voll';
  /** Uhrzeit des letzten `schritt` in Millisekunden. */
  private jetztMs = 0;

  /** Abstand in ms, in dem die Platzierungen auf Aenderungen geprueft werden. */
  private static readonly PLATZIERUNGEN_PRUEFEN_MS = 250;
  private platzierungenGeprueftMs = -Infinity;

  /**
   * `platzierungen` liefert die AKTUELLEN Platzierungen (im Testflug der
   * Entwurf, den Setzen, Ziehen und Loeschen laufend aendern); ohne sie
   * gilt das Layout der Welt. Aendern sie sich, werden nur die Zonen neu
   * gestreut, die eine geaenderte Freiflaeche beruehrt.
   */
  constructor(
    private readonly welt: ClientWorldLike,
    private readonly ent: EntityManager,
    private readonly nachlaufMs = NACHLAUF_MS,
    private readonly platzierungen: (() => readonly PlacementDef[] | null | undefined) | null = null
  ) {}

  /**
   * Je Aufruf hoechstens eine Zone gestreut UND hoechstens eine abgebaut —
   * siehe Zeitbudget und Aufraeumen im Kopfkommentar.
   *
   * Der Aufrufer ruft das pro Bild; die Warteschlange wird nur dann neu
   * gefuellt, wenn der Spieler die Zone gewechselt hat. Ohne diese
   * Bedingung liefe die Suche nach fehlenden Zonen 60-mal je Sekunde
   * ueber 25 Eintraege, obwohl sich nichts geaendert hat.
   *
   * `jetztMs` ist die Uhr fuer die Frist (Standard: `performance.now()`);
   * ein Test gibt sie vor, um Bildraten nachzubilden.
   */
  schritt(spielerX: number, spielerZ: number, jetztMs: number = performance.now()): void {
    this.jetztMs = jetztMs;
    this.platzierungenPruefen();
    const zx = Math.floor(spielerX / 64 + 0.5);
    const zy = Math.floor(spielerZ / 64 + 0.5);
    const jetzt = `${zx},${zy}`;
    if (jetzt !== this.letzteZone) {
      this.letzteZone = jetzt;
      this.mitte = { zx, zy };
      this.ringAbgleichen(false);
      this.warteschlangeFuellen(zx, zy);
    }
    const naechste = this.warteschlange.shift();
    if (naechste) this.zoneStreuen(naechste.zx, naechste.zy);
    this.abbauSchritt();
  }

  /** Alles verwerfen — nach einer Aenderung am Entwurf. */
  neuAufbauen(): void {
    for (const keys of this.fertig.values()) {
      for (const k of keys) this.ent.removeZDO(k);
    }
    this.fertig.clear();
    this.draussen.clear();
    this.warteschlange = [];
    this.letzteZone = '';
    this.freiflaechenListe = null;
    this.ent.flush();
  }

  /** Aktuelle Stufe. */
  get stufe(): BewuchsStufe {
    return this.aktuelleStufe;
  }

  /**
   * Stufe wechseln. Zonen ausserhalb des neuen Rings werden ohne Frist
   * abgebaut (eine je Bild), fehlende Zonen des neuen Rings nachgestreut.
   */
  setzeStufe(stufe: BewuchsStufe): void {
    if (stufe === this.aktuelleStufe) return;
    this.aktuelleStufe = stufe;
    this.ringAbgleichen(true);
    this.warteschlangeFuellen(this.mitte.zx, this.mitte.zy);
  }

  /** Wie viele Pflanzen gerade stehen — fuer die Anzeige. */
  anzahl(): number {
    let n = 0;
    for (const keys of this.fertig.values()) n += keys.length;
    return n;
  }

  /** Wie viele Zonen gerade stehen (auch leere) — fuer Test und Messung. */
  zonenAnzahl(): number {
    return this.fertig.size;
  }

  private imRing(zx: number, zy: number): boolean {
    const r = STUFEN_RADIUS[this.aktuelleStufe];
    return Math.max(Math.abs(zx - this.mitte.zx), Math.abs(zy - this.mitte.zy)) <= r;
  }

  /**
   * Traegt ein, welche stehenden Zonen ausserhalb des Rings liegen (mit der
   * Uhrzeit, zu der sie ihn verlassen haben), und streicht die, die wieder
   * darin liegen. Bereits eingetragene behalten ihren Stempel. Mit `sofort`
   * ist die Frist fuer alle abgelaufen (Stufenwechsel).
   */
  private ringAbgleichen(sofort: boolean): void {
    const stempel = sofort ? this.jetztMs - this.nachlaufMs : this.jetztMs;
    for (const schluessel of this.fertig.keys()) {
      const [zx, zy] = schluessel.split(',').map(Number);
      if (this.imRing(zx, zy)) {
        this.draussen.delete(schluessel);
      } else if (sofort || !this.draussen.has(schluessel)) {
        this.draussen.set(schluessel, stempel);
      }
    }
  }

  /** Baut die aelteste Zone ab, deren Frist um ist — hoechstens eine. */
  private abbauSchritt(): void {
    if (this.draussen.size === 0) return;
    let wahl: string | null = null;
    let aelteste = Infinity;
    for (const [schluessel, seit] of this.draussen) {
      if (this.jetztMs - seit >= this.nachlaufMs && seit < aelteste) {
        wahl = schluessel;
        aelteste = seit;
      }
    }
    if (wahl !== null) this.zoneAbbauen(wahl);
  }

  /** Clear areas of the current placements (same function as the server). */
  private freiflaechenListe: readonly ClearArea[] | null = null;
  private freiflaechen(): readonly ClearArea[] {
    this.freiflaechenListe ??= this.freiflaechenBerechnen();
    return this.freiflaechenListe;
  }

  private freiflaechenBerechnen(): readonly ClearArea[] {
    if (!this.welt.regionGeo) return [];
    const quelle = this.platzierungen?.() ?? this.welt.regionGeo.layout.placements;
    return freiflaechenAusPlatzierungen({ placements: quelle }, freiflaechenHuellen());
  }

  /**
   * Rechnet die Freiflaechen neu (hoechstens alle 250 ms) und streut die
   * Zonen neu, die eine hinzugekommene, entfernte oder veraenderte Flaeche
   * beruehrt — ein Objekt, das der Spieler setzt, verschiebt oder loescht,
   * zeigt sofort denselben Bewuchs, den der Server nach dem Speichern erzeugt.
   */
  private platzierungenPruefen(): void {
    if (this.jetztMs - this.platzierungenGeprueftMs < BewuchsVorschau.PLATZIERUNGEN_PRUEFEN_MS) return;
    this.platzierungenGeprueftMs = this.jetztMs;
    const alt = this.freiflaechenListe;
    if (alt === null) return; // noch nichts gestreut, nichts zu vergleichen
    const neu = this.freiflaechenBerechnen();
    const schl = (a: ClearArea): string => `${a.center.x},${a.center.z},${a.radius}`;
    const vorher = new Set(alt.map(schl));
    const nachher = new Set(neu.map(schl));
    const geaendert = [
      ...alt.filter((a) => !nachher.has(schl(a))),
      ...neu.filter((a) => !vorher.has(schl(a))),
    ];
    if (geaendert.length === 0) return;
    this.freiflaechenListe = neu;
    const rand = 16; // ein Pflanzenradius, wie freiflaechenFuerZone
    for (const a of geaendert) {
      const x0 = Math.floor((a.center.x - a.radius - rand) / 64 + 0.5);
      const x1 = Math.floor((a.center.x + a.radius + rand) / 64 + 0.5);
      const y0 = Math.floor((a.center.z - a.radius - rand) / 64 + 0.5);
      const y1 = Math.floor((a.center.z + a.radius + rand) / 64 + 0.5);
      for (const k of [...this.fertig.keys()]) {
        const [zx, zy] = k.split(',').map(Number);
        if (zx >= x0 && zx <= x1 && zy >= y0 && zy <= y1) this.zoneAbbauen(k);
      }
    }
    this.letzteZone = ''; // Warteschlange beim naechsten Schritt neu fuellen
  }

  /** Gibt die Instanzen einer Zone frei (`removeZDO` je Pflanze) und vergisst sie. */
  private zoneAbbauen(schluessel: string): void {
    for (const k of this.fertig.get(schluessel) ?? []) this.ent.removeZDO(k);
    this.fertig.delete(schluessel);
    this.draussen.delete(schluessel);
    this.ent.flush();
  }

  private warteschlangeFuellen(mx: number, my: number): void {
    const offen: Array<{ zx: number; zy: number; d: number }> = [];
    const radius = STUFEN_RADIUS[this.aktuelleStufe];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const zx = mx + dx;
        const zy = my + dy;
        if (this.fertig.has(`${zx},${zy}`)) continue;
        offen.push({ zx, zy, d: dx * dx + dy * dy });
      }
    }
    // Von innen nach aussen: Was der Spieler vor sich hat, kommt zuerst.
    offen.sort((a, b) => a.d - b.d);
    this.warteschlange = offen.map(({ zx, zy }) => ({ zx, zy }));
  }

  private zoneStreuen(zx: number, zy: number): void {
    const schluessel = `${zx},${zy}`;
    if (this.fertig.has(schluessel)) return;
    const keys: string[] = [];
    let i = 0;
    try {
      streueZone(
        {
          seed: this.welt.seed,
          geo: this.welt.geo,
          heightmaps: this.welt.heightmaps,
          regionGeo: this.welt.regionGeo,
        },
        this.welt.heightmaps.getZone(zx, zy),
        freiflaechenFuerZone(this.freiflaechen(), zx, zy),
        (fund: StreuFund) => {
          const key = `${SCHLUESSEL}-${schluessel}-${i++}`;
          keys.push(key);
          this.ent.applyUpdate({
            key,
            prefabHash: fund.prefabHash,
            position: fund.position,
            rotation: fund.rotation,
            // Der Server schreibt `scaleScalar` nur, wenn die gezogene
            // Groesse von der Prefab-Vorgabe abweicht — hier immer, weil
            // der Zeichner den Vergleich nicht kennt und 1.0 ohnehin
            // nichts aendert.
            scaleScalar: fund.scale,
            isOwn: false,
          } as never);
        }
      );
    } catch {
      // Eine Zone ausserhalb der Heightmap-Reichweite ist kein Fehler,
      // sondern der Rand der Welt — sie bleibt einfach leer.
    }
    this.fertig.set(schluessel, keys);
    this.ent.flush();
  }
}
