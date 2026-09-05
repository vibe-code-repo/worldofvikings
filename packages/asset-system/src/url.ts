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
  /**
   * Base URL of the private asset store (ADR-0015). Optional: when it is not
   * given, the store is assumed to sit under {@link DEFAULT_ASSET_STORE_PREFIX}
   * on the same host, which is how the development asset server serves it.
   */
  readonly storeUrl?: string | undefined;
}

/**
 * Where assets live when nothing is configured: the development asset server
 * started by `pnpm dev:assets`. A clean clone must run without any `.env`
 * (agent rule 19), so an unset `VITE_ASSET_URL` is not an error.
 */
export const DEFAULT_ASSET_BASE_URL = 'http://localhost:9000';

/**
 * Where the private store hangs off the asset host by default.
 *
 * One host with two roots rather than a second port: `VITE_ASSET_URL` stays the
 * single answer to "where do assets come from", and there is one CORS surface
 * to reason about instead of two (ADR-0015).
 */
export const DEFAULT_ASSET_STORE_PREFIX = 'store';

/** The subset of `import.meta.env` / `process.env` this package reads. */
export interface AssetEnv {
  readonly VITE_ASSET_URL?: string | undefined;
  /** Overrides the store location for a deployment that does not co-host it. */
  readonly VITE_ASSET_STORE_URL?: string | undefined;
}

/**
 * The one spelling of an asset path: no leading slashes, no traversal.
 *
 * Exported because the cache keys on it. `/environment/tree.glb` and
 * `environment/tree.glb` are the same asset and must not be downloaded twice.
 *
 * @throws if the path is empty or contains `..`.
 */
export function normalizeAssetPath(assetPath: string): string {
  if (assetPath.length === 0) {
    throw new Error('assetPath must not be empty');
  }
  if (assetPath.includes('..')) {
    throw new Error(`assetPath must not contain "..": ${assetPath}`);
  }
  return assetPath.replace(/^\/+/, '');
}

/**
 * Builds an absolute asset URL from a repository-relative asset path.
 *
 * @example
 * assetUrl({ baseUrl: 'http://localhost:9000' }, 'environment/pine_tree_01.glb')
 * // -> 'http://localhost:9000/environment/pine_tree_01.glb'
 */
export function assetUrl(config: AssetSourceConfig, assetPath: string): string {
  const base = config.baseUrl.replace(/\/+$/, '');
  return `${base}/${normalizeAssetPath(assetPath)}`;
}

/**
 * Builds an absolute URL for an asset served from the **private store**.
 *
 * Same rules as {@link assetUrl}; the only difference is the root, which is
 * `storeUrl` when the deployment names one and `<baseUrl>/store` otherwise.
 *
 * @example
 * assetStoreUrl({ baseUrl: 'http://localhost:9000' }, 'vegetation/pine-1b1.glb')
 * // -> 'http://localhost:9000/store/vegetation/pine-1b1.glb'
 */
export function assetStoreUrl(config: AssetSourceConfig, assetPath: string): string {
  const configured = config.storeUrl?.trim() ?? '';
  const base =
    configured.length > 0
      ? configured
      : `${config.baseUrl.replace(/\/+$/, '')}/${DEFAULT_ASSET_STORE_PREFIX}`;
  return assetUrl({ baseUrl: base }, assetPath);
}

/**
 * Reads the asset base URL out of an environment object.
 *
 * Pass `import.meta.env` in a Vite app and `process.env` in Node tooling; this
 * package never reaches for a global itself, because that would tie it to one
 * of the two.
 *
 * `storeUrl` is only set when `VITE_ASSET_STORE_URL` names one: leaving it
 * absent means "the store is where it usually is", which is what keeps a clean
 * clone working with no `.env` at all (agent rule 19).
 *
 * @throws if either variable is set but not an absolute URL — a relative value
 * would silently produce broken asset URLs at runtime instead of failing here.
 */
export function resolveAssetSourceConfig(env: AssetEnv = {}): AssetSourceConfig {
  const baseUrl = absoluteOrDefault('VITE_ASSET_URL', env.VITE_ASSET_URL, DEFAULT_ASSET_BASE_URL);
  const storeUrl = absoluteOrDefault('VITE_ASSET_STORE_URL', env.VITE_ASSET_STORE_URL, undefined);
  return storeUrl === undefined ? { baseUrl } : { baseUrl, storeUrl };
}

function absoluteOrDefault<T extends string | undefined>(
  name: string,
  value: string | undefined,
  fallback: T,
): string | T {
  const configured = value?.trim() ?? '';
  if (configured.length === 0) {
    return fallback;
  }
  if (!/^https?:\/\/./.test(configured)) {
    throw new Error(
      `${name} must be an absolute http(s) URL (for example ${DEFAULT_ASSET_BASE_URL}), got: ${configured}`,
    );
  }
  return configured.replace(/\/+$/, '');
}
