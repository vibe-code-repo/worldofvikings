/**
 * Feature (zone location) registry (Phase F) — C++ IZoneManager::Feature
 * entries parsed 1:1 from the server's features.pkg
 * (tools/prefab-parser/parse-features.ts), in pkg order (order matters:
 * m_features is iterated for placement).
 *
 * C++ reference: ZoneManager.cpp:48-157 (pkg read), ZoneManager.h:71-114.
 */

import featuresData from './featuresData.json';
import { getStableHash } from './hash.js';

/** C++ Prefab::Instance::RandomSpawn (Prefab.h:12-18). */
export interface FeatureRandomSpawn {
  readonly chanceToSpawn: number;
  readonly notInLava: boolean;
  readonly minElevation: number;
  readonly maxElevation: number;
}

/** C++ Prefab::Instance (piece of a feature). */
export interface FeaturePiece {
  /** Name from the pkg (0.221.6 added names). */
  readonly pieceName: string;
  /** Stable prefab hash from the pkg (C++ m_prefabHash). */
  readonly prefabHash: number;
  /** Position relative to the feature origin. */
  readonly pos: { readonly x: number; readonly y: number; readonly z: number };
  /** Rotation relative to the feature origin. */
  readonly rot: { readonly x: number; readonly y: number; readonly z: number; readonly w: number };
  /** RandomSpawn data merged onto this piece (null = always spawns). */
  readonly randomSpawn: FeatureRandomSpawn | null;
}

/** C++ IZoneManager::Feature (ZoneManager.h:71-114). */
export interface Feature {
  readonly name: string;
  /** get_stable_hash(name) — C++ m_hash. */
  readonly hash: number;
  readonly biome: number;
  readonly biomeArea: number;
  readonly applyRandomDamage: boolean;
  readonly centerFirst: boolean;
  readonly clearArea: boolean;
  readonly exteriorRadius: number;
  readonly interiorRadius: number;
  readonly forestTresholdMin: number;
  readonly forestTresholdMax: number;
  readonly group: string;
  readonly iconAlways: boolean;
  readonly iconPlaced: boolean;
  readonly inForest: boolean;
  readonly minAltitude: number;
  readonly maxAltitude: number;
  readonly minDistance: number;
  readonly maxDistance: number;
  readonly minTerrainDelta: number;
  readonly maxTerrainDelta: number;
  readonly minDistanceFromSimilar: number;
  readonly spawnAttempts: number;
  readonly quantity: number;
  readonly randomRotation: boolean;
  readonly slopeRotation: boolean;
  readonly snapToWater: boolean;
  readonly unique: boolean;
  readonly pieces: readonly FeaturePiece[];
}

interface FeatureJson extends Omit<Feature, 'hash'> {}

/** All 146 features from features.pkg, in pkg order. */
export const FEATURES: readonly Feature[] = (featuresData.features as FeatureJson[]).map((f) => ({
  ...f,
  hash: getStableHash(f.name),
}));

export const FEATURES_BY_NAME: ReadonlyMap<string, Feature> = new Map(
  FEATURES.map((f) => [f.name, f])
);

export const FEATURES_BY_HASH: ReadonlyMap<number, Feature> = new Map(
  FEATURES.map((f) => [f.hash, f])
);

/** Lookup by get_stable_hash(name) — e.g. the 'location' member of a LocationProxy ZDO. */
export function getFeatureByHash(hash: number): Feature | undefined {
  return FEATURES_BY_HASH.get(hash);
}
