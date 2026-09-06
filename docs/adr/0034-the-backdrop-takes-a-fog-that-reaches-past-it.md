# ADR-0034: The backdrop takes a fog that reaches past it

- **Status:** accepted
- **Date:** 2026-09-07
- **Deciders:** the integration of `feat/backdrop-and-cliffs`, `feat/terrain-layers` and `feat/editor-parity`

## Context

Three branches met in `feat/mountains`. Each was right on its own and the three
together made a picture in which **depth ran backwards**.

ADR-0031 took the painted distance out of the fog altogether. The reasoning was
sound for the numbers of the day — the village's fog ran from 80 m to 420 m and
the mountain shells stand 290 m to 806 m out, so a fogged outer shell is
_entirely_ fog colour and the horizon becomes a flat band where a mountain range
was. It added a second reason: that the haze of distance is painted into the
panorama already.

That second reason is not true, and it is the one this ADR is about. Measured,
the panorama is a **green painting** — B−R −18, saturation 0.26 — not a hazed
grey-blue one. Meanwhile ADR-0024's fog colour defaults to the sky's
`horizonColor`, which in this world is `#dfa974`, a warm evening band. So the
ground hazed to **amber** while the range behind it stayed **green and dark**.

Measured down the tile's diagonal, camera at `spawn=30,30&look=45,-6`
(1280×720, ANGLE/Vulkan, 150 settled frames):

| region             | luma  | B−R   | saturation |
| ------------------ | ----- | ----- | ---------- |
| near ground        | 58.6  | −45.3 | 0.76       |
| far ground (hazed) | 168.6 | −44.1 | 0.24       |
| painted range      | 103.9 | −3.3  | 0.03       |
| sky                | 152.0 | +25.3 | 0.15       |

The far ground is **brighter than the range behind it** (168.6 against 103.9) and
just as warm (−44.1 against −45.3). The furthest thing in the world was the
darkest thing in the frame, and the middle distance was a featureless beige wall.
Aerial perspective was not weak, it was inverted.

Two things were wrong and only together do they show: the haze had the wrong
colour, and the one surface that most needs haze was the one surface excluded
from it.

## Decision

**A backdrop takes the scene's fog when the fog reaches past it, and stays out of
it when it does not.** The question is asked per mesh, against that mesh's own
world bounding sphere:

```ts
backdropTakesFog(fog, reach) === fog.enabled && fog.end > reach;
```

where `reach` is `centerWorld.length() + radiusWorld` — how far the farthest
point of that mesh can be. `village1` sets `fog.color` to `#b4c0cc`, a light
cool grey, and `fog.end` to 1700 m.

## Why this shape

**The rule guards itself.** The flat-horizon failure ADR-0031 was avoiding
cannot come back: a fog whose end falls short of a shell does not apply to that
shell at all, so shortening `fog.end` makes the range _stop_ hazing rather than
turn into a band of fog colour. Nothing has to remember a rule; the numbers
decide, and the unsafe direction is the one that is refused.

**Strictly greater, and the far side, not the near side.** A shell whose far
edge sits past `fog.end` is drawn with a band of pure fog colour across that
edge — the same artefact, smaller. So the comparison uses the mesh's farthest
point and refuses the exact boundary, where the fog factor reaches 1.

**Per mesh, because the 25 meshes are not one thing.** The clouds reach 144 m to
483 m and the two shells 674 m and 1601 m. One answer for all of them would have
to be the answer for the largest, and the clouds would lose their haze to protect
a shell they are nowhere near.

**Measured reach rather than a number in the source.** The snow shell's bounding
radius is 1336.6 m — not the 594 m its geometry suggests, because the world file
scales it by (2, 3, 2). A constant written from the geometry would have been
wrong by more than a factor of two and would have fogged the shell into the flat
band this rule exists to prevent.

**`fog.color` is set rather than inherited.** ADR-0024 makes fog colour default
to `sky.horizonColor`, and the comment there says that is what it should almost
always be. This is the exception: the horizon band is warm because the evening
sun sits in it, while the air between the player and the mountains is not. Left
inherited, distance made things _yellower_.

## Result

Same camera, same settings, after:

| region             | luma  | B−R   | saturation |
| ------------------ | ----- | ----- | ---------- |
| near ground        | 58.6  | −45.3 | 0.76       |
| far ground (hazed) | 129.9 | −35.0 | 0.26       |
| painted range      | 142.9 | +11.3 | 0.08       |
| sky                | 152.0 | +25.3 | 0.15       |

All three series are now monotone with distance: luma rises 58.6 → 129.9 → 142.9
→ 152.0, saturation falls 0.76 → 0.26 → 0.08, and hue runs warm to cool, −45.3 →
−35.0 → +11.3 → +25.3. The range reads grey-blue and sits just _under_ the sky
rather than above it, which is what keeps it a mountain range and not a light
source.

Bloom was checked on the one surface that could blow out under it: the snowy
peaks peak at 212 of 255 with **0.00 %** of the region clipped, below the 0.85
bloom threshold. The frame cost is unchanged — the fog is a term in shaders that
already ran, and the same 25 backdrop meshes are drawn either way.

## Alternatives considered

| Alternative                                                      | Why not                                                                                                                                                                     |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Leave ADR-0031 alone and only fix `fog.color`                    | Measured: it cools the ground but leaves the range dark and green behind a cool haze, so the inversion stays. The seam is the problem, and only one side of it was movable. |
| Fog the backdrop unconditionally                                 | Restores exactly the flat grey horizon ADR-0031 was written against, the moment anyone shortens `fog.end`. The failure is invisible in a diff and obvious only on screen.   |
| A separate `sky.backdropHaze` fraction blended into the material | A second mechanism that means the same thing as fog, needing a custom shader for what fog already does — and two numbers that must be kept agreeing about one piece of air. |
| Paint the haze into the panorama                                 | Fixes one camera. Haze depends on where the player stands and on the world's own fog, and a repainted texture cannot know either.                                           |
| Raise `fog.end` far enough to reach and keep the exclusion       | The exclusion is what breaks it; raising the end without lifting the exclusion changes nothing about the range.                                                             |

## Consequences

- The world file, not the code, decides whether the horizon hazes. A world with
  a short fog gets ADR-0031's behaviour unchanged, and that is a supported
  answer rather than a bug.
- `fog.end` now carries a second meaning — how far the air goes, not only where
  the ground fades — so lowering it below a shell's reach silently stops that
  shell hazing. Silently in the sense that nothing errors; the debug bridge
  counts `backdrop.fogged` per mesh, which is where the difference shows.
- The lighting panel already draws `fog.color` and `fog.end` from the schema
  (ADR-0033), so both are editable in the editor with no change to `apps/editor`.
- `castsShadows` and picking are untouched: a backdrop is still out of the shadow
  map in both directions and still not pickable. Only the fog became a question.
