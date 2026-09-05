# @wov/game

Browser game client (production: `live.world-of-vikings.com`). Phase 1 renders a
placeholder Babylon.js scene (camera, light, ground) with the first licensed
asset loaded over the asset server, plus one DOM marker per concern:
`game-marker` (the app is served), `game-status` (the renderer), `game-assets`
(the asset pipeline — `assets: 1 loaded`). `pnpm smoke` asserts all three.

`src/environment.ts` holds the list of what is placed. It is a Phase 1 fixture,
not world data: the world is authored in the editor and loaded from `content/`
from Phase 4 on (agent rule 9).

- Dev: `pnpm --filter @wov/game dev` → http://localhost:5173
- Environment: `VITE_API_URL`, `VITE_ASSET_URL` (see `.env.example`)

**Hard rule (spec §10).** This app must never import `apps/editor` or
`@wov/editor-core`; editor code must not end up in the game bundle. The rule is
checked by `pnpm lint:boundaries`.

Dependencies: `@babylonjs/core` (renderer, ADR-0002), `vite`, and the shared
packages `@wov/engine` (render config), `@wov/ui` (design tokens) and
`@wov/asset-system` (asset URLs, loading, placement — ADR-0006, ADR-0007).
Further shared packages are added when the game actually uses them.
