# Architecture

> Status: **Phase 1 (player, camera, movement)**. This document describes what
> exists today and the boundaries the project commits to. Anything marked
> "later" is not implemented yet.

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
   Everything else uses the `PhysicsWorld` contract (ADR-0013).
7. The `@wov/physics` entry point must not import Babylon.js or its own backend —
   importing the contract has to stay free.
8. `apps/editor` and `packages/editor-core` must not reach a physics backend: the
   editor does not simulate and must not ship the WASM module (spec §38).

## Data flow

```text
World Editor ──PUT /worlds/:id──▶ services/api ──▶ content/worlds/*.json ──load──▶ Game
                                       │
                                 validates with
                                 @wov/world-schema
```

The editor never writes runtime game code, and the game never contains authored
world data in TypeScript (ADR-0004). Every read goes through
`@wov/world-schema`, so a broken or outdated file fails loudly.

A browser cannot write files, so authored data goes through `services/api`
(`GET /worlds`, `GET /worlds/:id`, `PUT /worlds/:id`, `GET /prefabs`,
`GET`/`PUT /prefabs/:catalog` over `CONTENT_DIR`): it validates in both
directions, writes atomically in Prettier's formatting so saved worlds stay
reviewable, and refuses every write when `WORLDS_READ_ONLY` is set (ADR-0017).
The game does not use those routes — it reads world files as data and still
renders without a backend (spec §35).

The same service also runs the two **content build steps** for the editor:
`POST /actions/import-scene` and `POST /actions/generate-prefabs` call the very
functions `pnpm import:scene` and `pnpm generate:prefabs` call, out of
`@wov/content-build` (ADR-0033). The command line and the editor are two doors
onto one implementation; the import reads only from `WOV_IMPORT_DIR`, and
without that variable it answers 501.

Inside the editor the same arrow points one way only: **the document is the
truth and the scene follows it** (ADR-0018). Every gesture becomes an
`EditorCommand` against the document, and the Babylon viewport reconciles itself
against the result — it never edits the world. That is what makes a gizmo drag,
a Delete keystroke and a number typed into the inspector undo identically.

## Rendering vs. state

```text
Game State  →  Gameplay Systems  →  Entities  →  Babylon rendering representation
```

Rendering never owns game state. Nothing gameplay-related is stored on a Babylon
`Mesh`: the player's position lives in a `WorldState` in `@wov/gameplay`, and the
capsule's `position` is written from it every frame and never read back
(ADR-0009). The camera follows a `() => Vector3`, not a mesh, so it cannot
become a route back into gameplay either.

## The Phase 1 client

```text
                        apps/game/src/loop.ts
                     (one loop, ADR-0010, ADR-0014)
                                  │
        ┌─────────────────────────┴─────────────────────────┐
        │ fixed step (60 Hz)                                │ once per frame
        v                                                   v
  input.sample(camera yaw)                        interpolate(previous, current)
        │                                                   │
        v                                                   v
  MovementSystem.update(state, input, dt,           capsule.position
                        ground, obstacles)                  │
        │                    ▲                              v
        │                    │ heightAt(x, z)      renderer.renderFrame()
        │                    │ isFree(from, to, r)          │
        v                    │                              v
  physics.step(dt) ─────────▶ physics-ground.ts   third-person camera follows
                              physics-obstacles.ts
                              (raycastGround, raycast)
```

Reading it in one sentence: keys and mouse buttons become intent, intent becomes
a position, physics says what height that position sits at and whether anything
is in the way of it, and the renderer draws the result with the camera behind
it. Every arrow points away from the state and towards the picture.

Five seams here have no unit test that can see them, so `pnpm smoke` covers each
in a real browser: the frame counter climbs, a held key walks the capsule, the
camera follows it, the Havok backend comes up over the network, and the capsule
is stopped by a wall of the _authored_ village rather than by one a test drew
(ADR-0026).

## Packages

| Package              | Purpose                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| `@wov/shared`        | Framework-free helpers. Dependency-free.                                                              |
| `@wov/world-schema`  | Zod schemas + versioning for all world data.                                                          |
| `@wov/asset-system`  | Asset URLs, GLB loading and caching, scene placement, manifest (ADR-0011).                            |
| `@wov/content-build` | Scene import and prefab catalogue generation, as functions the scripts _and_ the API call (ADR-0033). |
| `@wov/engine`        | Babylon.js bootstrap (ADR-0006), base scene (ADR-0007), third-person camera (ADR-0008).               |
| `@wov/physics`       | `PhysicsWorld` contract; Havok backend behind it (ADR-0013).                                          |
| `@wov/gameplay`      | Gameplay state and systems (ADR-0009). Never imports a renderer.                                      |
| `@wov/editor-core`   | Editor-only logic. Forbidden in the game.                                                             |
| `@wov/ui`            | Framework-free UI tokens/helpers.                                                                     |

See each package's README for its public API and ownership. `@wov/gameplay` and
`@wov/physics` never import each other: the app joins them, in
`apps/game/src/physics-ground.ts` (ADR-0014) and `physics-obstacles.ts`
(ADR-0026, ADR-0038).

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

The contract (`PhysicsWorld`, `CharacterController`, `raycastGround`, `raycast`,
`addStaticMesh`, `addStaticGroup`) contains no Babylon.js and no Havok, so gameplay never sees the
backend and importing it costs nothing. `apps/game` loads the backend with a
dynamic `import()` from `apps/game/src/physics-backend.ts`, which keeps the ~2 MB
`HavokPhysics.wasm` in its own chunk and out of the editor entirely. Stepping is
explicit: the game loop calls `step(deltaSeconds)`, the render loop never
advances the simulation on its own. Capsule size, mass and the substep limits are
data in `packages/physics/src/defaults.ts`. See ADR-0013.

A zone's entities are collided against through `addStaticGroup`: one shape, every
placement of it, with the entity's scale baked into the shape's coordinates and
only a position and a rotation on the body. The village's 1216 entities are 220
distinct _(prefab, scale)_ pairs, so 220 shapes carry all of them (ADR-0026).

## Known limitations (Phase 1)

- The game's entry chunk is large — see the numbers in `docs/development.md`.
  Splitting Babylon.js out of it is still open (ADR-0006).
- There is no player _controller_ on top of physics yet: the capsule is moved
  kinematically by `MovementSystem`, and physics answers the ground under it and
  whether anything is beside it (ADR-0026). Gravity, jumping and being pushed
  arrive with Phase 2.
- `toStaticMeshData` still lives in `apps/game/src/physics-backend.ts`; it
  belongs in `@wov/engine` next to the rest of the Babylon bridge.
- The camera's obstacle query is `noCameraObstacles`: it will happily sit inside
  a wall. The contract now has the general `raycast` this needs (ADR-0026); the
  camera has not been wired to it.
- `RenderConfig.debugOverlay` is declared and read by nobody — a placeholder for
  the overlay a later phase adds, not a feature.
- No character model, no combat, no world loading. The API only serves
  `/health`.
