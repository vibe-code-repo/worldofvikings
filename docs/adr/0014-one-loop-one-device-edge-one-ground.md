# ADR-0014: One loop, one device edge, one ground

- **Status:** accepted
- **Date:** 2026-09-06
- **Deciders:** Core maintainers
- **Supersedes:** nothing. Narrows ADR-0006, ADR-0008, ADR-0010 and ADR-0013.

## Context

Phase 1 was built as four parallel chains, each on its own branch and each with
a working `apps/game`:

| Chain             | What it brought                                          |
| ----------------- | -------------------------------------------------------- |
| `phase1/engine`   | `createRenderer`, `createBaseScene`, third-person camera |
| `phase1/gameplay` | `@wov/gameplay`, the input adapter, the fixed-step loop  |
| `phase1/assets`   | `@wov/asset-system` and the first vendored model         |
| `phase1/physics`  | `@wov/physics` and the Havok backend                     |

Each chain is coherent on its own and each passed its own tests. Merged
naively, the client would have had **two render loops** (Babylon's own and the
fixed-step one), **two readers of the mouse** (the camera's input and the
keyboard adapter), **two scenes** (`createGameScene` and three copies of the old
placeholder `createScene`), and **two answers to "where is the ground"** (a
hard-coded plane and a collision mesh). All four would have "worked" in the
sense that nothing throws.

The decisions below are the ones the merge had to make. They are recorded here
rather than in a merge commit message because they constrain every later phase.

## Decision

**1. One loop, owned by `apps/game/src/loop.ts`.** It runs the simulation on a
fixed step and then renders once. The renderer is created with
`autoStart: false`, so Babylon's own `runRenderLoop` is never started.

Consequence, and the reason this is a decision and not a detail: whoever calls
`renderFrame` is the loop, and therefore has to open and close the engine frame
the way Babylon's loop does. `beginFrame` is what measures the frame time, so
without it `engine.getDeltaTime()` stays 0 and every effect that eases over time
— the camera's follow lag, its zoom — freezes while the picture keeps rendering.
`RendererHandle.renderFrame` brackets the frame itself when it owns it.

**2. One device edge, split by concern.** `attachKeyboardMouse` reads keys and
mouse buttons; the third-person camera reads look and zoom through its own
`attachControl`, which carries the drag-look fallback for browsers that refuse
pointer lock. The adapter is attached with `ownsLook: false`, so `mousemove` has
one reader and pointer lock has one owner. Losing the lock still releases every
held key there, whoever asked for the lock — Escape must not leave the character
running.

**3. One scene, from `@wov/engine`.** `createGameScene` is the only bootstrap.
The placeholder `createScene` copies that three chains carried forward are gone,
and with them the 40 m ground: the base ground is 100 m and it is the ground
physics collides with and the asset probe stands on.

**4. One ground.** `MovementSystem` adheres entities to a `GroundQuery`;
`PhysicsWorld` answers downward rays. Neither package may import the other, so
the adapter lives in the app that owns both, in
`apps/game/src/physics-ground.ts`. Until physics is up — the backend is a ~2 MB
WASM download — the query is `flatGround(0)`, so the player walks immediately
and the ground gets more honest when the collision geometry arrives.

## Alternatives considered

| Alternative                                                             | Why not                                                                                                                                                        |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep Babylon's render loop and run the simulation from `onBeforeRender` | The simulation would then be driven by the renderer, which is the dependency direction spec §25 forbids, and a stalled renderer would silently stop time.      |
| Let the input adapter own look and feed the camera                      | Loses the drag-look fallback the camera brought, which is the only path that works when a browser refuses pointer lock — and the smoke test proves it is used. |
| Wait for physics before starting the loop                               | A 2 MB WASM download in front of the first frame, to replace a plane at y=0 with a plane at y=0.                                                               |
| Put the ground adapter in `@wov/gameplay` or `@wov/physics`             | Either one would have to import the other. The boundary rules reject it, and rightly: a headless server wants physics without gameplay.                        |

## Consequences

- The client has exactly one place where time advances, one place where devices
  are read, and one place where the world is built. A new system is added to
  the step function, not to a new loop.
- `renderFrame` is now safe to drive externally, which the editor will need when
  it gains a play-mode.
- The camera's obstacle query is still `noCameraObstacles`: the physics contract
  only casts _downward_ rays, so pushing the camera out of walls needs a general
  raycast on `PhysicsWorld` first. Recorded as open, not as done.
- Four smoke tests now cover seams no unit test can see: the frame counter
  climbs, the capsule walks, the camera follows it, and the physics backend
  comes up in a real browser.
