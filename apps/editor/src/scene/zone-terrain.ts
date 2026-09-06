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
 * **Why the asset wiring is here and not in `@wov/engine`.** The engine owns
 * `createTerrain`, which both apps call. What differs is where the height
 * field's bytes come from, and that is `@wov/asset-system` — a dependency the
 * engine package does not have and should not grow for twenty lines. So the
 * game (`apps/game/src/world-scene.ts`) and the editor each own their own
 * loader, and the drawing itself has exactly one implementation.
 */
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import { AssetManager, assetStoreUrl, assetUrl, createAssetCatalog } from '@wov/asset-system';
import type { AssetSourceConfig } from '@wov/asset-system';
import { createTerrain } from '@wov/engine';
import type { TerrainHandle, TerrainTextureSource } from '@wov/engine';
import type { TerrainDefinition } from '@wov/world-schema';

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
  /** Called when a tile has arrived and the picture changed. */
  readonly onChanged?: () => void;
  /** Called when a tile could not be loaded, with a readable reason. */
  readonly onFailed?: (reason: string) => void;
}

/**
 * A key that changes exactly when the drawn ground would differ.
 *
 * Switching zones and back must not reload a 3.5 MB tile, and the document is
 * replaced on every edit, so identity comparison would reload on every click.
 */
function terrainKey(name: string, terrain: TerrainDefinition | undefined): string {
  return terrain === undefined ? '' : `${name}|${JSON.stringify(terrain)}`;
}

export function createZoneTerrain(options: ZoneTerrainOptions): ZoneTerrain {
  const { scene, source, onChanged, onFailed } = options;
  /** One manager per height field, so switching zones back does not reload it. */
  const managers = new Map<string, AssetManager>();
  let handle: TerrainHandle | null = null;
  let key = '';
  let generation = 0;
  let disposed = false;

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
    handle = createTerrain(scene, root, {
      name,
      position: [terrain.position[0], terrain.position[1], terrain.position[2]],
      size: [terrain.size[0], terrain.size[1]],
      layers: (terrain.layers ?? []).map((layer) => ({
        ...textureSource(source, layer.texture),
        tileSize: layer.tileSize,
      })),
      splat: (terrain.splat ?? []).map((path) => textureSource(source, path)),
    });
    onChanged?.();
  };

  return {
    show(terrain, name) {
      if (disposed) {
        return;
      }
      const next = terrainKey(name, terrain);
      if (next === key) {
        return;
      }
      key = next;
      generation += 1;
      handle?.dispose();
      handle = null;
      if (terrain === undefined) {
        onChanged?.();
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
