/**
 * The narrow freeze, against a real scene graph (ADR-0049).
 *
 * ADR-0035 kept the editor unfrozen on purpose: a frozen node whose gizmo moves
 * is the worst kind of bug, because the document, the history, the inspector
 * and the hierarchy all agree and only the screen is wrong. The freeze this
 * module does instead is narrow — an entity is pinned once its model has landed
 * and thawed for exactly as long as it is selected or being written to — and
 * "narrow" is only worth anything if a test can catch it being wrong.
 *
 * So these tests do not ask whether `frozen` is set. They ask where the geometry
 * actually is: `absolutePosition` of the mesh under the entity root, after the
 * gesture, computed the way the renderer computes it. A freeze that swallowed
 * the move makes that number the old one.
 *
 * `NullEngine` rather than a mock scene, for the reason every other renderer
 * test in this repository uses it: the thing under test is Babylon's world
 * matrix bookkeeping, and a mock would only prove that the mock agrees.
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { InstantiatedEntries } from '@babylonjs/core/assetContainer.js';
import { Scene } from '@babylonjs/core/scene.js';
import type { AssetManager } from '@wov/asset-system';
import type { EditorDocument } from '@wov/editor-core';
import { CURRENT_WORLD_SCHEMA_VERSION } from '@wov/world-schema';
import type { CatalogedPrefab } from '../api/client.js';
import type { PrefabIndex } from './prefab-index.js';
import { createSceneSync, type SceneSync } from './scene-sync.js';

const PREFAB: CatalogedPrefab = {
  id: 'prop-barrel',
  name: 'Barrel',
  asset: 'environment/barrel.glb',
  visibility: 'public',
  category: 'prop',
  catalog: 'test',
};

const GRASS: CatalogedPrefab = {
  ...PREFAB,
  id: 'vegetation-grass',
  asset: 'vegetation/grass.glb',
  category: 'vegetation',
  bounds: { min: [-0.2, 0, -0.2], max: [0.2, 0.25, 0.2] },
};

function documentWith(
  entities: readonly { id: string; prefab: string; position: [number, number, number] }[],
  selection: readonly string[] = [],
): EditorDocument {
  return {
    world: {
      schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
      id: 'test',
      name: 'Test',
      zones: [{ id: 'zone', name: 'Zone', entities: [...entities] }],
    },
    selection: [...selection],
    activeZoneId: 'zone',
    dirty: false,
  } as EditorDocument;
}

describe('the reconciler freezes what is not moving', () => {
  let engine: NullEngine;
  let scene: Scene;
  let sync: SceneSync;
  let excludedFromCasting: AbstractMesh[];

  /**
   * A model that looks like a loaded GLB: a `__root__` transform with one mesh
   * a metre above it, so an out-of-date parent matrix pinned into a child shows up
   * as a wrong `absolutePosition` rather than as nothing at all.
   */
  const instantiate = (
    _asset: string,
    options: { rename?: (name: string) => string } = {},
  ): Promise<InstantiatedEntries> => {
    const rename = options.rename ?? ((name: string) => name);
    const root = new TransformNode(rename('__root__'), scene);
    const mesh = CreateBox(rename('model'), { size: 0.5 }, scene);
    mesh.parent = root;
    mesh.position.y = 1;
    return Promise.resolve({
      rootNodes: [root],
      skeletons: [],
      animationGroups: [],
      dispose() {
        // Nothing to give back: this fake never took anything.
      },
    } as unknown as InstantiatedEntries);
  };

  const prefabs = {
    get: (id: string) => (id === GRASS.id ? GRASS : id === PREFAB.id ? PREFAB : undefined),
  } as unknown as PrefabIndex;

  /** Lets every `await` inside `loadModel` run; the fake loader never waits. */
  const settle = async (): Promise<void> => {
    for (let turn = 0; turn < 8; turn += 1) {
      await Promise.resolve();
    }
  };

  /** Where the model's mesh actually is, as the renderer would compute it. */
  const modelAt = (entityId: string): [number, number, number] => {
    const node = sync.nodeFor(entityId);
    if (node === undefined) {
      throw new Error(`no node for "${entityId}"`);
    }
    const mesh = node.getChildMeshes(false).find((child) => child.name.endsWith(':model'));
    if (mesh === undefined) {
      throw new Error(`no model mesh under "${entityId}"`);
    }
    mesh.computeWorldMatrix(true);
    const point = mesh.absolutePosition;
    return [point.x, point.y, point.z];
  };

  beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    excludedFromCasting = [];
    sync = createSceneSync({
      scene,
      assets: {
        instantiate,
        sources: () => ({ repository: 0, store: 0, placeholder: 0 }),
      } as unknown as AssetManager,
      prefabs,
      shadows: {
        excludeFromShadows: () => undefined,
        excludeFromCasting: (meshes) => excludedFromCasting.push(...meshes),
      },
    });
  });

  afterEach(() => {
    sync.dispose();
    scene.dispose();
    engine.dispose();
  });

  it('pins an entity only once its model has landed', async () => {
    sync.apply(documentWith([{ id: 'barrel_1', prefab: PREFAB.id, position: [1, 0, 2] }]));
    expect(sync.frozenCount(), 'a stand-in must not be pinned').toBe(0);
    await settle();
    expect(sync.frozenCount()).toBe(1);
    expect(modelAt('barrel_1')).toEqual([1, 1, 2]);
  });

  it('moves a frozen entity when the document says so', async () => {
    sync.apply(documentWith([{ id: 'barrel_1', prefab: PREFAB.id, position: [1, 0, 2] }]));
    await settle();
    expect(sync.frozenCount()).toBe(1);

    sync.apply(documentWith([{ id: 'barrel_1', prefab: PREFAB.id, position: [7, 3, -4] }]));

    // The whole point of the narrow freeze: the picture followed the document.
    expect(modelAt('barrel_1')).toEqual([7, 4, -4]);
    // And it is pinned again afterwards, at the new place.
    expect(sync.frozenCount()).toBe(1);
    expect(modelAt('barrel_1')).toEqual([7, 4, -4]);
  });

  it('thaws a selected entity, so a gizmo writing on the node reaches the picture', async () => {
    sync.apply(documentWith([{ id: 'barrel_1', prefab: PREFAB.id, position: [1, 0, 2] }]));
    await settle();

    sync.apply(
      documentWith([{ id: 'barrel_1', prefab: PREFAB.id, position: [1, 0, 2] }], ['barrel_1']),
    );
    expect(sync.frozenCount(), 'the selection is what a gizmo attaches to').toBe(0);

    // Exactly what `PositionGizmo` does during a drag: it writes the node, and
    // nothing tells the reconciler until the drag ends.
    const node = sync.nodeFor('barrel_1');
    node?.position.set(10, 0, 2);
    expect(modelAt('barrel_1')).toEqual([10, 1, 2]);
  });

  it('pins it again when it is deselected', async () => {
    const placed = [
      { id: 'barrel_1', prefab: PREFAB.id, position: [1, 0, 2] as [number, number, number] },
    ];
    sync.apply(documentWith(placed));
    await settle();
    sync.apply(documentWith(placed, ['barrel_1']));
    expect(sync.frozenCount()).toBe(0);
    sync.apply(documentWith(placed, []));
    expect(sync.frozenCount()).toBe(1);
  });

  it('keeps a selection thawed across a load that lands later', async () => {
    // The order a paste produces: the entity is created and selected in the
    // same document, and its model arrives afterwards.
    sync.apply(
      documentWith([{ id: 'barrel_1', prefab: PREFAB.id, position: [0, 0, 0] }], ['barrel_1']),
    );
    await settle();
    expect(sync.frozenCount(), 'a held entity must not be pinned by its own load').toBe(0);
  });

  it('takes a tuft of grass out of the shadow map and leaves a barrel in it', async () => {
    sync.apply(
      documentWith([
        { id: 'barrel_1', prefab: PREFAB.id, position: [0, 0, 0] },
        { id: 'grass_1', prefab: GRASS.id, position: [4, 0, 0] },
      ]),
    );
    await settle();
    const names = excludedFromCasting.map((mesh) => mesh.name);
    expect(names).toEqual(['grass_1:model']);
  });
});
