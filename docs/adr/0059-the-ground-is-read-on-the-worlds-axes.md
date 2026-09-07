# ADR-0059: The ground is read on the world's axes

- **Status:** accepted
- **Date:** 2026-09-07
- **Deciders:** world pipeline

## Context

ADR-0045 measured the village's ground dressing and found it buried: over 5 249
in-tile placements the gap between a prop and the surface under it ran p05
−0.84 m, median −0.12 m, p95 +1.03 m, 89 % of it negative, and 77 of 5 273
placements showed less than 5 % of themselves. It named the ground as the
suspect — "the ground sits too high" — and the leading hypothesis was the
import's decimation: `height-field.ts` keeps every second row and column, so a
dip on an odd index is lost while the ridge beside it survives, and a lost dip
reads as ground that is too high.

Three things were measured before any code was written, and they take that
hypothesis apart.

**Decimation cannot be it.** The drawn adaptive tile reproduces the authored
513² raster to a mean of 1.6 cm with a worst case of 0.50 m, and the error is
exactly zero at every even/even index and symmetric about zero elsewhere. It is
an order of magnitude too small to make a −0.12 m median and it has no sign to
give one. ADR-0037 had already put the same question to four different grounds —
the adaptive tile, the full 513² raster, the export's own raster and the 257²
reduction — and got the same answer from all four, agreeing to 0.02 m over
22 500 probes.

**Most of the headline was our own output.** 4 032 of the 5 249 in-tile
placements are scattered vegetation (ADR-0025), placed by `pnpm scatter` onto
this very height field. They are 99.6 % negative by construction and witness
nothing about it. Over the 1 241 authored placements the median gap is −0.04 m.

**The disagreement is a field, not an offset.** Props of different families
standing within 2 m of one another agree on their residual; the residual varies
over tens of metres and no vertical offset, tilt or half-cell shift removes it.

So the question became: which reading of a square raster do the props actually
stand on? For each of the eight ways to turn or mirror a square, 374 authored
placements from 34 families of flat-bottomed ground dressing were seated on it,
and each family's spread about its own median measured. Scattered entities were
excluded, because a tuft placed against a ground cannot testify about it.

| reading                     | mean abs. deviation | IQR         |
| --------------------------- | ------------------- | ----------- |
| as shipped                  | 0.283 m             | 0.393 m     |
| mirror in x                 | 0.471 m             | 0.697 m     |
| mirror in z                 | 0.704 m             | 0.611 m     |
| half turn                   | 0.667 m             | 0.841 m     |
| **axes swapped**            | **0.068 m**         | **0.062 m** |
| mirror on the anti-diagonal | 0.721 m             | 0.827 m     |
| quarter turn                | 0.755 m             | 0.695 m     |
| three-quarter turn          | 0.441 m             | 0.560 m     |

The raster is not near-symmetric, so this is not an artefact of a tile that
reads alike either way round. And the swap has an independent witness that
cannot have been fitted to it: the ring of 100 cliffs of ADR-0037, which is not
scattered and stands at the rim of the tile rather than in the village.

The cause is that the export writes its raster and its scene placements in two
different frames, and the difference is one reflection. The import already
absorbs half of it — a placed model is mirrored in x on the way in
(`packages/content-build/src/scene-import.ts`) — and the ground was taken as it
came, which leaves the two a quarter turn apart. The village sits near the line
where the two readings agree, which is why a 0.3 m error there read as ground
dressing a paving stone too deep, and why the tens of metres out at the rim went
unremarked: nothing was standing there to complain.

A second, unrelated defect turned up on the way. The two rasters the world file
names ship in **different coordinate frames**: the export's own copy of the
ground is recentred by the general import and spans −150…150, while every tile
`terrain-import.ts` rebuilds spans 0…300. Both are declared `position [0,0,0]`,
`size [300,300]`. Nothing is broken today only because `heightAtOnTile` maps
through the tile rectangle fractionally; any caller that reads the samples
raster in world coordinates is 150 m off in both axes and gets a plausible wrong
number rather than an error.

## Decision

**The height-field import turns the raster onto the world's axes, and every
raster the world file names is rebuilt in one frame.**

- `transposeGrid` in `tooling/asset-pipeline/height-field.ts` is the arithmetic:
  a pure index swap, origin and step travelling with their axis.
- `decimateHeightField` applies it once, to every tile it builds, named by
  `HEIGHT_FIELD_ORIENTATION` beside the `SPLAT_ORIENTATION` that records the
  same class of fact about the control maps.
- `heightSamples` stops pointing at the export's recentred copy and points at
  `terrain/terrain-village1-samples.glb`, rebuilt here at the full 513² in the
  same 0…300 frame as the drawn tile. The tools and the renderer now stand on
  one ground in one frame.
- `meshVsGrid` measures what is left between a tile and the raster it came from,
  the importer prints it, and a test asserts it.

No placement moves. Nothing in the `entities` arrays is touched.

## Alternatives considered

| Alternative                                                                   | Why not                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Re-cut the height field at a finer resolution, or undecimate it               | The measurement says the decimation error is 3 cm at p05/p95 of the seating distribution and unbiased. It cannot produce the effect, and paying 86 % more triangles to move a number by 3 cm buys nothing.                        |
| Turn the placements instead — make the scene import's x-mirror a quarter turn | Identical seating, and it rewrites the `position` of every authored entity. Hand-authored placements are the truth; the ground is generated, so the generated side is the side that moves.                                        |
| A vertical offset, a tilt, or a half-cell sampling shift                      | All three were fitted and all three fail: the residual is a spatial field with a correlation length of tens of metres, and the best rigid shift over ±8 m improves the fit by 11 % with no minimum at a half cell or a whole one. |
| Keep `heightSamples` pointing at the recentred copy and transpose it in place | The general import is explicit that it touches the container and never the geometry. A grid transpose is geometry, and putting it there would also leave the two rasters in two frames.                                           |
| Drop the adaptive tile so the drawn ground and the raster agree exactly       | The disagreement is 8.7 % of the tile's vertices by at most 0.39 m, all of it at deliberate seams; removing it costs 86 % more triangles. Bounded and asserted is the better trade.                                               |

## Consequences

**Positive.**

- The cliff ring of ADR-0037 seats. 81 of 100 within half a metre of the ground
  before, **100 of 100** after; 18 floating past 3 m before, **none** after;
  worst gap +27.22 m before, **−0.81 m** after. It is not waiting on a
  neighbouring tile, a zone, or a streaming decision.
- The buried ground dressing of ADR-0045 comes out. Of the 77 placements showing
  less than 5 % of themselves, 14 were never over the tile at all — clouds and
  the two painted shells, which are the backdrop category of ADR-0031 and cannot
  be measured this way. Of the 63 that were real, **61 come out**: two remain,
  `environment-sm-env-stonewall-03_0069` at (196, 192) and `…_0124`.
- Authored village placements standing within half a metre of their ground:
  900 of 1 229 → **1 008 of 1 229**. Zone `interiors`: 14 buried → **0**.
- It costs nothing to draw. The tile comes out at the same 148 228 vertices and
  **281 216 triangles**, with the same 25 024 of 65 536 cells kept at the source
  resolution — the ground is the same shape, read the right way round.
- The two rasters answer the same world coordinates in the same frame, and the
  importer prints how far the drawn tile stands from the authored samples.

**Negative.**

- **The 4 032 scattered entities of ADR-0025 must be re-scattered, and this
  change does not do it.** `pnpm scatter` baked their `y` from the old reading,
  so against the corrected ground they run from −5.7 m to +5.5 m at p05/p95 and
  1 181 of them are underground. Re-running scatter from its seed is regenerated
  output and the correct fix; it is also 4 032 entities changing in the world
  file, which is the author's call and not this change's (ADR-0025 §persisted
  output, ADR-0036's byte-for-byte re-import promise has to be re-checked with
  it).
- **The splat orientation is coupled and was derived against the old reading.**
  `SPLAT_ORIENTATION` was chosen by correlating a control map's rarest channel
  against the slope of the ground as it was then read. That ground has now
  turned, so the constant has to be re-derived — and it is being changed on
  another branch at the same time. If both branches correct independently the
  two corrections cancel. They must be merged together and re-measured once, on
  one ground.
- The physics ground probe is one-sided: `GROUND_PROBE_HEIGHT = STEP_HEIGHT =
0.45` in `apps/game/src/physics-ground.ts`, so ground that drops is free and
  ground that rises more than 0.45 m under a walking player reports no ground at
  all. The corrected surface rises past that in places. No test covers it.
- The perf views of `tooling/perf/views.ts` sit on different ground now, and the
  file's contract is that all four are level enough for the capsule to stand
  still. They have to be re-checked before any frame time measured at them is
  compared with an older one.
- `terrain/terrain-village1.glb` stays in the store as the faithful, recentred
  import of the export's own raster. Nothing points at it any more; it is not
  the ground.

**Follow-ups.**

1. Re-run `pnpm scatter` for the village's vegetation and commit the result, or
   decide it stays as it is. Nothing else in this change is finished until that
   decision is made.
2. Re-derive `SPLAT_ORIENTATION` on the corrected ground, together with the
   branch that is fixing the control maps' own mirror.
3. Correct ADR-0045 and ADR-0037 by name: the ground was not too high, the 89 %
   negative is the scatter tool's own seating convention, the 77 are 63, and the
   cliff ring seats.
4. Give `pnpm seating` a way to exclude scattered entities and the backdrop
   category, so its headline stops counting its own output as evidence.
5. Watch the ground rising past `STEP_HEIGHT` under a walking player — it has no
   test and no counter.
