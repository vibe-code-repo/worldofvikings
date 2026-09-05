# @wov/gameplay

**Purpose.** Gameplay state and systems (stats, combat, inventory, AI) —
implemented incrementally from Phase 6 on. Gameplay state never lives inside a
Babylon.js mesh and this package never imports a renderer (spec §25).

**Public API.** `EntityId`, `toEntityId(raw)`. Nothing else exists in Phase 0.

**Dependencies.** `@wov/shared`.

**Ownership.** Core maintainers.
