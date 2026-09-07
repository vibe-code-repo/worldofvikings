# @wov/shared

**Purpose.** Tiny, framework-free helpers used by every other package: numeric
helpers, exhaustiveness checks, the one rule both browser apps apply to a
configured service URL, and the conditional-request helpers both servers answer
with. Kept deliberately small so it can be imported from the game, the editor,
the API and the tooling scripts.

**Public API.** `SHARED_VERSION`, `clamp(value, min, max)`,
`assertNever(value, message?)`,
`resolveServiceUrl(configured, fallback, name)` — empty means the local default,
anything else must be an absolute http(s) URL, and a trailing slash is dropped
so a path can be appended — `isDebugRequested(search)`, and from
`http-cache.ts`: `httpDate(epochMs)`, `fileValidators(size, modifiedMs,
revision?)`, `isNotModified(request, validators)` and
`revalidatingCacheControl(maxAgeSeconds?)`.

**Why HTTP helpers live in the base package.** `services/api` and
`tooling/scripts/asset-server.ts` both hand out files a browser sees again on
every editor open, and both have to answer `304` for exactly the same requests
(ADR-0052). Weak-tag comparison is the kind of small rule that is written
slightly differently the second time, and the symptom of a drift — one server
quietly re-sending 55 MB — is invisible from the inside. One implementation, one
test suite. It uses no Node built-in and no browser API, so it still belongs
here; tree shaking keeps it out of the app bundles that do not import it.

**Dependencies.** None. This package must stay dependency-free — it is the base
of the dependency graph.

**Ownership.** Core maintainers. Changes here affect everything; prefer adding a
helper to a more specific package first.
