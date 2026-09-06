/**
 * Turning one zone of a world file into a scene (ADR-0022).
 *
 * The world file is the truth here exactly as it is in the editor (ADR-0018):
 * nothing in this module decides what the world contains. It is handed a zone
 * and a prefab catalogue and it makes the scene say the same thing — the
 * ground from `zone.terrain` (ADR-0020) and one node per entity, each one
 * carrying the model its prefab names.
 *
 * **Why entities are instanced.** The village zone places 1216 entities from
 * 139 prefabs: eighty copies of one fence, sixty of one plank. Cloning each
 * one would put eighty meshes in front of the rasteriser that differ only in
 * their matrix. `AssetManager.instantiate({ instanced: true })` asks Babylon
 * for `InstancedMesh` copies instead, which share geometry and material with
 * the container's mesh and are drawn together — measured in `docs/development.md`.
 * Anything Babylon cannot instance (a transform node, a skinned mesh) it
 * clones, so the request never costs correctness.
 *
 * **Why vegetation is different.** The scatter tool (ADR-0025) plants thousands
 * of tufts of grass, and a scene node each is what makes that expensive: a
 * transform to recompute and a node for the culler to weigh, per frame, per
 * plant. Those prefabs are drawn as **thin instances** instead — one mesh with a
 * matrix buffer, no node, not pickable — which is what `render/thin-instances.ts`
 * does. Nothing in the game asks a tuft of grass a question; the editor, which
 * does, keeps the nodes.
 *
 * **Why one prefab at a time.** Each distinct asset is loaded once and
 * instantiated as many times as the zone places it. That is also why the loads
 * are sequential per prefab and parallel across them: 139 GLB requests at once
 * would queue behind each other in the browser anyway, and the memory peak of
 * 139 half-parsed containers is real.
 */
import { Scene } from '@babylonjs/core/scene.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { createTerrain, terrainLayerSources } from '@wov/engine';
import type { TerrainHandle, TerrainTextureSource } from '@wov/engine';
import {
  AssetManager,
  assetStoreUrl,
  assetUrl,
  createAssetCatalog,
  type AssetCatalogEntry,
  type AssetSourceConfig,
  type AssetSourceCounts,
} from '@wov/asset-system';
import { isBackdrop } from '@wov/world-schema';
import type {
  EntityDefinition,
  PrefabDefinition,
  TerrainDefinition,
  ZoneDefinition,
} from '@wov/world-schema';
import type { PhysicsWorld, StaticBody } from '@wov/physics';
import { applyThinInstances, thinInstanceMatrices } from './render/thin-instances.js';
import {
  collisionShapeOf,
  groupByScale,
  placementOf,
  readContainerBounds,
  readContainerGeometry,
  type ModelGeometry,
} from './entity-collision.js';

/** The stand-in a private texture falls back to when there is no store. */
const TEXTURE_PLACEHOLDER = 'placeholders/textures/unavailable.png';

/** Store URL plus the committed stand-in, for one private texture. */
function textureSource(source: AssetSourceConfig, path: string): TerrainTextureSource {
  return { url: assetStoreUrl(source, path), fallbackUrl: assetUrl(source, TEXTURE_PLACEHOLDER) };
}

/**
 * The prefab catalogue, indexed the two ways this module reads it: by id, to
 * resolve `EntityDefinition.prefab`, and by asset path, to tell the
 * {@link AssetManager} which files live in the private store (ADR-0015).
 *
 * Several prefabs may name the same GLB, so the asset catalogue is
 * deduplicated here rather than throwing inside `createAssetCatalog`.
 *
 * A prefab's separate collider model is listed too (ADR-0026): it is loaded by
 * the same manager, from the same store, with the same stand-in policy — a
 * second loader for it would be a second answer to "where are the bytes".
 */
export function indexPrefabs(prefabs: readonly PrefabDefinition[]): {
  readonly byId: ReadonlyMap<string, PrefabDefinition>;
  readonly assets: readonly AssetCatalogEntry[];
} {
  const byId = new Map<string, PrefabDefinition>();
  const byAsset = new Map<string, AssetCatalogEntry>();
  for (const prefab of prefabs) {
    byId.set(prefab.id, prefab);
    if (!byAsset.has(prefab.asset)) {
      byAsset.set(prefab.asset, {
        path: prefab.asset,
        visibility: prefab.visibility,
        placeholder: prefab.placeholder,
      });
    }
    const collider = prefab.collision?.asset;
    if (collider !== undefined && !byAsset.has(collider.path)) {
      byAsset.set(collider.path, {
        path: collider.path,
        visibility: collider.visibility,
        placeholder: collider.placeholder,
      });
    }
  }
  return { byId, assets: [...byAsset.values()] };
}

/**
 * Whether the game draws this prefab's copies as thin instances.
 *
 * Category, not a list of ids: vegetation is exactly the set of things the
 * scatter tool plants in bulk and nothing in the game interacts with, and a
 * hand-kept list of prefab ids would be out of date the next time the asset
 * import runs.
 */
export function drawsAsThinInstances(prefab: PrefabDefinition): boolean {
  return prefab.category === 'vegetation';
}

/**
 * Shortest a model may be and still be drawn into the sun's shadow map.
 *
 * Half a metre, from the two ends of the measurement. A tuft of the scattered
 * grass is 0.25 m tall (`content/prefabs/imported.json`) and the shadow map
 * covers 120 m in 2048 texels — 5.9 cm of ground each — so its whole shadow is
 * about four texels. The next thing up is a bush at 1.88 m, which is 32 texels
 * and a shape a player can see. Nothing in the village stands between the two.
 */
export const SHADOW_CASTER_MINIMUM_HEIGHT = 0.5;

/**
 * Whether this prefab's copies are drawn into the sun's shadow map.
 *
 * Everything does, except vegetation too short for its shadow to be a shape.
 * That is not only a saving, though it is a large one — the village scatters
 * 3 473 tufts of grass, each of them a thin instance the shadow pass would draw
 * a second time every frame. It is also what the picture wants: tufts that cast
 * shadows cast them on *each other*, and a dense field of grass then reads as a
 * dark mat rather than as grass. They still **receive**: a tuft in the shade of
 * a house is in the shade (`excludeFromCasting` in `@wov/engine`).
 *
 * Measured on the model rather than assumed from the category, because the
 * category says what a thing is and the bounds say how big it is — and a prefab
 * that was never measured casts, because "we do not know" must not read as
 * "it is small".
 */
export function castsShadows(prefab: PrefabDefinition): boolean {
  const bounds = prefab.bounds;
  // A backdrop is out of the shadow map for a different reason and without a
  // measurement: the sun's map covers 120 m around the player, the nearest
  // shell stands 290 m away, and a shell 1 188 m across put into that map would
  // stretch it over the whole world. It receives nothing either — `main.ts`
  // hands every backdrop mesh to `excludeFromShadows`, which is both directions
  // at once (ADR-0031).
  if (isBackdrop(prefab)) {
    return false;
  }
  if (bounds === undefined || prefab.category !== 'vegetation') {
    return true;
  }
  return bounds.max[1] - bounds.min[1] >= SHADOW_CASTER_MINIMUM_HEIGHT;
}

/**
 * The two flags a backdrop mesh has written on it, and the one number that says
 * whether it is a mesh at all.
 *
 * Structural rather than `AbstractMesh`, for the reason every other pure module
 * in this app is: the rule is testable without a renderer, and Babylon's mesh
 * satisfies it as it stands.
 */
export interface BackdropMesh {
  applyFog: boolean;
  isPickable: boolean;
  getTotalVertices(): number;
  /** True on an `InstancedMesh`, which shares its source's material. */
  readonly isAnInstance?: boolean;
  /** Present on an `InstancedMesh`: the mesh whose material it shares. */
  readonly sourceMesh?: { applyFog: boolean; isPickable: boolean };
}

/** A root node one `instantiate` call handed back. */
export interface BackdropRoot<M extends BackdropMesh> {
  getChildMeshes(directDescendantsOnly?: boolean): M[];
}

/**
 * Takes one backdrop model out of the fog and out of the picking, and says
 * which meshes it was.
 *
 * **Why the fog is a question and not a flat no.** A backdrop used to be taken
 * out of the fog outright, because the village's fog ran from 80 m to 420 m
 * while the mountain shells stand 290–806 m out: fogged by *that* fog, the
 * outer shell is entirely fog colour and the horizon is a flat band where a
 * mountain range was. The reasoning added that the haze of distance is painted
 * into the panorama already — but it is not. Measured, the panorama is a green
 * painting (B−R −18, saturation 0.26), and unfogged it read *darker* than the
 * hazed ground in front of it, so the furthest thing in the world was also the
 * heaviest. Depth ran backwards.
 *
 * So the question is asked per mesh instead ({@link backdropTakesFog}): a
 * backdrop takes the fog when the fog reaches past it, and stays out of it when
 * it does not. That keeps the original guarantee — no fog can flatten the
 * horizon, because a fog ending before the shell simply does not apply to it —
 * and lets a world that hazes to 1 100 m put the range behind its own air
 * (ADR-0034).
 *
 * **Why not pickable.** The editor rays against whatever is pickable to find
 * the surface under the cursor and to drop a prop onto it, and a prop dropped
 * onto a mountain lands half a kilometre from where it was aimed. Selecting a
 * backdrop still works, through the hierarchy, where it is a row like any other.
 *
 * **Why no rendering group.** Because depth already does it: the shells really
 * are the furthest geometry in the scene, 290 m beyond the last corner of a
 * 300 m tile. A rendering group *sounds* like the answer to "draw it behind
 * everything" and would have been a second, silent rule about draw order to
 * keep in step with the first.
 *
 * **Why `applyFog` is written on the source mesh.** It is not a flag the
 * renderer reads per draw — it is an input to the *material's* defines, and an
 * `InstancedMesh` shares its source's material. Written on the instance alone
 * it is accepted, changes nothing, and the mountains come out fog-grey. That is
 * the same trap `receiveShadows` has, documented in the same words in
 * `@wov/engine`'s lighting rig. `isPickable` really is per mesh, so it is
 * written on both.
 *
 * @param roots the nodes one `instantiate` call returned — the loader's
 *   `__root__` included, which is why the meshes are gathered by walking it.
 * @param takesFog asked once per mesh; see {@link backdropTakesFog}, which is
 *   the rule, kept apart from the walk so it can be read without a renderer.
 */
/**
 * Whether a backdrop mesh takes the scene's fog.
 *
 * `reach` is how far away the farthest point of that mesh can be — its world
 * bounding sphere's centre distance plus its radius. The fog has to end beyond
 * that, not merely somewhere inside it: a shell whose far side sits past
 * `fog.end` is drawn with a band of pure fog colour across it, which is the
 * flat horizon this rule exists to prevent.
 *
 * Strictly greater, so a fog ending exactly at the shell does not fog it: at
 * `end === reach` the far side is at fog factor 1, which is that same flat
 * band on the last row of pixels.
 */
export function backdropTakesFog(
  fog: { readonly enabled: boolean; readonly end: number },
  reach: number,
): boolean {
  return fog.enabled && fog.end > reach;
}

export function markAsBackdrop<M extends BackdropMesh>(
  roots: readonly BackdropRoot<M>[],
  takesFog: (mesh: M) => boolean,
): M[] {
  const meshes: M[] = [];
  for (const root of roots) {
    for (const mesh of root.getChildMeshes(false)) {
      // A `__root__` and the container's transform nodes come back from the
      // same walk and are not surfaces; skipping them keeps the returned list
      // exactly "what the shadow map must not see".
      if (mesh.getTotalVertices() === 0) {
        continue;
      }
      const fogged = takesFog(mesh);
      const shared = mesh.isAnInstance === true ? mesh.sourceMesh : undefined;
      if (shared !== undefined) {
        shared.applyFog = fogged;
        shared.isPickable = false;
      }
      mesh.applyFog = fogged;
      mesh.isPickable = false;
      meshes.push(mesh);
    }
  }
  return meshes;
}

/** Entities grouped by the prefab they place, in first-appearance order. */
export function groupByPrefab(
  entities: readonly EntityDefinition[],
): ReadonlyMap<string, readonly EntityDefinition[]> {
  const groups = new Map<string, EntityDefinition[]>();
  for (const entity of entities) {
    const group = groups.get(entity.prefab);
    if (group === undefined) {
      groups.set(entity.prefab, [entity]);
    } else {
      group.push(entity);
    }
  }
  return groups;
}

/**
 * Which zone the game walks around in: the first one with ground.
 *
 * A world file holds interiors and surroundings beside the outdoor zone, and
 * only one of them has a `terrain` block. Streaming and portals are a later
 * phase; until then "the zone with the ground" is the honest answer, and a
 * world with no ground at all falls back to the first zone so that a flat test
 * world still opens.
 */
export function playableZone(zones: readonly ZoneDefinition[]): ZoneDefinition | undefined {
  return zones.find((zone) => zone.terrain !== undefined) ?? zones[0];
}

/** What {@link loadZoneTerrain} and {@link placeEntities} report back. */
export interface ZoneScene {
  readonly zone: ZoneDefinition;
  /** The ground, or `null` for a zone that has none. */
  readonly terrain: TerrainHandle | null;
  /** One transform node per placed entity. */
  readonly roots: readonly TransformNode[];
  /** Entities whose prefab the catalogue does not know, by entity id. */
  readonly unknownPrefabs: readonly string[];
  /** Prefabs whose model would not load, as `prefab: reason`. */
  readonly failed: readonly string[];
  /** How many distinct prefab models were loaded. */
  readonly models: number;
  /** Entities drawn as thin instances rather than as scene nodes. */
  readonly thinInstances: number;
  /** Meshes that must receive shadow without casting it; see {@link castsShadows}. */
  readonly nonCasters: readonly AbstractMesh[];
  /** Meshes of the painted distance, out of the light entirely; see {@link isBackdrop}. */
  readonly backdrop: readonly AbstractMesh[];
  /** Where the bytes came from (ADR-0015). */
  readonly sources: AssetSourceCounts;
}

export interface ZoneSceneOptions {
  readonly scene: Scene;
  readonly source: AssetSourceConfig;
  readonly zone: ZoneDefinition;
  readonly prefabs: readonly PrefabDefinition[];
}

/**
 * Loads a zone's ground.
 *
 * The height field goes through the {@link AssetManager} so a clone with no
 * asset store gets the committed hull box instead of an exception (ADR-0015);
 * the textures go straight to a URL, because a texture has no container to
 * load and its stand-in is one shared grey image.
 *
 * @throws {Error} when the height field loads but carries no mesh — a tile with
 * nothing to stand on is worse than a missing one, because the player falls
 * through it silently.
 *
 * @param receiveShadows whether the ground samples the sun's shadow map
 * (ADR-0024). It has to be decided here rather than afterwards: the lookup is
 * compiled into the tile's generated program.
 */
export async function loadZoneTerrain(
  scene: Scene,
  source: AssetSourceConfig,
  terrain: TerrainDefinition,
  name: string,
  receiveShadows = false,
): Promise<{ readonly terrain: TerrainHandle; readonly sources: AssetSourceCounts }> {
  const placeholder = `placeholders/${terrain.heightField}`;
  const manager = new AssetManager({
    source,
    scene,
    catalog: createAssetCatalog([
      { path: terrain.heightField, visibility: 'private', placeholder },
    ]),
  });

  const entries = await manager.instantiate(terrain.heightField);
  const root = entries.rootNodes.find(
    (node): node is TransformNode => node instanceof TransformNode,
  );
  if (root === undefined) {
    throw new Error(`terrain "${terrain.heightField}" instantiated no transform node`);
  }

  const handle = createTerrain(scene, root, {
    name,
    position: [terrain.position[0], terrain.position[1], terrain.position[2]],
    size: [terrain.size[0], terrain.size[1]],
    layers: terrainLayerSources(terrain.layers ?? [], (path) => textureSource(source, path)),
    splat: (terrain.splat ?? []).map((path) => textureSource(source, path)),
    flatNormals: terrain.flatNormals === true,
    // Compiled into the ground's own program, not a mesh flag — the terrain
    // material is hand-written GLSL and `receiveShadows` means nothing to it
    // (ADR-0020, ADR-0024). The sun's shadow map must therefore already exist
    // when this runs, which is why the world's lighting is applied first.
    receiveShadows,
  });

  if (handle.meshes.length === 0) {
    handle.dispose();
    throw new Error(`terrain "${terrain.heightField}" has no mesh to stand on`);
  }
  return { terrain: handle, sources: manager.sources() };
}

/**
 * Puts every entity of a zone into the scene.
 *
 * One `TransformNode` per entity carries the entity's own transform, and the
 * instantiated model is parented under it — `__root__` and all, so Babylon's
 * handling of glTF's handedness stays where Babylon put it and the entity's
 * transform composes on top of it. The editor does the same thing for the same
 * reason (`apps/editor/src/scene/scene-sync.ts`), and the two have to agree:
 * a prop the editor puts on a wall must be on that wall in the game.
 *
 * A prefab whose model fails to load costs its entities, not the zone: the
 * failure is collected and reported, and everything else still stands.
 */
export async function placeEntities(options: ZoneSceneOptions): Promise<{
  readonly roots: readonly TransformNode[];
  readonly unknownPrefabs: readonly string[];
  readonly failed: readonly string[];
  readonly models: number;
  readonly thinInstances: number;
  /**
   * The meshes the shadow map must not draw, handed back rather than acted on.
   *
   * This module does not know the light — the rig is the app's (ADR-0024), and
   * a renderer package reaching into it from here would be the second answer to
   * "who lights the scene". So it says which meshes, and `main.ts` says so to
   * the rig.
   */
  readonly nonCasters: readonly AbstractMesh[];
  /**
   * The meshes of every backdrop entity, handed back for the same reason
   * {@link nonCasters} is: the light belongs to the app (ADR-0024). What is done
   * to them *here* is what does not need the light — fog and picking.
   */
  readonly backdrop: readonly AbstractMesh[];
  readonly sources: AssetSourceCounts;
  /**
   * The loader that did the work, with every model of the zone still cached.
   *
   * Handed back rather than kept private because the collision builder needs
   * the very same containers: reading the hull off a second copy of a model
   * would be a second answer to "how big is this thing".
   */
  readonly manager: AssetManager;
}> {
  const { scene, source, zone, prefabs } = options;
  const { byId, assets } = indexPrefabs(prefabs);
  const manager = new AssetManager({ source, scene, catalog: createAssetCatalog(assets) });

  const roots: TransformNode[] = [];
  const unknownPrefabs: string[] = [];
  const failed: string[] = [];
  const groups = groupByPrefab(zone.entities);

  const known = [...groups].filter(([prefabId, entities]) => {
    if (byId.has(prefabId)) {
      return true;
    }
    // A dangling prefab reference is a world-file problem, not a load failure:
    // it is named once per prefab rather than once per entity.
    unknownPrefabs.push(...entities.map((entity) => entity.id));
    return false;
  });

  let thinInstances = 0;
  const nonCasters: AbstractMesh[] = [];
  const backdrop: AbstractMesh[] = [];

  await Promise.all(
    known.map(async ([prefabId, entities]) => {
      const prefab = byId.get(prefabId);
      if (prefab === undefined) {
        return;
      }

      if (drawsAsThinInstances(prefab)) {
        try {
          // Read the counter *after* the await, not before: `total += await f()`
          // captures the old value first, and with these loads running
          // concurrently every prefab would then overwrite the previous one's
          // count instead of adding to it.
          const placed = await placeAsThinInstances(manager, prefab, entities);
          thinInstances += placed.entities;
          if (!castsShadows(prefab)) {
            nonCasters.push(...placed.meshes);
          }
        } catch (error) {
          failed.push(`${prefabId}: ${error instanceof Error ? error.message : String(error)}`);
        }
        return;
      }

      for (const entity of entities) {
        const root = new TransformNode(`entity:${entity.id}`, scene);
        root.position.set(entity.position[0], entity.position[1], entity.position[2]);
        const rotation = entity.rotation ?? [0, 0, 0];
        root.rotation.set(rotation[0], rotation[1], rotation[2]);
        const scale = entity.scale ?? [1, 1, 1];
        root.scaling.set(scale[0], scale[1], scale[2]);
        roots.push(root);

        try {
          const instantiated = await manager.instantiate(prefab.asset, {
            rename: (nodeName) => `${entity.id}:${nodeName}`,
            instanced: true,
          });
          for (const node of instantiated.rootNodes) {
            node.parent = root;
          }
          if (isBackdrop(prefab)) {
            // The rig has already run (`main.ts` relights before it places), so
            // the scene's fog here is the world file's fog and not Babylon's
            // default. Reach is measured off the mesh rather than assumed: the
            // shells are 594 m shells standing on a 300 m tile, the clouds are
            // small and near, and they do not want the same answer.
            backdrop.push(
              ...markAsBackdrop(instantiated.rootNodes, (mesh) => {
                mesh.computeWorldMatrix(true);
                const sphere = mesh.getBoundingInfo().boundingSphere;
                return backdropTakesFog(
                  {
                    enabled: scene.fogEnabled && scene.fogMode === Scene.FOGMODE_LINEAR,
                    end: scene.fogEnd,
                  },
                  sphere.centerWorld.length() + sphere.radiusWorld,
                );
              }),
            );
          }
        } catch (error) {
          failed.push(`${prefabId}: ${error instanceof Error ? error.message : String(error)}`);
          // One report per prefab: 80 identical lines say nothing 1 does not.
          return;
        }
      }
    }),
  );

  return {
    roots,
    unknownPrefabs,
    failed,
    models: known.length - failed.length,
    thinInstances,
    nonCasters,
    backdrop,
    sources: manager.sources(),
    manager,
  };
}

/** What building a zone's collision cost and what it produced (ADR-0026). */
export interface ZoneCollisionReport {
  /** Distinct shapes built — one per prefab and scale. */
  readonly shapes: number;
  /** Bodies placed; one per entity that has a shape. */
  readonly bodies: number;
  /** Triangles handed to the solver, hull and mesh shapes together. */
  readonly triangles: number;
  /** Entities whose prefab collides against nothing, on purpose. */
  readonly passable: number;
  /** Entities whose prefab does not say what it collides against at all. */
  readonly undeclared: number;
  /** Prefabs whose shape could not be built, as `prefab: reason`. */
  readonly failed: readonly string[];
  /** Wall-clock time the whole build took, in milliseconds. */
  readonly milliseconds: number;
}

export interface ZoneCollisionOptions {
  readonly physics: PhysicsWorld;
  /** The loader `placeEntities` handed back, models still cached. */
  readonly manager: AssetManager;
  readonly zone: ZoneDefinition;
  readonly prefabs: readonly PrefabDefinition[];
  /**
   * Longest the build may hold the main thread before handing it back, in
   * milliseconds. One frame's worth by default.
   */
  readonly sliceMilliseconds?: number;
  /** How to hand the thread back; the next animation frame by default. */
  readonly yieldToFrame?: () => Promise<void>;
}

/** Waits for the next frame, so a long build does not freeze the one running. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        resolve();
      });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Gives every entity of a zone a static collision body (ADR-0026).
 *
 * One shape per *(prefab, scale)* pair and one body per entity: the village
 * places 1216 entities from 139 models but only 220 distinct pairs, so 996 of
 * those bodies cost a transform and a pointer rather than a shape.
 *
 * A prefab whose shape cannot be built costs its entities and nothing else —
 * the same bargain `placeEntities` makes with a model that will not load.
 *
 * The work is sliced: after a prefab, if the current slice has held the main
 * thread for longer than `sliceMilliseconds`, the build waits for the next
 * frame before going on. A thousand bodies is a second or two of solver work on
 * a machine without a GPU, and a second in one piece is a second in which the
 * page does not answer a key or draw a frame (agent rule 13).
 */
export async function buildZoneCollision(
  options: ZoneCollisionOptions,
): Promise<{ readonly bodies: readonly StaticBody[]; readonly report: ZoneCollisionReport }> {
  const { physics, manager, zone, prefabs } = options;
  const sliceMilliseconds = options.sliceMilliseconds ?? 8;
  const yieldToFrame = options.yieldToFrame ?? nextFrame;
  const startedAt = performance.now();
  let sliceStartedAt = startedAt;
  const { byId } = indexPrefabs(prefabs);

  const bodies: StaticBody[] = [];
  const failed: string[] = [];
  let shapes = 0;
  let placed = 0;
  let triangles = 0;
  let passable = 0;
  let undeclared = 0;

  for (const [prefabId, entities] of groupByPrefab(zone.entities)) {
    const prefab = byId.get(prefabId);
    if (prefab === undefined) {
      continue;
    }
    const kind = prefab.collision?.kind;
    if (kind === undefined) {
      undeclared += entities.length;
      continue;
    }
    if (kind === 'none') {
      passable += entities.length;
      continue;
    }

    try {
      // The collider file when there is one, the model itself otherwise; the
      // hull of a box needs no vertices, so it never reads any.
      const source = prefab.collision?.asset?.path ?? prefab.asset;
      const container = await manager.loadGlb(source);
      const geometry: ModelGeometry | ReturnType<typeof readContainerBounds> =
        kind === 'box' ? readContainerBounds(container) : readContainerGeometry(container);

      for (const group of groupByScale(entities).values()) {
        const shape = collisionShapeOf(prefab, group.scale, geometry);
        if (shape === null) {
          continue;
        }
        bodies.push(
          physics.addStaticGroup({
            name: `${prefabId}@${String(group.entities.length)}`,
            shape,
            placements: group.entities.map(placementOf),
          }),
        );
        shapes += 1;
        placed += group.entities.length;
        if (shape.kind === 'mesh') {
          triangles += shape.indices.length / 3;
        } else if (shape.kind === 'hull') {
          triangles += shape.positions.length / 3;
        }
      }
    } catch (error) {
      failed.push(`${prefabId}: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (performance.now() - sliceStartedAt > sliceMilliseconds) {
      await yieldToFrame();
      sliceStartedAt = performance.now();
    }
  }

  return {
    bodies,
    report: {
      shapes,
      bodies: placed,
      triangles: Math.round(triangles),
      passable,
      undeclared,
      failed,
      // Wall clock, waits included: what it cost the page, not what it cost
      // the solver. The point of the slicing is that those two differ.
      milliseconds: Math.round(performance.now() - startedAt),
    },
  };
}

/**
 * Draws every copy of one prefab as thin instances of a single loaded model.
 *
 * The model is instantiated once — as clones, not GPU instances, because what
 * is wanted is one real mesh to hang the matrix buffer on. Each of its meshes
 * is then detached from the container and reset to the identity, so the matrix
 * it was standing at becomes part of every instance matrix instead of being
 * applied twice. The container's now-empty transform nodes go with it.
 *
 * @returns the meshes that now carry the matrix buffers, and how many
 *   instances were placed — one per entity, not per mesh: a tree with a trunk
 *   and a leaf card is one plant.
 */
async function placeAsThinInstances(
  manager: AssetManager,
  prefab: PrefabDefinition,
  entities: readonly EntityDefinition[],
): Promise<{ readonly meshes: readonly Mesh[]; readonly entities: number }> {
  const instantiated = await manager.instantiate(prefab.asset, {
    rename: (nodeName) => `${prefab.id}:${nodeName}`,
  });
  const meshes = instantiated.rootNodes
    .flatMap((node) => node.getChildMeshes(false))
    .filter((mesh): mesh is Mesh => mesh instanceof Mesh && mesh.getTotalVertices() > 0);

  for (const mesh of meshes) {
    const inContainer = mesh.computeWorldMatrix(true).clone();
    mesh.parent = null;
    mesh.rotationQuaternion = null;
    mesh.position.setAll(0);
    mesh.rotation.setAll(0);
    mesh.scaling.setAll(1);
    mesh.freezeWorldMatrix(Matrix.Identity());
    applyThinInstances(mesh, thinInstanceMatrices(inContainer, entities));
  }

  // The container's roots held nothing but the meshes that have just left them.
  for (const node of instantiated.rootNodes) {
    if (node.getChildMeshes(false).length === 0) {
      node.dispose(true, false);
    }
  }
  return { meshes, entities: meshes.length === 0 ? 0 : entities.length };
}

/** Every mesh under these entity roots, for collision and for counting. */
export function meshesUnder(roots: readonly TransformNode[]): readonly AbstractMesh[] {
  return roots.flatMap((root) => root.getChildMeshes(false));
}

/** The two counts of one loader plus the other's, for one status line. */
export function addSources(left: AssetSourceCounts, right: AssetSourceCounts): AssetSourceCounts {
  return {
    repository: left.repository + right.repository,
    store: left.store + right.store,
    placeholder: left.placeholder + right.placeholder,
  };
}

/** Nothing loaded yet: the neutral element of {@link addSources}. */
export const NO_SOURCES: AssetSourceCounts = { repository: 0, store: 0, placeholder: 0 };

/** Where {@link spawnFromQuery} may put the player, and where it lands by default. */
export interface SpawnArea {
  /** Lowest `[x, z]` of the tile, in metres. */
  readonly min: readonly [number, number];
  /** Highest `[x, z]` of the tile, in metres. */
  readonly max: readonly [number, number];
  /** Used when the query names nothing usable. */
  readonly fallback: readonly [number, number];
}

/**
 * Reads an `x,z` spawn override off the query string.
 *
 * The village is 300 m across and the parts of it worth looking at — the paths,
 * the cliffs, one particular house — are nowhere near the middle. Putting the
 * capsule down somewhere else is how a screenshot can show them; anything
 * malformed or outside the tile falls back to the middle rather than dropping
 * the player off the edge.
 */
export function spawnFromQuery(value: string | null, area: SpawnArea): readonly [number, number] {
  if (value === null) {
    return area.fallback;
  }
  const parts = value.split(',').map((part) => Number.parseFloat(part.trim()));
  const [x, z] = parts;
  if (parts.length !== 2 || x === undefined || z === undefined) {
    return area.fallback;
  }
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return area.fallback;
  }
  if (x < area.min[0] || x > area.max[0] || z < area.min[1] || z > area.max[1]) {
    return area.fallback;
  }
  return [x, z];
}
