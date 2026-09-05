# @wov/engine

**Purpose.** The rendering layer shared by the game and the editor. Phase 0
contains no Babylon.js code on purpose: `apps/game` owns its own bootstrap until
Phase 1 extracts the reusable parts here. What already exists is the render
configuration contract both apps agree on.

**Public API.** `RenderConfig`, `defaultRenderConfig`, `resolveRenderConfig(overrides?)`.

**Dependencies.** `@wov/shared`. Babylon.js will be added in Phase 1 — see ADR-0002.

**Ownership.** Core maintainers.
