# ADR-0040: The grade has a saturation of its own

- **Status:** accepted
- **Date:** 2026-09-07
- **Deciders:** `feat/licht`

## Context

Held against the look this project is aiming for, the village came out
markedly more colourful than it should be: grass reading as a strong
yellow-green rather than a grey-green, wood as orange rather than warm grey,
and the step from lit ground to shaded ground harsh enough that shaded
vegetation went nearly black. "Übersättigt" was the word the author used.

The lighting profile (ADR-0024) had `exposure` and `contrast` and a choice of
tone-mapping curve, and nothing else that touches colour. Three candidates were
therefore measured on the shipped frames rather than argued about — the
measurements are on `perf-results/matte-before.{square,slope}.rgba`, 1280×720,
rendered against the private asset store with 146 private models and 0
placeholders, so the pixels are the real village and not a placeholder one.

1. **Contrast is not the cause.** Inverting Babylon's gamma-space contrast
   (`x + (x²(3 − 2x) − x)·(c − 1)`) with the village's `c = 1.1` moves mean HSV
   saturation from 0.5249 to 0.5134 on `slope` and 0.4735 to 0.4619 on
   `square` — around 2 %, a rounding error against the complaint.
2. **The tone-mapping curve is a different picture, not a saturation knob.**
   The pre-tone-map linear frame was recovered by inverting contrast, gamma and
   the ACES fit (round-trip mean absolute error 0.01/255) and re-mapped at
   matched mean luminance. On `slope`: ACES 0.521 mean saturation, KHR-PBR
   Neutral 0.700, `standard` 0.411. `standard` does desaturate — and collapses
   the lit-to-shaded luminance ratio from 2.86 to 1.91, trading the author's
   complaint for a flat, shadowless frame.
3. **The chroma is in the scene radiance, before the grade.** The frame with
   tone mapping off still measures 0.418. It comes from a warm key against a
   cool fill: on `slope`'s vegetation, the lit quartile's r:g:b energy share was
   0.402 : 0.438 : 0.159 while the shaded quartile's was 0.313 : 0.437 : 0.249 —
   the sun stripped 36 % of the blue share out of the lit half, which is exactly
   what reads as lime grass and orange wood.

So there were two problems standing behind one complaint: a grade with no
saturation control at all, and a light rig that puts opposite hues into the lit
and the shaded halves of every surface.

## Decision

**Give the profile a `postProcessing.saturation`, and tune the village's light
underneath it.** They are two different things and both are needed: the field is
renderer capability, the numbers are the author's look.

`saturation` is `0` greyscale, `1` untouched, `2` twice as colourful — the
convention `exposure` and `contrast` already use, so the default of `1` leaves
every existing world exactly as it was. It is implemented with Babylon's
`ImageProcessingConfiguration.colorCurves`, whose `globalSaturation` is the last
step of `applyImageProcessing`, after tone mapping and after contrast, and is
literally `result.rgb = mix(vec3(luma), result.rgb, 1 + 0.01·saturation)`. That
is a luminance-preserving mix towards grey: it changes chroma and leaves
brightness and the lit-to-shaded ratio alone, which is precisely the separation
the measurements above say is needed. It costs three `vec4` uniforms and about
six ALU operations in a fragment shader that already runs, no extra pass and no
extra texture. `colorCurvesEnabled` is set only when a world asks for something
other than `1`, so no existing world pays for the `COLORCURVES` shader
permutation.

`content/worlds/village1.json` then gets `saturation: 0.68`, a sun pulled from
`#ffd2a1` to `#ffe4c6` and from intensity 3.3 to 3.0, an ambient fill from
`#8fb3d8` at 0.85 to `#a8bcd0` at 1.1, and `shadows.darkness` from 0.25 to 0.42.
The sun and fill colours narrow the warm/cool split at its origin; the fill
intensity and the shadow darkness soften the step into shade the author called
harsh. The sun's direction is untouched, so it is still the same evening.

## Alternatives

- **A colour-grading LUT** (`colorGradingTexture`). More expressive, and the
  wrong answer here: it is a binary asset well over the 20 KB limit, and one
  with no provenance to declare, which the asset rules forbid outright.
- **Switching the tone-mapping operator to `standard`.** Measured in item 2
  above. It buys 0.11 of saturation and costs a third of the shadow contrast.
- **Desaturating the source textures.** It would fix one world's look by
  editing every material in it, and it cannot be undone by an author who wants a
  brighter zone. A grade is where a look belongs.
- **Only changing the light, no new field.** Item 3 says the light is a real
  contributor, but the tinted-key effect is bounded: taking it out entirely
  still leaves a frame at 0.42 mean saturation and costs the evening its warmth.

## Consequences

Measured on the same three views, before against after (mean HSV saturation ·
share of pixels above saturation 0.5 · luminance P90/P10, which is the
lit-to-shaded split the author called harsh):

| View     | Before                 | After                  |
| -------- | ---------------------- | ---------------------- |
| `square` | 0.4736 · 55.8 % · 4.37 | 0.3287 · 11.7 % · 3.99 |
| `slope`  | 0.5249 · 63.1 % · 2.86 | 0.3651 · 15.8 % · 2.67 |
| `vista`  | 0.3484 · 38.5 % · 5.06 | 0.2420 · 6.8 % · 4.55  |

Mean luminance rises slightly rather than falling (`vista` 0.3485 → 0.3632):
this took colour out, not light. The warm/cool split closes at its source — on
`slope`'s vegetation the lit-versus-shaded blue share goes from 0.159 vs 0.249
to 0.217 vs 0.281, a gap of 0.090 narrowed to 0.064.

- **The default look does not move.** With the code change in and
  `village1.json` untouched, `pnpm perf:compare` reports mean |Δ| 0.0000/255 and
  max |Δ| 0/255 on both `square` and `slope`. A world file that never mentions
  the field renders byte for byte as it did.
- **A new named view, `vista`.** `square` is filled by a palisade and `slope` by
  a bush, so the colour statistics of both belong to two or three materials.
  `vista` puts ground, village, haze and the painted range in one frame, which
  is the kind of picture a grade is actually judged in. It is stable to the
  pixel across runs, which is what makes it a comparison view rather than a
  screenshot.
- **The editor gets the control for free** (ADR-0033): the lighting panel is
  drawn from `LightingProfileSchema`, so `saturation` appears under Post
  Processing with its own slider. It is bounded `0…2` in the schema rather than
  left open like the other gains precisely so the control derives a range to
  step in. The `evening` and `noon` presets state it, so pressing a preset
  cannot leave an old saturation behind.
- **`saturation: 0` is legal** and produces a greyscale frame. That is an
  authoring choice, not a bug — but a mistyped zero will look like a broken
  renderer rather than a bad number.
- **Colour curves run after tone mapping**, in gamma space, so they cannot
  recover chroma that has already clipped. Today 0.12 % of `slope` and 0.06 % of
  `square` pixels sit at a channel ceiling, so this does not bite; raising
  exposure later would make the knob less effective, not more.
