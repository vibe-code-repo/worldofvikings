# @wov/shared

**Purpose.** Tiny, framework-free helpers used by every other package: numeric
helpers and exhaustiveness checks. Kept deliberately small so it can be imported
from the game, the editor, the API and the tooling scripts.

**Public API.** `SHARED_VERSION`, `clamp(value, min, max)`, `assertNever(value, message?)`.

**Dependencies.** None. This package must stay dependency-free — it is the base
of the dependency graph.

**Ownership.** Core maintainers. Changes here affect everything; prefer adding a
helper to a more specific package first.
