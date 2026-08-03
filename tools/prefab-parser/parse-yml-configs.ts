/**
 * YAML config converter (Phase F) — converts the C++ server's two location
 * YAML configs into JSON for the shared package, same offline pattern as the
 * pkg parsers (no runtime YAML dependency in shared/client):
 *
 *   data/terrain_modifiers.yml  → shared/src/terrainModifiers.json
 *     (TerrainModifier.cpp:44-77 — ClearArea radius/offset per feature name)
 *   data/location-overrides.yml → shared/src/locationOverrides.json
 *     (ServerSettings locationOverrides — ZoneManager.cpp:1000-1013, 1068-1084,
 *      1259-1266; only active when experimental-location-overrides: true)
 *
 * Usage: npx tsx tools/prefab-parser/parse-yml-configs.ts
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATA_DIR = resolve(__dirname, '../../../valheim.community/data');
const OUTPUT_DIR = resolve(__dirname, '../../shared/src');

function main(): void {
  // ── terrain_modifiers.yml ────────────────────────────────────────
  const tmPath = join(DATA_DIR, 'terrain_modifiers.yml');
  if (!existsSync(tmPath)) {
    console.error(`[ERROR] not found: ${tmPath}`);
    process.exit(1);
  }
  const tmRaw = parseYaml(readFileSync(tmPath, 'utf-8')) as Record<
    string,
    Record<string, unknown>
  >;
  const modifiers: Record<
    string,
    { levelRadius: number; levelOffset: number; smoothRadius: number; smoothPower: number; square: boolean }
  > = {};
  for (const [name, cfg] of Object.entries(tmRaw)) {
    // C++ defaults (TerrainModifier.cpp:60-64)
    modifiers[name] = {
      levelRadius: (cfg.level_radius as number) ?? 5.0,
      levelOffset: (cfg.level_offset as number) ?? -0.2,
      smoothRadius: (cfg.smooth_radius as number) ?? 7.0,
      smoothPower: (cfg.smooth_power as number) ?? 3.0,
      square: (cfg.square as boolean) ?? true,
    };
  }
  const tmOut = join(OUTPUT_DIR, 'terrainModifiers.json');
  writeFileSync(tmOut, JSON.stringify({ modifiers }, null, 1));
  console.log(`  wrote ${Object.keys(modifiers).length} terrain modifiers -> ${tmOut}`);

  // ── location-overrides.yml ───────────────────────────────────────
  const loPath = join(DATA_DIR, 'location-overrides.yml');
  if (!existsSync(loPath)) {
    console.error(`[ERROR] not found: ${loPath}`);
    process.exit(1);
  }
  const loRaw = parseYaml(readFileSync(loPath, 'utf-8')) as Record<
    string,
    Record<string, unknown>
  >;
  interface OverrideJson {
    minAltitude: number;
    snapToTerrain: boolean;
    surroundingCheck: {
      enabled: boolean;
      samplePoints: number;
      minValidPoints: number;
      radiusMultiplier: number;
    };
  }
  const overrides: Record<string, OverrideJson> = {};
  for (const [name, cfg] of Object.entries(loRaw)) {
    if (cfg === null || typeof cfg !== 'object') continue;
    const sc = (cfg['surrounding-check'] ?? {}) as Record<string, unknown>;
    overrides[name] = {
      // C++ semantics: minAltitude < 0 = use original (LocationOverride default)
      minAltitude: (cfg['min-altitude'] as number) ?? -1,
      snapToTerrain: (cfg['snap-to-terrain'] as boolean) ?? false,
      surroundingCheck: {
        enabled: (sc.enabled as boolean) ?? false,
        samplePoints: (sc['sample-points'] as number) ?? 8,
        minValidPoints: (sc['min-valid-points'] as number) ?? 8,
        radiusMultiplier: (sc['radius-multiplier'] as number) ?? 1.0,
      },
    };
  }
  const loOut = join(OUTPUT_DIR, 'locationOverrides.json');
  writeFileSync(loOut, JSON.stringify({ overrides }, null, 1));
  console.log(`  wrote ${Object.keys(overrides).length} location overrides -> ${loOut}`);
  for (const [name, o] of Object.entries(overrides)) {
    console.log(
      `    ${name}: minAltitude=${o.minAltitude} snapToTerrain=${o.snapToTerrain} ` +
        `surrounding=${o.surroundingCheck.enabled} (${o.surroundingCheck.minValidPoints}/${o.surroundingCheck.samplePoints} @ ×${o.surroundingCheck.radiusMultiplier})`
    );
  }
}

main();
