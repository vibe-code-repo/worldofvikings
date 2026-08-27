/**
 * LeereGeo — eine Welt ohne Landmasse.
 *
 * ── Wofür ────────────────────────────────────────────────────────────
 * Eine Dungeon-Instanz ist eine vollwertige Welt (s. `server/src/world/
 * Welt.ts`), nur ohne Gelände: Ihr Boden sind die Bodenplatten der
 * Raum-Bauteile, und die liegen auf y = 0. Sie bekommt deshalb keine
 * abgespeckte Welt, sondern diese Geo — flach, ein Biom, keine Seen,
 * keine Flüsse.
 *
 * Das ist kein Sonderfall im Code, sondern ein WERT. Kommen später
 * Instanzen mit eigener Landmasse dazu, bekommen sie eine echte Geo und
 * sonst nichts Neues; an der Welt selbst ändert sich keine Zeile.
 *
 * ── Warum als Unterklasse ────────────────────────────────────────────
 * `IGeo` ist ein Alias auf `GeoManager` und keine Schnittstelle — die
 * Signaturen im Projekt lauten durchweg `geo: GeoManager`. `RegionGeo`
 * geht denselben Weg: `generate()` überschreiben und die Höhen- und
 * Biomfragen selbst beantworten.
 *
 * Es genügen zwei Überschreibungen für das Gelände. `Heightmap.build`
 * fragt ausschliesslich `getBiome` und `getBiomeHeight` (nachgesehen,
 * nicht vermutet), und `getHeight`/`getGenerationHeight` der Basisklasse
 * gehen beide durch `getBiomeHeight`.
 *
 * ── Was der Boden auf 0 bedeutet ─────────────────────────────────────
 * Die Wasserlinie der Vorlage liegt bei 30 m. Eine Instanz liegt damit
 * rechnerisch „unter Wasser", und das ist folgenlos: Der Client zeichnet
 * in der Instanz kein Gelände und kein Wasser, und das Spawnsystem einer
 * Instanz bekommt eine leere Tabelle. Wer hier später Wasser haben will,
 * hebt den Boden über 30 statt die Wasserlinie zu senken — die steckt in
 * der Heightmap und gilt für alle Welten.
 */

import { GeoManager } from './GeoManager.js';
import { Biome } from '../types.js';

/**
 * Bodenhöhe einer leeren Welt in Metern.
 *
 * 0, weil die Bauteile eines Dungeons ihren Ursprung auf dem Boden haben
 * und der Instanz-Ursprung auf (0, 0, 0) liegt. Die Zahl ist damit keine
 * Einstellung, sondern die Fortsetzung des Bauteil-Vertrags.
 */
export const LEERE_WELT_BODEN_M = 0;

export class LeereGeo extends GeoManager {
  constructor(worldSeed = 0) {
    super(worldSeed);
  }

  /** Keine Seen, keine Flüsse, keine Ströme — es gibt kein Gelände. */
  protected override generate(): void {
    // Absichtlich leer.
  }

  override getBiome(): Biome {
    return Biome.Meadows;
  }

  override getBaseHeight(): number {
    return 0;
  }

  override getBiomeHeight(): { height: number; mask: number } {
    return { height: LEERE_WELT_BODEN_M, mask: 0 };
  }

  override getForestFactor(): number {
    return 0;
  }
}
