import { describe, expect, it } from 'vitest';
import type { PrefabCatalog, WorldDefinition } from '@wov/world-schema';
import {
  collectPrefabIds,
  findMissingTerrainAssets,
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
  schemaVersion: 2,
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
    schemaVersion: 2,
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
