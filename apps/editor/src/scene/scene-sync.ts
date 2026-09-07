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
 *
 * **What it costs, and why that is a decision (ADR-0049).** A village is 5 273
 * entities. Three things about *how* they reach the scene are the difference
 * between an editor that draws its world at three frames a second and one that
 * draws it at the game's cost:
 *
 * 1. The model is **instantiated, not cloned**. Ninety copies of one fence are
 *    ninety `InstancedMesh` objects sharing one geometry and one material —
 *    one draw call instead of ninety, and each of them still its own node with
 *    its own matrix, individually pickable and movable, which is what an editor
 *    needs and what thin instances cannot give.
 * 2. An entity is **frozen once its model has landed** and thawed again for
 *    exactly as long as it is selected or being written to. ADR-0035 kept the
 *    editor unfrozen because a frozen node whose gizmo moves is the worst kind
 *    of bug; "never" was a choice rather than a measurement, and the choice
 *    this module makes instead is narrower and testable — see {@link thaw}.
 * 3. Grass and painted distance are **kept out of the sun's shadow map**, by
 *    the game's own rule (`castsShadows` in `@wov/world-schema`), so the author
 *    is shown the light the game draws and not three thousand tufts shadowing
 *    each other into a dark mat.
 */
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture.js';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';
import type { Node } from '@babylonjs/core/node.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { AssetManager, AssetSourceCounts } from '@wov/asset-system';
import { freezeStaticNodes, unfreezeStaticNodes } from '@wov/engine';
import type { EditorDocument } from '@wov/editor-core';
import { activeZone } from '@wov/editor-core';
import { castsShadows, isBackdrop } from '@wov/world-schema';
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
  /** Whether this subtree's world matrices are currently pinned; see {@link thaw}. */
  frozen: boolean;
  entity: EntityDefinition;
}

/**
 * What the viewport does with meshes that must stay out of the sun's map.
 *
 * The two halves of `LightingHandle` this module needs, named as a shape of
 * their own so that the *viewport* can hand over a pair that survives a
 * relight: the rig itself is thrown away and rebuilt whenever the open world's
 * lighting profile changes, and an exclusion said to a rig that no longer
 * exists is grass casting shadows again with nothing on screen to explain it.
 */
export interface ShadowExclusions {
  /** Out of the map in both directions: it neither casts nor receives. */
  excludeFromShadows(meshes: readonly AbstractMesh[]): void;
  /** Out of it as a caster only; it still takes the shadow of a house. */
  excludeFromCasting(meshes: readonly AbstractMesh[]): void;
}

export interface SceneSyncOptions {
  readonly scene: Scene;
  readonly assets: AssetManager;
  readonly prefabs: PrefabIndex;
  /** Called when a late asset load changes what is on screen. */
  readonly onSceneChanged?: () => void;
  /**
   * Where a mesh goes that the sun's shadow map must not see (ADR-0027,
   * ADR-0031). Without one the editor draws every mesh into the map, which is
   * what it did before ADR-0049 and what the game has never done.
   */
  readonly shadows?: ShadowExclusions;
}

export interface SceneSync {
  /** Makes the scene match `document`. Cheap when nothing changed. */
  apply(document: EditorDocument): void;
  /**
   * Entity roots currently in the scene, counted from the scene itself.
   *
   * Exactly one per entity, and that is the point: it is the independent
   * witness that the document reached the picture, so it has to be comparable
   * to `entityCount` without arithmetic.
   */
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
  /**
   * The texture files the scene has finished loading, by file name.
   *
   * The counterpart to {@link SceneSync.loadedCount}, and the reason it is not
   * enough: a model can arrive, parse and draw with its base colour missing —
   * an image URI the loader rejects does exactly that — and every other number
   * in this bridge still calls that a success. This one answers "did the
   * pixels arrive", not "did the file" (ADR-0019).
   */
  loadedTextures(): readonly string[];
  /**
   * Entity subtrees whose world matrices are currently pinned.
   *
   * The witness for ADR-0049's narrow freeze: a number that only ever moves
   * when a model lands, a selection changes or an entity is written to, and
   * that a test can read without a renderer telling it what it wants to hear.
   */
  frozenCount(): number;
  dispose(): void;
}

/**
 * What a `Texture` adds to `BaseTexture` and this module needs: the URL it was
 * loaded from. Declared rather than imported because `getActiveTextures` hands
 * back the base type, and only some of those have a file behind them.
 */
interface UrlBearing {
  readonly url?: string | null;
}

/** The load notification a `Texture` has and a `BaseTexture` does not. */
interface LoadNotifying {
  readonly onLoadObservable?: { addOnce(callback: () => void): unknown };
}

const DATA_PREFIX = 'data:';

/**
 * The file name a loaded texture came from, or `undefined` for one that has no
 * file — the renderer's own generated textures, and data URIs.
 *
 * Separated out because it is the only part of {@link SceneSync.loadedTextures}
 * with a decision in it, and the rest needs a live scene to exercise.
 */
export function textureFileName(source: string): string | undefined {
  // Babylon prefixes the URL of a texture it loaded out of a glTF with
  // `data:`, whatever the texture actually came from:
  // `data:http://host/store/environment/textures/atlas.png`. Stripping that is
  // the difference between reporting the file and reporting nothing.
  const url = source.startsWith(DATA_PREFIX) ? source.slice(DATA_PREFIX.length) : source;
  if (url.includes(';base64,')) {
    return undefined;
  }
  const file = url.split('?')[0]?.split('/').pop();
  return file === undefined || !file.includes('.') ? undefined : file;
}

/**
 * The entity id written on this node itself, or `undefined`.
 *
 * The counterpart to {@link entityIdOf}, and the difference matters: a store
 * model brings its own `__root__` transform node, which is parented under the
 * entity root and therefore *inherits* an answer from the walking version. One
 * entity would then be counted two or three times, depending on how deep the
 * GLB's hierarchy is.
 */
function ownEntityId(node: Node): string | undefined {
  const id: unknown = (node.metadata as Record<string, unknown> | null | undefined)?.[ENTITY_KEY];
  return typeof id === 'string' ? id : undefined;
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
    // On a frozen subtree this returns the pinned matrix, which is the right
    // one: it was computed with `force` at the moment the freeze happened and
    // nothing that could invalidate it happens without a thaw first.
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

/**
 * The mesh whose material a per-mesh render flag actually reaches.
 *
 * For an `InstancedMesh` that is its source: the two share one material, and
 * `applyFog` is an input to that material's defines rather than something the
 * renderer reads per draw. Written on the instance alone it is accepted,
 * changes nothing, and the mountains come out fog-grey. The same trap
 * `receiveShadows` has, documented in the same words in `@wov/engine`'s
 * lighting rig and in the game's `markAsBackdrop`.
 */
function materialOwner(mesh: AbstractMesh): AbstractMesh {
  return mesh.isAnInstance ? (mesh as InstancedMesh).sourceMesh : mesh;
}

export function createSceneSync(options: SceneSyncOptions): SceneSync {
  const { scene, assets, prefabs, onSceneChanged, shadows } = options;
  const instances = new Map<string, EntityInstance>();
  let zoneId: string | null = null;
  let previous: readonly EntityDefinition[] = [];
  let disposed = false;
  /**
   * Entities that must stay thawed: the current selection.
   *
   * The selection is exactly the set a gizmo can be attached to, and a gizmo
   * writes straight onto the node without going through {@link writeTransform}
   * — so it is the one place where "about to move" cannot be noticed after the
   * fact. Deriving the hold from the document rather than being told about it
   * keeps the rule in one place: `apply` already sees every selection change,
   * because a selection change replaces the document (ADR-0018).
   */
  let held: ReadonlySet<string> = new Set<string>();

  // One material for every stand-in: a cube per entity with its own material
  // would be a material per entity for the same colour.
  const pendingMaterial = new StandardMaterial('editor-pending', scene);
  pendingMaterial.diffuseColor = new Color3(0.42, 0.46, 0.54);
  pendingMaterial.emissiveColor = new Color3(0.08, 0.09, 0.12);

  /**
   * The one box every stand-in is an instance of.
   *
   * A `CreateBox` per entity was 5 273 geometries and 5 273 vertex buffers for
   * one shape, built and thrown away again during the load — which is the
   * moment the editor can least afford them. The source itself is invisible and
   * unpickable and stays out of the picture; Babylon draws an instance whether
   * or not its source is visible, and the source is parented nowhere, so
   * nothing inherits from it.
   */
  const pendingSource = CreateBox('editor-pending-source', { size: PENDING_SIZE }, scene);
  pendingSource.material = pendingMaterial;
  pendingSource.isVisible = false;
  pendingSource.isPickable = false;

  // A texture arriving changes the picture as much as a model arriving does, and
  // nothing else notices it: the models are instantiated from asset containers,
  // so the reconciler is long finished by the time the atlas decodes. Without
  // this, `loadedTextures` reports whatever was true at the last document edit.
  const textureWatch = scene.onNewTextureAddedObservable.add((texture) => {
    (texture as BaseTexture & LoadNotifying).onLoadObservable?.addOnce(() => {
      if (!disposed) {
        onSceneChanged?.();
      }
    });
  });

  /**
   * Pins this entity's world matrices, unless it is one the author is holding.
   *
   * Only ever called on a subtree that is not already frozen: `computeWorldMatrix`
   * returns early on a frozen node, so freezing a second time would pin whatever
   * was pinned before rather than what is there now.
   */
  const freeze = (instance: EntityInstance): void => {
    if (instance.frozen || held.has(instance.entity.id)) {
      return;
    }
    freezeStaticNodes([instance.root]);
    instance.frozen = true;
  };

  /**
   * Lets this entity move again.
   *
   * The counterpart to {@link freeze} and the whole safety argument of the
   * narrow freeze: everything that can move an entity goes through here first
   * — a selection (which is what a gizmo attaches to), a transform written by
   * the document, a rebuild. A subtree that is thawed and never re-frozen costs
   * what the editor cost before ADR-0049 for that one entity; a subtree that is
   * frozen while something moves it is a prop whose gizmo works, whose document
   * updates and whose picture never changes.
   */
  const thaw = (instance: EntityInstance): void => {
    if (!instance.frozen) {
      return;
    }
    unfreezeStaticNodes([instance.root]);
    instance.frozen = false;
  };

  const writeTransform = (instance: EntityInstance, entity: EntityDefinition): void => {
    const refreeze = instance.frozen;
    thaw(instance);
    instance.entity = entity;
    instance.root.position.set(entity.position[0], entity.position[1], entity.position[2]);
    const rotation = entity.rotation ?? [0, 0, 0];
    instance.root.rotation.set(rotation[0], rotation[1], rotation[2]);
    const scale = entity.scale ?? [1, 1, 1];
    instance.root.scaling.set(scale[0], scale[1], scale[2]);
    if (refreeze) {
      freeze(instance);
    }
  };

  const createInstance = (entity: EntityDefinition): EntityInstance => {
    const root = new TransformNode(`entity:${entity.id}`, scene);
    root.metadata = { [ENTITY_KEY]: entity.id };

    // A stand-in appears immediately: an entity that is invisible and unpickable
    // until its model arrives cannot be selected, moved or undone in the
    // meantime, and if the load fails it never can be.
    const pending = pendingSource.createInstance(`entity:${entity.id}:pending`);
    pending.parent = root;
    pending.position.y = PENDING_SIZE / 2;

    const instance: EntityInstance = {
      root,
      prefabId: entity.prefab,
      pending,
      generation: 0,
      frozen: false,
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
        // Copies that share one geometry and one material. Babylon falls back
        // to a clone for anything it cannot instance — transform nodes, skinned
        // meshes, meshes with no vertices — so this is a request rather than an
        // assertion, and every copy is still a node of its own with its own
        // matrix, pickable and movable. That is the difference from the thin
        // instances the game scatters vegetation with (ADR-0025), which are not
        // nodes and could not be selected.
        instanced: true,
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
      const meshes = instance.root
        .getChildMeshes(false)
        .filter((mesh) => mesh !== instance.pending);
      if (isBackdrop(prefab)) {
        // Out of the picking, which is what the viewport rays against for both
        // "what did I click on" and "what is the surface under this point"
        // (`picking.ts`). Left pickable, a prop dropped near the horizon lands
        // on a mountain half a kilometre away, and a click anywhere the shell
        // covers selects a painted range instead of the house behind it. The
        // hierarchy still lists it, so it stays selectable and editable —
        // which is the parity rule: what a script can place, a person can move
        // (ADR-0031).
        for (const mesh of meshes) {
          mesh.isPickable = false;
          mesh.applyFog = false;
          // `applyFog` is a material define, and an instance shares its
          // source's material: said on the instance alone it is accepted and
          // does nothing. `isPickable` really is per mesh, so it is said twice.
          const owner = materialOwner(mesh);
          owner.applyFog = false;
          owner.isPickable = false;
        }
      }
      if (shadows !== undefined && !castsShadows(prefab)) {
        // The game's rule, by the game's own function (`@wov/world-schema`):
        // grass receives shadow and casts none, painted distance is out of the
        // map in both directions. An editor that shadows every tuft shows the
        // author a dark mat the game will never draw (ADR-0027, ADR-0031).
        const drawn = meshes.filter((mesh) => mesh.getTotalVertices() > 0);
        if (isBackdrop(prefab)) {
          shadows.excludeFromShadows(drawn);
        } else {
          shadows.excludeFromCasting(drawn);
        }
      }
      instance.pending?.dispose();
      instance.pending = null;
      // The model is where the document says; nothing under this root moves
      // again until the author selects it or the document writes to it.
      freeze(instance);
      onSceneChanged?.();
    } catch (error) {
      // Keep the stand-in and say why, rather than leaving an entity that is in
      // the file and nowhere on screen.
      console.warn(`[editor] could not load "${prefab.asset}" for "${entity.id}":`, error);
    }
  };

  const disposeInstance = (instance: EntityInstance): void => {
    instance.generation += 1;
    instance.frozen = false;
    instance.root.dispose(false, false);
  };

  const clearAll = (): void => {
    for (const instance of instances.values()) {
      disposeInstance(instance);
    }
    instances.clear();
    previous = [];
  };

  /**
   * Moves the hold to this selection: thaw what joined it, re-freeze what left.
   *
   * A zone switch is not a special case — `clearAll` has already emptied the
   * map, so every id in the old hold simply finds nothing to re-freeze.
   */
  const holdSelection = (selection: readonly string[]): void => {
    const next = new Set(selection);
    const released = [...held].filter((id) => !next.has(id));
    // The hold moves first, because `freeze` asks it whether it may act.
    held = next;
    for (const id of next) {
      const instance = instances.get(id);
      if (instance !== undefined) {
        thaw(instance);
      }
    }
    for (const id of released) {
      const instance = instances.get(id);
      // Re-frozen only when the model has landed: a stand-in is about to be
      // replaced, and pinning it would pin a matrix nothing will use.
      if (instance !== undefined && instance.pending === null) {
        freeze(instance);
      }
    }
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

      // Before the diff, and before its early return: a click that only changes
      // the selection is exactly the gesture that must thaw a prop, and it
      // changes no entity at all.
      holdSelection(document.selection);

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
      // Only nodes that carry the id *themselves* count — the intermediate
      // nodes a loaded GLB brings inherit it and are not entities.
      return scene.transformNodes.filter((node) => ownEntityId(node) !== undefined).length;
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

    frozenCount() {
      let frozen = 0;
      for (const instance of instances.values()) {
        if (instance.frozen) {
          frozen += 1;
        }
      }
      return frozen;
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

    loadedTextures() {
      // Walked from the entity roots rather than from `scene.textures`: models
      // are loaded into asset containers and instantiated from them, so their
      // textures never enter the scene's own list — that one holds the
      // renderer's internal ones and would report success for an empty world.
      const names = new Set<string>();
      for (const instance of instances.values()) {
        for (const mesh of instance.root.getChildMeshes()) {
          for (const texture of mesh.material?.getActiveTextures() ?? []) {
            if (!texture.isReady()) {
              continue;
            }
            // The URL when the texture has one — a glTF texture is named after
            // its material slot, which does not say which file arrived.
            const file = textureFileName((texture as BaseTexture & UrlBearing).url ?? texture.name);
            if (file !== undefined) {
              names.add(file);
            }
          }
        }
      }
      return [...names].sort();
    },

    dispose() {
      disposed = true;
      scene.onNewTextureAddedObservable.remove(textureWatch);
      clearAll();
      pendingSource.dispose();
      pendingMaterial.dispose();
    },
  };
}
