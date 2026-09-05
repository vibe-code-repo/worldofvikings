# @wov/editor-core

**Purpose.** Editor-only logic: selection, commands, undo/redo, world document
handling. **`apps/game` must never import this package** (spec §10); the rule is
enforced by `pnpm lint:boundaries`.

**Public API.** `createEmptyWorld(id, name)`.

**Dependencies.** `@wov/world-schema`.

**Ownership.** Editor maintainers.
