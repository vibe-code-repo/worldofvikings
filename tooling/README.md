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
- `perf/` — `pnpm perf:editor`; the editor's measuring rig (ADR-0047). It builds
  the editor with the debug bridge, starts an API on a throwaway `CONTENT_DIR`,
  an asset server and `vite preview`, opens the built editor with `?debug=1` and
  runs three named scenarios on `village1`: `load` (the three load milestones,
  the main thread's long tasks, a CPU profile, then the settled frame),
  `dial` (ten ground-metallic changes) and `edit` (select, nudge, click). One
  JSON report per run, plus a PNG and one `.rgba` per scenario. `--scenario`
  takes a comma-separated list or `all`; `--skip-build` reuses the last build.
  See `docs/development.md`.
- `scripts/seating.ts` — `pnpm seating`; measures how far a zone's placements
  stand above the ground of the zone that has one, against both the regular
  raster and the drawn tile. Reads the private asset store, writes nothing. See
  ADR-0037.
- `asset-pipeline/` — reserved for the GLB/KTX2 pipeline (Phase 5+).
