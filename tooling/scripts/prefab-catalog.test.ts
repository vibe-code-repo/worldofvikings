import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePrefabCatalog } from '@wov/world-schema';
import type { AssetEntry } from '@wov/asset-system/manifest';
import type { Bounds } from '../asset-pipeline/glb.js';
import {
  IMPORTED_CATALOG_ID,
  buildImportedCatalog,
  colliderPathFor,
  isColliderAsset,
  prefabIdFromAssetPath,
  prefabNameFromAssetPath,
  repoRoot,
} from './prefab-catalog.js';

/** A measured trunk, so the fixtures do not need the private store. */
const PINE_TRUNK: Bounds = { min: [-0.4, 0, -0.4], max: [0.4, 2, 0.4] };

const trunkBoxes = new Map<string, Bounds>([['vegetation/pine-1b1.glb', PINE_TRUNK]]);

/** `buildImportedCatalog` with the measurements a tree needs. */
function build(assets: readonly AssetEntry[], boxes = trunkBoxes) {
  return buildImportedCatalog(assets, { trunkBoxes: boxes });
}

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
    const catalog = build(assets);
    expect(catalog.id).toBe(IMPORTED_CATALOG_ID);
    expect(catalog.prefabs.map((prefab) => prefab.asset)).toEqual([
      'environment/sm-env-rock-01.glb',
      'environment/sm-prop-barrel-01.glb',
      'terrain/terrainl1.glb',
      'vegetation/pine-1b1.glb',
    ]);
  });

  it('takes the category from the path and the export marker', () => {
    const byId = new Map(build(assets).prefabs.map((p) => [p.id, p]));
    expect(byId.get('environment-sm-prop-barrel-01')?.category).toBe('prop');
    expect(byId.get('environment-sm-env-rock-01')?.category).toBe('environment');
    expect(byId.get('vegetation-pine-1b1')?.category).toBe('vegetation');
    expect(byId.get('terrain-terrainl1')?.category).toBe('terrain');
  });

  it('carries visibility, placeholder and bounds over from the manifest', () => {
    const pine = build(assets).prefabs.find((p) => p.id === 'vegetation-pine-1b1');
    expect(pine).toMatchObject({
      visibility: 'private',
      placeholder: 'placeholders/vegetation/pine-1b1.glb',
      bounds: { min: [-1, 0, -1], max: [1, 2, 1] },
    });
    const barrel = build(assets).prefabs.find((p) => p.id === 'environment-sm-prop-barrel-01');
    expect(barrel?.visibility).toBe('public');
    expect(barrel && 'placeholder' in barrel).toBe(false);
  });

  it('is deterministic: the same manifest produces the same catalog', () => {
    expect(build(assets)).toEqual(build([...assets].reverse()));
  });

  it('produces a catalog the world schema accepts', () => {
    expect(parsePrefabCatalog(build(assets)).ok).toBe(true);
  });

  it('refuses to invent an id twice', () => {
    expect(() =>
      build([
        entry({ path: 'environment/rock-01.glb' }),
        entry({ path: 'environment/rock_01.glb' }),
      ]),
    ).toThrow(/rock-01/);
  });
});

describe('collision defaults', () => {
  const barrel = entry({ path: 'environment/sm-prop-barrel-01.glb' });
  const pine = entry({
    path: 'vegetation/pine-1b1.glb',
    visibility: 'private',
    placeholder: 'placeholders/vegetation/pine-1b1.glb',
  });

  function collisionOf(assets: readonly AssetEntry[], id: string) {
    return build(assets).prefabs.find((prefab) => prefab.id === id)?.collision;
  }

  it('boxes scenery and props', () => {
    expect(collisionOf([barrel], 'environment-sm-prop-barrel-01')).toEqual({ kind: 'box' });
  });

  it('gives the ground every triangle', () => {
    expect(
      collisionOf([entry({ path: 'terrain/terrainl1.glb', kind: 'terrain' })], 'terrain-terrainl1'),
    ).toEqual({ kind: 'mesh' });
  });

  it('walks through grass and bushes', () => {
    expect(
      collisionOf([entry({ path: 'vegetation/bush-1a1.glb' })], 'vegetation-bush-1a1'),
    ).toEqual({ kind: 'none' });
  });

  it('collides a tree against its measured trunk, not its crown', () => {
    expect(collisionOf([pine], 'vegetation-pine-1b1')).toEqual({ kind: 'box', box: PINE_TRUNK });
  });

  it('refuses to file a crown as a trunk when nothing was measured', () => {
    expect(() => build([pine], new Map())).toThrow(/trunk/);
  });

  it('leaves an opening open by colliding against its triangles', () => {
    expect(
      collisionOf(
        [entry({ path: 'environment/sm-prop-archway-01.glb' })],
        'environment-sm-prop-archway-01',
      ),
    ).toEqual({ kind: 'mesh' });
  });

  it('uses a hand-made collider file where the export has one', () => {
    const house = entry({ path: 'environment/sm-bld-house-01.glb' });
    const collider = entry({
      path: 'environment/sm-bld-house-01-collision.glb',
      visibility: 'private',
      placeholder: 'placeholders/environment/sm-bld-house-01-collision.glb',
    });
    expect(collisionOf([house, collider], 'environment-sm-bld-house-01')).toEqual({
      kind: 'mesh',
      asset: {
        path: 'environment/sm-bld-house-01-collision.glb',
        visibility: 'private',
        placeholder: 'placeholders/environment/sm-bld-house-01-collision.glb',
      },
    });
  });

  it('does not make a prefab out of a collider file', () => {
    const collider = entry({ path: 'environment/sm-bld-house-01-collision.glb' });
    expect(build([collider]).prefabs).toEqual([]);
    expect(isColliderAsset('environment/sm-bld-house-01-collision.glb')).toBe(true);
    expect(isColliderAsset('environment/sm-bld-house-01.glb')).toBe(false);
    expect(colliderPathFor('environment/sm-bld-house-01.glb')).toBe(
      'environment/sm-bld-house-01-collision.glb',
    );
  });
});

/** The committed prefabs that carry a measured trunk box, with their hull. */
async function committedTrees(): Promise<{ id: string; box: Bounds; hull: Bounds }[]> {
  const committed = JSON.parse(
    await readFile(join(repoRoot, 'content', 'prefabs', 'imported.json'), 'utf8'),
  ) as { prefabs: { id: string; bounds?: Bounds; collision?: { box?: Bounds } }[] };

  const trees = committed.prefabs.flatMap((prefab) =>
    prefab.collision?.box !== undefined && prefab.bounds !== undefined
      ? [{ id: prefab.id, box: prefab.collision.box, hull: prefab.bounds }]
      : [],
  );
  expect(trees.length).toBeGreaterThan(0);
  return trees;
}

describe('content/prefabs/imported.json', () => {
  it('is what the current manifest generates — regenerate with `pnpm generate:prefabs`', async () => {
    const manifest = JSON.parse(
      await readFile(join(repoRoot, 'assets', 'manifest.json'), 'utf8'),
    ) as { assets: AssetEntry[] };
    const committed = JSON.parse(
      await readFile(join(repoRoot, 'content', 'prefabs', 'imported.json'), 'utf8'),
    ) as { prefabs: { asset: string; collision?: { box?: Bounds } }[] };

    // Trunks are measured on models in the private store, which a clone does
    // not have. They are read back out of the committed file here and the rule
    // they must satisfy is checked in the next test instead; everything else is
    // regenerated from the manifest and compared field for field.
    const committedTrunks = new Map<string, Bounds>();
    for (const prefab of committed.prefabs) {
      if (prefab.collision?.box !== undefined) {
        committedTrunks.set(prefab.asset, prefab.collision.box);
      }
    }

    expect(committed).toEqual(
      buildImportedCatalog(manifest.assets, { trunkBoxes: committedTrunks }),
    );
  });

  it('never measures a trunk wider than the model it came from', async () => {
    for (const tree of await committedTrees()) {
      const { id, box, hull } = tree;
      for (const axis of [0, 2]) {
        expect(box.min[axis], `${id} axis ${String(axis)}`).toBeGreaterThanOrEqual(
          hull.min[axis] - 1e-6,
        );
        expect(box.max[axis], `${id} axis ${String(axis)}`).toBeLessThanOrEqual(
          hull.max[axis] + 1e-6,
        );
      }
      // The full height is kept, so nothing walks through the crown either.
      expect(box.max[1] - box.min[1], id).toBeCloseTo(hull.max[1] - hull.min[1], 3);
    }
  });

  it('collides a tree with a crown against far less than that crown', async () => {
    const crowned = (await committedTrees()).filter(
      (tree) => tree.hull.max[0] - tree.hull.min[0] > 2,
    );
    expect(crowned.length).toBeGreaterThan(0);
    for (const tree of crowned) {
      const trunkWidth = tree.box.max[0] - tree.box.min[0];
      const crownWidth = tree.hull.max[0] - tree.hull.min[0];
      expect(trunkWidth, tree.id).toBeLessThan(crownWidth / 3);
    }
  });
});
