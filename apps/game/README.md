# @wov/game

Browser game client (production: `live.world-of-vikings.com`). Phase 1 renders the
base scene — a 100 m ground, fill and key light, sky colour and matching fog —
with a camera looking at it, plus a DOM marker. No gameplay yet.

- Dev: `pnpm --filter @wov/game dev` → http://localhost:5173
- Environment: `VITE_API_URL`, `VITE_ASSET_URL` (see `.env.example`)

**Hard rule (spec §10).** This app must never import `apps/editor` or
`@wov/editor-core`; editor code must not end up in the game bundle. The rule is
checked by `pnpm lint:boundaries`.

Engine, scene, render loop and resize handling come from `@wov/engine`
(ADR-0006), and so does the base scene (ADR-0007). `src/scene.ts` only adds the
camera — the part the editor does differently.

## Dev build only

`src/dev-debug.ts` publishes `window.__wov = { backend, frameId }` and writes
`frame <n>` into the marker every frame. A loaded page proves nothing about a
running renderer: the marker is there whether the loop ticks, stalls or throws
after the first frame, so `pnpm smoke` watches the counter climb instead.

It is installed behind `import.meta.env.DEV`, which Vite replaces with `false`
in a production build, so Rollup drops the call and the module with it. The
check is one grep:

```bash
pnpm --filter @wov/game build && grep -r __wov apps/game/dist   # must find nothing
```

Dependencies: `@babylonjs/core` (renderer, ADR-0002), `vite`, and the shared
packages `@wov/engine` (renderer bootstrap) and `@wov/ui` (design tokens).
Further shared packages are added when the game actually uses them.
