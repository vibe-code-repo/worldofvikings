# tooling/

Repository tooling. Everything here runs through `tsx` and Node built-ins; it is
not part of any shipped bundle.

- `scripts/asset-server.ts` — static development asset server on port 9000
  (`pnpm dev:assets`). Serves `assets/` so `VITE_ASSET_URL` resolves locally the
  same way it resolves against the CDN in production.
- `validators/validate-content.ts` — `pnpm validate`; checks every file in
  `content/worlds/` against `@wov/world-schema`.
- `smoke/` — `pnpm smoke`; Playwright starts all dev servers and asserts one
  visible marker per app plus `/health` of the API and asset server.
  Install the browser once with `npx playwright install chromium`.
- `perf/` — `pnpm perf:frame`; the frame-cost measuring rig. It builds the game
  with the debug bridge, starts an API, an asset server and `vite preview` on
  ports of their own, opens one of the named views in `perf/views.ts`, waits
  until the village has finished arriving and then measures the frames of a
  three-second window: mean scene-render time, draw calls, active meshes,
  triangles, a CDP CPU profile aggregated by function, and the canvas as raw
  RGBA. `pnpm perf:compare` puts two of those RGBA files side by side, which is
  how a change proves it left the picture alone. See `docs/development.md`.
- `asset-pipeline/` — reserved for the GLB/KTX2 pipeline (Phase 5+).
