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
 *  - Keine `clearAreas`: Der Client kennt die Locations nicht, die der
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
 * Eine Zone faellt erst NACHLAUF_BILDER Bilder nach dem Verlassen des
 * Rings weg. Ohne diese Frist flackerte der Rand: Wer an einer
 * Zonengrenze hin- und herfliegt, liesse jedes Mal eine Randzone bauen
 * (11 ms) und wieder abbauen. In Ruhe (nach der Frist) steht genau der
 * Ring, nicht mehr.
 *
 * ── Stufen (K2.1) ────────────────────────────────────────────────────
 * `voll` = der bisherige 5x5-Ring, `klein` = 3x3, `aus` = nichts. Die
 * Vorschau ist der groesste Einzelposten im Bild (Messung M2.0: ruhig
 * 14,1 -> 9,2 ms ohne sie), und wer Objekte setzt, braucht den Bewuchs
 * nicht in voller Dichte. Ein Wechsel baut die ueberzaehligen Zonen
 * ebenfalls eine je Bild ab, ohne Frist.
 */

import { streueZone, type ClientWorldLike, type StreuFund } from './bewuchsTypen';
import type { EntityManager } from '../entities/EntityManager';

/** Wie viel die Vorschau zeigt: voll = 5x5 Zonen, klein = 3x3, aus = nichts. */
export type BewuchsStufe = 'voll' | 'klein' | 'aus';

/** Die Stufen in der Reihenfolge, in der die Taste sie durchschaltet. */
export const BEWUCHS_STUFEN_LISTE: readonly BewuchsStufe[] = ['voll', 'klein', 'aus'];

/** Radius in Zonen um den Spieler je Stufe (2 = 5x5 Zonen = 320 m Kantenlaenge); -1 = leer. */
export const STUFEN_RADIUS: Readonly<Record<BewuchsStufe, number>> = { voll: 2, klein: 1, aus: -1 };

/**
 * Bilder, die eine Zone ausserhalb des Rings noch stehen bleibt, bevor sie
 * abgebaut wird (60 = etwa eine Sekunde). Klein gewaehlt: Bei 45 m/s
 * (0,75 m je Bild) bleibt so hoechstens eine Zonenreihe (64 m) hinter dem
 * Ring stehen; laenger wuerde der Bestand im Flug spuerbar ueber den Ring
 * hinauswachsen.
 */
export const NACHLAUF_BILDER = 60;

/** Praefix der Entity-Schluessel — muss sich von `edplace-` unterscheiden. */
const SCHLUESSEL = 'bewuchs';

export class BewuchsVorschau {
  /** Bereits gestreute Zonen (Schluessel "zx,zy") mit ihren Entity-Keys. */
  private readonly fertig = new Map<string, string[]>();
  /** Noch zu streuende Zonen, naechste zuerst. */
  private warteschlange: Array<{ zx: number; zy: number }> = [];
  /**
   * Zonen ausserhalb des Rings und das Bild, in dem sie ihn verlassen haben.
   * Kehrt der Spieler zurueck, verschwindet der Eintrag; ist die Frist um,
   * baut `abbauSchritt` die Zone ab.
   */
  private readonly draussen = new Map<string, number>();
  private letzteZone = '';
  private mitte = { zx: 0, zy: 0 };
  private bild = 0;
  private aktuelleStufe: BewuchsStufe = 'voll';

  constructor(
    private readonly welt: ClientWorldLike,
    private readonly ent: EntityManager,
    private readonly nachlaufBilder = NACHLAUF_BILDER
  ) {}

  /**
   * Je Aufruf hoechstens eine Zone gestreut UND hoechstens eine abgebaut —
   * siehe Zeitbudget und Aufraeumen im Kopfkommentar.
   *
   * Der Aufrufer ruft das pro Bild; die Warteschlange wird nur dann neu
   * gefuellt, wenn der Spieler die Zone gewechselt hat. Ohne diese
   * Bedingung liefe die Suche nach fehlenden Zonen 60-mal je Sekunde
   * ueber 25 Eintraege, obwohl sich nichts geaendert hat.
   */
  schritt(spielerX: number, spielerZ: number): void {
    this.bild++;
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
   * Traegt ein, welche stehenden Zonen ausserhalb des Rings liegen (mit dem
   * Bild, in dem sie ihn verlassen haben), und streicht die, die wieder
   * darin liegen. Bereits eingetragene behalten ihren Stempel. Mit `sofort`
   * ist die Frist fuer alle abgelaufen (Stufenwechsel).
   */
  private ringAbgleichen(sofort: boolean): void {
    const stempel = sofort ? this.bild - this.nachlaufBilder : this.bild;
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
      if (this.bild - seit >= this.nachlaufBilder && seit < aelteste) {
        wahl = schluessel;
        aelteste = seit;
      }
    }
    if (wahl !== null) this.zoneAbbauen(wahl);
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
        [],
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
