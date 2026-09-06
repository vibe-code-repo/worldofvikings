import { describe, expect, it } from 'vitest';
import { assetIdFromPath } from '@wov/asset-system/manifest';
import {
  ENVIRONMENT_SET,
  TERRAIN_SET,
  VEGETATION_SET,
  isSelection,
  originShiftFor,
  select,
  sizeLimitFor,
  toKebab,
} from './selection.js';
import type { Bounds } from './glb.js';

function taken(folder: string, file: string) {
  const result = select(folder, file);
  if (!isSelection(result)) {
    throw new Error(`expected "${file}" to be selected, but: ${result.reason}`);
  }
  return result;
}

function refused(folder: string, file: string): string {
  const result = select(folder, file);
  if (isSelection(result)) {
    throw new Error(`expected "${file}" to be left out, but it became ${result.id}`);
  }
  return result.reason;
}

describe('what is taken', () => {
  it('takes scenery, buildings, props and items as environment', () => {
    expect(taken('Mesh', 'SM_Env_Rock_03.glb').id).toBe('environment/sm-env-rock-03');
    expect(taken('Mesh', 'SM_Bld_Wall_01.glb').group).toBe('environment');
    expect(taken('Mesh', 'SM_Prop_Barrel_01.glb').group).toBe('environment');
    expect(taken('Mesh', 'SM_Item_Pot_01.glb').group).toBe('environment');
  });

  it('takes every named tree, bush and grass family as vegetation', () => {
    for (const file of [
      'Tree_1A3.glb',
      'Pine_1B1_0.glb',
      'Bush_1A2 (Small) 1 Snow.glb',
      'Grass_Short_Clump_Yellow.glb',
      'Massive_Tree_1A1 1 Dark.glb',
      'Split_Tree_1A2 1 Dark.glb',
      'Branched_Tree_2A1.glb',
      'SM_Plant_Mushrooms_02.glb',
    ]) {
      expect(taken('PrefabHierarchyObject', file).group).toBe('vegetation');
    }
  });

  it('takes every terrain, whatever it is called', () => {
    expect(taken('TerrainData', 'TerrainL1.glb')).toMatchObject({
      group: 'terrain',
      kind: 'terrain',
      path: 'terrain/terrainl1.glb',
    });
    expect(taken('TerrainData', 'Terrain Customization.glb').id).toBe(
      'terrain/terrain-customization',
    );
  });

  it('records the folder it came from as the kind', () => {
    expect(taken('Mesh', 'SM_Env_Rock_03.glb').kind).toBe('mesh');
    expect(taken('PrefabHierarchyObject', 'SM_Env_Rock_03 1.glb').kind).toBe('prefab');
  });
});

describe('what is left out, and why it says so', () => {
  it('leaves out characters, weapons, vehicles and the sky dome', () => {
    expect(refused('Mesh', 'SM_Chr_Goblin_01.glb')).toMatch(/character/);
    expect(refused('Mesh', 'SM_Wep_Axe_01.glb')).toMatch(/weapon/);
    expect(refused('Mesh', 'SM_Veh_Cart_01.glb')).toMatch(/vehicle/);
    expect(refused('Mesh', 'SM_Generic_SkyDome_02.glb')).toMatch(/sky/);
  });

  it('leaves out the hundreds of prefabs that are equipment, not scenery', () => {
    expect(refused('PrefabHierarchyObject', '2 Boss Ent Death.glb')).toMatch(/no world-building/);
  });

  it('leaves out folders that hold no geometry at all', () => {
    expect(refused('Texture2D', 'Rock_Texture_01.glb')).toMatch(/Texture2D/);
  });

  it('leaves out anything that is not a GLB', () => {
    expect(refused('TerrainData', 'TerrainL1.json')).toMatch(/not a GLB/);
  });
});

describe('provenance', () => {
  it('files the flat-shaded SM_ family under the environment set, wherever it is planted', () => {
    expect(taken('Mesh', 'SM_Env_Rock_03.glb').provenance).toBe(ENVIRONMENT_SET);
    expect(taken('Mesh', 'SM_Plant_Mushrooms_02.glb').provenance).toBe(ENVIRONMENT_SET);
  });

  it('keeps the photo-textured trees in a set of their own', () => {
    expect(taken('PrefabHierarchyObject', 'Tree_1A3.glb').provenance).toBe(VEGETATION_SET);
  });

  it('marks both third-party sets unconfirmed with the review still open', () => {
    for (const set of [ENVIRONMENT_SET, VEGETATION_SET]) {
      expect(set.author).toMatch(/unconfirmed/);
      expect(set.author).toMatch(/licence review open/);
    }
  });

  it('attributes the terrain set to this project, which authored it', () => {
    expect(taken('TerrainData', 'TerrainL1.glb').provenance).toBe(TERRAIN_SET);
    expect(TERRAIN_SET.author).toBe('World of Vikings project');
  });

  it('says where an asset is held, naming no vendor and no tool', () => {
    for (const set of [ENVIRONMENT_SET, VEGETATION_SET, TERRAIN_SET]) {
      expect(set.source).toMatch(/^private asset collection — \w+ set$/);
    }
  });
});

describe('toKebab', () => {
  it('flattens spaces, brackets and underscores alike', () => {
    expect(toKebab('Bush_1A2 (Small) 1 Dark.glb')).toBe('bush-1a2-small-1-dark');
    expect(toKebab('SM_Env_Grass_Short_Clump_01_LOD0.glb')).toBe(
      'sm-env-grass-short-clump-01-lod0',
    );
  });

  it('agrees with assetIdFromPath, which computes the same id without Zod', () => {
    for (const file of [
      'Tree_1A3.glb',
      'Bush_1A2 (Small) 1 Dark.glb',
      'Terrain Customization.glb',
    ]) {
      const selection = taken(
        file.startsWith('Terrain') ? 'TerrainData' : 'PrefabHierarchyObject',
        file,
      );
      expect(assetIdFromPath(selection.path)).toBe(selection.id);
    }
  });
});

describe('sizeLimitFor', () => {
  it('holds hand props to a hand prop’s size', () => {
    // The dozen `SM_Item_*` files exported inside a 100x character rig measure
    // 15–156 m. Excluding them by name would also drop the real pots and cups;
    // excluding them by size drops exactly the wrong ones.
    expect(sizeLimitFor('environment', 'SM_Item_Goblin_WarBanner')).toBe(20);
    expect(sizeLimitFor('environment', 'SM_Env_Rock_Cliff_02')).toBe(80);
  });

  it('lets a terrain be a terrain', () => {
    expect(sizeLimitFor('terrain', 'TerrainL1')).toBeGreaterThan(200);
  });
});

describe('originShiftFor', () => {
  // A tree whose roots dip a metre below its authored ground-contact origin.
  const rootedTree: Bounds = { min: [-8, -1, -8], max: [8, 26, 8] };
  // A terrain tile: corner origin, surface spanning 0..200 on x and z.
  const terrain: Bounds = { min: [0, 0, 0], max: [200, 29, 200] };

  it('leaves a mesh or prefab exactly where its author put it', () => {
    // Snapping this to the hull base would lift the tree a metre out of the
    // ground. 79 of 96 vegetation models in the source have roots below zero.
    expect(originShiftFor('vegetation', rootedTree)).toEqual([0, 0, 0]);
    expect(originShiftFor('environment', rootedTree)).toEqual([0, 0, 0]);
  });

  it('recentres a terrain, whose corner origin is a container artefact', () => {
    expect(originShiftFor('terrain', terrain)).toEqual([-100, 0, -100]);
  });

  it('never moves anything vertically — y is always authored', () => {
    for (const group of ['environment', 'vegetation', 'terrain'] as const) {
      expect(originShiftFor(group, rootedTree)[1]).toBe(0);
    }
  });
});
