import { describe, expect, it } from 'vitest';
import {
  ALPHA_CUTOFF,
  MATERIAL_SURFACES,
  METALLIC_FACTOR,
  ROUGHNESS_FACTOR,
  isListedMaterial,
  surfaceFor,
} from './materials.js';

/**
 * The material names the export actually uses — the union of what the scene
 * bundles name and what the models in the store still carry, read off the
 * export once and pinned here.
 *
 * This list is the point of the test file: the table is only worth having if it
 * is complete for the input it was written for, and an unlisted material is a
 * model that silently renders opaque.
 */
const NAMES_IN_THE_EXPORT = [
  'Birch_Bark_A',
  'Boss',
  'Cube Wood',
  'Dark 60 atlas-b_Material_01 1',
  'Dark 85 atlas-b_Material_01 2',
  'Dark 85 atlas-a_Mat_01_A 2',
  'Dark_atlas-b_Material_01 1',
  'Default-Material',
  'DefaultMaterial',
  'Destroyed_House',
  'DoubleSide_atlas-b_Material_01 1',
  'atlas-e_01',
  'atlas-e_02',
  'atlas-e_TextureWalls',
  'Dungeons_Material_Characters_01',
  'Glass_atlas-e_01 1',
  'Grass_Short_Mat_01 1',
  'Grass_Short_Mat_01 Low Wild',
  'Grass_Short_Plant_Leaves_1A1 2',
  'Grass_Short_Plant_Leaves_1A1_RedBlue',
  'Grass_Short_Plant_Leaves_1A1_Snow',
  'Grass_Short_Plant_Leaves_1A1_Yellow',
  'Ice',
  'Leaves 1',
  'Leaves 2',
  'Leaves 3',
  'Leaves Birch 1',
  'Leaves Birch 2',
  'Leaves Birch 3 Dark',
  'Leaves Birch 3 Dark Snow',
  'Lit',
  'Maple Leaves 1',
  'Mesh_MeshEffect 2',
  'Metal_atlas-a_Mat_01_A 2',
  'Metal_atlas-a_Mat_01_A 5',
  'Oak_Bark_A',
  'Oak_Bark_A 2 Dark',
  'Pine 1',
  'Pine 2',
  'atlas-b_Material_01',
  'atlas-b_Material_01_Dark',
  'atlas-a_Mat_01_A',
  'atlas-a_Mat_01_A 2',
  'atlas-a_Mat_01_A 2 1',
  'atlas-a_Mat_01_A 3',
  'atlas-a_Mat_01_A 3 1',
  'atlas-a_Mat_01_A_Emmisive',
  'atlas-a_Mat_Castle_Wall_01 1',
  'atlas-d_01_A',
  'atlas-c_01',
  'atlas-c_Clouds',
  'RunesA',
  'RunesD',
  'RunesP',
  'SM_Item_Crystal_04',
  'SM_Item_Potion_01',
  'SM_Prop_Log_Spike_09',
  'Trunks',
] as const;

describe('MATERIAL_SURFACES', () => {
  it('has an answer for every material name in the export', () => {
    const missing = NAMES_IN_THE_EXPORT.filter((name) => !isListedMaterial(name));
    expect(missing).toEqual([]);
  });

  it('lists nothing the export does not use', () => {
    // Two spellings are listed that the current export does not reach —
    // `Maple Leaves` and `Grass_Short_Plant_Leaves_1A1` without their instance
    // number — because a re-export can drop the number at any time.
    const known: readonly string[] = [
      ...NAMES_IN_THE_EXPORT,
      'Maple Leaves',
      'Grass_Short_Plant_Leaves_1A1',
    ];
    const extra = Object.keys(MATERIAL_SURFACES).filter((name) => !known.includes(name));
    expect(extra).toEqual([]);
  });

  it('cuts out and double-sides every leaf, grass and glass material', () => {
    for (const name of NAMES_IN_THE_EXPORT.filter(
      (candidate) =>
        /leaves|pine \d|grass_short_mat/i.test(candidate) ||
        candidate.startsWith('Glass_') ||
        candidate.startsWith('DoubleSide_'),
    )) {
      expect({ name, ...surfaceFor(name) }).toEqual({
        name,
        alphaMode: 'MASK',
        doubleSided: true,
        emissive: false,
      });
    }
  });

  it('makes the self-lit materials emissive and nothing else', () => {
    const emissive = Object.entries(MATERIAL_SURFACES)
      .filter(([, surface]) => surface.emissive)
      .map(([name]) => name)
      .sort();
    expect(emissive).toEqual(['atlas-a_Mat_01_A_Emmisive', 'SM_Item_Crystal_04']);
  });

  it('leaves bark, stone and the flat-shaded atlases opaque and single-sided', () => {
    for (const name of [
      'Oak_Bark_A',
      'Trunks',
      'atlas-e_01',
      'atlas-a_Mat_01_A',
      'atlas-b_Material_01',
    ]) {
      expect({ name, ...surfaceFor(name) }).toEqual({
        name,
        alphaMode: 'OPAQUE',
        doubleSided: false,
        emissive: false,
      });
    }
  });

  it('renders an unlisted material opaque rather than guessing from its name', () => {
    expect(isListedMaterial('Leaves Of Some Future Tree')).toBe(false);
    expect(surfaceFor('Leaves Of Some Future Tree').alphaMode).toBe('OPAQUE');
  });

  it('keeps the factors that stop a physically-based renderer drawing metal', () => {
    expect(METALLIC_FACTOR).toBe(0);
    expect(ROUGHNESS_FACTOR).toBe(1);
    expect(ALPHA_CUTOFF).toBe(0.5);
  });
});
