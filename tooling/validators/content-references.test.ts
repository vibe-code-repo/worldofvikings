import { describe, expect, it } from 'vitest';
import { CURRENT_WORLD_SCHEMA_VERSION } from '@wov/world-schema';
import type { PrefabCatalog, WorldDefinition } from '@wov/world-schema';
import {
  collectPrefabIds,
  findMissingTerrainAssets,
  findSoundProblems,
  findUnknownPrefabReferences,
} from './content-references.js';

const catalog = (id: string, prefabIds: readonly string[]): PrefabCatalog => ({
  schemaVersion: 1,
  id,
  prefabs: prefabIds.map((prefabId) => ({
    id: prefabId,
    name: prefabId,
    asset: `environment/${prefabId}.glb`,
    visibility: 'public',
    category: 'prop',
  })),
});

const world = (prefabs: readonly string[]): WorldDefinition => ({
  schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
  id: 'example',
  name: 'Example',
  zones: [
    {
      id: 'village',
      name: 'Village',
      entities: prefabs.map((prefab, index) => ({
        id: `entity_${index}`,
        prefab,
        position: [0, 0, 0],
      })),
    },
  ],
});

describe('collectPrefabIds', () => {
  it('collects the ids of every catalog', () => {
    const result = collectPrefabIds([
      { file: 'base.json', catalog: catalog('base', ['barrel-01']) },
      { file: 'imported.json', catalog: catalog('imported', ['rock-01']) },
    ]);
    expect([...result.ids].sort()).toEqual(['barrel-01', 'rock-01']);
    expect(result.duplicates).toEqual([]);
  });

  it('reports an id claimed by two catalogs, because an entity names the id alone', () => {
    const result = collectPrefabIds([
      { file: 'base.json', catalog: catalog('base', ['barrel-01']) },
      { file: 'imported.json', catalog: catalog('imported', ['barrel-01']) },
    ]);
    expect(result.duplicates).toEqual([
      'prefab id "barrel-01" is defined in both base.json and imported.json',
    ]);
  });
});

describe('findUnknownPrefabReferences', () => {
  it('says nothing when every reference resolves', () => {
    expect(findUnknownPrefabReferences(world(['barrel-01']), new Set(['barrel-01']))).toEqual([]);
  });

  it('names the zone, the entity and the missing prefab', () => {
    expect(findUnknownPrefabReferences(world(['ghost-01']), new Set(['barrel-01']))).toEqual([
      'village/entity_0 references unknown prefab "ghost-01"',
    ]);
  });
});

describe('findMissingTerrainAssets', () => {
  const withTerrain = (terrain: WorldDefinition['zones'][number]['terrain']): WorldDefinition => ({
    schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
    id: 'example',
    name: 'Example',
    zones: [{ id: 'village', name: 'Village', entities: [], terrain }],
  });

  const declared = new Set([
    'terrain/village-257.glb',
    'textures/village-splat-a.png',
    'textures/terrain-grass-a.png',
  ]);

  it('says nothing when every path is declared', () => {
    const world = withTerrain({
      heightField: 'terrain/village-257.glb',
      position: [0, 0, 0],
      size: [300, 300],
      layers: [{ texture: 'textures/terrain-grass-a.png', tileSize: 2 }],
      splat: ['textures/village-splat-a.png'],
    });
    expect(findMissingTerrainAssets(world, declared)).toEqual([]);
  });

  it('names the height field, the splat map and the layer texture separately', () => {
    const world = withTerrain({
      heightField: 'terrain/missing.glb',
      position: [0, 0, 0],
      size: [300, 300],
      layers: [{ texture: 'textures/missing-layer.png', tileSize: 2 }],
      splat: ['textures/missing-splat.png'],
    });
    expect(findMissingTerrainAssets(world, declared)).toEqual([
      'village/terrain references unknown asset "terrain/missing.glb"',
      'village/terrain references unknown asset "textures/missing-splat.png"',
      'village/terrain references unknown asset "textures/missing-layer.png"',
    ]);
  });

  it('ignores a zone with no terrain', () => {
    expect(findMissingTerrainAssets(withTerrain(undefined), new Set())).toEqual([]);
  });
});

describe('findSoundProblems', () => {
  const clips = new Set([
    'audio/ambience/bed.ogg',
    'audio/emitters/fire.ogg',
    'audio/footsteps/gravel-01.ogg',
  ]);
  const prefabs = new Set(['brazier']);

  /** A world with one zone, six terrain layers and one entity. */
  const withSound = (zoneSound: unknown, worldSound?: unknown, layers = 6): WorldDefinition =>
    ({
      schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
      id: 'village1',
      name: 'Village One',
      sound: worldSound,
      zones: [
        {
          id: 'village',
          name: 'Village',
          entities: [{ id: 'village-e0001', prefab: 'brazier', position: [0, 0, 0] }],
          terrain: {
            heightField: 'terrain/village.glb',
            position: [0, 0, 0],
            size: [300, 300],
            layers: Array.from({ length: layers }, () => ({
              texture: 'textures/g.png',
              tileSize: 2,
            })),
          },
          sound: zoneSound,
        },
      ],
    }) as unknown as WorldDefinition;

  const banks = [{ surface: 'gravel', clips: ['audio/footsteps/gravel-01.ogg'] }];
  const known = { assetPaths: clips, prefabIds: prefabs };

  it('says nothing about a sound block that names only things that exist', () => {
    const world = withSound({
      ambience: { clip: 'audio/ambience/bed.ogg' },
      footsteps: {
        banks,
        defaultSurface: 'gravel',
        layerSurfaces: ['gravel', 'gravel', 'gravel', 'gravel', 'gravel', 'gravel'],
      },
      emitters: [{ id: 'fire', prefab: 'brazier', clip: 'audio/emitters/fire.ogg' }],
    });
    expect(findSoundProblems(world, known)).toEqual([]);
  });

  it('catches a layerSurfaces array that has drifted from the terrain', () => {
    const world = withSound({
      footsteps: { banks, defaultSurface: 'gravel', layerSurfaces: ['gravel', 'gravel'] },
    });
    expect(findSoundProblems(world, known)).toEqual([
      'village/sound.footsteps.layerSurfaces has 2 entries but the terrain has 6 layers',
    ]);
  });

  it('catches a clip that is not in the manifest', () => {
    const world = withSound({ ambience: { clip: 'audio/ambience/missing.ogg' } });
    expect(findSoundProblems(world, known)).toContain(
      'village/sound references unknown asset "audio/ambience/missing.ogg"',
    );
  });

  it('catches an emitter pointing at a prefab the catalogue does not have', () => {
    const world = withSound({
      emitters: [{ id: 'fire', prefab: 'nothing-here', clip: 'audio/emitters/fire.ogg' }],
    });
    expect(findSoundProblems(world, known)).toContain(
      'village/sound emitter "fire" references unknown prefab "nothing-here"',
    );
  });

  it('catches an emitter pointing at an entity that was renamed', () => {
    const world = withSound({
      emitters: [{ id: 'well', entity: 'village-e9999', clip: 'audio/emitters/fire.ogg' }],
    });
    expect(findSoundProblems(world, known)).toContain(
      'village/sound emitter "well" references unknown entity "village-e9999"',
    );
  });

  it('catches a surface that has no bank, which would be silence with no error', () => {
    const world = withSound({
      footsteps: {
        banks,
        defaultSurface: 'gravel',
        layerSurfaces: ['gravel', 'snow', 'gravel', 'gravel', 'gravel', 'gravel'],
      },
    });
    expect(findSoundProblems(world, known)).toContain(
      'village/sound names surface "snow", which has no footstep bank',
    );
  });

  it('lets a zone inherit the world’s banks', () => {
    const world = withSound(
      { footsteps: { layerSurfaces: Array.from({ length: 6 }, () => 'gravel') } },
      { footsteps: { banks, defaultSurface: 'gravel' } },
    );
    expect(findSoundProblems(world, known)).toEqual([]);
  });

  it('ignores a world with no sound at all', () => {
    expect(findSoundProblems(withSound(undefined), known)).toEqual([]);
  });
});
