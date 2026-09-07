# ADR-0053: A footstep asks the splat map what it landed on

- **Status:** accepted
- **Date:** 2026-09-07
- **Deciders:** `feat/ton`

## Context

A footstep that is always gravel is not a footstep feature. The village's ground
is one adaptive tile with six painted layers — gravel, two rocks, grass, rough
rock and moss — and a player crossing from the square onto the grass has to hear
that they did.

So something has to answer _which layer is under the player's feet_, four times
a second, on the CPU, without becoming a second ground query. ADR-0014 allows the
client exactly one, and the physics hit it already has does not know about splat
weights: the collision mesh is a triangle soup with no material behind it.

Three ways to get the answer were considered.

**A second raycast against a specially tagged surface.** Rejected outright: a
second ground query is precisely what ADR-0014 forbids, and it would have to
agree with the first one about where the ground is.

**`Texture.readPixels()` on the splat maps.** This is a GPU readback. It stalls
the pipeline and hands back a promise per call, so a footstep would be waiting on
the render thread.

**Decode the splat maps on the CPU, once, and sample them.** The maps are
ordinary PNGs the terrain material has already downloaded; fetching them again
costs a decode of about a millisecond for 1024², paid once, after the models,
on a path nobody is waiting for.

The third one is right, and the whole difficulty is in one word: _sample them_
**how**.

## Decision

**The surface is the argmax of the splat weights at the player's position, read
in the shader's own terms, under a uv fit that is measured off the mesh and
verified.**

Four steps, in `packages/engine/src/terrain-surface.ts`:

1. **Decode.** `fetch` → `createImageBitmap` → `OffscreenCanvas.getImageData`,
   for each of the one or two splat maps.
2. **Fit the uv, do not assume it.** The shader samples `texture2D(uSplat0, vUv)`
   with the height field's **own** `uv` attribute — unscaled, unlike the layers,
   which multiply by `uLayerScale`. This project does not assume a model's
   coordinates. So the probe reads the mesh's `position` and `uv` buffers, fits
   `u = a + b·x` and `v = c + d·z` by least squares, and then measures the
   **largest** error over every vertex it fitted to. A maximum and not a mean:
   a tile whose uv is affine everywhere except along one seam has a fine mean
   and a footstep that is wrong along that seam. A residual over
   `UV_FIT_TOLERANCE` makes the probe `unmapped`, and footsteps fall back to the
   profile's `defaultSurface` with the reason on the sound row.
3. **Blend and pick.** Sample both maps at that uv, take the weights in the
   shader's own channel order (`weights0.rgba` = layers 0–3, `weights1.rg` =
   layers 4–5), and take the argmax. Below a total of `0.0001` the answer is
   layer 0 — the same fallback the generated GLSL compiles in, and
   `terrain-surface.test.ts` pins the constant against
   `terrainFragmentSource(4, 1)` so the CPU and the GPU cannot drift apart in
   silence. A tie goes to the lower layer: arbitrary, but _stated_ arbitrary, or
   a 50/50 boundary would flicker between two banks every step.
4. **Map layer to sound.** `layerSurfaces[layer]` → surface id → bank → clips.

Nearest texel, not bilinear: this feeds an argmax, and interpolating four texels
before taking the largest of six sums changes nothing anyone can hear while
costing four times the reads. `v` is flipped once, because texture space runs up
and image rows run down.

Off the tile, the probe answers `null` rather than a wrapped texel. A player can
stand beside the ground the splat describes, and that is not an error.

## Consequences

**Measured, in the browser, on the real village tile.** The probe reports
`6 layers from 2 splat map(s), uv fit ±2.3e-15` — the village's height field is
exactly affine in x and z, so the fit is not an approximation on this tile at
all. Asked at 841 points on a 10 m grid over the whole 300 m tile, it answers
**546 gravel and 295 grass**. That is the whole feature in one number: a village
where every footstep is gravel passes every other assertion in
`tooling/smoke/village-sound.spec.ts`, and fails that one.

**Resolution puts a floor on accuracy, and the number belongs here rather than
in a bug report.** The village splat is 1024² over 300 m: **29 cm of ground per
texel**. A step can therefore flip a surface one stride early at the edge of a
path. That is accepted.

**Wooden paths will not fire yet.** The 469 plank pieces of the village are
_entities_, not a terrain layer, so no splat channel describes them and `wood`
cannot be selected in this zone however good the probe is. The physics hit
already knows which mesh was struck; a `surface` on the prefab is the change that
answers it, and the `wood` and `water` banks are imported and authored now so
that change is data only.

**The splat maps are downloaded twice**, once by the terrain material and once by
the probe: 618 KB on this village. The design expected the second to be an
HTTP-cache hit, and on the development asset server it is not, because that
server sends no cache headers — deliberately, since an importer rewrites the
files under it. This is a deployment question (a cache header on the asset host)
and not one to answer by caching a file that changes. It is paid after the models
are on screen, so nothing waits for it.

**One mesh is fitted, the largest.** The village's ground is a single adaptive
tile and the format allows several. Fitting each and choosing per query would be
a matrix inverse per mesh per footstep for a case that does not exist; the tile
does not move (ADR-0035), so its inverse world matrix is computed once at load
and the per-footstep cost is one vector transform, two texel reads and an argmax.
