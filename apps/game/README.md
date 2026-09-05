# @wov/game

Browser game client (production: `live.world-of-vikings.com`). Phase 1 runs a
capsule around a flat plane: keyboard and mouse produce intent, `@wov/gameplay`
turns intent into a position, and the renderer draws that position.

- Dev: `pnpm --filter @wov/game dev` → http://localhost:5173
- Environment: `VITE_API_URL`, `VITE_ASSET_URL` (see `.env.example`)

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
```

The arrow only points one way: state flows into the renderer and never back
(spec §25,
[ADR-0007](../../docs/adr/0007-gameplay-state-is-plain-data-systems-are-pure-functions.md)).
`src/main.ts` is wiring and contains no gameplay decision.

| File                          | Responsibility                                             |
| ----------------------------- | ---------------------------------------------------------- |
| `src/input/bindings.ts`       | The binding table as data, plus its validation             |
| `src/input/binder.ts`         | Presses → `InputState`. No DOM, so it is fully unit-tested |
| `src/input/keyboard-mouse.ts` | DOM events and pointer lock, through narrow ports          |
| `src/loop.ts`                 | Fixed simulation step on a variable frame rate             |
| `src/render/interpolate.ts`   | Blends two steps for the frame in between                  |
| `src/scene.ts`                | Babylon scene, camera, placeholder capsule                 |
| `src/main.ts`                 | Wiring only                                                |

Why the device edge lives in the app rather than in a package, why the bindings
are a table, and why the adapter test uses a hand-written DOM stub instead of
jsdom:
[ADR-0008](../../docs/adr/0008-the-device-edge-and-the-frame-loop-live-in-apps-game.md).

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

Dependencies: `@babylonjs/core` (renderer, ADR-0002), `vite`, `vitest` (the
input adapter and the frame loop are testable logic and are tested here rather
than in a package, ADR-0008), and the shared packages `@wov/gameplay` (state and
systems), `@wov/engine` (render config) and `@wov/ui` (design tokens).
