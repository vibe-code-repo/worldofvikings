/**
 * The viewport's copy of the document, as Babylon nodes (ADR-0018).
 *
 * One rule: **the document is the truth and the scene follows it.** Nothing
 * here decides what the world contains; it is told, and it makes the scene say
 * the same thing. That is why every edit — a gizmo drag included — becomes a
 * command against the document first and reaches the picture second.
 *
 * The work it does is the diff (`entity-diff.ts`): only added, removed,
 * replaced and moved entities are touched, so dragging one prop does not
 * re-instantiate the zone around it.
 *
 * Each entity gets one `TransformNode` named `entity:<id>` carrying its id in
 * `metadata`. The loaded model is parented under it, `__root__` and all, so
 * Babylon's x-mirroring of imported glTF stays where Babylon put it and the
 * entity's own transform composes on top of it.
 */
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Node } from '@babylonjs/core/node';
import type { Scene } from '@babylonjs/core/scene';
import type { AssetManager, AssetSourceCounts } from '@wov/asset-system';
import type { EditorDocument } from '@wov/editor-core';
import { activeZone } from '@wov/editor-core';
import type { EntityDefinition } from '@wov/world-schema';
import type { Bounds } from './editor-camera-math.js';
import { diffEntities, isEmptyDiff } from './entity-diff.js';
import type { PrefabIndex } from './prefab-index.js';

/** The key an entity id is stored under on a node's `metadata`. */
const ENTITY_KEY = 'wovEntityId';

/** How big the stand-in cube is while a model loads, or when it never arrives. */
const PENDING_SIZE = 1;

interface EntityInstance {
  readonly root: TransformNode;
  prefabId: string;
  /** The stand-in cube, removed once the real model is parented. */
  pending: AbstractMesh | null;
  /** Bumped when the instance is rebuilt, so a late load knows it is stale. */
  generation: number;
  entity: EntityDefinition;
}

export interface SceneSyncOptions {
  readonly scene: Scene;
  readonly assets: AssetManager;
  readonly prefabs: PrefabIndex;
  /** Called when a late asset load changes what is on screen. */
  readonly onSceneChanged?: () => void;
}

export interface SceneSync {
  /** Makes the scene match `document`. Cheap when nothing changed. */
  apply(document: EditorDocument): void;
  /** Entity roots currently in the scene, counted from the scene itself. */
  meshCount(): number;
  /**
   * How many of them show their real model rather than a stand-in cube.
   *
   * Counted from the reconciler's own bookkeeping, because that is what the
   * number is *about*: not whether the document reached the scene (that is
   * {@link SceneSync.meshCount}), but whether the GLB has arrived yet.
   */
  loadedCount(): number;
  /** The node for an entity, for gizmos and framing. */
  nodeFor(entityId: string): TransformNode | undefined;
  /** The entity a picked mesh belongs to, or `undefined` for scenery. */
  entityOf(node: Node | null | undefined): string | undefined;
  /** The world-space hull of these entities, or `null` when none is loaded. */
  boundsOf(entityIds: readonly string[]): Bounds | null;
  /** Where the loaded assets came from (ADR-0015). */
  sources(): AssetSourceCounts;
  dispose(): void;
}

/** Reads the entity id off a node, walking up to the entity root. */
function entityIdOf(node: Node | null | undefined): string | undefined {
  for (let current = node ?? null; current !== null; current = current.parent) {
    const id: unknown = (current.metadata as Record<string, unknown> | null | undefined)?.[
      ENTITY_KEY
    ];
    if (typeof id === 'string') {
      return id;
    }
  }
  return undefined;
}

/**
 * The hull of everything under `root`, in world space.
 *
 * Built from the child meshes rather than from a bounding box on the root:
 * a `TransformNode` has no bounds of its own, and the imported hierarchy is
 * where the geometry actually is.
 */
function hierarchyBounds(root: TransformNode): Bounds | null {
  let min: [number, number, number] | null = null;
  let max: [number, number, number] | null = null;

  for (const mesh of root.getChildMeshes(false)) {
    mesh.computeWorldMatrix(true);
    const info = mesh.getBoundingInfo().boundingBox;
    const low = info.minimumWorld;
    const high = info.maximumWorld;
    if (min === null || max === null) {
      min = [low.x, low.y, low.z];
      max = [high.x, high.y, high.z];
      continue;
    }
    min = [Math.min(min[0], low.x), Math.min(min[1], low.y), Math.min(min[2], low.z)];
    max = [Math.max(max[0], high.x), Math.max(max[1], high.y), Math.max(max[2], high.z)];
  }

  return min === null || max === null ? null : { min, max };
}

export function createSceneSync(options: SceneSyncOptions): SceneSync {
  const { scene, assets, prefabs, onSceneChanged } = options;
  const instances = new Map<string, EntityInstance>();
  let zoneId: string | null = null;
  let previous: readonly EntityDefinition[] = [];
  let disposed = false;

  // One material for every stand-in: a cube per entity with its own material
  // would be a material per entity for the same colour.
  const pendingMaterial = new StandardMaterial('editor-pending', scene);
  pendingMaterial.diffuseColor = new Color3(0.42, 0.46, 0.54);
  pendingMaterial.emissiveColor = new Color3(0.08, 0.09, 0.12);

  const writeTransform = (instance: EntityInstance, entity: EntityDefinition): void => {
    instance.entity = entity;
    instance.root.position.set(entity.position[0], entity.position[1], entity.position[2]);
    const rotation = entity.rotation ?? [0, 0, 0];
    instance.root.rotation.set(rotation[0], rotation[1], rotation[2]);
    const scale = entity.scale ?? [1, 1, 1];
    instance.root.scaling.set(scale[0], scale[1], scale[2]);
  };

  const createInstance = (entity: EntityDefinition): EntityInstance => {
    const root = new TransformNode(`entity:${entity.id}`, scene);
    root.metadata = { [ENTITY_KEY]: entity.id };

    // A stand-in appears immediately: an entity that is invisible and unpickable
    // until its model arrives cannot be selected, moved or undone in the
    // meantime, and if the load fails it never can be.
    const pending = CreateBox(`entity:${entity.id}:pending`, { size: PENDING_SIZE }, scene);
    pending.material = pendingMaterial;
    pending.parent = root;
    pending.position.y = PENDING_SIZE / 2;

    const instance: EntityInstance = {
      root,
      prefabId: entity.prefab,
      pending,
      generation: 0,
      entity,
    };
    writeTransform(instance, entity);
    instances.set(entity.id, instance);
    void loadModel(instance, entity);
    return instance;
  };

  const loadModel = async (instance: EntityInstance, entity: EntityDefinition): Promise<void> => {
    const generation = instance.generation;
    const prefab = prefabs.get(entity.prefab);
    if (prefab === undefined) {
      // A dangling prefab reference keeps its stand-in cube on purpose: the
      // entity is in the world file and has to stay selectable and deletable.
      console.warn(`[editor] entity "${entity.id}" references unknown prefab "${entity.prefab}"`);
      return;
    }

    try {
      const instantiated = await assets.instantiate(prefab.asset, {
        rename: (name) => `${entity.id}:${name}`,
      });
      // The instance may have been removed, or rebuilt with another prefab,
      // while the GLB was in flight.
      if (disposed || instance.generation !== generation || instances.get(entity.id) !== instance) {
        for (const node of instantiated.rootNodes) {
          node.dispose();
        }
        return;
      }
      for (const node of instantiated.rootNodes) {
        node.parent = instance.root;
      }
      instance.pending?.dispose();
      instance.pending = null;
      onSceneChanged?.();
    } catch (error) {
      // Keep the stand-in and say why, rather than leaving an entity that is in
      // the file and nowhere on screen.
      console.warn(`[editor] could not load "${prefab.asset}" for "${entity.id}":`, error);
    }
  };

  const disposeInstance = (instance: EntityInstance): void => {
    instance.generation += 1;
    instance.root.dispose(false, false);
  };

  const clearAll = (): void => {
    for (const instance of instances.values()) {
      disposeInstance(instance);
    }
    instances.clear();
    previous = [];
  };

  return {
    apply(document) {
      if (disposed) {
        return;
      }
      const zone = activeZone(document);
      const nextZoneId = zone?.id ?? null;
      if (nextZoneId !== zoneId) {
        // Another zone is a different set of entities entirely; a diff between
        // them would be a long list of coincidental id matches.
        clearAll();
        zoneId = nextZoneId;
      }

      const next = zone?.entities ?? [];
      const diff = diffEntities(previous, next);
      if (isEmptyDiff(diff)) {
        previous = next;
        return;
      }

      for (const id of diff.removed) {
        const instance = instances.get(id);
        if (instance) {
          disposeInstance(instance);
          instances.delete(id);
        }
      }
      for (const entity of diff.replaced) {
        const instance = instances.get(entity.id);
        if (instance) {
          disposeInstance(instance);
          instances.delete(entity.id);
        }
        createInstance(entity);
      }
      for (const entity of diff.added) {
        createInstance(entity);
      }
      for (const entity of diff.moved) {
        const instance = instances.get(entity.id);
        if (instance) {
          writeTransform(instance, entity);
        }
      }

      previous = next;
      onSceneChanged?.();
    },

    meshCount() {
      // Counted off the scene, not off the map above: the point of this number
      // is to be an independent witness that the document reached the picture.
      return scene.transformNodes.filter((node) => entityIdOf(node) !== undefined).length;
    },

    loadedCount() {
      let loaded = 0;
      for (const instance of instances.values()) {
        if (instance.pending === null) {
          loaded += 1;
        }
      }
      return loaded;
    },

    nodeFor: (entityId) => instances.get(entityId)?.root,
    entityOf: entityIdOf,

    boundsOf(entityIds) {
      let bounds: Bounds | null = null;
      for (const id of entityIds) {
        const root = instances.get(id)?.root;
        const own = root ? hierarchyBounds(root) : null;
        if (own === null) {
          continue;
        }
        bounds =
          bounds === null
            ? own
            : {
                min: [
                  Math.min(bounds.min[0], own.min[0]),
                  Math.min(bounds.min[1], own.min[1]),
                  Math.min(bounds.min[2], own.min[2]),
                ],
                max: [
                  Math.max(bounds.max[0], own.max[0]),
                  Math.max(bounds.max[1], own.max[1]),
                  Math.max(bounds.max[2], own.max[2]),
                ],
              };
      }
      return bounds;
    },

    sources: () => assets.sources(),

    dispose() {
      disposed = true;
      clearAll();
      pendingMaterial.dispose();
    },
  };
}
