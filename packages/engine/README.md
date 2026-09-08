# @wov/engine

**Purpose.** The rendering layer shared by `apps/game` and `apps/editor`. Three
things, kept apart on purpose:

1. **The bootstrap** (ADR-0006) — engine selection (WebGPU with a WebGL2
   fallback), the `Scene`, the render loop, resize handling and the Babylon.js
   side-effect imports both apps depend on. `createRenderer` creates no camera,
   light or mesh.
2. **The base scene** (ADR-0007) — the opt-in empty stage both apps open on:
   ground, fill and key light, sky colour and matching fog. A caller who wants
   it calls `createBaseScene`; the bootstrap never imposes it, and it creates no
   camera, because the game and the editor need different ones.
3. **The light rig** (ADR-0024) — `applyLighting` turns a world file's
   `lighting` block into a sun, a fill light, a shadow map that follows the
   player, a gradient sky, the scene's fog and a grading pipeline. Both apps
   call it with the same profile out of the same file, which is what makes the
   editor show an author the picture the player will get.
4. **The terrain renderer** (ADR-0020, ADR-0032) — a loaded height field placed
   where a zone's `terrain` says, with a generated multi-layer material that
   blends up to eight ground textures by two RGBA splat maps, together with a
   normal map, a metallic and a smoothness per layer, and one reflection of the
   sky the scene is lit under. It renders terrain; it does
   not decide where terrain is (that is world data) and it does not load the
   model (that is `@wov/asset-system`).
5. **Sound** (ADR-0062, ADR-0063, ADR-0065) — `createAudioEngine` owns Babylon's
   AudioV2 engine, its four buses, its one listener and the per-URL clip cache,
   and it plays a clip either at a place in the world or simply into your ears.
   `resolveSoundProfile` and `applyWorldSound` are the audio twins of
   `resolveLightingProfile` and `applyLighting`: a zone's bed, its emitters and
   its footstep banks are world data, resolved in one place and put into a scene
   by one function that both clients call. `terrain-surface.ts` answers which
   ground a footstep landed on, by asking the splat map on the CPU in the
   shader's own terms. It also owns the browser's autoplay policy, as a state
   machine that can tell "click anywhere" apart from three other kinds of
   silence.
6. **The third-person camera** (ADR-0008, spec §26) — mouse rotation with
   pointer lock, wheel zoom, a frame-rate independent follow lag and collision
   avoidance as an interface. Its arithmetic is a separate Babylon-free module,
   and so is the decision of whether a mouse movement counts.

The package owns **no gameplay state**: no entity, no player, nothing a system
reads back. Rendering never owns the game state (spec §25), which is why
`@wov/gameplay` is forbidden from importing this package
(`pnpm lint:boundaries`).

## Public API

| Export                                                                                      | What it does                                                                                                                                        |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createRenderer(canvas, options)`                                                           | `Promise<RendererHandle>`. Builds engine, scene and render loop for a canvas.                                                                       |
| `RendererHandle`                                                                            | `engine`, `scene`, `backend`, `config`, `disposed`, `onFrame`, `renderFrame`, `resize`, `dispose`.                                                  |
| `selectBackend(config, caps)`                                                               | Pure choice between `'webgpu'` and `'webgl2'`. Separated out so it is testable.                                                                     |
| `detectRenderCapabilities()`                                                                | What the current browser offers (`navigator.gpu`).                                                                                                  |
| `resolveRenderConfig(overrides?)`                                                           | Normalises a partial `RenderConfig`; clamps `resolutionScale` to `0.25…2`.                                                                          |
| `defaultRenderConfig`                                                                       | The defaults `resolveRenderConfig` merges into.                                                                                                     |
| `createBaseScene(scene, opts?)`                                                             | `BaseSceneHandle`. Adds ground, two lights, sky colour and fog to an existing scene.                                                                |
| `BaseSceneHandle`                                                                           | `ground`, `groundMaterial`, `ambientLight`, `sun`, `options`, `dispose` (restores the old sky/fog).                                                 |
| `resolveBaseSceneOptions(over?)`                                                            | Validates a partial base-scene description and derives the fog distances from the ground size.                                                      |
| `defaultBaseSceneOptions`                                                                   | The resolved defaults: 100 m ground, no shadows, linear fog in the sky colour.                                                                      |
| `applyLighting(scene, options?)`                                                            | `LightingHandle`. Puts the profile's sun, fill, shadow map, sky, fog and grading chain into a scene.                                                |
| `LightingHandle`                                                                            | `profile`, `sun`, `ambient`, `shadows`, `sky`, `pipeline`, `ssao`, `excludeFromShadows`, `excludeFromCasting`, `focusShadows`, `dispose`.           |
| `resolveLightingProfile(...profiles)`                                                       | Merges partial profiles left to right (world, then zone) into a complete one, validating colours and distances.                                     |
| `defaultLightingProfile`                                                                    | The resolved defaults: the late-afternoon sun a world with no profile is lit by.                                                                    |
| `SKY_VERTEX_SOURCE` / `SKY_FRAGMENT_SOURCE`                                                 | The gradient sky's GLSL, Babylon-free so it can be asserted in a unit test.                                                                         |
| `createThirdPersonCamera(scene, options)`                                                   | `ThirdPersonCameraHandle`. The camera of spec §26, following a `() => Vector3`.                                                                     |
| `ThirdPersonCameraHandle`                                                                   | `camera`, `settings`, `state`, `look`, `zoom`, `update`, `setObstacleQuery`, `attachControl`, `detachControl`, `dispose`.                           |
| `stepThirdPersonCamera(state, input, settings)`                                             | One camera frame as pure arithmetic: new state, position and focus. No Babylon.                                                                     |
| `createTerrain(scene, heightField, options)`                                                | `TerrainHandle`. Places a loaded height field and gives it the splat material.                                                                      |
| `TerrainHandle`                                                                             | `root`, `meshes` (what physics collides against), `material`, `textures`, `dispose`.                                                                |
| `createTerrainMaterial(scene, name, options)`                                               | The material on its own, for a view that draws ground without a physics world.                                                                      |
| `clearLoaderTransform(root)`                                                                | Clears the glTF loader's handedness transform (half turn **and** mirror) so a tile covers the metres the world file names.                          |
| `terrainFragmentSource(layers, splats, shadows?, surface?)` / `TERRAIN_VERTEX_SOURCE`       | The generated GLSL, Babylon-free so it can be asserted in a unit test.                                                                              |
| `terrainLayerSources(layers, resolve)`                                                      | World-file layers to loadable ones, through the caller's own URL resolver. One mapping for the game and the editor.                                 |
| `TerrainSurfaceShader` / `plainSurface(count)`                                              | Which layers have a normal map and whether the tile is facetted — part of the program's shape.                                                      |
| `sceneSkyGradient(scene)` / `setSceneSkyGradient`                                           | The sky a scene is lit under, as numbers the ground can reflect (ADR-0032). Written by `applyLighting`, read by the terrain material.               |
| `createAudioEngine(options?)`                                                               | `Promise<AudioSystem>`. The page's audio engine, its four buses, its listener and the clip cache (ADR-0065).                                        |
| `audio.playAt(url, place?)` / `audio.play(url, options?)`                                   | One clip at a place in the world, or one clip simply heard. Buffers are cached per URL and shared.                                                  |
| `audio.attachListener(node)` / `audio.unlock()` / `audio.statusLine`                        | Where the ears are, asking the browser for sound, and the one line saying whether there is any.                                                     |
| `distanceGain(falloff, d)` / `audibleRadius(falloff)`                                       | The Web Audio distance curves, and the radius past which a source is not worth a panner.                                                            |
| `nextAudioUnlockState(state, event)` / `summarizeAudioStatus(state)`                        | The autoplay state machine, and its status line. Pure.                                                                                              |
| `resolveSoundProfile(...profiles)` / `defaultSoundProfile`                                  | A world's and a zone's sound blocks merged into one complete description. Babylon-free, Zod-free (ADR-0062).                                        |
| `applyWorldSound(scene, options)`                                                           | `Promise<WorldSoundHandle>`. The bed, the emitters, the one-shots, the distance cull and `footstep(surface)`. The audio twin of `applyLighting`.    |
| `planEmitters(emitters, entities)`                                                          | Expands a `prefab` rule over a zone's entities, and reports what matched nothing and what was capped. Pure.                                         |
| `createTerrainSurfaceProbe(options)` / `dominantLayer(weights)` / `fitTileUv(pos, uv)`      | Which splat layer is under a point, under a uv fit measured off the mesh and verified (ADR-0063).                                                   |
| `createClipBag(clips, random?)` / `jitteredRate(jitter, random)`                            | Never the same footstep twice running, and a seeded pitch jitter a test can watch.                                                                  |
| `SKY_GRADIENT_FUNCTION`                                                                     | The sky as a function of direction, pasted into both the dome's program and the ground's.                                                           |
| `layerRepeats(size, tileSize)`                                                              | Metres across ÷ metres per repeat — the one place `size` and `tileSize` meet.                                                                       |
| `resolveThirdPersonCameraSettings(over?)`                                                   | Validates a partial camera description; rejects a pitch range that reaches the pole.                                                                |
| `defaultThirdPersonCameraSettings`                                                          | The resolved defaults: 6 m out (2…12), −17°…66° pitch, 0.12 s follow lag.                                                                           |
| `CameraObstacleQuery`                                                                       | `(probe) => number \| null` — the seam physics plugs into. Default `noCameraObstacles`.                                                             |
| `createCameraLookInput(sink, o?)`                                                           | The pointer-lock / drag / wheel state machine, without DOM types.                                                                                   |
| `wrapAngle`, `smoothingFactor`, `applyLook`, `applyZoom`, `wheelTicks`, `orbitDirection`, … | The individual camera functions, each testable on its own.                                                                                          |
| `shadowBasis(direction)` / `snapShadowFocus(focus, basis, texel)`                           | The shadow map's own axes and a focus point quantised onto its texels (ADR-0039). Pure arithmetic; `applyLighting` applies it by itself.            |
| `sunShaftsGate(...)` / `sunViewAngleDegrees(...)` / `sunAnchorPosition(...)`                | Whether the sun is near enough to the view axis for shafts, and where to park the stand-in that represents it (ADR-0042). No Babylon import.        |
| `hazeAt(fog, distance)` / `fogVisibility` / `rawFogFactor`                                  | How much haze sits at a distance on either curve, including the 2.2 encode Babylon's PBR path applies (ADR-0041). No Babylon import.                |
| `backdropTakesFog(fog, reach)` / `MAX_BACKDROP_HAZE`                                        | Whether a painted backdrop mesh is drawn hazed, or kept out of the fog because it would be a flat band of it (ADR-0034, ADR-0041).                  |
| `sceneFogCurve(scene)` / `fogModeCode(mode)` / `BABYLON_FOGMODE`                            | The curve a scene is fogged with, read off Babylon's own fields, and the mode code the terrain shader is sent.                                      |
| `TerrainHandle.update(surface)`                                                             | Writes the surface uniforms into the program the tile already has — a dial turned, not a tile rebuilt (ADR-0050). Throws on a layer-count mismatch. |
| `TerrainHandle.rebuildMaterial(options)`                                                    | A new material over the height field that is already loaded: a swapped texture, a replaced splat map, the facet switch (ADR-0050).                  |
| `applyTerrainUniforms(material, size, layerCount, surface)`                                 | The one place the layer uniforms are written, so a tile _built_ at metalness 0.4 and a tile _turned_ to 0.4 cannot drift apart.                     |

```ts
const renderer = await createRenderer(canvas, { resolutionScale: 1 });
const base = createBaseScene(renderer.scene, { groundSize: 100, skyColor: '#4d5b68' });
const camera = createThirdPersonCamera(renderer.scene, { target: () => player.position });
camera.attachControl(canvas); // pointer lock, drag-look and the wheel
const stop = renderer.onFrame(({ deltaSeconds }) => update(deltaSeconds));
// later
stop();
renderer.dispose(); // disposes the scene, and with it the base scene and camera
```

Base-scene options are plain data — numbers and `#rrggbb` strings, never Babylon
types — so the same description can come out of world JSON later. They are
validated rather than trusted: `Color3.FromHexString` answers black for anything
it cannot parse, so a typo would otherwise render as a lighting bug instead of
an error naming the field.

`createBaseScene`'s key light is created with `shadowEnabled = false`; it is
`applyLighting` that turns shadows on, and it takes the base scene's two lights
over rather than adding a second sun.

## The light rig

`applyLighting(scene, { profiles, sun, ambient, cameras })` is the only place a
sun, a shadow map, a sky or a grading pipeline is created (ADR-0024). Profiles
merge left to right — `[world.lighting, zone.lighting]` — and everything a file
leaves out comes from `defaultLightingProfile`. The profile type is structural
plain data, not `@wov/world-schema`'s Zod type: this package must stay free of
Zod and that one free of a renderer, the same arrangement `TerrainOptions`
already has with `TerrainDefinition`.

Three things about it are decisions rather than details:

- **One shadow map that follows the player, not a cascade.** A fixed ortho
  frustum of `shadows.distance` metres, parked behind the point the app names
  through `focusShadows(x, y, z)`. The engine must not reach into gameplay to
  find the player (spec §25), so something has to tell it where to look.
  That point is quantised onto whole texels of the map first (`shadow-snap.ts`,
  ADR-0039): a centre that slides in fractions of a texel re-rasterises every
  silhouette every frame, which is a shadow edge that crawls whenever the
  player moves. Babylon only snaps inside its cascaded generator, so this
  package does it — laterally, leaving the depth axis continuous.
- **Everything casts and receives unless excluded.** The map's render list is
  rebuilt from the scene each pass and new meshes become receivers as they are
  added, because a village arrives over several seconds and a rule applied per
  mesh as it lands is one `await` away from being applied to none of them. The
  sky, the ground and the editor's grid say they are out through
  `excludeFromShadows`.
- **Casting and receiving can be separated.** `excludeFromCasting` drops meshes
  from the map's render list and leaves them receivers, which is what a field of
  scattered grass needs (ADR-0027): thousands of thin instances rasterised a
  second time to darken four texels each, and shadowing one another into a dark
  mat. Which meshes those are is the caller's business, not the rig's.
- **The ground receives through its own shader.** `mesh.receiveShadows` is a
  define on a material Babylon generated, and the terrain's is hand-written
  (ADR-0020) — so `TerrainOptions.receiveShadows` compiles the lookup into the
  generated program instead, reading the shadow map's depth format off the map
  rather than assuming it.

`createRenderer` is asynchronous because WebGPU can only be initialised
asynchronously; the WebGL2 path resolves on the next microtask. The WebGPU
engine is behind a dynamic `import()`, so it stays out of the main chunk when
the browser gets WebGL2.

`options` extends `Partial<RenderConfig>` with `autoStart` (default `true`),
`resizeHost` (defaults to `window`, `null` disables it) and `createEngine` —
which is how the tests run the real bootstrap on a headless `NullEngine`.

## Third-person camera

`createThirdPersonCamera` follows a `() => Vector3` and updates itself on
`scene.onBeforeRenderObservable` (pass `autoUpdate: false` and call `update(dt)`
to drive it yourself). It goes down with the scene it was created in, because
`attachControl` leaves listeners on the document that the scene knows nothing
about.

Three seams are worth knowing about (ADR-0008):

- **Collision avoidance is a query, not an implementation.**
  `setObstacleQuery((probe) => free | null)` answers how much of the line from
  the pivot to the camera is clear; the default answers `null` for everything,
  so the camera behaves as it does outdoors until the physics chain supplies a
  Havok shape cast. On a hit the camera cuts in immediately and eases back out —
  a smoothed approach would let geometry cross the near plane and the player
  would see through the world.
- **The arithmetic is Babylon-free.** `third-person-camera-math.ts` has the
  yaw/pitch clamps, the exponential (frame-rate independent) follow lag, the
  zoom and the obstacle limit as pure functions, so the properties that make a
  camera feel right are pinned by plain Vitest rather than by looking at it.
- **Input is decoded separately.** `camera-input.ts` decides whether a movement
  counts — pointer lock, the held-button fallback for when pointer lock is
  refused, and cancelling a drag on `blur`. Only the twenty lines of
  `attachControl` touch the DOM, and those are covered by `pnpm smoke`, which
  drives a real wheel and a real drag over the game canvas.

## Sound

```ts
const audio = await createAudioEngine({ volume: 0.8 });
audio.attachListener(scene.activeCamera); // the camera, not the player — see below
await audio.playAt(clipUrl, { node, loop: true, minDistance: 1.5, rolloffFactor: 1.6 });
await audio.play(footstepUrl, { playbackRate: 1.04 }); // no place: simply heard
button.addEventListener('click', () => void audio.unlock());
element.textContent = audio.statusLine; // "sound: click to enable" / "sound: on"
```

Create it **once per page**, next to the physics backend, and never await it in
the frame loop: a clip that has not arrived should delay sound, not walking. It
is not a scene member — a browser has one `AudioContext` worth having and its
listener is one listener — which is why this hands back a handle instead of
writing into a scene the way `applyLighting` does.

**The listener follows the camera, not the player.** In third person the picture
is the camera's, and a listener at the capsule's feet puts a brazier that is on
screen to your left into your right ear the moment the camera swings round.
**Footsteps are not spatialised at all**, for the same reason in the other
direction: they come from the listener's own feet, and panning them at the
capsule puts your own steps behind you whenever the camera orbits.

**A zone's sound is world data (ADR-0062).** `applyWorldSound` is what a client
calls with a resolved profile; it never reads a file and never decides what a
world sounds like.

```ts
const profile = resolveSoundProfile(world.sound, zone.sound);
const sound = await applyWorldSound(scene, {
  audio,
  profile,
  clipSource: (path) => ({ url: storeUrl(path), fallbackUrl: silenceUrl }),
  entities: zone.entities, // so a `prefab` emitter rule has something to match
  nodeOf: (id) => scene.getTransformNodeByName(`entity:${id}`),
  listener: scene.activeCamera,
  listenerAt: () => scene.activeCamera.globalPosition,
});
sound.footstep('gravel'); // once per stride, from the app's own accumulator
```

**Which surface a footstep landed on comes from the splat map (ADR-0063),** read
on the CPU in the shader's own channel order and under a uv fit measured off the
tile's own vertices. A fit that does not hold reports `unmapped` and the caller
falls back to one surface — a plain footstep rather than a confidently wrong
one.

**AudioV2, not the legacy `Audio/` engine**, and **nothing is added to
`side-effects.ts`** — AudioV2 registers nothing on `Scene`, so an entry there
would be bundle weight of exactly the kind the mesh-builder note below warns
about. The modules are imported by `src/audio.ts` and nowhere else.

**Autoplay is four different silences, not one.** `audio-unlock.ts` is a pure
state machine because the audio context reads `suspended` both when the page has
never been clicked and when something interrupted playback afterwards — and a
"click anywhere" prompt is right for the first and useless for the second. What
tells them apart is whether a gesture has ever reached the page, which is why
the machine has memory. A gesture never reports success by itself: `resumeAsync`
can still fail, and the status moves to `unlocked` only when the engine says it
is running.

**`audio-falloff.ts` is arithmetic the browser also does, and that is the
point.** The panner applies the curve; nothing else can _ask_ about it.
`audibleRadius` inverts each of the three Web Audio distance models so a
distance cull has a number, and a test pins that inversion against the curve it
came from.

One measured caveat, found in a browser rather than reasoned about: Babylon's
`sound.spatial` is a **mirror** initialised from its own defaults and never
re-read from the panner sub-node. The creation options do configure the panner —
the sub-node reads back `inverse / 1.5 / 1.6` for a brazier — but the mirror
still says `linear / 1 / 1`. `playAt` therefore writes the resolved falloff
through the mirror once after creating the sound, so that asking a sound how far
it carries gives the answer you can hear.

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

No dependency was added for sound: AudioV2 ships inside `@babylonjs/core`.

**Ownership.** Core maintainers.
