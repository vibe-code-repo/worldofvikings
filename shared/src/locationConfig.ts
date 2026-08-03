/**
 * Location config (Phase F) — the C++ server's two location YAML configs,
 * converted offline to JSON (tools/prefab-parser/parse-yml-configs.ts):
 *
 *   terrainModifiers  — C++ TerrainModifier::GetFeatureModifierParams
 *     (TerrainModifier.cpp:148-160): ClearArea radius/offset for features
 *     whose pkg clearArea flag is false but which flatten terrain
 *     client-side (houses, runestones, …).
 *   locationOverrides — C++ ServerSettings::locationOverrides
 *     (ZoneManager.cpp:1000-1013, 1068-1084, 1259-1266): per-location
 *     min-altitude, surrounding terrain check, snap-to-terrain.
 *     Only active when the server enables experimental-location-overrides.
 */

import terrainModifiersData from './terrainModifiers.json';
import locationOverridesData from './locationOverrides.json';
import { getStableHash } from './hash.js';
import type { Feature } from './features.js';

export interface TerrainModifierParams {
  /** C++ level_radius — ClearArea radius. */
  readonly radius: number;
  /** C++ level_offset (unused for ClearArea, kept for Phase G terrain mods). */
  readonly offset: number;
}

/**
 * C++ TerrainModifier::GetFeatureModifierParams — hash-keyed lookup
 * (get_stable_hash(featureName)). Returns null when the feature has no
 * modifier config.
 */
export function getFeatureModifierParams(featureName: string): TerrainModifierParams | null {
  const entry = MODIFIERS_BY_HASH.get(getStableHash(featureName));
  return entry ? { radius: entry.levelRadius, offset: entry.levelOffset } : null;
}

/** Full terrain modifier config entry (terrain_modifiers.yml). */
export interface ModifierJson {
  levelRadius: number;
  levelOffset: number;
  smoothRadius: number;
  smoothPower: number;
  square: boolean;
}

const MODIFIERS_BY_HASH: ReadonlyMap<number, ModifierJson> = new Map(
  Object.entries(terrainModifiersData.modifiers as Record<string, ModifierJson>).map(
    ([name, cfg]) => [getStableHash(name), cfg]
  )
);

/**
 * Terrain leveling parameters for a feature (Phase F4).
 *
 * In original Valheim, location prefabs carry Unity TerrainModifier
 * components that flatten the ground under the location (client-side).
 * The C++ reference server does NOT level terrain — this is a deliberate,
 * documented deviation with Unity parity: without it, location pieces
 * float on slopes (pieces are booked relative to the feature center).
 *
 * Rule (which features level):
 *  1. Feature listed in terrain_modifiers.yml (35 entries: WoodHouse*,
 *     Runestone_*, Dolmen*, SunkenCrypt, TrollCave, StoneTower, …)
 *     → the yml parameters.
 *  2. Otherwise feature.clearArea (StartTemple, boss altars, …)
 *     → levelRadius = exteriorRadius, everything else = C++
 *     GetFeatureModifierParams defaults (TerrainModifier.cpp:148-160:
 *     offset −0.2, smoothRadius 7, smoothPower 3, square true).
 *  3. Otherwise → null (no leveling: boulders, ships, tar pits, …).
 */
export function getTerrainLeveling(feature: Feature): ModifierJson | null {
  const entry = MODIFIERS_BY_HASH.get(feature.hash);
  if (entry) return entry;
  if (feature.clearArea) {
    // Radius auf die PIECE-Grundfläche beschränken: exteriorRadius ist der
    // Vegetations-Freiraum, nicht die Bau-Grundfläche. 74 Features tragen
    // 12-32 m (StartTemple 25, Boss-Altäre und Mistlands-Türme bis 32) —
    // ungekappt entstanden daraus 64-m-Terrassen mit harten 6-m-Kanten
    // mitten im Gelände (vom Nutzer am Holzhaus neben dem Steinkreis
    // gemeldet, 2026-08-02: die "abgesackte" Fläche war die Kante des
    // Tempel-Plateaus). Geebnet wird jetzt genau so weit, wie Pieces
    // stehen (+2 m Saum, hart gedeckelt), der Rest bleibt natürliches
    // Gelände; der Übergang wächst mit dem Radius, damit keine Klippe
    // stehen bleibt. Vanilla ebnet ebenfalls nur unter den Bauten.
    let pieceRadius = 0;
    for (const p of feature.pieces) {
      const d = Math.hypot(p.pos.x, p.pos.z);
      if (d > pieceRadius) pieceRadius = d;
    }
    const levelRadius = Math.min(feature.exteriorRadius, pieceRadius + 2, 16);
    return {
      levelRadius,
      levelOffset: -0.2,
      smoothRadius: Math.max(7.0, levelRadius),
      smoothPower: 3.0,
      square: true,
    };
  }
  return null;
}

export interface SurroundingCheck {
  readonly enabled: boolean;
  readonly samplePoints: number;
  readonly minValidPoints: number;
  readonly radiusMultiplier: number;
}

/** C++ ServerSettings::LocationOverride. */
export interface LocationOverride {
  /** >= 0 overrides the feature's minAltitude; < 0 keeps the original. */
  readonly minAltitude: number;
  readonly snapToTerrain: boolean;
  readonly surroundingCheck: SurroundingCheck;
}

const OVERRIDES = locationOverridesData.overrides as Record<string, LocationOverride>;

/** C++ VAL_SETTINGS.locationOverrides lookup by feature name. */
export function getLocationOverride(featureName: string): LocationOverride | null {
  return OVERRIDES[featureName] ?? null;
}
