# ADR-0043: The village control map was turned one flip short, and the path gets its own image back

- **Status:** accepted
- **Date:** 2026-09-07
- **Deciders:** project maintainers

## Context

The author's report on the village ground was three sentences, of which two are
about this ground: _"the ground textures in the village itself are still a long
way off"_ and _"there are rocks and stones missing"_. The third — _"the colours
are matter in the original, ours look oversaturated"_ — belongs to the grade and
is a different branch.

ADR-0020 §orientation and ADR-0032 §1 both state that the export's control maps
are mirrored on the anti-diagonal relative to the height field, and both back it
with the same measurement: over the eight ways to lay a square map on the tile,
average the terrain's own slope under the rarest channel — the one covering
0.14 % of the tile at 73° mean slope, which can only be a cliff face — and take
the placement where that average stands out.

Re-run against the tile and the maps the store actually shipped, that
measurement says something different from what the pipeline was doing:

| Placement                       | Mean gradient under the cliff channel |
| ------------------------------- | ------------------------------------- |
| identity — what the shader read | 0.96                                  |
| **vertical flip**               | **4.28**                              |
| flip u                          | 0.77                                  |
| flip both                       | 0.66                                  |
| transpose                       | 1.84                                  |
| transpose + flip v              | 1.06                                  |
| transpose + flip u              | 0.64                                  |
| transpose + flip both           | 0.62                                  |

against a tile mean of 0.67 and a 99th percentile of 3.93. The winner is not
close, and it is not what the renderer was sampling. So ADR-0032 measured the
right placement — its per-entity numbers in §1 reproduce exactly under the
flipped map and not under the unflipped one — and
`tooling/asset-pipeline/terrain-import.ts` shipped the other one. The village
was painted mirrored about the middle of the tile: the paths lay where the
meadow belongs, the gravel where the paths belong, and the cliff channel on
ground of ordinary steepness.

Nothing caught it because nothing could. A mirrored landscape is still a
landscape: every hash matched, every schema passed, and the picture looked like
a plausible village with oddly placed dirt.

Once the map is the right way up, one decision made under the mirrored paint has
to be asked again. ADR-0032 §1 identified channel `0.R` as the path layer — it
carries 3.4 to 4.1 times as much weight under the stone, brick and wooden path
props as under the bushes — and gave it the export's second, paler
pebbles-and-sand image. An amendment then took that image back out, because on a
mirrored map it landed in the middle of the meadow and read as a whitish sheet.

## Decision

### 1. The turn is a quarter turn clockwise, and it happens in the import

`rotateQuarterTurn` in `tooling/asset-pipeline/png.ts` replaces
`mirrorOnAntiDiagonal`, which no world used any more once this changed. It is
the same mirror composed with a vertical flip:
`mirrorOnAntiDiagonal(in)[r][c] = in[h-1-c][w-1-r]`, flipped in v, is
`in[h-1-c][r]` — a plain quarter turn clockwise.

Fixed in the **import** and nowhere else, so the stored map is right in its own
right and every reader — the game, the editor viewport, a future tool — gets it
without a flag to remember. The alternative, `texture.invertY = true` on the two
splat textures in `createTerrainMaterial`, produces the same pixels and leaves
the stored bytes wrong for anyone who opens them.

This has to stay a one-sided fix. Correcting the import **and** setting a
sampler flag cancels out exactly, and the ground goes back to what it was while
the change looks like it did nothing.

### 2. `pnpm validate:assets` re-measures it on the stored bytes

`measureChannelSlope` in `tooling/asset-pipeline/splat-orientation.ts` is the
measurement above as a function, and `validate-assets.ts` runs it over
`village-splat-b.png` channel 0 against `terrain-village1.glb` whenever a store
is reachable:

> the weighted mean gradient under the cliff channel must exceed the tile's own
> 95th percentile.

4.28 against 2.38 passes; the map that shipped before scores 0.96 and fails. A
hash says the bytes did not change; it does not say they were ever right, and
this is the only check in the repository that asks the second question. It runs
only when `WOV_ASSET_STORE` points somewhere, like the rest of the private half.

### 3. The path layer gets the second gravel image back

Layer 0 is `textures/terrain-gravel-path.png` again — the export's paler
pebbles-and-sand image — while layer 3 keeps `terrain-gravel.png`. Two layers
pointing at one file was a data smell that only survived because the paint was
in the wrong place: on the corrected map the channel lands on the paths the
props stand on, and the image reads as a gravel road between the stone kerbs
rather than as a sheet across a meadow.

Measured on the `floor` view's ground band, the change is brighter without being
more colourful — mean luma 52.9 → 73.9 with mean chroma 21.7 → 20.9, and the
share of the band below level 40 falling from 47.3 % to 25.2 %.

Editor parity needs nothing: `layers[].texture` is `assetPathOf('texture')` in
`@wov/world-schema`, so the Zone tab's `Terrain` half already draws it as a
picker over the store's images (ADR-0033). This swap is a thing a person does in
the editor and a thing a world file records; no script has a capability the
editor lacks.

### 4. `floor`, a view that actually shows the ground

`square` spends most of its pixels on a palisade and `slope` on a bush. A change
to the ground that repaints the whole village moves `square` by 9.7 mean pixel
levels, which is not a number anyone should be asked to judge a ground by.
`floor` stands on the village's own floor, pitched 32° down at the paths between
the houses, and moves by 17.5.

## Alternatives considered

| Alternative                                            | Why not                                                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invertY = true` on the splat textures in the material | Same pixels, but the stored map stays wrong for every other reader, and the correction hides behind a sampler flag nobody looks at.                           |
| Flip in the shader's UV                                | Same objection, plus the editor and the game would each have to remember it, and the two could drift.                                                         |
| Leave the map and repaint by hand                      | The world is hand-crafted, but the paint is authored data, not ours. Repainting it would be inventing a village.                                              |
| Give the layers dielectric surfaces in the same change | Measured and rejected here — see below. It needs the sun back down, and the sun is in the `lighting` block another branch owns.                               |
| Decode the layer albedo to linear in the same change   | Measured and rejected here for the same reason: it is right, and on its own it halves the ground's brightness.                                                |
| Add a per-layer colour tint to the schema              | There is nothing to tint with. All 18 authored layer assets carry `DiffuseRemapMin 0,0,0,0`, `DiffuseRemapMax 1,1,1,1` and `Specular 0` — the identity remap. |

## Two faults measured here and deliberately not landed

Both are real, both are in this ground, and both need a light the `lighting`
block owns. They are written down with their numbers so the branch that owns the
grade can take them without measuring again.

**The ground layers are metals.** Layers 0, 1 and 3 carry metallic 0.75–0.85 and
layer 2 carries 0.5, faithfully copied from the authored layer assets and
byte-for-byte what they say. `terrain-shader.ts` computes
`diffuse = albedo × (1 − metallic)`, so 82 % of the village floor throws away
half to five sixths of its colour and gets it back only as reflected analytic
sky. Setting all six layers to metallic 0 through `pnpm terrain-surface` moves
the `floor` band from luma 52.9 to **80.7** and its below-40 share from 47.3 % to
19.4 % — but its mean chroma from 21.7 to **34.7**, because ADR-0032 §4 raised
this zone's sun from 2.3 to 3.3 and its fill from 0.62 to 0.85 specifically to
pay for the diffuse the metallic ate. Landed alone it hands the author the same
complaint with the sign reversed: a ground that is too bright and more
saturated, not less.

**The ground is shaded in gamma space.** `loadTexture` builds plain `Texture`
objects and the generated GLSL uses `texture2D(...).rgb` directly as albedo,
while every glTF model in the frame goes through a PBR material whose base
colour the loader marks as gamma space and whose shader decodes it — and the
post-processing pipeline that follows assumes linear input and re-encodes at the
end. The terrain is the one surface in the frame that skips the decode. Adding
`pow(texel, vec3(2.2))` to every layer albedo fetch was implemented and
rendered: the `floor` band goes to luma **28.4** with chroma 9.2 on its own, and
to luma **35.7** with chroma 11.1 combined with dielectric layers. Both are far
too dark to ship without the sun coming back up, which is why the change was
taken out again rather than left in. It is the lowest-chroma frame of the four,
which is the direction the author asked for.

The handover, in one line: **metallic 0 on all six layers plus the sRGB decode
wants roughly the light ADR-0032 §4 took away, and the pair of them together is
the matte, low-chroma ground the reference shows.**

## Consequences

**Positive.** The village's paths are where the props that mark them stand, the
cliff channel is on the cliffs, and the ground the reference calls a path reads
as one. The store holds a control map that is right on its own terms, and a
check re-measures that rather than trusting a hash.

**Negative.** The whole village ground is repainted, mirrored about z = 150.
Every screenshot of it, and every note about "the gravel near the well", is now
wrong — a bigger version of the warning ADR-0032 already gave for the layer
order. `village-splat-a.png` and `village-splat-b.png` change their bytes,
sizes and hashes, so every other store copy holds a stale map until it is
re-imported, and two worktrees that re-imported at different moments will draw
different villages until they agree.

**Follow-ups.** The two faults above, once the grade is settled. Whether the
base grass layer should be `terrain-grass-b.png` rather than
`terrain-grass-a.png` is still open and still unsettled by the splat data —
grass-a's mean is R54 G54 B2, so the meadow cannot be the reference's grey-green
while it is that image, but 60 % of the village floor is that layer and the swap
must be an A/B against a reference frame, not a texture mean.
