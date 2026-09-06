# @wov/game

Browser game client (production: `live.world-of-vikings.com`). It opens an
authored world over `services/api`, draws that zone's ground from its height
field and splat layers, places its entities from the prefab catalogue as GPU
instances, and walks a placeholder capsule over the result with the
third-person camera following it: keyboard and mouse produce intent,
`@wov/gameplay` turns intent into a position, and the renderer draws that
position (ADR-0022).

One DOM marker per concern: `game-marker` (the app is served), `game-status`
(the renderer, the simulation, physics and the ground), `game-collision` (what
the player can bump into), `game-world` (which
world is on screen, or why none is), `game-assets` and `game-asset-sources`
(the asset pipeline and where the bytes came from), `game-controls` (the key
list). `pnpm smoke` asserts them.

No world data lives in this app. `src/world-api.ts` fetches it, `src/config.ts`
says where from, and `src/world-scene.ts` turns one zone into a scene. The
client never reads `assets/manifest.json`: the prefab catalogue says where a
model's bytes are (ADR-0015, ADR-0016).

- Dev: `pnpm --filter @wov/game dev` → http://localhost:5173
- Environment: `VITE_API_URL`, `VITE_ASSET_URL` (see `.env.example`)
- Query string: `?world=<id>` (default `village1`), `?spawn=<x>,<z>`

## Controls

WASD move · Shift sprint · Space dodge · E interact · LMB attack · RMB block ·
1–5 quick slots · click the scene to capture the mouse, Escape to release it
(spec §27). Arrow keys, the right Shift and the numeric keypad work too.

`dodge`, `interact`, `attack`, `block` and the quick slots reach the gameplay
state and wait there: nothing consumes them until the combat system of spec §28.

## How the pieces fit

```text
DOM events → input/keyboard-mouse → input/binder → InputState
                                                        ↓
                                       MovementSystem (@wov/gameplay)
                                                        ↓
                                                   WorldState
                                                        ↓
                                   render/interpolate → capsule mesh
                                                        ↓
                                   third-person camera (@wov/engine)
```

The arrow only points one way: state flows into the renderer and never back
(spec §25,
[ADR-0009](../../docs/adr/0009-gameplay-state-is-plain-data-systems-are-pure-functions.md)).
`src/main.ts` is wiring and contains no gameplay decision.

| File                           | Responsibility                                               |
| ------------------------------ | ------------------------------------------------------------ |
| `src/input/bindings.ts`        | The binding table as data, plus its validation               |
| `src/input/binder.ts`          | Presses → `InputState`. No DOM, so it is fully unit-tested   |
| `src/input/keyboard-mouse.ts`  | DOM events and pointer lock, through narrow ports            |
| `src/loop.ts`                  | Fixed simulation step on a variable frame rate               |
| `src/render/interpolate.ts`    | Blends two steps for the frame in between                    |
| `src/render/thin-instances.ts` | Vegetation as one mesh plus a matrix buffer (ADR-0025)       |
| `src/placeholder-target.ts`    | The capsule the camera follows until there is a player       |
| `src/scene.ts`                 | Renderer, base scene, camera and capsule, from `@wov/engine` |
| `src/config.ts`                | Where the API and the assets are, and which world to open    |
| `src/world-api.ts`             | `GET /worlds/:id` and `GET /prefabs`, validated              |
| `src/world-scene.ts`           | One zone → ground, entities, plants, collision bodies        |
| `src/entity-collision.ts`      | Prefab shape + entity transform → one shared static shape    |
| `src/physics-ground.ts`        | The ground query, answered by a downward ray                 |
| `src/physics-obstacles.ts`     | The obstacle query, answered by rays across the path         |
| `src/main.ts`                  | Wiring only                                                  |

Why the device edge lives in the app rather than in a package, why the bindings
are a table, and why the adapter test uses a hand-written DOM stub instead of
jsdom:
[ADR-0010](../../docs/adr/0010-the-device-edge-and-the-frame-loop-live-in-apps-game.md).

## Rebinding

`DEFAULT_BINDINGS` is a plain array of `{ action, source }` rows that survives a
JSON round trip, so a rebinding screen can store a player's table in a profile.
`compileBindings` validates whatever is loaded — an unknown action, an unknown
device, or one key bound to two actions throws rather than becoming a key that
quietly does nothing. `adapter.rebind(table)` swaps the table at runtime, and a
key held across the change resolves to its new action.

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

`src/dev-debug.ts` publishes
`window.__wov = { backend, frameId, camera, player, groundAt, rayHit, terrainBounds, render, collision }`
and writes `frame <n>` into the marker every frame. `render` carries Babylon's
own per-frame draw-call, active-mesh and triangle counters, which is what the
instancing of ADR-0022 is measured with — see `docs/development.md`. `collision`
carries what the zone's collision cost and produced, and `rayHit` casts through
that geometry, which is the only way a test can ask about a **hole**: an
archway's shape is only right if a line through its opening is clear and a line
through its post is not (ADR-0026). A loaded page proves nothing
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

## One loop

The client has exactly one loop. `src/loop.ts` owns the frame: it runs the
simulation on a fixed step and then calls `renderer.renderFrame()` once. The
renderer is therefore created with `autoStart: false` — Babylon's own render
loop would otherwise draw frames the simulation never saw, and the two would
drift apart.

The mouse is read once as well. Keys and mouse buttons come through
`src/input/keyboard-mouse.ts`; look and zoom belong to the camera's own input
(ADR-0008), which is why the adapter is attached with `ownsLook: false`.

Dependencies: `@babylonjs/core` (renderer, ADR-0002), `vite`, `vitest` (the
input adapter and the frame loop are testable logic and are tested here rather
than in a package, ADR-0010), and the shared packages `@wov/gameplay` (state and
systems), `@wov/engine` (renderer bootstrap, base scene, camera),
`@wov/asset-system` (asset URLs, loading, placement — ADR-0011, ADR-0012),
`@wov/world-schema` (validating the world file and the prefab catalogue the API
answers with — ADR-0022), `@wov/shared` (the service-URL rule both apps use) and
`@wov/ui` (design tokens).
