# ADR-0010: The device edge and the frame loop live in apps/game

- **Status:** accepted
- **Date:** 2026-09-05
- **Deciders:** Core maintainers

## Context

[ADR-0009](0009-gameplay-state-is-plain-data-systems-are-pure-functions.md) gave
Phase 1 a renderer-free simulation: `MovementSystem.update(state, input, dt,
ground)` is a pure function, and `advance(accumulator, frameDelta)` splits real
time into fixed steps. Neither knows where `input` comes from or when a frame
happens. This milestone supplies both, and has to decide where they belong.

Constraints that force a decision:

- **The DOM is the game client's business, not the simulation's.** `@wov/gameplay`
  must not gain a `KeyboardEvent` import; `pnpm lint:boundaries` would not catch
  it, because the DOM is not a package.
- **Controllers come later** (spec §27: "Architecture should allow controller
  support later"). A `switch (event.code)` would have to be rewritten for that;
  so would a rebinding screen, which players expect.
- **A binding table is external data.** The moment it can be stored in a
  profile it can also arrive corrupted, and agent rule 10 says validate it.
- **Gameplay runs at 60 Hz, displays do not.** Something has to own the frame
  callback, decide how many steps it buys, and interpolate what is drawn in
  between.
- **Adding a dependency needs a reason** (agent rule 12). Testing DOM code
  normally means jsdom.
- **Tests must stay fast and honest.** The input adapter carries the most
  fiddly logic in the app — edge triggers, diagonals, camera-relative axes,
  focus loss — and none of it is worth trusting untested.

## Decision

The device edge and the frame loop live in **`apps/game`**, not in a package,
and split into four small modules:

| Module                    | Knows about                            |
| ------------------------- | -------------------------------------- |
| `input/bindings.ts`       | A table of data; no DOM, no state      |
| `input/binder.ts`         | Presses and intent; no DOM             |
| `input/keyboard-mouse.ts` | DOM events and pointer lock; no intent |
| `loop.ts`                 | When a frame happens; no gameplay      |

Four parts of that decision are part of it:

1. **Bindings are a table, not code.** `DEFAULT_BINDINGS` is a JSON-shaped array
   of `{ action, source }` rows. `compileBindings(table)` validates it and turns
   it into per-device lookups. Arrow keys, the right Shift and the numeric
   keypad are rows, not branches; a rebinding screen and a stored profile need
   no new code, and a gamepad adds a third `device` variant.

2. **The intent state machine is DOM-free.** `createInputBinder` takes
   `pressKey('KeyW')`, not a `KeyboardEvent`. Every rule that is easy to get
   wrong — an edge action fires once per press, opposing keys cancel, a
   diagonal is normalised _before_ it is rotated into the camera frame — is
   therefore testable with plain function calls.

3. **The DOM arrives through ports.** `attachKeyboardMouse` takes three narrow
   interfaces (`DomEventSource`, `PointerLockSurface`, `PointerLockOwner`)
   rather than reading `window` and `document`. `window`, `document` and an
   `HTMLCanvasElement` satisfy them as they are.

4. **A hand-written DOM stub, not jsdom.** The wiring test builds those three
   ports in about forty lines.

## Alternatives considered

| Alternative                                      | Why not                                                                                                                                                                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input adapter in `@wov/gameplay`                 | Puts the DOM in the package that must never render, and makes the renderer-free rule a matter of discipline instead of structure.                                                                                |
| Input adapter in a new `@wov/input` package      | A package for one consumer. `apps/editor` has different needs; extract when a second caller actually exists.                                                                                                     |
| `switch (event.code)` instead of a table         | Rebinding and controller support both mean rewriting it, and there is nowhere to store a player's choice.                                                                                                        |
| jsdom for the adapter test                       | A large dependency to simulate a browser we barely touch. It would also _hide_ growth: under jsdom the adapter could quietly start reading layout or styles and the test would still pass. The stub fails first. |
| Read `window`/`document` directly in the adapter | Then the only way to test it is jsdom, and the surface the adapter depends on stops being written down anywhere.                                                                                                 |
| `Babylon.Scene.onBeforeRenderObservable`         | Ties the simulation rate to the renderer, which is exactly what the fixed step exists to prevent, and makes the loop untestable without a canvas.                                                                |
| Interpolate in the gameplay package              | Interpolation produces numbers for a mesh and writes nothing back. It is presentation (spec §25).                                                                                                                |

## Consequences

**Positive**

- The interesting input behaviour is unit-tested without a browser: 48 tests
  over the table, the binder and the wiring, all in milliseconds.
- Rebinding is already possible — `rebind(table)` replaces the whole table and
  a key held across the change resolves to its new action, because held state
  is keyed by the physical key rather than by the action.
- The surface the game depends on is written down. The port interfaces name
  every DOM member the adapter uses.
- The frame loop reads no clock, so a whole second of frames runs in a test in
  microseconds and always produces the same numbers.
- `apps/*` joined the Vitest run, so app logic can be tested at all.

**Negative**

- The stub is a stub. It does not model event ordering, capture and bubbling,
  or a real `PointerEvent`. The wiring it covers is deliberately thin, and
  `pnpm smoke` runs the app in a real browser.
- `InputState` grew a `slot` field for the number row, so `@wov/gameplay`
  changed for a reason that came from the app.
- Four modules for what could have been one file. The seam between the binder
  and the DOM layer is what makes the first three testable; it is not free.

**Follow-ups**

- The camera is still the Phase 0 orbit camera, driven from the pointer-lock
  look delta. Spec §26 (smooth follow, collision avoidance) is its own change.
- Nothing consumes `dodge`, `interact`, `attack`, `block` or `slot` yet — the
  combat system of spec §28 does, and must respect the hit-window rule.
- The binding table has no persistence and no rebinding UI. Both are additive:
  `compileBindings` already validates whatever is loaded.
- `I` (inventory) and `C` (character) from spec §27 are unbound until there is
  a screen to open.
