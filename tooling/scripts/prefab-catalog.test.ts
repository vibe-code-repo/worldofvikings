import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePrefabCatalog } from '@wov/world-schema';
import type { AssetEntry } from '@wov/asset-system/manifest';
import {
  IMPORTED_CATALOG_ID,
  buildImportedCatalog,
  prefabIdFromAssetPath,
  prefabNameFromAssetPath,
  repoRoot,
} from './prefab-catalog.js';

function entry(overrides: Partial<AssetEntry> & Pick<AssetEntry, 'path'>): AssetEntry {
  return {
    id: 'x/y',
    kind: 'mesh',
    bytes: 1,
    hash: `sha256-${'0'.repeat(64)}`,
    bounds: { min: [-1, 0, -1], max: [1, 2, 1] },
    origin: 'test',
    source: 'test',
    author: 'test',
    license: 'CC0-1.0',
    redistributable: true,
    visibility: 'public',
    ...overrides,
  } as AssetEntry;
}

/** An entry without bounds — a texture, or a placeholder box. */
function boundlessEntry(overrides: Partial<AssetEntry> & Pick<AssetEntry, 'path'>): AssetEntry {
  const { bounds: _bounds, ...rest } = entry(overrides);
  return rest as AssetEntry;
}

describe('prefabIdFromAssetPath', () => {
  it('flattens the path into one identifier the world schema accepts', () => {
    expect(prefabIdFromAssetPath('vegetation/pine-1b1.glb')).toBe('vegetation-pine-1b1');
    expect(prefabIdFromAssetPath('environment/kenney-retro-fantasy-kit/detail-barrel.glb')).toBe(
      'environment-kenney-retro-fantasy-kit-detail-barrel',
    );
    expect(prefabIdFromAssetPath('environment/SM_Prop_Barrel_01.GLB')).toBe(
      'environment-sm-prop-barrel-01',
    );
  });
});

describe('prefabNameFromAssetPath', () => {
  it('drops the export prefix and title-cases the rest', () => {
    expect(prefabNameFromAssetPath('environment/sm-prop-barrel-01.glb')).toBe('Barrel 01');
    expect(prefabNameFromAssetPath('vegetation/pine-1b1.glb')).toBe('Pine 1b1');
    expect(prefabNameFromAssetPath('terrain/terrainl1.glb')).toBe('Terrainl1');
  });
});

describe('buildImportedCatalog', () => {
  const assets: AssetEntry[] = [
    entry({
      path: 'vegetation/pine-1b1.glb',
      kind: 'prefab',
      visibility: 'private',
      placeholder: 'placeholders/vegetation/pine-1b1.glb',
    }),
    entry({ path: 'environment/sm-prop-barrel-01.glb' }),
    entry({ path: 'environment/sm-env-rock-01.glb' }),
    entry({ path: 'terrain/terrainl1.glb', kind: 'terrain' }),
    boundlessEntry({ path: 'textures/pine-1.png', kind: 'texture' }),
    boundlessEntry({ path: 'placeholders/vegetation/pine-1b1.glb' }),
  ];

  it('makes one prefab per geometry asset, skipping textures and placeholders', () => {
    const catalog = buildImportedCatalog(assets);
    expect(catalog.id).toBe(IMPORTED_CATALOG_ID);
    expect(catalog.prefabs.map((prefab) => prefab.asset)).toEqual([
      'environment/sm-env-rock-01.glb',
      'environment/sm-prop-barrel-01.glb',
      'terrain/terrainl1.glb',
      'vegetation/pine-1b1.glb',
    ]);
  });

  it('takes the category from the path and the export marker', () => {
    const byId = new Map(buildImportedCatalog(assets).prefabs.map((p) => [p.id, p]));
    expect(byId.get('environment-sm-prop-barrel-01')?.category).toBe('prop');
    expect(byId.get('environment-sm-env-rock-01')?.category).toBe('environment');
    expect(byId.get('vegetation-pine-1b1')?.category).toBe('vegetation');
    expect(byId.get('terrain-terrainl1')?.category).toBe('terrain');
  });

  it('carries visibility, placeholder and bounds over from the manifest', () => {
    const pine = buildImportedCatalog(assets).prefabs.find((p) => p.id === 'vegetation-pine-1b1');
    expect(pine).toMatchObject({
      visibility: 'private',
      placeholder: 'placeholders/vegetation/pine-1b1.glb',
      bounds: { min: [-1, 0, -1], max: [1, 2, 1] },
    });
    const barrel = buildImportedCatalog(assets).prefabs.find(
      (p) => p.id === 'environment-sm-prop-barrel-01',
    );
    expect(barrel?.visibility).toBe('public');
    expect(barrel && 'placeholder' in barrel).toBe(false);
  });

  it('is deterministic: the same manifest produces the same catalog', () => {
    expect(buildImportedCatalog(assets)).toEqual(buildImportedCatalog([...assets].reverse()));
  });

  it('produces a catalog the world schema accepts', () => {
    expect(parsePrefabCatalog(buildImportedCatalog(assets)).ok).toBe(true);
  });

  it('refuses to invent an id twice', () => {
    expect(() =>
      buildImportedCatalog([
        entry({ path: 'environment/rock-01.glb' }),
        entry({ path: 'environment/rock_01.glb' }),
      ]),
    ).toThrow(/rock-01/);
  });
});

describe('content/prefabs/imported.json', () => {
  it('is what the current manifest generates — regenerate with `pnpm generate:prefabs`', async () => {
    const manifest = JSON.parse(
      await readFile(join(repoRoot, 'assets', 'manifest.json'), 'utf8'),
    ) as { assets: AssetEntry[] };
    const committed = JSON.parse(
      await readFile(join(repoRoot, 'content', 'prefabs', 'imported.json'), 'utf8'),
    ) as unknown;

    expect(committed).toEqual(buildImportedCatalog(manifest.assets));
  });
});
