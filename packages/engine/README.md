# @wov/engine

**Purpose.** The Babylon.js bootstrap shared by `apps/game` and `apps/editor`
(ADR-0006). It owns exactly four things — engine selection (WebGPU with a WebGL2
fallback), the `Scene`, the render loop and resize handling — plus the
Babylon.js side-effect imports both apps depend on.

It owns **no gameplay state and no scene content**: no camera, light, mesh or
material. Those belong to the app and, from Phase 6 on, to `@wov/gameplay`.
Rendering never owns the game state (spec §25), which is why `@wov/gameplay` is
forbidden from importing this package (`pnpm lint:boundaries`).

## Public API

| Export                            | What it does                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| `createRenderer(canvas, options)` | `Promise<RendererHandle>`. Builds engine, scene and render loop for a canvas.                      |
| `RendererHandle`                  | `engine`, `scene`, `backend`, `config`, `disposed`, `onFrame`, `renderFrame`, `resize`, `dispose`. |
| `selectBackend(config, caps)`     | Pure choice between `'webgpu'` and `'webgl2'`. Separated out so it is testable.                    |
| `detectRenderCapabilities()`      | What the current browser offers (`navigator.gpu`).                                                 |
| `resolveRenderConfig(overrides?)` | Normalises a partial `RenderConfig`; clamps `resolutionScale` to `0.25…2`.                         |
| `defaultRenderConfig`             | The defaults `resolveRenderConfig` merges into.                                                    |

```ts
const renderer = await createRenderer(canvas, { resolutionScale: 1 });
// the app owns the content:
new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 3, 18, Vector3.Zero(), renderer.scene);
const stop = renderer.onFrame(({ deltaSeconds }) => update(deltaSeconds));
// later
stop();
renderer.dispose();
```

`createRenderer` is asynchronous because WebGPU can only be initialised
asynchronously; the WebGL2 path resolves on the next microtask. The WebGPU
engine is behind a dynamic `import()`, so it stays out of the main chunk when
the browser gets WebGL2.

`options` extends `Partial<RenderConfig>` with `autoStart` (default `true`),
`resizeHost` (defaults to `window`, `null` disables it) and `createEngine` —
which is how the tests run the real bootstrap on a headless `NullEngine`.

## Side-effect imports

`src/side-effects.ts` is the one place that lists the Babylon.js modules whose
import is load-bearing. This matters more than it looks: with the ES6 packages a
missing side-effect import produces **no compiler error and no runtime warning**.
`scene.pickWithRay` is declared in Babylon's own `scene.d.ts` and is a function
at runtime even when `Culling/ray.js` was never imported — it throws when called.

Two rules, both enforced by `src/side-effects.test.ts`:

1. An import belongs there only if it **measurably changes behaviour**. A module
   that merely defines exports is imported by whoever uses those exports —
   `@babylonjs/core/Meshes/meshBuilder.js` is the cautionary case: it registers
   nothing and costs 113 kB raw / 33 kB gzip in the game bundle (ADR-0006).
2. Every entry has a test that **calls** the feature. A `typeof` check is not a
   witness, because the unregistered stubs are functions too.

Import the single builder you need
(`@babylonjs/core/Meshes/Builders/groundBuilder.js`), not the full set.

## Dependencies

- `@babylonjs/core` — the renderer this package exists to bootstrap (ADR-0002).
- `@wov/shared` — `clamp` for the render config.

**Ownership.** Core maintainers.
