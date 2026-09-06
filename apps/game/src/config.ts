/**
 * Where the game's two services are, and which world it opens.
 *
 * Both services default to the local development ports, so a clean clone needs
 * no `.env` (agent rule 19). `resolveAssetSourceConfig` in `@wov/asset-system`
 * answers the asset half; this module adds the API and the world id and keeps
 * the three answers in one place.
 */
import { resolveServiceUrl } from '@wov/shared';
import { resolveAssetSourceConfig, type AssetEnv, type AssetSourceConfig } from '@wov/asset-system';

/** The API base URL, without a trailing slash. */
export const DEFAULT_API_URL = 'http://localhost:3000';

/** The world the client opens when the address bar does not name one. */
export const DEFAULT_WORLD_ID = 'village1';

/** The environment variables the game reads, on top of {@link AssetEnv}. */
export interface GameEnv extends AssetEnv {
  readonly VITE_API_URL?: string | undefined;
}

export interface GameConfig {
  /** Where `GET /worlds/:id` and `GET /prefabs` live. */
  readonly apiUrl: string;
  /** Where GLB files are served from, including the private store (ADR-0015). */
  readonly assets: AssetSourceConfig;
}

/** Reads `import.meta.env`. A malformed URL throws instead of failing later. */
export function resolveGameConfig(env: GameEnv = {}): GameConfig {
  return {
    apiUrl: resolveServiceUrl(env.VITE_API_URL, DEFAULT_API_URL, 'VITE_API_URL'),
    assets: resolveAssetSourceConfig(env),
  };
}

/**
 * The world id from `?world=`, or {@link DEFAULT_WORLD_ID}.
 *
 * The same character rule the world schema enforces is applied here, so a
 * hand-typed address cannot turn into a request for `/worlds/../../etc`. An id
 * that fails it falls back to the default rather than being sent on: the query
 * string is user input, and the API is not the place to find that out.
 */
export function worldIdFromQuery(search: string): string {
  const asked = new URLSearchParams(search).get('world')?.trim() ?? '';
  return /^[a-z0-9][a-z0-9_-]*$/.test(asked) ? asked : DEFAULT_WORLD_ID;
}
