# @wov/gameplay

**Purpose.** Gameplay state and the systems that advance it. Gameplay state
never lives inside a Babylon.js mesh and this package never imports a renderer
(spec §25, agent rule 7). The state is plain, immutable data and the systems are
pure functions over it — see
[ADR-0009](../../docs/adr/0009-gameplay-state-is-plain-data-systems-are-pure-functions.md).

Phase 1 covers movement only. Stats, combat, inventory and AI arrive later
(spec §24: incrementally, not all at once).

## The shape

```text
WorldState  (entity ids + one map per component)
    |
MovementSystem.update(state, input, dt, ground)  → a new WorldState
    |
apps/game copies the numbers into Babylon
```

Everything the world outside can answer arrives as an interface: ground height
comes from a `GroundQuery`, never from a raycast the system performs itself.
Phase 1 answers it from a flat plane, physics answers it from Havok later
(spec §29), a test answers it from a table.

## Public API

**State** — `WorldState`, `EntitySpec`, `createWorldState(specs)`,
`addEntity(state, spec)`, `getTransform`, `getMovement`, `getInput`,
`EntityId`, `toEntityId(raw)`.

**Components** — `Transform`, `Movement`, `MovementTuning`, `createTransform`,
`createMovement`, `DEFAULT_MOVEMENT_TUNING`.

**Input** — `InputState` (`moveX`, `moveZ`, `sprint`, `dodge`, `interact`,
`attack`, `block`, `slot`, derived from the desktop bindings of spec §27),
`createInputState(overrides)`, `NEUTRAL_INPUT`, `inputEquals`,
`QUICK_SLOT_COUNT`.

`slot` is the quick slot triggered this tick — `1`–`QUICK_SLOT_COUNT`, or `0`
for none. One number rather than five booleans, because a slot activation is
exclusive. The axes are clamped into `[-1, 1]`; an out-of-range `slot` throws
instead, because firing the wrong skill is worse than refusing to fire one.

Who produces an `InputState` is not this package's business. `apps/game` maps
keyboard and mouse onto it through a rebindable table
([ADR-0010](../../docs/adr/0010-the-device-edge-and-the-frame-loop-live-in-apps-game.md)),
and a gamepad or a replay file can produce the same record later.

**Ground** — `GroundQuery`, `flatGround(height)`, `NO_GROUND`,
`groundUnder(ground, position)`.

**Fixed timestep** — `createStepAccumulator(options)`, `advance(acc, frameDelta)`,
`DEFAULT_FIXED_DELTA` (1/60 s), `DEFAULT_MAX_STEPS_PER_FRAME`.

**Systems** — `MovementSystem.update(state, input, dt, ground)`.

**Vectors** — `Vec3`, `vec3(x, y, z)`, `ZERO_VEC3`, `horizontalLength(x, z)`.

## Using it from a render loop

`update` must only ever be called with the fixed step, otherwise the same key
press covers a different distance on every machine:

```ts
const tick = advance(accumulator, frameDeltaSeconds);
accumulator = tick.accumulator;
for (let i = 0; i < tick.steps; i += 1) {
  state = MovementSystem.update(state, input, accumulator.fixedDelta, ground);
}
// tick.alpha interpolates the render pose between the last two steps.
```

`update` returns the identical state object when nothing changed, so a caller
can skip its render sync with a reference check.

## Rules that hold here

- No renderer import, ever (`pnpm lint:boundaries` enforces it).
- Only deterministic arithmetic in the simulation path: `+ - * /` and
  `Math.sqrt`. No `Math.hypot`, `Math.pow` or `Math.atan2` — their results are
  implementation-defined and differ between engines.
- Systems never mutate the state they are given and read no clock and no random
  source.
- Tuning values in code are placeholders; they move to `content/` once the
  character exists (agent rule 9).

**Dependencies.** `@wov/shared` (for `clamp`). Nothing else.

**Ownership.** Core maintainers.
