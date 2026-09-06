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
import type { LightingProfileOptions } from '@wov/engine';

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

/**
 * The profile `?flat=1` applies instead of the world's own (ADR-0024).
 *
 * Not "no lighting" — a scene has to be lit by something — but the flat noon
 * the client had before there was a profile at all: one sun straight down, a
 * bright fill, no shadow map, no sky, no fog, no grading.
 *
 * It exists because "the picture is better now" is not a measurement. The only
 * way to say how much of a frame is shadow is to compare it with the same frame
 * without any, from the same camera, with the same models loaded — which is
 * what `tooling/smoke/lighting.spec.ts` does with this switch.
 */
export const FLAT_LIGHTING: LightingProfileOptions = {
  sun: { direction: [-0.45, -1, -0.6], color: '#ffffff', intensity: 1.1 },
  ambient: { skyColor: '#ffffff', groundColor: '#1f2519', intensity: 0.55 },
  sky: { enabled: false, horizonColor: '#4d5b68' },
  fog: { enabled: false },
  shadows: { enabled: false },
  postProcessing: { enabled: false },
};

/** The world's own profile, with the shadow map switched off. */
const NO_SHADOWS: LightingProfileOptions = { shadows: { enabled: false } };

/**
 * The profiles to light with, given what the query string asks for.
 *
 * - `?flat=1` replaces the world's profile with {@link FLAT_LIGHTING};
 * - `?shadows=off` keeps it and turns only the shadow map off, which is the
 *   control a shadow measurement needs: same sun, same grade, same camera, no
 *   shadows, so the difference between two frames is the shadows and nothing
 *   else.
 *
 * Any other value is neither: these are diagnostic switches, and a typo in one
 * must not quietly change what a screenshot is showing.
 */
export function lightingProfiles(
  search: string,
  authored: readonly (LightingProfileOptions | undefined)[],
): readonly (LightingProfileOptions | undefined)[] {
  const params = new URLSearchParams(search);
  if (params.get('flat') === '1') {
    return [FLAT_LIGHTING];
  }
  if (params.get('shadows') === 'off') {
    return [...authored, NO_SHADOWS];
  }
  return authored;
}
