/**
 * The asset server's request handler, without the listening socket.
 *
 * Split out of `asset-server.ts` so it can be tested: that file reads the
 * environment and binds a port at import time, which makes everything it
 * decides untestable — and after ADR-0052 it decides something that fails
 * silently. A missing validator costs bytes nobody counts, and a validator that
 * answers 304 too eagerly shows a texture that will not change. Both are
 * assertions a test can make, once there is something to call.
 *
 * `asset-server.ts` is now configuration plus `listen`.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, normalize, resolve, sep } from 'node:path';
import { assetCacheHeaders, assetNotModified } from './asset-cache.js';
import { contentTypeFor, routeRequest } from './asset-routes.js';

/** What the handler serves, and how long a client may hold it. */
export interface AssetHandlerOptions {
  /** `assets/` in the repository, or whatever `ASSET_ROOT` points at. */
  readonly assetRoot: string;
  /** The private store, `WOV_ASSET_STORE`. Absent on a clean clone. */
  readonly storeRoot?: string | undefined;
  /** `ASSET_CACHE_MAX_AGE`, seconds. `0` means: revalidate every time. */
  readonly maxAgeSeconds?: number | undefined;
}

/** Resolves a request path inside the asset root, or `undefined` if it escapes. */
export function resolveAssetPath(root: string, requestPath: string): string | undefined {
  const decoded = decodeURIComponent(requestPath.split('?')[0] ?? '/');
  const candidate = resolve(join(root, normalize(decoded)));
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    return undefined;
  }
  return candidate;
}

/**
 * Headers every response carries, success or not.
 *
 * The failures need it as much as the successes: without the CORS header on a
 * 404, a browser reports "blocked by CORS policy" instead of "not found", and
 * the expected state of a clean clone — no store mounted, private assets 404,
 * placeholders load — reads in the console as a security problem.
 *
 * `*` and no `Vary`, unchanged by ADR-0052: the answer does not depend on who
 * asked, so nothing here may vary by origin.
 */
export const COMMON_HEADERS = { 'access-control-allow-origin': '*' } as const;

/** Builds the request handler `createServer` is given. */
export function createAssetHandler(
  options: AssetHandlerOptions,
): (request: IncomingMessage, response: ServerResponse) => void {
  const { assetRoot, storeRoot, maxAgeSeconds = 0 } = options;

  return (request, response) => {
    void (async () => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { ...COMMON_HEADERS, allow: 'GET, HEAD' }).end();
        return;
      }

      if (request.url === '/health' || request.url === '/') {
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(
          JSON.stringify({
            status: 'ok',
            service: 'world-of-vikings-assets',
            root: assetRoot,
            // Reported so "is the store mounted?" is answerable without SSH.
            store: storeRoot ?? null,
          }),
        );
        return;
      }

      const route = routeRequest(request.url ?? '/', { assets: assetRoot, store: storeRoot });
      if (route === undefined) {
        // A store request with no store: the expected state of a clean clone.
        response.writeHead(404, COMMON_HEADERS).end('no asset store configured');
        return;
      }
      const filePath = resolveAssetPath(route.root, route.path);
      if (filePath === undefined) {
        response.writeHead(403, COMMON_HEADERS).end('forbidden');
        return;
      }

      try {
        const stats = await stat(filePath);
        if (!stats.isFile()) {
          response.writeHead(404, COMMON_HEADERS).end('not found');
          return;
        }

        const cache = assetCacheHeaders(stats.size, stats.mtimeMs, maxAgeSeconds);
        if (assetNotModified(request.headers, cache)) {
          // No `content-type` and no `content-length`: a 304 has no body, and a
          // length that describes a body which is not there is what makes a
          // client hang waiting for it (RFC 9110 §15.4.5).
          response.writeHead(304, { ...COMMON_HEADERS, ...cache }).end();
          return;
        }

        response.writeHead(200, {
          ...COMMON_HEADERS,
          ...cache,
          'content-type': contentTypeFor(filePath),
          'content-length': stats.size,
        });
        if (request.method === 'HEAD') {
          response.end();
          return;
        }
        createReadStream(filePath).pipe(response);
      } catch {
        response.writeHead(404, COMMON_HEADERS).end('not found');
      }
    })();
  };
}
