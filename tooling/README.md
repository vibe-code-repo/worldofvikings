# tooling/

Repository tooling. Everything here runs through `tsx` and Node built-ins; it is
not part of any shipped bundle.

- `scripts/asset-server.ts` — static development asset server on port 9000
  (`pnpm dev:assets`). Serves `assets/` so `VITE_ASSET_URL` resolves locally the
  same way it resolves against the CDN in production. It is configuration plus
  `listen`; the request handling is `scripts/asset-handler.ts`, the caching
  policy `scripts/asset-cache.ts` and the two-root routing
  `scripts/asset-routes.ts`, all three so they can be tested without binding a
  port. Environment: `ASSET_PORT`, `ASSET_HOST`, `ASSET_ROOT`,
  `WOV_ASSET_STORE`, `ASSET_CACHE_MAX_AGE`.

  **Caching (ADR-0052).** Every file answers with a weak `ETag` (size and
  modification time) and a `Last-Modified` HTTP-date, and a request that sends
  either back gets `304` with no body — `GET` and `HEAD` alike.
  `Cache-Control` is `public, max-age=0, must-revalidate`: the browser asks
  every time, exactly as it did under `no-cache`, so a texture swapped in the
  store is on screen after one reload. What changed is that a file which did
  **not** change no longer costs its bytes. Opening the village in the editor a
  second time went from 153.44 MB to 0.09 MB, and even the first open more than
  halved (154.02 → 56.90 MB), because 148 of a single open's 317 asset requests
  are the same textures asked for by several models.

  `ASSET_CACHE_MAX_AGE` is the escape hatch: whole seconds, default `0`, and an
  unreadable value refuses to start rather than quietly running a policy nobody
  configured. Setting it to `N` sends `public, max-age=N` instead, which tells
  every browser it may use a stored file for `N` seconds **without asking** — so
  a texture replaced under the same path stays invisible for up to that long.
  Do not set it on a host anybody imports into; it exists for a deployment whose
  store is frozen between releases.

  The CORS surface is unchanged: `access-control-allow-origin: *` on every
  answer including the 404s and the 304s, and no `Vary`, because the answer does
  not depend on who asked.

- `validators/validate-content.ts` — `pnpm validate`; checks every file in
  `content/worlds/` against `@wov/world-schema`.
- `smoke/` — `pnpm smoke`; Playwright starts all dev servers and asserts one
  visible marker per app plus `/health` of the API and asset server.
  Install the browser once with `npx playwright install chromium`.
- `perf/cache-profile.ts` — `pnpm perf:cache`; what opening the editor twice
  costs on the wire. Builds the editor with the debug bridge, starts the API on
  a throwaway `CONTENT_DIR`, the asset server and `vite preview` on ports of
  their own, opens a world through the File menu, waits until every entity shows
  its model, then reloads the same browser profile and does it again. Reports
  requests, bytes, 200/304/served-from-cache per origin and seconds, for the
  cold and the warm pass. Counting lives in `perf/cache-summary.ts`, which has
  the tests. This is the measurement ADR-0052 is argued from.
- `perf/` — `pnpm perf:frame`; the frame-cost measuring rig. It builds the game
  with the debug bridge, starts an API, an asset server and `vite preview` on
  ports of their own, opens one of the named views in `perf/views.ts`, waits
  until the village has finished arriving and then measures the frames of a
  three-second window: mean scene-render time, draw calls, active meshes,
  triangles, a CDP CPU profile aggregated by function, and the canvas as raw
  RGBA. `pnpm perf:compare` puts two of those RGBA files side by side, which is
  how a change proves it left the picture alone. See `docs/development.md`.
- `scripts/seating.ts` — `pnpm seating`; measures how far a zone's placements
  stand above the ground of the zone that has one, against both the regular
  raster and the drawn tile. Reads the private asset store, writes nothing. See
  ADR-0037.
- `asset-pipeline/` — reserved for the GLB/KTX2 pipeline (Phase 5+).
