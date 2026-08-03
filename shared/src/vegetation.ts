/**
 * Vegetation registry (Phase E) — C++ IZoneManager::Foliage entries parsed
 * 1:1 from the server's vegetation.pkg (tools/prefab-parser/parse-vegetation.ts),
 * with the prefab resolved against the shared registry (entries with unknown
 * prefabs are skipped, exactly like C++ ZoneManager.cpp:219-223).
 */

import vegetationData from './vegetationData.json';
import { getStableHash } from './hash.js';
import { PREFABS_BY_NAME } from './prefabs.js';

/** C++ IZoneManager::Foliage (ZoneManager.h:130-171). */
export interface Foliage {
  /** Prefab name from the pkg (C++ resolves via PrefabManager). */
  readonly prefabName: string;
  /** get_stable_hash(prefabName) — C++ m_prefab->m_hash. */
  readonly prefabHash: number;
  /** Biome bitmask this foliage may spawn in. */
  readonly biome: number;
  /** BiomeArea bitmask (Edge/Median). */
  readonly biomeArea: number;
  /** Min. free radius between two instances (0 = may overlap). */
  readonly radius: number;
  /** Per-zone quantity min/max; max<1 → spawn chance instead. */
  readonly min: number;
  readonly max: number;
  /** Ground normal.y must be within [cos(maxTilt°), cos(minTilt°)]. */
  readonly minTilt: number;
  readonly maxTilt: number;
  readonly groupRadius: number;
  readonly forcePlacement: boolean;
  readonly groupSizeMin: number;
  readonly groupSizeMax: number;
  readonly scaleMin: number;
  readonly scaleMax: number;
  /** Random X/Z tilt in degrees. */
  readonly randTilt: number;
  readonly blockCheck: boolean;
  /** Altitude relative to WATER_LEVEL (30). */
  readonly minAltitude: number;
  readonly maxAltitude: number;
  readonly minOceanDepth: number;
  readonly maxOceanDepth: number;
  readonly terrainDeltaRadius: number;
  readonly minTerrainDelta: number;
  readonly maxTerrainDelta: number;
  readonly inForest: boolean;
  readonly forestTresholdMin: number;
  readonly forestTresholdMax: number;
  readonly snapToWater: boolean;
  readonly snapToStaticSolid: boolean;
  readonly groundOffset: number;
  readonly chanceToUseGroundTilt: number;
  /** Mistlands vegetation mask range. */
  readonly minVegetation: number;
  readonly maxVegetation: number;
}

interface FoliageJson extends Omit<Foliage, 'prefabHash'> {}

/**
 * All 120 foliage entries from vegetation.pkg whose prefab exists in the
 * registry, in pkg order (order matters: rng state is per-entry, but the
 * placed-areas overlap check is order-dependent).
 */
export const FOLIAGE: readonly Foliage[] = buildFoliage();

function buildFoliage(): Foliage[] {
  const list: Foliage[] = [];
  for (const f of vegetationData.foliage as FoliageJson[]) {
    if (!PREFABS_BY_NAME.has(f.prefabName)) {
      console.warn(`[vegetation] Skipping unknown prefab: '${f.prefabName}'`);
      continue;
    }
    list.push({ ...f, prefabHash: getStableHash(f.prefabName) });
  }
  return list;
}

/** Fast membership test for the client's instancing decision (E4). */
export const FOLIAGE_HASHES: ReadonlySet<number> = new Set(FOLIAGE.map((f) => f.prefabHash));
