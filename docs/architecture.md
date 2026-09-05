# Architecture

> Status: **Phase 0 (repository bootstrap)**. This document describes what exists
> today and the boundaries the project commits to. Anything marked "later" is not
> implemented yet.

## Overview

```text
                         WORLD OF VIKINGS
                                |
          ┌─────────────────────┼─────────────────────┐
          v                     v                     v
       WEBSITE                 GAME                 EDITOR
   apps/website            apps/game            apps/editor
                                |                     |
                                └──────────┬──────────┘
                                           v
                            shared packages (packages/*)
                                           |
                          ┌────────────────┴───────────────┐
                          v                                v
                    services/api                    assets/ (dev server)
```

## Layers

| Layer    | Location     | Rule                                         |
| -------- | ------------ | -------------------------------------------- |
| Apps     | `apps/*`     | May depend on packages. Never on each other. |
| Services | `services/*` | May depend on packages. Never on apps.       |
| Packages | `packages/*` | Never depend on apps or services.            |
| Content  | `content/`   | Data only. No code.                          |
| Assets   | `assets/`    | Binary assets. No code.                      |

## Enforced boundaries

These are checked by `pnpm lint:boundaries` (dependency-cruiser,
`.dependency-cruiser.cjs`, resolving `@wov/*` to package sources via
`tsconfig.depcruise.json`), not just documented:

1. `apps/game` must not import `apps/editor` or `@wov/editor-core` — editor code
   must never reach the game bundle (spec §10).
2. `packages/world-schema` must not import Babylon.js, React or any app — it
   describes data, not rendering.
3. `packages/gameplay` must not import Babylon.js or `@wov/engine` — gameplay
   state is independent of the renderer (spec §25).
4. `packages/*` must not import `apps/*` or `services/*`.
5. No circular dependencies anywhere.

## Data flow

```text
World Editor  ──save──▶  WorldDefinition (content/worlds/*.json)  ──load──▶  Game
```

The editor never writes runtime game code, and the game never contains authored
world data in TypeScript (ADR-0004). Every read goes through
`@wov/world-schema`, so a broken or outdated file fails loudly.

## Rendering vs. state

```text
Game State  →  Gameplay Systems  →  Entities  →  Babylon rendering representation
```

Rendering never owns game state. Nothing gameplay-related is stored on a Babylon
`Mesh`. In Phase 0 there is no gameplay state yet; the rule exists so it is never
introduced the wrong way round.

## Packages

| Package             | Purpose                                          |
| ------------------- | ------------------------------------------------ |
| `@wov/shared`       | Framework-free helpers. Dependency-free.         |
| `@wov/world-schema` | Zod schemas + versioning for all world data.     |
| `@wov/asset-system` | Asset URL resolution; loading/caching later.     |
| `@wov/engine`       | Shared renderer layer (Babylon.js from Phase 1). |
| `@wov/gameplay`     | Gameplay state and systems (from Phase 6).       |
| `@wov/editor-core`  | Editor-only logic. Forbidden in the game.        |
| `@wov/ui`           | Framework-free UI tokens/helpers.                |

See each package's README for its public API and ownership.

## Build model

Shared packages are compiled with `tsc -b tsconfig.packages.json` into `dist/`
and consumed through their `exports` entry. The root `prepare` script builds them
after `pnpm install`, so a clean clone can run `pnpm dev` immediately.
`pnpm dev:packages` keeps them in watch mode while you work.

## Known limitations (Phase 0)

- `@wov/engine` contains no Babylon.js code yet; game and editor each bootstrap
  their own scene. Extracting the shared bootstrap is a Phase 1 task.
- No physics, no player, no assets, no world loading.
- The API only serves `/health`.
