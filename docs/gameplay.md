# Gameplay

> Status: **Phase 0** — **no gameplay is implemented**. This document records the
> architecture gameplay must follow, so the first system does not set a bad
> precedent.

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

Phase 1 player/camera/movement → Phase 2 character and animation → Phase 6
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
