/**
 * Where the editor's two services are.
 *
 * Both default to the local development ports, so a clean clone needs no `.env`
 * (agent rule 19). `resolveAssetSourceConfig` in `@wov/asset-system` does the
 * same job for the asset server; this module adds the API and keeps the two
 * answers in one place.
 */
import { resolveAssetSourceConfig, type AssetEnv, type AssetSourceConfig } from '@wov/asset-system';

/** The API base URL, without a trailing slash. */
export const DEFAULT_API_URL = 'http://localhost:3000';

/** The environment variables the editor reads, on top of {@link AssetEnv}. */
export interface EditorEnv extends AssetEnv {
  readonly VITE_API_URL?: string | undefined;
}

export interface EditorConfig {
  /** Where `GET /worlds`, `PUT /worlds/:id` and `GET /prefabs` live. */
  readonly apiUrl: string;
  /** Where GLB files are served from, including the private store (ADR-0015). */
  readonly assets: AssetSourceConfig;
}

/**
 * Reads `import.meta.env`.
 *
 * A malformed URL throws here rather than turning every later request into an
 * unexplained failure — the same rule `resolveAssetSourceConfig` follows.
 */
export function resolveEditorConfig(env: EditorEnv = {}): EditorConfig {
  const raw = (env.VITE_API_URL ?? '').trim();
  const apiUrl = raw === '' ? DEFAULT_API_URL : raw;
  if (!/^https?:\/\//i.test(apiUrl)) {
    throw new Error(`VITE_API_URL must be an absolute http(s) URL, got "${apiUrl}"`);
  }
  return { apiUrl: apiUrl.replace(/\/+$/, ''), assets: resolveAssetSourceConfig(env) };
}
