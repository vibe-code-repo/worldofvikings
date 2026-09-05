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
6. Only `packages/physics/src/havok.ts` and `apps/game/src/physics-backend.ts`
   may name a physics backend (`@babylonjs/havok`, `@wov/physics/havok`).
   Everything else uses the `PhysicsWorld` contract (ADR-0008).
7. The `@wov/physics` entry point must not import Babylon.js or its own backend —
   importing the contract has to stay free.
8. `apps/editor` and `packages/editor-core` must not reach a physics backend: the
   editor does not simulate and must not ship the WASM module (spec §38).

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

| Package             | Purpose                                           |
| ------------------- | ------------------------------------------------- |
| `@wov/shared`       | Framework-free helpers. Dependency-free.          |
| `@wov/world-schema` | Zod schemas + versioning for all world data.      |
| `@wov/asset-system` | Asset URL resolution; loading/caching later.      |
| `@wov/engine`       | Shared renderer layer (Babylon.js from Phase 1).  |
| `@wov/physics`      | `PhysicsWorld` contract; Havok backend behind it. |
| `@wov/gameplay`     | Gameplay state and systems (from Phase 6).        |
| `@wov/editor-core`  | Editor-only logic. Forbidden in the game.         |
| `@wov/ui`           | Framework-free UI tokens/helpers.                 |

See each package's README for its public API and ownership.

## Build model

Shared packages are compiled with `tsc -b tsconfig.packages.json` into `dist/`
and consumed through their `exports` entry. The root `prepare` script builds them
after `pnpm install`, so a clean clone can run `pnpm dev` immediately.
`pnpm dev:packages` keeps them in watch mode while you work.

## Physics

```text
gameplay / apps  →  @wov/physics (contract, no Babylon)
                         ▲
                         │ implements
                    @wov/physics/havok  →  @babylonjs/havok (WASM)
```

The contract (`PhysicsWorld`, `CharacterController`, `raycastGround`,
`addStaticMesh`) contains no Babylon.js and no Havok, so gameplay never sees the
backend and importing it costs nothing. `apps/game` loads the backend with a
dynamic `import()` from `apps/game/src/physics-backend.ts`, which keeps the ~2 MB
`HavokPhysics.wasm` in its own chunk and out of the editor entirely. Stepping is
explicit: the game loop calls `step(deltaSeconds)`, the render loop never
advances the simulation on its own. Capsule size, mass and the substep limits are
data in `packages/physics/src/defaults.ts`. See ADR-0008.

## Known limitations (Phase 0/1)

- `@wov/engine` contains no Babylon.js code yet; game and editor each bootstrap
  their own scene. Extracting the shared bootstrap is a Phase 1 task, and
  `toStaticMeshData` in `apps/game/src/physics-backend.ts` moves there with it.
- Physics exists, but there is no player controller on top of it yet: the game
  drops one capsule to prove the world simulates.
- No assets, no world loading. The API only serves `/health`.
