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
 *
 * **Caching (ADR-0052).** Every file answers with an `ETag` and a
 * `Last-Modified`, and a request that already holds them is answered `304` with
 * no body. `Cache-Control` stays revalidating — `public, max-age=0,
 * must-revalidate`, which is `no-cache` said in full — so a texture replaced in
 * the store is still visible on the next reload; what changed is that an
 * *unchanged* file no longer costs its bytes a second time. A deployment that
 * knowingly wants a lifetime sets `ASSET_CACHE_MAX_AGE` (seconds); see
 * `tooling/README.md`.
 *
 * This file is configuration plus `listen`. Everything it decides lives in
 * `asset-handler.ts`, `asset-cache.ts` and `asset-routes.ts`, which have tests.
 */
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAssetCacheMaxAge } from './asset-cache.js';
import { createAssetHandler } from './asset-handler.js';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const assetRoot = resolve(process.env['ASSET_ROOT'] ?? join(repoRoot, 'assets'));
const configuredStore = process.env['WOV_ASSET_STORE']?.trim() ?? '';
const storeRoot = configuredStore.length > 0 ? resolve(configuredStore) : undefined;
const port = Number.parseInt(process.env['ASSET_PORT'] ?? '9000', 10);
const maxAgeSeconds = readAssetCacheMaxAge(process.env['ASSET_CACHE_MAX_AGE']);

const server = createServer(createAssetHandler({ assetRoot, storeRoot, maxAgeSeconds }));

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
  process.stdout.write(
    maxAgeSeconds === 0
      ? `asset server: every file is revalidated (ETag + Last-Modified, 304 when unchanged)\n`
      : `asset server: files may be used for ${String(maxAgeSeconds)} s without asking (ASSET_CACHE_MAX_AGE)\n`,
  );
});
