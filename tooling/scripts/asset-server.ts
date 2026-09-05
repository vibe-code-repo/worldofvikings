/**
 * Development asset server (spec §5, port 9000).
 *
 * In production, assets are served from `assets.world-of-vikings.com`. Locally
 * `VITE_ASSET_URL` points at this server, so the same asset reference resolves
 * in both environments and contributors do not need a CDN account.
 *
 * Deliberately written against Node built-ins only: a static file server is not
 * worth a dependency (agent rule 12).
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const assetRoot = resolve(process.env['ASSET_ROOT'] ?? join(repoRoot, 'assets'));
const port = Number.parseInt(process.env['ASSET_PORT'] ?? '9000', 10);

const contentTypes = new Map<string, string>([
  ['.glb', 'model/gltf-binary'],
  ['.gltf', 'model/gltf+json'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ktx2', 'image/ktx2'],
  ['.ogg', 'audio/ogg'],
  ['.mp3', 'audio/mpeg'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
]);

/** Resolves a request path inside the asset root, or `undefined` if it escapes. */
export function resolveAssetPath(root: string, requestPath: string): string | undefined {
  const decoded = decodeURIComponent(requestPath.split('?')[0] ?? '/');
  const candidate = resolve(join(root, normalize(decoded)));
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    return undefined;
  }
  return candidate;
}

const server = createServer((request, response) => {
  void (async () => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }

    if (request.url === '/health' || request.url === '/') {
      response
        .writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        .end(JSON.stringify({ status: 'ok', service: 'world-of-vikings-assets', root: assetRoot }));
      return;
    }

    const filePath = resolveAssetPath(assetRoot, request.url ?? '/');
    if (filePath === undefined) {
      response.writeHead(403).end('forbidden');
      return;
    }

    try {
      const stats = await stat(filePath);
      if (!stats.isFile()) {
        response.writeHead(404).end('not found');
        return;
      }
      response.writeHead(200, {
        'content-type': contentTypes.get(extname(filePath)) ?? 'application/octet-stream',
        'content-length': stats.size,
        'access-control-allow-origin': '*',
        'cache-control': 'no-cache',
      });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      createReadStream(filePath).pipe(response);
    } catch {
      response.writeHead(404).end('not found');
    }
  })();
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`asset server: http://localhost:${port} serving ${assetRoot}\n`);
});
