import { describe, expect, it } from 'vitest';
import type { EntityDefinition, PrefabDefinition, ZoneDefinition } from '@wov/world-schema';
import {
  NO_SOURCES,
  addSources,
  groupByPrefab,
  indexPrefabs,
  playableZone,
  spawnFromQuery,
} from './world-scene.js';

const prefab = (id: string, asset: string): PrefabDefinition => ({
  id,
  name: id,
  asset,
  visibility: 'private',
  placeholder: `placeholders/${asset}`,
  category: 'environment',
});

const entity = (id: string, prefabId: string): EntityDefinition => ({
  id,
  prefab: prefabId,
  position: [0, 0, 0],
});

const zone = (id: string, terrain?: ZoneDefinition['terrain']): ZoneDefinition => ({
  id,
  name: id,
  entities: [],
  ...(terrain === undefined ? {} : { terrain }),
});

const VILLAGE_TERRAIN = {
  heightField: 'terrain/village.glb',
  position: [0, 0, 0] as [number, number, number],
  size: [300, 300] as [number, number],
};

describe('indexPrefabs', () => {
  it('indexes by id and deduplicates the asset catalogue', () => {
    // Two prefabs, one GLB: the loader must be told about the file once, or
    // `createAssetCatalog` throws on the duplicate path.
    const { byId, assets } = indexPrefabs([
      prefab('rock-a', 'environment/rock.glb'),
      prefab('rock-b', 'environment/rock.glb'),
    ]);
    expect([...byId.keys()]).toEqual(['rock-a', 'rock-b']);
    expect(assets).toEqual([
      {
        path: 'environment/rock.glb',
        visibility: 'private',
        placeholder: 'placeholders/environment/rock.glb',
      },
    ]);
  });
});

describe('groupByPrefab', () => {
  it('collects the entities that share a prefab, in first-appearance order', () => {
    const groups = groupByPrefab([entity('a', 'fence'), entity('b', 'rock'), entity('c', 'fence')]);
    expect([...groups.keys()]).toEqual(['fence', 'rock']);
    expect(groups.get('fence')?.map((one) => one.id)).toEqual(['a', 'c']);
  });
});

describe('playableZone', () => {
  it('takes the zone that has ground, not the first one in the file', () => {
    const zones = [zone('interiors'), zone('village', VILLAGE_TERRAIN)];
    expect(playableZone(zones)?.id).toBe('village');
  });

  it('falls back to the first zone when none has ground', () => {
    expect(playableZone([zone('flat'), zone('other')])?.id).toBe('flat');
  });

  it('answers nothing for a world with no zones', () => {
    expect(playableZone([])).toBeUndefined();
  });
});

describe('spawnFromQuery', () => {
  const area = { min: [0, 0] as const, max: [300, 300] as const, fallback: [150, 150] as const };

  it('lands in the middle when the query names nothing', () => {
    expect(spawnFromQuery(null, area)).toEqual([150, 150]);
  });

  it('takes a point inside the tile', () => {
    expect(spawnFromQuery('162, 87', area)).toEqual([162, 87]);
  });

  it('falls back rather than dropping the player off the tile', () => {
    expect(spawnFromQuery('400,10', area)).toEqual([150, 150]);
    expect(spawnFromQuery('-1,10', area)).toEqual([150, 150]);
    expect(spawnFromQuery('nonsense', area)).toEqual([150, 150]);
    expect(spawnFromQuery('1,2,3', area)).toEqual([150, 150]);
  });

  it('reads the tile own corner, not a hard-coded zero', () => {
    const shifted = {
      min: [100, 100] as const,
      max: [200, 200] as const,
      fallback: [150, 150] as const,
    };
    expect(spawnFromQuery('50,150', shifted)).toEqual([150, 150]);
    expect(spawnFromQuery('120,150', shifted)).toEqual([120, 150]);
  });
});

describe('addSources', () => {
  it('adds the counts of one loader to those of the other', () => {
    expect(addSources({ repository: 1, store: 2, placeholder: 3 }, NO_SOURCES)).toEqual({
      repository: 1,
      store: 2,
      placeholder: 3,
    });
    expect(
      addSources(
        { repository: 1, store: 2, placeholder: 3 },
        { repository: 4, store: 5, placeholder: 6 },
      ),
    ).toEqual({ repository: 5, store: 7, placeholder: 9 });
  });
});
