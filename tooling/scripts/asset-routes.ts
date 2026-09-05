/**
 * Which of the asset server's two roots a request belongs to (ADR-0015).
 *
 * A module of its own, and not a function inside `asset-server.ts`, for one
 * reason: importing that file starts a listening server, so nothing there can
 * be unit-tested. This is the one decision in the server that can be silently
 * wrong — a `/store/…` request landing in `assets/` serves *a* file rather than
 * failing — so it is the one part that has to be testable.
 */

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
