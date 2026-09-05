# ADR-0006: The engine package owns the Babylon.js bootstrap

- **Status:** accepted
- **Date:** 2026-09-05
- **Deciders:** Core maintainers

## Context

Phase 0 left `apps/game` and `apps/editor` with a private copy of the same
Babylon.js start-up sequence: construct an `Engine`, apply the hardware scaling
level, construct a `Scene`, call `engine.runRenderLoop(() => scene.render())`
and hook `window.resize`. `@wov/engine` held only the `RenderConfig` contract.

Two copies of a bootstrap is two places to get it wrong, and Phase 1 adds work
that must land in both: WebGPU with a WebGL2 fallback (spec §2.1), a frame hook
for the player controller and camera (spec §24–§27), and deterministic teardown
so the editor can rebuild a viewport without leaking a GPU context.

The expensive part is not the code — it is the Babylon.js **side-effect
imports**. With the ES6 packages a feature only works once the module that
registers it has been imported, and a missing import does not fail loudly:

- Without `@babylonjs/core/Culling/ray.js`, `scene.pickWithRay` is declared in
  `scene.d.ts`, exists at runtime as a function, and throws when called.
- Without `@babylonjs/core/Materials/standardMaterial.js`,
  `Scene.DefaultMaterialFactory` is still a function, and reading
  `scene.defaultMaterial` throws.

`tsc` is green in both cases. A per-app import list drifts silently, and the
symptom appears far from the cause — as broken selection or an unshaded scene.

## Decision

`@wov/engine` owns the Babylon.js bootstrap and nothing else. It exposes
`createRenderer(canvas, options): Promise<RendererHandle>`, which owns engine
selection, the `Scene`, the render loop, resize handling, teardown and the
required side-effect imports. Both apps use it and neither constructs an
`Engine` or a `Scene` itself.

The package owns **no gameplay state and no scene content**: no camera, light,
mesh or material. Those stay in the apps and later in `@wov/gameplay`, so the
flow of spec §25 — state → systems → entities → Babylon representation — holds.

Two rules follow for the side-effect list (`src/side-effects.ts`):

1. An import belongs there only if it **measurably changes behaviour**. A module
   that merely defines exports is imported by whoever uses those exports.
2. Every entry has a test in `side-effects.test.ts` that **calls** the feature.
   A `typeof` check is not a witness, because the stubs are functions too.

`@babylonjs/core/Meshes/meshBuilder.js` is therefore **not** in the list, though
it looks like an obvious candidate. It registers nothing; it only assembles
`MeshBuilder` from every `Meshes/Builders/*` module, and callers get a complete
`MeshBuilder` by importing it themselves regardless. Measured on the game bundle
(Babylon 8.56.2, `pnpm --filter @wov/game build`):

| Bundle                | Raw        | Gzip      |
| --------------------- | ---------- | --------- |
| with `meshBuilder.js` | 1102.05 kB | 271.40 kB |
| without               | 988.71 kB  | 238.20 kB |

113 kB raw / 33 kB gzip for no observable effect, against a hard 60 FPS and
payload budget (spec §38). Both apps import the one builder they need
(`Meshes/Builders/groundBuilder.js`) instead.

`createRenderer` is asynchronous because WebGPU can only be initialised
asynchronously; the WebGL2 path resolves on the next microtask. The WebGPU
engine is loaded with a dynamic `import()` so it stays out of the main chunk
when the browser gets WebGL2 (it is the separate 247 kB `webgpuEngine` chunk).

## Alternatives considered

| Alternative                                             | Why not                                                                                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Leave the bootstrap duplicated in both apps             | Two drifting copies of the side-effect list, and every Phase 1 addition (WebGPU, frame hook, teardown) has to be written and reviewed twice.            |
| Put camera, light and ground into `@wov/engine` too     | Makes the renderer own scene content, and the editor and the game need different ones. Violates spec §25 and would drag world data toward the renderer. |
| A synchronous `createRenderer` plus a separate `init()` | WebGPU cannot be initialised synchronously. Two-step construction lets callers use a half-built renderer; one `await` is simpler than a state machine.  |
| Re-export Babylon.js from `@wov/engine`                 | Hides which Babylon modules an app actually pulls in, which is exactly what the bundle budget in spec §38 needs to stay visible.                        |
| Keep `meshBuilder.js` in the side-effect list           | 113 kB raw / 33 kB gzip of measured cost for zero observable effect. Rejected on the numbers above, not on taste.                                       |

## Consequences

**Positive** — one bootstrap, one documented side-effect list, and tests that
call each registered feature instead of trusting the compiler. Both apps get
WebGPU-with-fallback and clean teardown for free. `RendererHandle.onFrame` gives
Phase 1's player controller and camera a hook that does not require touching
Babylon's render loop.

**Negative** — creating a renderer is now asynchronous, so both call sites carry
an `async` boundary; the editor's `useEffect` needs a cancellation flag because
React StrictMode mounts twice. `@wov/engine` now depends on `@babylonjs/core`,
which makes it the heaviest shared package — `@wov/gameplay` must keep its
existing boundary rule forbidding it (`pnpm lint:boundaries`).

**Follow-ups** — the game's main chunk is 989 kB raw / 238 kB gzip and still
above Vite's 500 kB warning; splitting Babylon out of the entry chunk is its own
task. `RendererHandle` does not yet expose a fixed-timestep update separate from
the render frame; gameplay systems will need one (spec §29). Havok physics
(spec §29) will add its own side-effect import and its own test alongside it.
