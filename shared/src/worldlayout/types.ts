/**
 * WorldLayout — das Autorformat der designer-definierten Welt.
 *
 * Ein Layout beschreibt Regionen (Polygone/Kreise mit Biom und
 * Terrainparametern) auf einer unbegrenzten Karte. Alles außerhalb von
 * Regionen ist offener Ozean; das Detail INNERHALB einer Region liefern
 * weiterhin die Valheim-Biomhöhenfunktionen (RegionGeo ersetzt nur die
 * radiale Basis). Die Reihenfolge in `regions` ist die Z-Ordnung: spätere
 * Regionen überdecken frühere — so malt man ein Gebirge mitten auf einen
 * Wiesen-Kontinent.
 *
 * Das Dokument ist klein (JSON, typisch < 200 KB) und wird 1:1 an Client
 * und Karten-Worker übertragen; das Laufzeitformat (Distanzfeld) kompiliert
 * jede Seite deterministisch selbst (compile.ts).
 */

import { Biome } from '../types.js';

export const WORLD_LAYOUT_VERSION = 1;

/** Größte erlaubte Ausdehnung: float32-Präzision (~4 mm bei ±50 km). */
export const LAYOUT_MAX_EXTENT = 100_000;

export type BiomeName =
  | 'meadows'
  | 'blackforest'
  | 'swamp'
  | 'mountain'
  | 'plains'
  | 'mistlands'
  | 'ashlands'
  | 'deepnorth';

/** Autorname → Bitmasken-Biom (shared/src/types.ts, Werte aus C++ Types.h). */
export const BIOME_BY_NAME: ReadonlyMap<BiomeName, Biome> = new Map([
  ['meadows', Biome.Meadows],
  ['blackforest', Biome.BlackForest],
  ['swamp', Biome.Swamp],
  ['mountain', Biome.Mountain],
  ['plains', Biome.Plains],
  ['mistlands', Biome.Mistlands],
  ['ashlands', Biome.AshLands],
  ['deepnorth', Biome.DeepNorth],
]);

/**
 * Basis-Plateau je Biom (normierte getBaseHeight-Skala; 0.15 ⇔ Wasserlinie,
 * ×200 = Meter). Die Werte orientieren sich an den Schwellen der radialen
 * Formel: Mountain entschied dort bei base > 0.4, Swamp lebte in 0.05–0.25.
 */
export const DEFAULT_BASE_LEVEL: ReadonlyMap<BiomeName, number> = new Map([
  ['meadows', 0.22],
  ['blackforest', 0.26],
  ['swamp', 0.16],
  ['mountain', 0.5],
  ['plains', 0.22],
  ['mistlands', 0.27],
  ['ashlands', 0.22],
  ['deepnorth', 0.34],
]);

export interface ContinentDef {
  id: string;
  name: string;
  faction?: 'saxon' | 'viking' | 'neutral';
}

export type RegionShape =
  | {
      kind: 'polygon';
      /** Einfaches Polygon (keine Löcher), Weltkoordinaten [x, z] in Metern. */
      points: ReadonlyArray<readonly [number, number]>;
    }
  | { kind: 'circle'; x: number; z: number; radius: number };

export interface RegionDef {
  id: string;
  continentId?: string;
  biome: BiomeName;
  shape: RegionShape;
  /** Küsten-/Grenz-Falloff in Metern — über diese Strecke steigt das Land
   *  vom Ozeanboden auf das Regionsniveau. */
  edgeFalloff: number;
  /** Basis-Plateau (normiert); Default: DEFAULT_BASE_LEVEL des Bioms. */
  baseLevel?: number;
  /** Amplitudenfaktor des Perlin-Details (Default 1). */
  heightScale?: number;
  /** Override für den Waldfaktor (0 = kahl … 2 = dicht); ohne Wert gilt
   *  weiterhin das globale Wald-Perlin. */
  forestDensity?: number;
  /**
   * Kuratierung (Nutzer-Entscheidung: volle Kontrolle je Region).
   * Fehlt ein Feld, gelten die Standard-Tabellen des Bioms (gefiltert über
   * die vorhandenen biome-Bitmasken). Gesetzt = exakt diese Einträge; Namen
   * aus FOLIAGE / FEATURES / SPAWN_TABLE, unbekannte werden serverseitig
   * ignoriert.
   */
  vegetation?: readonly string[];
  locations?: readonly string[];
  spawns?: readonly string[];
}

export interface WorldLayout {
  version: typeof WORLD_LAYOUT_VERSION;
  name: string;
  /** Seed NUR fürs Perlin-Detail (Hügel, Wald, Küstenrauschen). */
  detailSeed: string;
  continents: readonly ContinentDef[];
  /** Z-Ordnung: spätere überdecken frühere. */
  regions: readonly RegionDef[];
}

/** Achsenparallele Hülle einer Form (für Bbox-Checks und den Kompiler). */
export function shapeBounds(shape: RegionShape): {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
} {
  if (shape.kind === 'circle') {
    return {
      minX: shape.x - shape.radius,
      minZ: shape.z - shape.radius,
      maxX: shape.x + shape.radius,
      maxZ: shape.z + shape.radius,
    };
  }
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of shape.points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, minZ, maxX, maxZ };
}

/** Bounding-Box des gesamten Layouts (ohne Falloff-Ränder). */
export function layoutBounds(layout: WorldLayout): {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
} {
  let minX = -1024;
  let minZ = -1024;
  let maxX = 1024;
  let maxZ = 1024;
  for (const r of layout.regions) {
    const b = shapeBounds(r.shape);
    if (b.minX < minX) minX = b.minX;
    if (b.minZ < minZ) minZ = b.minZ;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxZ > maxZ) maxZ = b.maxZ;
  }
  return { minX, minZ, maxX, maxZ };
}
