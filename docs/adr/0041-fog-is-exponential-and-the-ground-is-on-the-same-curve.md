# ADR-0041: Fog is exponential, and the ground is on the same curve as the things standing on it

- **Status:** accepted
- **Date:** 2026-09-07
- **Deciders:** `feat/licht`

## Context

Held against the look this project is aiming for, the village had no aerial
perspective. The reference frames put a pale blue-grey haze on the distant
ridges that strengthens with distance, so the range reads as far away rather
than as a painted wall; ours had full-chroma green hills all the way to the
horizon and a hard silhouette where they met the backdrop. The author's words
were that the far country "wird mit Nebel in Richtung der Berge gearbeitet" and
ours is not.

Three separate things added up to that, and the obvious one — "the fog numbers
are wrong" — was the smallest of them.

### 1. The curve was flat exactly where the player lives

`village1` fogged linearly from 80 m to 1700 m. A straight ramp over 1620 m
gives almost nothing at the near end: 1.2 % haze at 100 m, 7.4 % at 200 m,
13.6 % at 300 m. The village tile is 300 × 300 m (ADR-0020), so **the entire
playable ground sits inside the flattest 13 % of the ramp**. Everything visibly
hazed in our frames was backdrop, and the step from an unhazed midground to a
hazed backdrop was a seam rather than a gradient.

### 2. The ground hazed at half the rate of everything standing on it

The terrain has a hand-written shader (ADR-0020) and it did apply fog — with the
raw linear factor. Every GLB in this project loads as a `PBRMaterial`, and
Babylon's `fogFragment` include reads:

```glsl
float fog = CalcFogFactor();
#ifdef PBR
  fog = toLinearSpace(fog);   // pow(fog, 2.2)
#endif
color.rgb = mix(vFogColor, color.rgb, fog);
```

So at one distance there were two hazes. At 300 m the ground was 13.6 % hazed
and the house standing on it 27.5 %; at 800 m, 44.4 % against 72.6 %. The one
surface that carries most of the depth cue was the least hazed surface in the
frame — and ADR-0034's fog numbers had been tuned by eye against the doubled PBR
curve, which is why the shells looked hazed and the ground did not.

### 3. The guard from ADR-0034 was written in a unit the new curve does not have

`backdropTakesFog(fog, reach) === fog.enabled && fog.end > reach`. An
exponential curve has no `end`, so the rule had nothing to test. It also lived
in `apps/game`, and the editor — forbidden by the boundary rules from importing
it — had grown its own copy that read `mesh.applyFog = false` for every backdrop
mesh unconditionally. An author dragging the fog sliders in the Lighting panel
saw the ground haze and the mountains stay dark and green: exactly the picture
ADR-0034 was written to get rid of, shown on the side of the wire nobody tested.

## Decision

**Fog is a curve the world chooses, both curves are computed in one place, and
the ground is on the same curve as everything standing on it.**

1. `lighting.fog` gains `mode: 'linear' | 'exp'` and `density` (extinction per
   metre). `mode` defaults to `linear`, so every world file written before this
   ADR keeps the curve it was tuned against.
2. `packages/engine/src/fog.ts` is the one definition of "how much haze sits at
   this distance": `rawFogFactor` (Babylon's own `CalcFogFactor`), the 2.2
   encode, `hazeAt`, `backdropTakesFog`, and `sceneFogCurve`, which reads
   Babylon's scene fields rather than keeping a second copy beside them. No
   Babylon import — it is arithmetic, and the game, the editor, the terrain
   shader and a test that never opens a scene all need it.
3. The terrain shader applies `pow(fog, 2.2)` and branches on the scene's fog
   **mode** — `uFogRange` became a `vec4` carrying `(start, end, mode, density)`
   — instead of on a boolean that only knew `FOGMODE_LINEAR`.
4. `backdropTakesFog` is restated as the question it was always asking: **does
   this mesh keep enough of its own colour to be worth drawing?**
   `hazeAt(fog, reach) < 0.99`. Both apps call it.
5. `village1` runs `mode: "exp"` at `density: 0.0005`, with `fog.color` darkened
   from `#b4c0cc` to `#a3afbd`.

### Why exponential and not exponential-squared

Aerial perspective is extinction along a line of sight, which is exponential;
`exp2` falls off with the square of distance and saturates. Measured against the
shells' own reach (674 m and 1601 m, ADR-0034): an `exp2` density strong enough
to give the midground 20 % haze at 200 m puts the snow shell past 99.9 %, which
is the flat band of fog colour ADR-0031 was written against. `exp` never quite
reaches 1, which is what leaves the range a colour of its own.

### The table

`density` 0.0005 with the 2.2 encode is an effective extinction of 0.0011 per
metre. Haze as it reaches the screen, on both paths, before and after:

| distance | linear 80→1700, ground (before) | linear 80→1700, PBR mesh (before) | exp 0.0005, everything (after) |
| -------: | ------------------------------: | --------------------------------: | -----------------------------: |
|    100 m |                          1.23 % |                            2.72 % |                        10.42 % |
|    200 m |                          7.41 % |                           15.58 % |                        19.75 % |
|    400 m |                         19.75 % |                           38.38 % |                        35.60 % |
|    800 m |                         44.44 % |                           72.56 % |                        58.52 % |
|   1700 m |                        100.00 % |                          100.00 % |                        84.59 % |

The two "before" columns are the bug: one distance, two hazes. The "after"
column is one number for every surface in the frame, it is already visible at a
hundred metres, and it still leaves the far shell 15 % of its own colour.

### Why the backdrop cap is 0.99 and not lower

The cap has to keep ADR-0034's five cases answering the way they did, and it
does: under `linear` the factor reaches 0 at `end`, so a shell at or past `end`
is refused exactly as before. A tighter cap does not. At 0.90 — the value the
first sketch of this change proposed — ADR-0034's own case "the fog reaches past
the shell" (`end` 1100 m, reach 806 m) flips to a refusal, and shells that
ADR-0034 deliberately fogs would silently stop being fogged. 0.99 is also the
number the picture supports: one part in a hundred of a channel is 2.55 levels
of eight-bit colour, and below that a shell and pure fog are the same pixels.

## What the pictures say

`pnpm perf:frame` on `square`, `slope`, `rim` and `vista`, 1280 × 720, ANGLE on
the machine's own driver, against the private asset store (146 private models, 0
placeholders). Before: `perf-results/f41-before.*`; after: `perf-results/f41-after.*`.

`vista` is the frame the claim is made in, because it is the one with ground,
village, haze and the painted range all in it (ADR-0040). Reading down one
column of it, from the sky to the player's feet — 120 px wide, averaged over
8 rows, identical camera in both:

| what                          | luma before | luma after | sat before | sat after |
| ----------------------------- | ----------: | ---------: | ---------: | --------: |
| sky, high                     |       147.7 |      147.7 |       0.06 |      0.06 |
| painted range, ~600 m–1600 m  |       118.8 |      130.5 |       0.29 |      0.18 |
| midground hills, ~150 m–400 m |        80.2 |       90.4 |       0.29 |      0.19 |
| near ground, ~10 m–40 m       |        60.0 |       64.6 |       0.29 |      0.25 |

The luma series was already monotone; the saturation series was **flat** —
0.29 at ten metres, 0.29 at a kilometre and a half. That is the complaint,
stated as a number: distance changed nothing about colour. After, it falls with
distance, 0.25 → 0.19 → 0.18 → 0.06, and it falls fastest where the fog does the
most work. The range is 11 luma steps brighter than it was and still 17 below
the sky, so it hazes towards the sky without overtaking it — ADR-0034's rule,
re-measured on the new curve.

The near ground moves least (60.0 → 64.6, saturation 0.29 → 0.25), which is the
other half of the claim: haze that erases the grass under the player's feet is
not aerial perspective, it is a grey filter.

`pnpm perf:compare` says the same thing over whole frames. `square` — a
palisade five metres from the camera — moves by a mean of 2.40/255; `slope` by
5.06 and `vista` by 4.64. The change is where distance is, and the close-up view
the frame budget is set by is very nearly the picture it was.

## Consequences

- ADR-0034's guard is superseded by `hazeAt(fog, reach) < MAX_BACKDROP_HAZE`.
  Its result table was taken against a ground that hazed at half the rate this
  one does and no longer describes a frame that exists; the table above replaces
  it.
- `fog.start` and `fog.end` are inert under `exp`, and `density` is inert under
  `linear`. Both stay in the file and both are written to the scene, so
  switching a world between the curves does not lose the other's numbers.
- The fields are optional and every existing file keeps its meaning, so this is
  an additive format change of the kind `packages/world-schema/src/lighting.ts`
  already documents (v2 → v3): no `CURRENT_WORLD_SCHEMA_VERSION` bump and no
  migration.
- The terrain fragment shader gained a `pow` and an `exp` on a full-screen
  surface. Measured on `vista` across the runs above, frame time did not
  separate from run-to-run noise.

### Editor parity (ADR-0033)

- `mode` and `density` appear in the Lighting panel by themselves, because
  `LIGHTING_FIELDS` is `describeFields(LightingProfileSchema)`. Probed at
  runtime rather than assumed: `mode` comes out `{kind: 'choice', options:
['linear','exp']}` and `density` `{kind: 'number', minimum: 0, maximum: 0.005,
step: 0.0001}`.
- That step needed a change in `describeFields`. Its rule was "a range of two or
  less gets hundredths", which for a 0…0.005 field is a control with two
  positions: off, and past the end. The step is now also held to a power of ten
  near a fiftieth of the range, which leaves every existing 0…1 and 0…2 field on
  its hundredths.
- The editor's own `applyFog = false` is gone; `apps/editor/src/scene/scene-sync.ts`
  calls the same `backdropTakesFog`. `tooling/smoke/editor-fog.spec.ts` opens a
  two-shell world in the editor and asserts, off the meshes, that every backdrop
  mesh takes the fog — the same claim `village-backdrop.spec.ts` makes for the
  game.
- The editor draws its ground through the same `packages/engine` terrain code,
  so the mode-aware uniform covers it.

## What this change cannot fix

Between the tile edge (~150 m) and the near shell (674 m of reach) **there is no
geometry at all**: `surroundings` and its ring of 100 cliffs is not drawn
(ADR-0037). Aerial perspective needs receivers at graded distances, and no fog
curve can haze empty space. The midground half of the reference look depends on
the rocks-and-cliffs work putting something out there.

The fog colour and `sky.horizonColor` are also one decision split in two. The
haze now agrees with the sky where the ridges actually sit; it disagrees with the
warm horizon band, and that band (`#dfa974`, saturation 0.48) is far more
saturated than the reference's pale evening. Whoever brings the horizon down
should re-check the fog colour against it in the same sitting.

## One more thing the new fields found

`services/api/src/world-file.ts` writes a saved world back in a canonical field
order so that a save only changes what somebody changed. Its lighting order was
a hand-written list of key names, and that list was also a **filter**: a field it
did not name was dropped on write. It named neither `mode` nor `density`, so the
first save of `village1` from the editor would have quietly turned its fog back
into a linear one — and it did not name `postProcessing.saturation` (ADR-0040)
or `sky.groundReflection` (ADR-0032) either, both of which were already being
lost.

The list now orders the fields it names and keeps everything else at the end of
its group, which is the rule `canonicalTerrain` in the same file had already
arrived at for the same reason. Forgetting a name costs an ordering, not a
value, and `world-file.test.ts` says so.

## A trap worth writing down

Babylon's shader processor reads `#ifdef` out of a line that is **commented
out**. A comment in the terrain shader that mentioned `#ifdef PBR` opened a
conditional that never closed, and the rest of the program — the fog mix and
`gl_FragColor` — was silently eaten. The symptom was not a missing shader: the
effect failed to compile, the ground fell back to something flat and grey, and
it looked exactly like fog that had been turned up far too high. There are no
hash characters in that shader's comments any more, and the reason is written
beside them.
