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
- `asset-pipeline/` — reserved for the GLB/KTX2 pipeline (Phase 5+).
