# ADR-0024: Lighting is world data, drawn with one following shadow map

- **Status:** accepted
- **Date:** 2026-09-06
- **Deciders:** project maintainers

## Context

Since ADR-0022 the game draws the authored village: 1216 entities from 139
models on a 300 m tile. It drew them under the Phase 1 stage rig — one
directional light straight down at intensity 1.1, a bright hemispheric fill, a
grey-blue clear colour, linear fog, and nothing else. Measured on the village
square at `?spawn=166,150` that is a frame with a luminance standard deviation
of 0.079 and 18.5 % of its lower two thirds in anything darker than the middle
of the picture: a scene with no shadow anywhere, whose only dark pixels are the
faces that happen to point away from the light.

The reference the project is aiming at is a low warm evening sun with long soft
shadows, a darker fill, a blue sky warming towards the horizon, distance haze
and a graded frame. Three questions had to be answered before any of that could
be written:

1. **Where do the numbers live?** A time of day is a look, and a look is
   authored (agent rule 9). It is also per place: an interior is not lit like
   the square outside it.
2. **How does the ground receive a shadow?** The terrain material is
   hand-written GLSL, because the splat blend has to be (ADR-0020).
   `mesh.receiveShadows` is a define on a material Babylon generated, and means
   nothing to one it did not.
3. **What can the frame budget pay for?** Shadows are a second pass over every
   caster, every frame (spec §38).

## Decision

**Lighting is an optional `lighting` block in the world format, on a world and
on a zone**, with every group and every field optional (`schemaVersion` 2 → 3,
`packages/world-schema/src/lighting.ts`, migration `v2ToV3`). Zone beats world,
group by group and field by field; anything unstated falls back to
`defaultLightingProfile` in `@wov/engine`. `content/worlds/village1.json` states
the evening of the reference picture.

**One function applies it in both clients**: `applyLighting(scene, …)` in
`packages/engine/src/lighting.ts`, called by `apps/game/src/scene.ts` and by
`apps/editor/src/scene/viewport.ts`. The editor no longer has a light rig of its
own. It creates the sun and the fill, the sun's shadow map, a gradient sky box,
the scene's fog and a `DefaultRenderingPipeline`, and hands them all back on a
handle that can put the scene back the way it was.

**Shadows are one `ShadowGenerator` that follows the player**, not a cascade:
a fixed ortho frustum of `shadows.distance` metres, parked behind the point the
app names through `focusShadows`. The ground samples it through GLSL generated
alongside the splat blend (`terrain-shader.ts`), in the same terms Babylon's own
shadow includes use — `(z + depthValues.x) / depthValues.y`, the depth the
caster pass stored.

**Everything casts and receives unless it is excluded.** The shadow map's
render list is rebuilt each pass from a predicate over the scene, and new meshes
are made receivers as they are added. Three things say they are not taking part:
the sky, the ground (it receives through its own shader and must not shadow
itself) and the editor's grid.

## Alternatives considered

| Alternative                                             | Why not                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lighting constants in `@wov/engine`, one look for all   | An interior and a square cannot differ without an `if` in TypeScript, which is world data in code (agent rule 9).                                                                                                                                                                                                   |
| `CascadedShadowGenerator`                               | Its map is a `sampler2DArray` with a cascade to select per pixel, and the ground's lookup is hand-written — the terrain shader would have to reimplement cascade selection, in GLSL 3 only. A third-person camera on a village needs one crisp band, not correctness at 400 m. Reconsider when view distance grows. |
| Babylon's `shadowsFragmentFunctions` include in terrain | Its PCF paths bind a `sampler2DShadow` comparison sampler that `ShaderMaterial` has no route to, and its uniforms are named for the light-index binding a `ShaderMaterial` never does. Sixteen lines of our own GLSL against a set of includes we would be binding by hand anyway.                                  |
| `addShadowCaster` per mesh after each load              | A village arrives over several seconds, one prefab at a time. A rule applied per mesh as it lands is one `await` away from being applied to none of them, and looks exactly like a scene with no shadows. A list that is only added to also holds every mesh a zone change disposed.                                |
| A panorama skybox from the scene bundle                 | It needs an asset, so a clean clone and a machine with the private store would see different skies (ADR-0015), and the fog would have to match a colour someone sampled out of an image. A gradient's horizon is a number the fog is tied to.                                                                       |
| SSAO2 on by default                                     | Measured: see below. It is in the profile and off.                                                                                                                                                                                                                                                                  |

## Measurements

Chromium 1280 × 720, WebGL2 through ANGLE/Vulkan on a desktop GPU, village
square at `?spawn=166,150`, the same camera in every row, all rows taken back to
back. The browser calls the frame at 60 Hz, so **16.7 ms is the floor this
measurement can see**: a row at the floor is not "free", it is "cheaper than one
frame's worth of headroom".

Before (`main`, the Phase 1 rig) against after (this change):

|                        | before  | after     |
| ---------------------- | ------- | --------- |
| draw calls             | 182     | 526       |
| triangles per frame    | 487 307 | 1 306 607 |
| frame time             | 16.8 ms | 26.1 ms   |
| luminance std. dev.    | 0.079   | 0.148     |
| dynamic range (p5–p95) | 0.228   | 0.412     |
| pixels in shade        | 18.5 %  | 32.4 %    |

The 344 extra draw calls and 819 300 extra triangles are the shadow pass. What
each part of the profile costs, same batch:

| configuration                         | frame time | draw calls | triangles |
| ------------------------------------- | ---------- | ---------- | --------- |
| the shipped profile (2048 map)        | 25.8 ms    | 526        | 1 306 607 |
| the same, 1024 map                    | 28.9 ms    | 526        | 1 306 607 |
| the same, grading chain off           | 26.0 ms    | 520        | 1 306 607 |
| the same, shadows off                 | 16.7 ms    | 189        | 487 319   |
| the same, SSAO2 on (12 samples, 75 %) | 37.1 ms    | 713        | 1 793 914 |

Three things follow, and each decided something:

- **The shadow pass is bound by the caster geometry, not by the map size.**
  1024 measured no faster than 2048 — the difference is run-to-run noise, and
  the wrong way round. So the map is 2048 over 120 m, 5.9 cm of ground per
  texel, because the resolution is nearly free and the sharpness is not.
- **The grading chain costs less than this measurement can resolve** on a GPU
  (26.0 against 25.8 ms), which is why it is on by default and why every part of
  it is still a field in the profile.
- **SSAO2 costs a full geometry-buffer pass**: 187 more draw calls, 487 000 more
  triangles and 11 ms — more than the shadow map — for occlusion this stylised,
  flat-shaded art barely shows. It stays off. It is in the profile so that
  turning it on is a line in a world file rather than a code change.

**In a software rasteriser the grading chain, not the shadow map, is what
hurts.** `pnpm smoke` runs headless Chromium without a GPU, and there the
shipped profile takes a frame from roughly a tenth of a second to more than a
second — enough that half a second of a held key advances the fixed-step
simulation by three steps and "the capsule walks" fails for a reason that has
nothing to do with walking. Switching the shadow map off alone did not fix it;
the HDR pipeline's full-screen passes did. So the game's smoke tests, which are
all about wiring, open the client with `?flat=1`, and the rig has a test that
measures nothing else (`tooling/smoke/lighting.spec.ts`). Two query switches
exist for that and for screenshots: `?flat=1` replaces the world's profile with
a flat noon, `?shadows=off` keeps it and turns off only the shadow map.

Three things were tried and rejected on measurement rather than on taste:

- **Culling the caster list to the shadow box.** Babylon does not frustum-cull a
  shadow map's render list, so narrowing it to the box the map covers looks
  free. At the village's density it removed 1 caster of 2581 — they all stand
  within 140 m of each other — and reading a bounding sphere off every mesh
  every pass cost 40 ms a frame in world-matrix updates.
- **`receiveShadows` on the instanced meshes.** It is refused with a console
  warning and no effect: an `InstancedMesh` shares its source's material and the
  flag is a define on that material. Ninety copies of one fence stood in a scene
  with shadows and took none. The source lives in the asset container rather
  than the scene, so the rig reaches it through `sourceMesh`.
- **Contrast as the smoke test's witness.** The obvious claim — "shadows make
  the histogram wider" — is false on this frame: a shadow pulls sunlit surfaces
  down towards the ambient level, so the standard deviation went _down_, 0.131
  against 0.138. The test compares the same camera's frame with and without the
  map pixel by pixel instead, which is exact: shade can only take light away.

## Consequences

**Positive.** A world states how it is lit and the editor shows the author the
same picture the player gets, out of the same file through the same function.
Turning a feature off is a field, not a branch: `?flat=1` applies a flat-noon
profile so a screenshot can be compared against one with no rig at all, which is
what `tooling/smoke/lighting.spec.ts` measures. Bias, map size, shadow distance
and the whole grading chain are tunable per world without a build.

**Negative.** The shadow pass roughly doubles the draw calls and triangles of a
village-sized zone. The ground's shadow lookup is a second implementation of
something Babylon already has, and it has to keep agreeing with
`shadowMapVertexMetric` — `terrain-shader.test.ts` pins the expression. The
shadow map covers a box around the player, so a shadow further away than
`shadows.distance` does not exist; at 120 m on a 300 m tile the edge falls
inside the fog.

**Follow-ups.** Cascades when the view distance grows past one tile. A time of
day that moves, once there is a reason for it to — the profile is already the
shape that would be interpolated. Grass tufts and emissive props are content,
not lighting: the bloom threshold is set low enough that they will glow when
they exist.
