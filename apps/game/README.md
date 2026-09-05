# @wov/game

Browser game client (production: `live.world-of-vikings.com`). Phase 0 renders an
empty Babylon.js scene (camera, light, ground) plus a DOM marker.

- Dev: `pnpm --filter @wov/game dev` → http://localhost:5173
- Environment: `VITE_API_URL`, `VITE_ASSET_URL` (see `.env.example`)

**Hard rule (spec §10).** This app must never import `apps/editor` or
`@wov/editor-core`; editor code must not end up in the game bundle. The rule is
checked by `pnpm lint:boundaries`.

Engine, scene, render loop and resize handling come from `@wov/engine`
(ADR-0006); `src/scene.ts` only fills the scene with camera, light and ground.

Dependencies: `@babylonjs/core` (renderer, ADR-0002), `vite`, and the shared
packages `@wov/engine` (renderer bootstrap) and `@wov/ui` (design tokens).
Further shared packages are added when the game actually uses them.
