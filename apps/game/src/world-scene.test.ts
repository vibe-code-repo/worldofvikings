import { describe, expect, it } from 'vitest';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { AssetManager } from '@wov/asset-system';
import type { PhysicsWorld, StaticGroup } from '@wov/physics';
import { SHADOW_CASTER_MINIMUM_HEIGHT, castsShadows } from '@wov/world-schema';
import type { EntityDefinition, PrefabDefinition, ZoneDefinition } from '@wov/world-schema';
import {
  NO_SOURCES,
  addSources,
  buildZoneCollision,
  drawsAsThinInstances,
  groupByPrefab,
  backdropTakesFog,
  markAsBackdrop,
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

describe('the shadow-caster rule the game shares with the editor', () => {
  // The rule itself lives in `@wov/world-schema` and is tested there
  // (ADR-0049). What belongs here is the pairing it has with this module's own
  // rule about how those plants are drawn.
  it('draws the same plants as thin instances that it keeps out of the map', () => {
    // Not the same rule, and deliberately so — a bush is thin-instanced and
    // does cast — but a non-caster is always a thin instance, because that is
    // the only case where one mesh stands for thousands.
    const grass: PrefabDefinition = {
      ...prefab('grass-short-clump-1', 'vegetation/grass-short-clump-1.glb'),
      category: 'vegetation',
      bounds: { min: [-0.5, 0, -0.5], max: [0.5, 0.25, 0.5] },
    };
    expect(castsShadows(grass)).toBe(false);
    expect(drawsAsThinInstances(grass)).toBe(true);
    expect(SHADOW_CASTER_MINIMUM_HEIGHT).toBeGreaterThan(0.25);
  });
});

describe('the backdrop', () => {
  const shell = (): PrefabDefinition => ({
    ...prefab('environment-backdrop-mountains-snow', 'environment/backdrop-mountains-snow.glb'),
    category: 'backdrop',
    bounds: { min: [-297, -297, -297], max: [297, 0, 297] },
  });

  it('is never drawn into the shadow map', () => {
    // Not a measurement like vegetation's: the sun's map covers 120 m around
    // the player and the nearest shell is 290 m out, so the question is not how
    // tall it is.
    expect(castsShadows(shell())).toBe(false);
  });

  it('is not thin-instanced — there are two of them, not two thousand', () => {
    expect(drawsAsThinInstances(shell())).toBe(false);
  });

  it('takes a mesh out of the picking, and out of a fog that would erase it', () => {
    const mesh = { applyFog: true, isPickable: true, getTotalVertices: () => 324 };
    const marked = markAsBackdrop([{ getChildMeshes: () => [mesh] }], () => false);
    expect(marked).toEqual([mesh]);
    expect(mesh.applyFog).toBe(false);
    expect(mesh.isPickable).toBe(false);
  });

  it('leaves a mesh in a fog that reaches past it, so the range hazes with distance', () => {
    const mesh = { applyFog: false, isPickable: true, getTotalVertices: () => 324 };
    markAsBackdrop([{ getChildMeshes: () => [mesh] }], () => true);
    expect(mesh.applyFog).toBe(true);
    // Never pickable, whatever the fog does.
    expect(mesh.isPickable).toBe(false);
  });

  it('writes the fog flag on the source mesh of an instance, not only on the copy', () => {
    // `applyFog` is a material define, and an `InstancedMesh` shares its
    // source's material: written on the copy alone it changes nothing and the
    // mountains come out fog-grey. Same trap as `receiveShadows`.
    const source = { applyFog: true, isPickable: true };
    const instance = {
      applyFog: true,
      isPickable: true,
      isAnInstance: true,
      sourceMesh: source,
      getTotalVertices: () => 324,
    };
    markAsBackdrop([{ getChildMeshes: () => [instance] }], () => false);
    expect(source.applyFog).toBe(false);
    expect(source.isPickable).toBe(false);
  });

  it('skips the loader’s __root__ and the container’s transform nodes', () => {
    const empty = { applyFog: true, isPickable: true, getTotalVertices: () => 0 };
    const real = { applyFog: true, isPickable: true, getTotalVertices: () => 12 };
    // What comes back is handed to `excludeFromShadows`, so a transform node in
    // the list would be a node the shadow rig is asked to un-light.
    expect(markAsBackdrop([{ getChildMeshes: () => [empty, real] }], () => false)).toEqual([real]);
    expect(empty.applyFog).toBe(true);
  });
});

/**
 * Whether the painted distance takes the world's fog.
 *
 * The rule is self-guarding, which is the whole point of it: the backdrop is
 * only fogged by a fog that reaches *past* it, so a world can never haze its
 * horizon into a flat band by shortening `fog.end`. It simply stops being
 * fogged, which is where this started (ADR-0031).
 */
describe('backdropTakesFog', () => {
  const fog = (enabled: boolean, end: number): { enabled: boolean; end: number } => ({
    enabled,
    end,
  });

  it('says no when there is no fog', () => {
    expect(backdropTakesFog(fog(false, 4000), 806)).toBe(false);
  });

  it('says no when the fog ends before the shell, which would erase it', () => {
    // The village's own numbers before this rule existed: fog to 420 m and an
    // outer shell reaching 806 m is a horizon painted flat in fog colour.
    expect(backdropTakesFog(fog(true, 420), 806)).toBe(false);
  });

  it('says yes when the fog reaches past the shell', () => {
    expect(backdropTakesFog(fog(true, 1100), 806)).toBe(true);
  });

  it('is decided per mesh, so near clouds haze while a far shell does not', () => {
    expect(backdropTakesFog(fog(true, 900), 250)).toBe(true);
    expect(backdropTakesFog(fog(true, 900), 1200)).toBe(false);
  });

  it('refuses the exact boundary rather than fogging a shell to its own end', () => {
    expect(backdropTakesFog(fog(true, 806), 806)).toBe(false);
  });
});
