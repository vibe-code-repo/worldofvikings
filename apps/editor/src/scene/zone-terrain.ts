/**
 * The active zone's ground in the viewport (ADR-0020, ADR-0022).
 *
 * The editor draws the terrain but does not edit it: at this stage it is
 * scenery with two jobs. It shows the author what the ground under a prop looks
 * like, and it is what the surface snapping of spec §14 drops a prop onto —
 * `dropToSurface` in `picking.ts` rays against whatever is pickable, and the
 * tile is. It carries no entity id, so `SceneSync.entityOf` answers `undefined`
 * for it: clicking the ground selects nothing, and no gizmo can move it.
 *
 * Terrain sculpting is a later phase. When it arrives, the ground becomes a
 * document-owned thing edited through commands like everything else (ADR-0018),
 * and this module becomes its reconciler rather than a loader.
 *
 * **The ground is reconciled, not reloaded (ADR-0050).** The terrain block is
 * three things at once, and {@link ZoneTerrain.show} tells them apart:
 *
 * 1. numbers that are *uniforms* — `tileSize`, `normalScale`, `metallic`,
 *    `smoothness` — written straight into the program the tile already carries;
 * 2. things that are a *material* — the layer and splat textures, the facet
 *    switch, the tile's place and size — which build a new material over the
 *    height field that is already loaded;
 * 3. the height field itself, which is the only change that fetches a model.
 *
 * It used to be one key, the JSON of the whole block, so every keystroke in the
 * Surface panel took the third path: dispose the tile, re-instantiate 3.5 MB of
 * height field, compile a shader and create fourteen textures — measured at
 * 0.8 s to 1.5 s a keystroke on the village (ADR-0050).
 *
 * **Why the asset wiring is here and not in `@wov/engine`.** The engine owns
 * `createTerrain`, which both apps call. What differs is where the height
 * field's bytes come from, and that is `@wov/asset-system` — a dependency the
 * engine package does not have and should not grow for twenty lines. So the
 * game (`apps/game/src/world-scene.ts`) and the editor each own their own
 * loader, and the drawing itself has exactly one implementation.
 */
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { AssetManager, assetStoreUrl, assetUrl, createAssetCatalog } from '@wov/asset-system';
import type { AssetSourceConfig } from '@wov/asset-system';
import { createTerrain, terrainLayerSources } from '@wov/engine';
import type {
  TerrainHandle,
  TerrainOptions,
  TerrainSurfaceUpdate,
  TerrainTextureSource,
} from '@wov/engine';
import type { TerrainDefinition } from '@wov/world-schema';
import {
  NO_TERRAIN_KEYS,
  terrainChange,
  terrainKeys,
  terrainSurface,
  type TerrainKeys,
} from './terrain-keys.js';

/** The stand-in a private texture falls back to when there is no store. */
const TEXTURE_PLACEHOLDER = 'placeholders/textures/unavailable.png';

/** Store URL plus the committed stand-in, for one private texture. */
function textureSource(source: AssetSourceConfig, path: string): TerrainTextureSource {
  return { url: assetStoreUrl(source, path), fallbackUrl: assetUrl(source, TEXTURE_PLACEHOLDER) };
}

export interface ZoneTerrain {
  /**
   * Draws this zone's ground, replacing whatever was drawn before.
   *
   * `undefined` means the zone has none — an interior, or a world still being
   * blocked out — and takes the previous tile off the screen.
   */
  show(terrain: TerrainDefinition | undefined, name: string): void;
  /** The tile currently in the scene, or `null`. */
  current(): TerrainHandle | null;
  dispose(): void;
}

export interface ZoneTerrainOptions {
  readonly scene: Scene;
  readonly source: AssetSourceConfig;
  /**
   * Called when a tile has arrived and the picture changed, with the tile that
   * is now on screen — or nothing, when the new zone has no ground. The caller
   * needs the meshes: the ground must be kept out of the shadow map it
   * receives from, or a 300 m tile shadows every slope it has (ADR-0024).
   */
  readonly onChanged?: (terrain: TerrainHandle | null) => void;
  /** Called when a tile could not be loaded, with a readable reason. */
  readonly onFailed?: (reason: string) => void;
}

export function createZoneTerrain(options: ZoneTerrainOptions): ZoneTerrain {
  const { scene, source, onChanged, onFailed } = options;
  /** One manager per height field, so switching zones back does not reload it. */
  const managers = new Map<string, AssetManager>();
  let handle: TerrainHandle | null = null;
  let keys: TerrainKeys = NO_TERRAIN_KEYS;
  /**
   * The dials as the document last stated them.
   *
   * Kept rather than read back off the handle, because a dial can be turned
   * while the tile is still in flight: the load applies this on arrival, so a
   * metalness typed during the first two seconds is not silently lost.
   */
  let surface: TerrainSurfaceUpdate | null = null;
  let generation = 0;
  let disposed = false;

  /** Everything `createTerrain` and `rebuildMaterial` are handed, in one place. */
  const drawOptions = (terrain: TerrainDefinition, name: string): TerrainOptions => ({
    name,
    position: [terrain.position[0], terrain.position[1], terrain.position[2]],
    size: [terrain.size[0], terrain.size[1]],
    layers: terrainLayerSources(terrain.layers ?? [], (path) => textureSource(source, path)),
    splat: (terrain.splat ?? []).map((path) => textureSource(source, path)),
    flatNormals: terrain.flatNormals === true,
    // The ground receives the sun's shadow map through its own shader
    // (ADR-0024). It has to be requested here rather than set afterwards:
    // the lookup is compiled into the tile's generated program.
    receiveShadows: true,
  });

  const load = async (terrain: TerrainDefinition, name: string, mine: number): Promise<void> => {
    const placeholder = `placeholders/${terrain.heightField}`;
    // Its own catalogue rather than the prefab one: a height field is named by
    // the zone, not by a prefab, and a world may name one no catalogue lists.
    let manager = managers.get(terrain.heightField);
    if (manager === undefined) {
      manager = new AssetManager({
        source,
        scene,
        catalog: createAssetCatalog([
          { path: terrain.heightField, visibility: 'private', placeholder },
        ]),
      });
      managers.set(terrain.heightField, manager);
    }
    const entries = await manager.instantiate(terrain.heightField);
    const root = entries.rootNodes.find(
      (node): node is TransformNode => node instanceof TransformNode,
    );
    if (root === undefined) {
      throw new Error(`terrain "${terrain.heightField}" instantiated no transform node`);
    }
    if (disposed || generation !== mine) {
      // Another zone was opened while this tile was in flight.
      for (const node of entries.rootNodes) {
        node.dispose();
      }
      return;
    }
    handle = createTerrain(scene, root, drawOptions(terrain, name));
    // A dial turned while the tile was in flight: the handle is younger than
    // the document, so the document wins.
    if (surface !== null) {
      handle.update(surface);
    }
    onChanged?.(handle);
  };

  return {
    show(terrain, name) {
      if (disposed) {
        return;
      }
      const next = terrainKeys(name, terrain);
      const change = terrainChange(keys, next);
      keys = next;
      surface = terrain === undefined ? null : terrainSurface(terrain);

      // Nothing moved. Every gizmo drag lands here: the document is replaced on
      // each of them and this method is called again with the same ground.
      if (change === 'none') {
        return;
      }

      // Only the dials moved: write them into the program the tile already has
      // (ADR-0050). Deliberately no `onChanged` — the meshes are the ones the
      // caller already knows about, and telling it otherwise would rebuild the
      // shadow-caster list and re-render the whole shell for a number.
      if (change === 'uniform') {
        if (surface !== null) {
          handle?.update(surface);
        }
        return;
      }

      // A different material over the same height field: a swapped texture, a
      // replaced splat map, the facet switch. The geometry is the same file
      // with the same vertices, so it is kept and only the material is rebuilt.
      if (change === 'material' && terrain !== undefined && handle !== null) {
        handle.rebuildMaterial(drawOptions(terrain, name));
        onChanged?.(handle);
        return;
      }

      // A different height field, no ground at all, or a material change that
      // arrived while the first tile was still in flight: load, as before.
      generation += 1;
      handle?.dispose();
      handle = null;
      if (terrain === undefined) {
        onChanged?.(null);
        return;
      }
      const mine = generation;
      void load(terrain, name, mine).catch((error: unknown) => {
        // A zone without its ground is still editable, so this reports and
        // leaves the rest of the viewport alone.
        onFailed?.(error instanceof Error ? error.message : String(error));
      });
    },

    current: () => handle,

    dispose() {
      disposed = true;
      generation += 1;
      handle?.dispose();
      handle = null;
      for (const manager of managers.values()) {
        void manager.dispose();
      }
      managers.clear();
    },
  };
}
