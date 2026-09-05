# ADR-0003: Game and editor are separate applications

- **Status:** accepted
- **Date:** 2026-09-05
- **Deciders:** project maintainers

## Context

Spec §10 states it as a hard requirement: editor-specific code must never be part
of the game production bundle. The editor also needs React and permission-gated
access in production (§48), while the game ships plain HTML/CSS UI to every
player. Sharing one bundle would ship editor code and React to players and blur
the trust boundary between "runs the game" and "may edit the world".

## Decision

`apps/game` and `apps/editor` are independent Vite applications with independent
bundles, deployed to different domains. Shared code lives in `packages/engine`,
`packages/world-schema`, `packages/asset-system`, `packages/shared` and
`packages/ui`. Editor-only logic lives in `packages/editor-core`, which
`apps/game` must not import.

## Alternatives considered

| Alternative                               | Why not                                                                                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| One app with an `?editor=1` mode          | The editor code is in the bundle whether or not it is reachable; tree-shaking cannot be relied on for a rule this important.            |
| One app with dynamic import of the editor | Better, but the boundary becomes a build-time detail instead of a structural one, and the editor could still reach into game internals. |

## Consequences

**Positive** — the game bundle provably contains no editor code; the editor can
use React freely; production access control has a natural boundary (one domain).

**Negative** — some duplication during Phase 0 (each app bootstraps its own
Babylon scene) until the shared parts are extracted into `@wov/engine`.

**Follow-ups** — the rule is enforced by `pnpm lint:boundaries`
(`.dependency-cruiser.cjs`, rule `game-must-not-use-editor`), which runs in CI.
