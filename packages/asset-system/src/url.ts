/**
 * Asset addressing: turning a repository-relative asset path into a URL.
 *
 * Nothing in this module knows about Babylon.js or the browser, so the same
 * resolution runs in the game, in the editor and in Node tooling (spec §37).
 */

/** Asset roots differ per environment (`VITE_ASSET_URL`, see spec §7). */
export interface AssetSourceConfig {
  /** Base URL of the asset host, with or without a trailing slash. */
  readonly baseUrl: string;
}

/**
 * Where assets live when nothing is configured: the development asset server
 * started by `pnpm dev:assets`. A clean clone must run without any `.env`
 * (agent rule 19), so an unset `VITE_ASSET_URL` is not an error.
 */
export const DEFAULT_ASSET_BASE_URL = 'http://localhost:9000';

/** The subset of `import.meta.env` / `process.env` this package reads. */
export interface AssetEnv {
  readonly VITE_ASSET_URL?: string | undefined;
}

/**
 * Builds an absolute asset URL from a repository-relative asset path.
 *
 * @example
 * assetUrl({ baseUrl: 'http://localhost:9000' }, 'environment/pine_tree_01.glb')
 * // -> 'http://localhost:9000/environment/pine_tree_01.glb'
 */
export function assetUrl(config: AssetSourceConfig, assetPath: string): string {
  if (assetPath.length === 0) {
    throw new Error('assetUrl: assetPath must not be empty');
  }
  if (assetPath.includes('..')) {
    throw new Error(`assetUrl: assetPath must not contain "..": ${assetPath}`);
  }
  const base = config.baseUrl.replace(/\/+$/, '');
  const path = assetPath.replace(/^\/+/, '');
  return `${base}/${path}`;
}

/**
 * Reads the asset base URL out of an environment object.
 *
 * Pass `import.meta.env` in a Vite app and `process.env` in Node tooling; this
 * package never reaches for a global itself, because that would tie it to one
 * of the two.
 *
 * @throws if `VITE_ASSET_URL` is set but not an absolute URL — a relative value
 * would silently produce broken asset URLs at runtime instead of failing here.
 */
export function resolveAssetSourceConfig(env: AssetEnv = {}): AssetSourceConfig {
  const configured = env.VITE_ASSET_URL?.trim() ?? '';
  if (configured.length === 0) {
    return { baseUrl: DEFAULT_ASSET_BASE_URL };
  }
  if (!/^https?:\/\/./.test(configured)) {
    throw new Error(
      `VITE_ASSET_URL must be an absolute http(s) URL (for example ${DEFAULT_ASSET_BASE_URL}), got: ${configured}`,
    );
  }
  return { baseUrl: configured.replace(/\/+$/, '') };
}
