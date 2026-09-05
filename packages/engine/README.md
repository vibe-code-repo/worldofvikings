# @wov/engine

**Purpose.** The rendering layer shared by `apps/game` and `apps/editor`. Two
things, kept apart on purpose:

1. **The bootstrap** (ADR-0006) — engine selection (WebGPU with a WebGL2
   fallback), the `Scene`, the render loop, resize handling and the Babylon.js
   side-effect imports both apps depend on. `createRenderer` creates no camera,
   light or mesh.
2. **The base scene** (ADR-0007) — the opt-in empty stage both apps open on:
   ground, fill and key light, sky colour and matching fog. A caller who wants
   it calls `createBaseScene`; the bootstrap never imposes it, and it creates no
   camera, because the game and the editor need different ones.

The package owns **no gameplay state**: no entity, no player, nothing a system
reads back. Rendering never owns the game state (spec §25), which is why
`@wov/gameplay` is forbidden from importing this package
(`pnpm lint:boundaries`).

## Public API

| Export                            | What it does                                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| `createRenderer(canvas, options)` | `Promise<RendererHandle>`. Builds engine, scene and render loop for a canvas.                       |
| `RendererHandle`                  | `engine`, `scene`, `backend`, `config`, `disposed`, `onFrame`, `renderFrame`, `resize`, `dispose`.  |
| `selectBackend(config, caps)`     | Pure choice between `'webgpu'` and `'webgl2'`. Separated out so it is testable.                     |
| `detectRenderCapabilities()`      | What the current browser offers (`navigator.gpu`).                                                  |
| `resolveRenderConfig(overrides?)` | Normalises a partial `RenderConfig`; clamps `resolutionScale` to `0.25…2`.                          |
| `defaultRenderConfig`             | The defaults `resolveRenderConfig` merges into.                                                     |
| `createBaseScene(scene, opts?)`   | `BaseSceneHandle`. Adds ground, two lights, sky colour and fog to an existing scene.                |
| `BaseSceneHandle`                 | `ground`, `groundMaterial`, `ambientLight`, `sun`, `options`, `dispose` (restores the old sky/fog). |
| `resolveBaseSceneOptions(over?)`  | Validates a partial base-scene description and derives the fog distances from the ground size.      |
| `defaultBaseSceneOptions`         | The resolved defaults: 100 m ground, no shadows, linear fog in the sky colour.                      |

```ts
const renderer = await createRenderer(canvas, { resolutionScale: 1 });
const base = createBaseScene(renderer.scene, { groundSize: 100, skyColor: '#4d5b68' });
// the app still owns the camera:
new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 3, 34, Vector3.Zero(), renderer.scene);
const stop = renderer.onFrame(({ deltaSeconds }) => update(deltaSeconds));
// later
stop();
renderer.dispose(); // disposes the scene, and with it the base scene
```

Base-scene options are plain data — numbers and `#rrggbb` strings, never Babylon
types — so the same description can come out of world JSON later. They are
validated rather than trusted: `Color3.FromHexString` answers black for anything
it cannot parse, so a typo would otherwise render as a lighting bug instead of
an error naming the field.

The key light is created with `shadowEnabled = false`. Shadows are selective and
cost a pass per caster (spec §38); they arrive with the content that needs them,
and until then the flag says so in code.

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
