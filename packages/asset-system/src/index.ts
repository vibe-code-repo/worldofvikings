/**
 * @wov/asset-system — resolves asset references to URLs.
 *
 * Phase 0 only contains URL resolution. Loading, caching and GLB handling are
 * added in Phase 1 together with the Babylon.js asset manager.
 */

/** Asset roots differ per environment (`VITE_ASSET_URL`, see spec §7). */
export interface AssetSourceConfig {
  /** Base URL of the asset host, with or without a trailing slash. */
  readonly baseUrl: string;
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
