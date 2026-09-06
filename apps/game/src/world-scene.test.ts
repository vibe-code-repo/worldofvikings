import { describe, expect, it } from 'vitest';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { AssetManager } from '@wov/asset-system';
import type { PhysicsWorld, StaticGroup } from '@wov/physics';
import type { EntityDefinition, PrefabDefinition, ZoneDefinition } from '@wov/world-schema';
import {
  NO_SOURCES,
  SHADOW_CASTER_MINIMUM_HEIGHT,
  addSources,
  buildZoneCollision,
  castsShadows,
  drawsAsThinInstances,
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

describe('buildZoneCollision', () => {
  /** A physics world that records the groups it was handed. */
  function recordingPhysics(): {
    readonly world: PhysicsWorld;
    readonly groups: StaticGroup[];
  } {
    const groups: StaticGroup[] = [];
    const world = {
      addStaticGroup(group: StaticGroup) {
        groups.push(group);
        return { name: group.name, dispose: () => undefined };
      },
    } as unknown as PhysicsWorld;
    return { world, groups };
  }

  /** A loader that hands back one box-shaped container for every asset. */
  function boxManager(): AssetManager {
    const container = {
      meshes: [
        {
          getTotalVertices: () => 8,
          computeWorldMatrix: () => Matrix.Identity(),
          getBoundingInfo: () => ({
            boundingBox: {
              minimumWorld: new Vector3(-1, 0, -1),
              maximumWorld: new Vector3(1, 2, 1),
            },
          }),
        },
      ],
      rootNodes: [],
    };
    return { loadGlb: () => Promise.resolve(container) } as unknown as AssetManager;
  }

  const wall: PrefabDefinition = {
    id: 'wall',
    name: 'Wall',
    asset: 'environment/wall.glb',
    visibility: 'public',
    category: 'environment',
    collision: { kind: 'box' },
  };
  const grass: PrefabDefinition = { ...wall, id: 'grass', collision: { kind: 'none' } };
  const undecided: PrefabDefinition = { ...wall, id: 'undecided', collision: undefined };

  function zoneOf(entities: EntityDefinition[]): ZoneDefinition {
    return { id: 'z', name: 'Z', entities };
  }

  it('gives one shape every placement of it', async () => {
    const { world, groups } = recordingPhysics();
    const { report } = await buildZoneCollision({
      physics: world,
      manager: boxManager(),
      prefabs: [wall],
      zone: zoneOf([
        { id: 'a', prefab: 'wall', position: [0, 0, 0] },
        { id: 'b', prefab: 'wall', position: [5, 0, 0] },
        { id: 'c', prefab: 'wall', position: [9, 0, 0], scale: [2, 2, 2] },
      ]),
      yieldToFrame: () => Promise.resolve(),
    });

    // Two shapes, not three: the first two entities differ only in position.
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.placements.length).sort()).toEqual([1, 2]);
    expect(report.shapes).toBe(2);
    expect(report.bodies).toBe(3);
  });

  it('counts what it deliberately left alone and what nobody decided', async () => {
    const { world, groups } = recordingPhysics();
    const { report } = await buildZoneCollision({
      physics: world,
      manager: boxManager(),
      prefabs: [grass, undecided],
      zone: zoneOf([
        { id: 'a', prefab: 'grass', position: [0, 0, 0] },
        { id: 'b', prefab: 'undecided', position: [1, 0, 0] },
      ]),
      yieldToFrame: () => Promise.resolve(),
    });

    expect(groups).toHaveLength(0);
    expect(report.passable).toBe(1);
    expect(report.undeclared).toBe(1);
  });

  it('hands the main thread back while it works', async () => {
    let yields = 0;
    const { world } = recordingPhysics();
    await buildZoneCollision({
      physics: world,
      manager: boxManager(),
      prefabs: [wall],
      zone: zoneOf([{ id: 'a', prefab: 'wall', position: [0, 0, 0] }]),
      sliceMilliseconds: -1,
      yieldToFrame: () => {
        yields += 1;
        return Promise.resolve();
      },
    });
    expect(yields).toBeGreaterThan(0);
  });

  it('loses the entities of a prefab whose shape will not build, not the zone', async () => {
    const { world, groups } = recordingPhysics();
    const broken = {
      loadGlb: () => Promise.reject(new Error('no bytes')),
    } as unknown as AssetManager;
    const { report } = await buildZoneCollision({
      physics: world,
      manager: broken,
      prefabs: [wall],
      zone: zoneOf([{ id: 'a', prefab: 'wall', position: [0, 0, 0] }]),
      yieldToFrame: () => Promise.resolve(),
    });

    expect(groups).toHaveLength(0);
    expect(report.failed).toEqual(['wall: no bytes']);
  });
});

describe('castsShadows', () => {
  const plant = (id: string, height: number): PrefabDefinition => ({
    ...prefab(id, `vegetation/${id}.glb`),
    category: 'vegetation',
    bounds: { min: [-0.5, 0, -0.5], max: [0.5, height, 0.5] },
  });

  it('leaves a tuft of grass out of the shadow map', () => {
    expect(castsShadows(plant('grass-short-clump-1', 0.25))).toBe(false);
  });

  it('keeps a bush and a tree in it', () => {
    expect(castsShadows(plant('bush-1a1', 1.88))).toBe(true);
    expect(castsShadows(plant('pine-1b1', 16.14))).toBe(true);
  });

  it('measures the model, not the category: a short wall still casts', () => {
    expect(
      castsShadows({
        ...prefab('kerb', 'environment/kerb.glb'),
        bounds: { min: [-1, 0, -1], max: [1, 0.2, 1] },
      }),
    ).toBe(true);
  });

  it('casts when the prefab does not say how big it is', () => {
    // Undecided must not mean invisible: a model with no measured bounds is a
    // model nobody measured, not a model that is small.
    expect(
      castsShadows({ ...prefab('mystery', 'environment/x.glb'), category: 'vegetation' }),
    ).toBe(true);
  });

  it('draws the same plants as thin instances that it keeps out of the map', () => {
    // Not the same rule, and deliberately so — a bush is thin-instanced and
    // does cast — but a non-caster is always a thin instance, because that is
    // the only case where one mesh stands for thousands.
    const grass = plant('grass-short-clump-1', 0.25);
    expect(drawsAsThinInstances(grass)).toBe(true);
    expect(SHADOW_CASTER_MINIMUM_HEIGHT).toBeGreaterThan(0.25);
  });
});
