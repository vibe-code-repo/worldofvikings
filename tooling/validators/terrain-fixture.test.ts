import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CURRENT_WORLD_SCHEMA_VERSION, parseWorldDefinition } from '@wov/world-schema';
import { parseAssetManifest } from '@wov/asset-system/manifest';
import { findMissingTerrainAssets } from './content-references.js';

/**
 * The village tile as a world file (ADR-0020).
 *
 * The game places the same tile from a fixture in `apps/game` rather than from
 * `content/`, because the client does not read world files yet. This test is
 * what keeps the two honest: the numbers the game uses are a valid `terrain` in
 * the real schema, and every asset they name is declared in the manifest — so
 * the format is exercised end to end before any world file depends on it.
 */
const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const fixtureFile = join(repoRoot, 'tooling', 'fixtures', 'worlds', 'village-terrain.json');
const manifestFile = join(repoRoot, 'assets', 'manifest.json');

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8')) as unknown;
}

describe('the village terrain fixture', () => {
  it('is a valid world at the current schema version', async () => {
    const result = parseWorldDefinition(await readJson(fixtureFile));
    expect(result.ok ? [] : result.errors).toEqual([]);
    expect(result.ok && result.world.schemaVersion).toBe(CURRENT_WORLD_SCHEMA_VERSION);
    expect(result.ok && result.migratedFrom).toBeUndefined();
  });

  it('describes a 300 x 300 m tile with six layers in two splat maps', async () => {
    const result = parseWorldDefinition(await readJson(fixtureFile));
    const terrain = result.ok ? result.world.zones[0]?.terrain : undefined;
    expect(terrain?.size).toEqual([300, 300]);
    expect(terrain?.position).toEqual([0, 0, 0]);
    expect(terrain?.layers).toHaveLength(6);
    expect(terrain?.splat).toHaveLength(2);
  });

  it('names only assets the manifest declares', async () => {
    const world = parseWorldDefinition(await readJson(fixtureFile));
    const manifest = parseAssetManifest(await readJson(manifestFile));
    expect(manifest.ok).toBe(true);
    if (!world.ok || !manifest.ok) {
      throw new Error('fixture or manifest did not parse');
    }
    const declared = new Set(manifest.manifest.assets.map((asset) => asset.path));
    expect(findMissingTerrainAssets(world.world, declared)).toEqual([]);
  });
});
