# @wov/shared

**Purpose.** Tiny, framework-free helpers used by every other package: numeric
helpers, exhaustiveness checks and the one rule both browser apps apply to a
configured service URL. Kept deliberately small so it can be imported from the
game, the editor, the API and the tooling scripts.

**Public API.** `SHARED_VERSION`, `clamp(value, min, max)`,
`assertNever(value, message?)`,
`resolveServiceUrl(configured, fallback, name)` — empty means the local default,
anything else must be an absolute http(s) URL, and a trailing slash is dropped
so a path can be appended.

**Dependencies.** None. This package must stay dependency-free — it is the base
of the dependency graph.

**Ownership.** Core maintainers. Changes here affect everything; prefer adding a
helper to a more specific package first.
