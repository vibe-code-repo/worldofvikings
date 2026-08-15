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
 */

import { streueZone, type ClientWorldLike, type StreuFund } from './bewuchsTypen';
import type { EntityManager } from '../entities/EntityManager';

/** Radius in Zonen um den Spieler (2 = 5x5 Zonen = 320 m Kantenlaenge). */
const ZONEN_RADIUS = 2;

/** Praefix der Entity-Schluessel — muss sich von `edplace-` unterscheiden. */
const SCHLUESSEL = 'bewuchs';

export class BewuchsVorschau {
  /** Bereits gestreute Zonen (Schluessel "zx,zy") mit ihren Entity-Keys. */
  private readonly fertig = new Map<string, string[]>();
  /** Noch zu streuende Zonen, naechste zuerst. */
  private warteschlange: Array<{ zx: number; zy: number }> = [];
  private letzteZone = '';

  constructor(
    private readonly welt: ClientWorldLike,
    private readonly ent: EntityManager
  ) {}

  /**
   * Je Aufruf hoechstens eine Zone — siehe Zeitbudget im Kopfkommentar.
   *
   * Der Aufrufer ruft das pro Bild; die Warteschlange wird nur dann neu
   * gefuellt, wenn der Spieler die Zone gewechselt hat. Ohne diese
   * Bedingung liefe die Suche nach fehlenden Zonen 60-mal je Sekunde
   * ueber 25 Eintraege, obwohl sich nichts geaendert hat.
   */
  schritt(spielerX: number, spielerZ: number): void {
    const zx = Math.floor(spielerX / 64 + 0.5);
    const zy = Math.floor(spielerZ / 64 + 0.5);
    const jetzt = `${zx},${zy}`;
    if (jetzt !== this.letzteZone) {
      this.letzteZone = jetzt;
      this.warteschlangeFuellen(zx, zy);
    }
    const naechste = this.warteschlange.shift();
    if (naechste) this.zoneStreuen(naechste.zx, naechste.zy);
  }

  /** Alles verwerfen — nach einer Aenderung am Entwurf. */
  neuAufbauen(): void {
    for (const keys of this.fertig.values()) {
      for (const k of keys) this.ent.removeZDO(k);
    }
    this.fertig.clear();
    this.warteschlange = [];
    this.letzteZone = '';
    this.ent.flush();
  }

  /** Wie viele Pflanzen gerade stehen — fuer die Anzeige. */
  anzahl(): number {
    let n = 0;
    for (const keys of this.fertig.values()) n += keys.length;
    return n;
  }

  private warteschlangeFuellen(mx: number, my: number): void {
    const offen: Array<{ zx: number; zy: number; d: number }> = [];
    for (let dy = -ZONEN_RADIUS; dy <= ZONEN_RADIUS; dy++) {
      for (let dx = -ZONEN_RADIUS; dx <= ZONEN_RADIUS; dx++) {
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
