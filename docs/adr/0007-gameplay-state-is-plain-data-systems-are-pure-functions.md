# ADR-0007: Gameplay state is plain data, systems are pure functions

- **Status:** accepted
- **Date:** 2026-09-05
- **Deciders:** Core maintainers

## Context

Phase 1 needs the first real gameplay code: a player that moves. How that first
system is shaped decides how every later system looks, because combat, AI,
inventory and save games all sit on the same state.

Constraints that force a decision:

- **Rendering must not own the state** (spec §25, agent rule 7). Storing the
  position on a Babylon `Mesh` is the default that this rule forbids.
- **The simulation must be reproducible.** A replay, a network fix-up and a bug
  report that says "at second 12 I was inside the wall" all need the same
  inputs to produce the same numbers on every machine.
- **Frame rate varies**, from a 144 Hz desktop to a laptop that stutters to
  30 fps. Movement may not depend on it.
- **Browser performance is a core requirement** (spec §38), so the shape must
  not force an allocation per entity per frame forever.
- Tests must be able to run the simulation without a browser, a canvas or a
  physics engine.

## Decision

Gameplay state in `@wov/gameplay` is **plain, immutable data**: a `WorldState`
holds an entity id list plus one map per component (`Transform`, `Movement`,
`Input`). Systems are **pure functions** over it — `MovementSystem.update(state,
input, dt, ground)` reads no clock and no random source, mutates nothing it is
given, and returns a new `WorldState`.

Three consequences of that decision are part of it:

1. **Everything the world outside can answer arrives as an interface.** Ground
   height comes from a `GroundQuery`, not from a raycast the system performs.
   Phase 1 answers it from a flat plane, a later phase from Havok (spec §29),
   a test from a table.
2. **Time is fixed.** `createStepAccumulator` / `advance` turn variable frame
   time into whole steps of 1/60 s, capped so a stalled tab cannot spiral. The
   system is only ever called with the fixed step.
3. **Only deterministic arithmetic.** `+ - * /` and `Math.sqrt`, which IEEE-754
   pins exactly. No `Math.hypot`, `Math.pow` or `Math.atan2` in the simulation
   path — their results are implementation-defined and differ between engines.

## Alternatives considered

| Alternative                                           | Why not                                                                                                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entity classes with methods (`player.update(dt)`)     | Rebuilds the inheritance tree agent rule 6 forbids, and hides state where a save game and a test cannot reach it.                                 |
| Mutable state, systems write in place                 | Faster, but a bug becomes "who wrote this field?" and no test can compare a before and an after. Revisit only with a measured frame-time problem. |
| A full ECS library (bitecs, miniplex)                 | A dependency and an archetype model for a handful of entities. Agent rule 12: no dependency without a clear reason. The maps can grow into one.   |
| Gameplay state on the Babylon `Mesh`, systems in apps | Exactly what spec §25 forbids; also makes headless tests impossible.                                                                              |
| Variable timestep, `dt` straight from the render loop | The same key press produces a different distance on every machine, and replays and physics fix-ups become impossible.                             |

## Consequences

**Positive** — systems are testable without a browser: the movement tests run
the full simulation in milliseconds. A world state can be cloned, diffed,
serialised into a save game and compared in an assertion. Adding a component
adds a map and changes nothing that exists.

**Negative** — a state update allocates. `MovementSystem.update` copies the
component maps of the entities it touched, and it returns the identical object
when nothing changed so callers can bail out with a reference check, but at a
few hundred moving entities this will need a second look. The immutability is a
convention, not enforced by the type system beyond `readonly`.

**Follow-ups**

- Facing (`Transform.yaw`) is data but no system writes it yet; a later system
  derives it from velocity, and it will need `Math.atan2`, so it must be kept
  out of the reproducible path or pinned.
- Gravity, capsule collision and step height belong to physics (spec §29), not
  to `MovementSystem`; `GroundQuery` is the seam where they meet.
- `MovementSystem.update` takes one `InputState` for all entities carrying an
  Input component. When enemy AI arrives it writes each NPC's own Input
  component and the system reads per entity instead.
- Movement tuning currently has a placeholder default in code. It moves into
  `content/` once the character exists (agent rule 9).
