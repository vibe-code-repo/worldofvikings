/**
 * Development asset server (spec §5, port 9000).
 *
 * In production, assets are served from `assets.world-of-vikings.com`. Locally
 * `VITE_ASSET_URL` points at this server, so the same asset reference resolves
 * in both environments and contributors do not need a CDN account.
 *
 * It serves **two** roots (ADR-0015):
 *
 * - `/…` — `assets/` in the repository, or `ASSET_ROOT`.
 * - `/store/…` — the private asset store, `WOV_ASSET_STORE`, which lives
 *   outside the repository because the redistribution rights for what is in it
 *   are not settled. Without that variable the prefix simply 404s, which is the
 *   normal state of a clean clone: the client then loads the committed
 *   placeholders and says so on screen.
 *
 * One server rather than two, so `VITE_ASSET_URL` stays the single answer to
 * "where do assets come from" and there is one CORS surface to reason about.
 *
 * Deliberately written against Node built-ins only: a static file server is not
 * worth a dependency (agent rule 12).
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentTypeFor, routeRequest } from './asset-routes.js';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const assetRoot = resolve(process.env['ASSET_ROOT'] ?? join(repoRoot, 'assets'));
const configuredStore = process.env['WOV_ASSET_STORE']?.trim() ?? '';
const storeRoot = configuredStore.length > 0 ? resolve(configuredStore) : undefined;
const port = Number.parseInt(process.env['ASSET_PORT'] ?? '9000', 10);

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
 */
const COMMON_HEADERS = { 'access-control-allow-origin': '*' } as const;

const server = createServer((request, response) => {
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
      response.writeHead(200, {
        ...COMMON_HEADERS,
        'content-type': contentTypeFor(filePath),
        'content-length': stats.size,
        'cache-control': 'no-cache',
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
});

// Loopback by default (a clean clone never exposes assets by accident); the
// staging host on wov-dev sets ASSET_HOST=0.0.0.0 so the reverse proxy can reach it.
const host = process.env['ASSET_HOST'] ?? '127.0.0.1';
server.listen(port, host, () => {
  process.stdout.write(`asset server: http://localhost:${port} serving ${assetRoot}\n`);
  process.stdout.write(
    storeRoot === undefined
      ? `asset server: /store is not mounted (set WOV_ASSET_STORE to serve private assets)\n`
      : `asset server: /store serving ${storeRoot}\n`,
  );
});
