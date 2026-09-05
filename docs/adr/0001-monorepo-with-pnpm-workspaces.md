# ADR-0001: Monorepo with pnpm workspaces

- **Status:** accepted
- **Date:** 2026-09-05
- **Deciders:** project maintainers

## Context

The project consists of a website, a game client, a world editor, an API and a
set of shared libraries that all change together — a schema change touches the
editor, the game and the validator in one step. Contributors must be able to go
from `git clone` to a running environment in four commands (spec §3), on Linux,
macOS and Windows, without Docker.

## Decision

One repository, pnpm workspaces (`apps/*`, `services/*`, `packages/*`), a shared
`tsconfig.base.json`, one ESLint flat config, one Prettier config, one Vitest run,
and root scripts (`dev`, `build`, `test`, `lint`, `format`, `typecheck`,
`validate`, `check`, `smoke`). The pnpm version is pinned via `packageManager`
and installed through Corepack.

## Alternatives considered

| Alternative            | Why not                                                                                                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multiple repositories  | A schema change would need coordinated PRs across repos; contributor onboarding cost multiplies.                                                                                                    |
| npm or Yarn workspaces | pnpm's strict, non-hoisted `node_modules` catches undeclared dependencies, which is exactly the discipline a multi-package project needs. Its store also keeps repeated installs cheap.             |
| Nx / Turborepo         | Real value at a scale we do not have. They add a build-graph tool a new contributor must learn before contributing; pnpm's topological `-r` ordering is enough today. Revisit when builds get slow. |

## Consequences

**Positive** — one clone, one install, one command set; cross-package changes are
atomic; boundaries can be enforced repository-wide.

**Negative** — CI installs everything even for a one-package change; the strict
`node_modules` layout occasionally surprises contributors coming from npm.

**Follow-ups** — if the install/build time becomes a problem, add task caching
(Turborepo or `nx`) rather than splitting the repository.
