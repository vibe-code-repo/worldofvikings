# @wov/game

Browser game client (production: `live.world-of-vikings.com`). Phase 1 renders the
base scene — a 100 m ground, fill and key light, sky colour and matching fog —
with a placeholder capsule and the third-person camera following it, plus a DOM
marker. No gameplay yet.

Controls: hold the left mouse button to look around (the page also asks for
pointer lock, and uses it when the browser grants it), the wheel to zoom.

- Dev: `pnpm --filter @wov/game dev` → http://localhost:5173
- Environment: `VITE_API_URL`, `VITE_ASSET_URL` (see `.env.example`)

**Hard rule (spec §10).** This app must never import `apps/editor` or
`@wov/editor-core`; editor code must not end up in the game bundle. The rule is
checked by `pnpm lint:boundaries`.

Engine, scene, render loop and resize handling come from `@wov/engine`
(ADR-0006), and so do the base scene (ADR-0007) and the third-person camera
(ADR-0008). What is left in `src/scene.ts` is the wiring, and in
`src/placeholder-target.ts` the capsule the camera follows until there is a
player: the camera takes a `() => Vector3`, so Phase 2 replaces the capsule by
changing that one getter.

## Dev build only

`src/dev-debug.ts` publishes `window.__wov = { backend, frameId, camera }` and
writes `frame <n>` into the marker every frame. A loaded page proves nothing
about a running renderer: the marker is there whether the loop ticks, stalls or
throws after the first frame, so `pnpm smoke` watches the counter climb instead.
The camera readout is there for the same reason — unit tests pin the camera
arithmetic, only a real browser shows that a wheel notch over the canvas reaches
it.

It is installed behind `import.meta.env.DEV`, which Vite replaces with `false`
in a production build, so Rollup drops the call and the module with it. The
check is one grep:

```bash
pnpm --filter @wov/game build && grep -r __wov apps/game/dist   # must find nothing
```

Dependencies: `@babylonjs/core` (renderer, ADR-0002), `vite`, and the shared
packages `@wov/engine` (renderer bootstrap) and `@wov/ui` (design tokens).
Further shared packages are added when the game actually uses them.
