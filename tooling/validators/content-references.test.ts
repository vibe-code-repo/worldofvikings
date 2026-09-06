import { describe, expect, it } from 'vitest';
import type { PrefabCatalog, WorldDefinition } from '@wov/world-schema';
import { collectPrefabIds, findUnknownPrefabReferences } from './content-references.js';

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
  schemaVersion: 1,
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
