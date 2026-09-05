/**
 * @wov/asset-system — where assets live, how they are loaded, and what should
 * be there.
 *
 * Three separable concerns, so that the parts which do not need a renderer can
 * be used without one:
 *
 * - `url.ts` resolves an asset reference to a URL (`VITE_ASSET_URL`, spec §37).
 * - `manifest.ts` is the Zod schema for `assets/manifest.json`, used by the game
 *   and by `pnpm validate:assets`.
 * - `asset-manager.ts` loads and caches GLB containers for one Babylon scene,
 *   through the `glb-loader.ts` port that `babylon-glb-loader.ts` implements.
 *
 * Importing this module does **not** import Babylon.js. The Babylon binding is
 * loaded on the first actual asset load (see `babylon-glb-loader.ts`), which
 * keeps the renderer out of Node tooling and out of the initial browser chunk.
 */
export { AssetLoadError, AssetManager } from './asset-manager.js';
export type { AssetManagerOptions, InstantiateOptions } from './asset-manager.js';
export type { GlbLoader } from './glb-loader.js';
export { createBabylonGlbLoader } from './babylon-glb-loader.js';
export {
  ASSET_HASH_PREFIX,
  ASSET_MANIFEST_FILE_NAME,
  AssetEntrySchema,
  AssetHashSchema,
  AssetManifestSchema,
  AssetPathSchema,
  CURRENT_ASSET_MANIFEST_VERSION,
  compareManifestWithFiles,
  formatManifestReport,
  immutableAssetPath,
  isIndexedAssetFile,
  isManifestInSync,
  parseAssetManifest,
} from './manifest.js';
export type {
  AssetEntry,
  AssetManifest,
  AssetManifestParseResult,
  AssetMismatch,
  ManifestComparison,
} from './manifest.js';
export { DEFAULT_ASSET_BASE_URL, assetUrl, resolveAssetSourceConfig } from './url.js';
export type { AssetEnv, AssetSourceConfig } from './url.js';
