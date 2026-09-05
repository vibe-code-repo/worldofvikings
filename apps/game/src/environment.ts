/**
 * The Phase 1 environment probe.
 *
 * One licensed CC0 model, loaded through the asset server and placed next to
 * the ground, so that "the asset pipeline works" is something you can see and
 * the smoke test can assert instead of something we claim.
 *
 * `PHASE_1_PROPS` is **not world data.** The world is authored in the editor and
 * loaded from `content/` from Phase 4 on (agent rule 9); this list is a fixture
 * that proves the path from `assets/` through the asset server into the scene,
 * and it goes away when a real world file takes over.
 */
import type { Scene } from '@babylonjs/core/scene';
import { AssetManager, placeAssets, resolveAssetSourceConfig } from '@wov/asset-system';
import type { AssetEnv, AssetPlacement, PlacementResult } from '@wov/asset-system';

/**
 * What the probe places.
 *
 * The Kenney kit is authored at roughly a third of a metre per unit — the model
 * is 0.30 units tall — so it is scaled up to read as a barrel on a 40 m ground
 * instead of a speck at the camera's default distance. See
 * `docs/asset-licenses.md` for source, author, license and modification status.
 */
export const PHASE_1_PROPS: readonly AssetPlacement[] = [
  {
    asset: 'environment/kenney-retro-fantasy-kit/detail-barrel.glb',
    name: 'probe-barrel',
    position: [4, 0, 0],
    scale: 8,
  },
];

/**
 * Loads and places {@link PHASE_1_PROPS} into a scene.
 *
 * The {@link AssetManager} it creates lives as long as the page: the cache is
 * the point, and there is nothing yet that would tear a scene down. When zone
 * streaming arrives, the manager becomes something the caller owns and disposes.
 *
 * @param scene the scene the loaded meshes belong to.
 * @param env `import.meta.env`; the asset host comes from `VITE_ASSET_URL` and
 * falls back to the local asset server, so a clean clone needs no `.env`.
 */
export async function loadEnvironment(scene: Scene, env: AssetEnv): Promise<PlacementResult> {
  const manager = new AssetManager({ source: resolveAssetSourceConfig(env), scene });
  return placeAssets(manager, PHASE_1_PROPS);
}
