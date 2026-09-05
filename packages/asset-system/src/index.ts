/**
 * @wov/asset-system — where assets live and how they are loaded.
 *
 * Separable concerns, so that the parts which do not need a renderer can be
 * used without one:
 *
 * - `url.ts` resolves an asset reference to a URL (`VITE_ASSET_URL`, spec §37).
 * - `asset-manager.ts` loads and caches GLB containers for one Babylon scene,
 *   through the `glb-loader.ts` port that `babylon-glb-loader.ts` implements.
 * - `scene-placement.ts` instantiates loaded assets and moves the copies into
 *   position — the step after loading, and deliberately the thinnest one:
 *   *deciding* where something goes is world data, never this package's job.
 *
 * **What is deliberately not here:** the manifest schema. It lives behind
 * `@wov/asset-system/manifest` because it is the only part that needs Zod, it
 * is used by `pnpm validate:assets` and not by the game, and re-exporting it
 * from this entry point put 84 kB of Zod into the game's first chunk (spec §38;
 * a dependency-cruiser rule now guards it).
 *
 * Importing this module does **not** import Babylon.js either. The Babylon
 * binding is loaded on the first actual asset load (see `babylon-glb-loader.ts`),
 * which keeps the renderer out of Node tooling and out of the initial chunk.
 */
export { AssetLoadError, AssetManager } from './asset-manager.js';
export type { AssetManagerOptions, InstantiateOptions } from './asset-manager.js';
export type { GlbLoader } from './glb-loader.js';
export { createBabylonGlbLoader } from './babylon-glb-loader.js';
export { placeAssets, summarizePlacement } from './scene-placement.js';
export type {
  AssetInstantiator,
  AssetPlacement,
  InstantiatedNode,
  InstantiatedNodes,
  PlaceableNode,
  PlacementFailure,
  PlacementResult,
} from './scene-placement.js';
export { DEFAULT_ASSET_BASE_URL, assetUrl, resolveAssetSourceConfig } from './url.js';
export type { AssetEnv, AssetSourceConfig } from './url.js';
