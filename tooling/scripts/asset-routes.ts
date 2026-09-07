/**
 * Which of the asset server's two roots a request belongs to (ADR-0015), and
 * which content type the answer carries.
 *
 * A module of its own, and not a pair of things inside `asset-server.ts`, for
 * one reason: importing that file starts a listening server, so nothing there
 * can be unit-tested. These are the two decisions in the server that can be
 * silently wrong — a `/store/…` request landing in `assets/` serves *a* file
 * rather than failing, and a content type nobody declared is served as
 * `application/octet-stream`, which most browsers still decode — so they are
 * the parts that have to be testable.
 */
import { extname } from 'node:path';
import type { AUDIO_EXTENSIONS } from '@wov/asset-system';

/** The URL prefix the private store is served under. */
export const STORE_PREFIX = '/store';

/** The two roots the server can serve from. */
export interface AssetRoots {
  /** `assets/` in the repository, or whatever `ASSET_ROOT` points at. */
  readonly assets: string;
  /** The private store, `WOV_ASSET_STORE`. Absent on a clean clone. */
  readonly store?: string | undefined;
}

/** A resolved route: which root, and the path inside it. */
export interface AssetRoute {
  readonly root: string;
  /** Request path relative to `root`, still with its leading slash. */
  readonly path: string;
}

/**
 * Routes one request path.
 *
 * Returns `undefined` for a `/store/…` request when no store is configured.
 * That is not an error condition but the normal state of a clean clone: the
 * caller answers 404 and the client falls back to the committed placeholder.
 */
export function routeRequest(requestPath: string, roots: AssetRoots): AssetRoute | undefined {
  const [pathOnly = '/', ...rest] = requestPath.split('?');
  const query = rest.length > 0 ? `?${rest.join('?')}` : '';

  if (pathOnly === STORE_PREFIX || pathOnly.startsWith(`${STORE_PREFIX}/`)) {
    if (roots.store === undefined || roots.store.length === 0) {
      return undefined;
    }
    const inside = pathOnly.slice(STORE_PREFIX.length);
    return { root: roots.store, path: `${inside === '' ? '/' : inside}${query}` };
  }
  return { root: roots.assets, path: requestPath };
}

/**
 * What each audio extension is served as.
 *
 * Typed as a total record over {@link AUDIO_EXTENSIONS} on purpose: adding a
 * format to that list and forgetting it here is then a compile error rather
 * than a header nobody notices. Opus is served as `audio/ogg` because that is
 * the container this project encodes it into.
 */
const AUDIO_CONTENT_TYPES: Record<(typeof AUDIO_EXTENSIONS)[number], string> = {
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
};

/**
 * What each extension is served as. Keyed by the lower-case extension including
 * the dot, which is what {@link contentTypeFor} looks up.
 */
const CONTENT_TYPES = new Map<string, string>([
  ['.glb', 'model/gltf-binary'],
  ['.gltf', 'model/gltf+json'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ktx2', 'image/ktx2'],
  ...Object.entries(AUDIO_CONTENT_TYPES),
  ['.txt', 'text/plain; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
]);

/** What this project serves when it has never been told. */
export const FALLBACK_CONTENT_TYPE = 'application/octet-stream';

/**
 * The content type for a file path, by extension.
 *
 * A missing entry is not a hard failure — a browser sniffs a `.wav` served as
 * an octet stream and plays it anyway — which is exactly why the audio half of
 * the table is a total record over {@link AUDIO_EXTENSIONS}: a format this
 * project can import but never declared would otherwise work everywhere except
 * where a proxy or a strict client believes the header.
 */
export function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES.get(extname(filePath).toLowerCase()) ?? FALLBACK_CONTENT_TYPE;
}
