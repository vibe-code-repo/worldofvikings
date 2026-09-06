# Gameplay

> Status: **Phase 1** — the first system exists: a player capsule that walks.
> Everything below the "What exists today" section is still the target, not the
> state.

## What exists today

`@wov/gameplay` holds the state and the systems, as plain data and pure
functions (ADR-0009):

| Piece                                                        | What it is                                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `WorldState`                                                 | An entity list plus one map per component — transform, movement, input        |
| `MovementSystem.update(state, input, dt, ground, obstacles)` | Pure. Same arguments, same numbers, on every machine                          |
| `advance(accumulator, frameDelta)`                           | Splits real time into whole 60 Hz steps, with a cap on catch-up               |
| `GroundQuery`                                                | `heightAt(x, z)`. Answered by physics in the client, by a table in a test     |
| `ObstacleQuery`                                              | `isFree(from, to, radius)`. What is beside an entity, not below it (ADR-0026) |
| `InputState`                                                 | One frame of intent: two axes, sprint, dodge, interact, attack, block, slot   |

The client wires them in `apps/game`: the DOM adapter produces `InputState`, the
loop runs the step, and the renderer draws the result (ADR-0010, ADR-0014). None
of that is in this package — `@wov/gameplay` imports no renderer and no DOM, and
`pnpm lint:boundaries` fails the build if that changes.

Not yet implemented: gravity and jumping (`velocity.y` stays 0), collision
against walls, entity facing (`Transform.yaw` is written by no system), and
anything that consumes `dodge`, `interact`, `attack`, `block` or the quick slots
— they reach the state and wait there for the combat system of spec §28.

## Principles

1. **Composition over inheritance.** Entities are composed of components
   (transform, render, animation, stats, combat, inventory, AI), not deep class
   hierarchies (spec §25).
2. **Rendering never owns state.** Gameplay state is never stored on a Babylon
   `Mesh`. Flow: game state → systems → entities → rendering representation.
3. **Data-driven.** Items, enemies, quests and skills are JSON in `content/`,
   validated by schemas — not one TypeScript class per item (spec §30, §32, §33).
4. **Damage happens in animation hit windows**, not on mouse-down (spec §28).

## Planned order (spec §51)

Phase 1 player/camera/movement (**done**) → Phase 2 character and animation → Phase 6
combat → Phase 7 enemy AI → Phase 8 items and inventory → Phase 9 NPCs and
quests → Phase 10 dungeon.

The first complete loop is the vertical slice of spec §50: village → NPC quest →
forest → five enemies → small ruin → mini dungeon → boss → loot → return.

## Controls (target, spec §27)

```text
WASD Movement   Mouse Camera   LMB Light attack   RMB Block
Space Dodge     Shift Sprint   E Interact         I Inventory
C Character     1-5 Skills
```

## Where code belongs

`@wov/gameplay` holds state and systems and must not import a renderer.
`@wov/engine` holds the rendering layer. `apps/game` wires the two together.
