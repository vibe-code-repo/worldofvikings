# ADR-0039: The shadow map is snapped to its own texels

- **Status:** accepted
- **Date:** 2026-09-07
- **Deciders:** `feat/licht`

## Context

The village is lit by one shadow map that follows the player (ADR-0024).
`focusShadows` is called once per rendered frame with the _interpolated_ player
position, and `place()` parked the sun at `focus − direction × distance` from
exactly that point. Babylon builds the light's view from the light position
(`Matrix.LookAtLHToRef`) and, because `shadowFrustumSize` is set, an
orthographic box centred on it — so the grid of 2048² texels is pinned to a
point that slides in arbitrary fractions of a texel. Every silhouette in the
map therefore falls into different texels every frame, and the step comparison
that reads it (Babylon's own poisson path and `shadowFactor()` in the terrain
shader alike) turns that into an edge that crawls. Walking through the village
made every shadow boundary shimmer, which is what the author reported.

Measured, before anything was changed, with the village's own numbers (map 120 m
over 2048 texels = 5.86 cm a texel): transforming the world origin by
`generator.getTransformMatrix()` into texel space and reading the fractional
part over eight frames of walking gives −0.342 −0.316 −0.290 −0.263 −0.237
−0.211 −0.185 −0.159, and at sprint speed it jumps around the whole ±0.5. The
grid phase never repeats. Two focus points a third of a texel apart move that
phase by (−0.254, −0.097) texels; two that differ only by two centimetres of
vertical bob move it by (0.000, −0.305), because world up is not the light's up.

Babylon 8.56.2 has no cure for this on the classes we use. The only texel
snapping in the library is inside `CascadedShadowGenerator._computeMatrices`,
and `stabilizeCascades` is a cascade-only property; `ShadowGenerator` and
`DirectionalLight` have no equivalent, and `frustumEdgeFalloff` is about the
map's border rather than its phase.

## Decision

`applyLighting` quantises the shadow focus onto whole texels of the map before
it parks the sun, unconditionally. The arithmetic lives in
`packages/engine/src/shadow-snap.ts` as two pure functions over plain numbers:
`shadowBasis` builds the light's own axes the way `LookAtLH` does
(`forward = normalize(direction)`, `right = normalize(up × forward)`,
`up = forward × right`, with world +Z standing in when the light points along
world up), and `snapShadowFocus` rounds the focus point's two **lateral**
components to multiples of `distance / mapSize` while leaving the component
along the light exactly as it was.

The depth component stays continuous on purpose, and that is what the cascaded
generator does too (`Matrix.TranslationToRef(x, y, 0)`): a shift along the light
moves caster and receiver depth by the same amount and cancels in the
comparison, whereas the two lateral axes are what decide which texel a
silhouette lands in.

Nothing about this is authorable. There is no world-data field and no switch: a
shadow map that re-rasterises itself every frame is a defect, not a look, and
the editor's viewport — which calls the same `focusShadows` with its orbit
target — stops swimming for free, which is exactly what ADR-0033 asks of the
engine.

## Alternatives considered

| Alternative                                         | Why not                                                                                                                                               |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CascadedShadowGenerator` with `stabilizeCascades`  | It is Babylon's own snapping, but it buys it with three maps and a cascade-selecting lookup the hand-written terrain shader does not have (ADR-0024). |
| Snap in the app, before calling `focusShadows`      | The app does not know the map's texel size or the light's axes, and there are two apps. The engine owns the map, so the engine owns its grid.         |
| A `shadows.stabilize` field in the lighting profile | A field whose only sane value is `true` is a way to ship the bug by accident. The measurement that needs the map displaced has `?shadowFocus=`.       |
| Snap all three components                           | Quantising depth buys nothing — a uniform shift along the light cancels on both sides of the comparison — and costs the map's near/far headroom.      |
| Widen the terrain shader's filter kernel            | The ground's ±0.5-texel taps make the crawl _more visible_ there than on the houses, but the motion is in the map. That is a separate, later change.  |

## Consequences

**Positive** — a step smaller than one texel now produces the very same light
matrix, so shadow edges stay on the same world pixels between frames. Both the
game and the editor are fixed by one change. The quantisation is a pure function
with its own test, so the part that has to be right is provable without a device.

**Negative** — the map's centre lags the focus point by up to half a texel
(under 3 cm at village settings), and `sun.position` — which the debug bridge
and `tooling/perf/frame-profile.ts` use as the witness that the map follows the
player — now moves in discrete steps of one texel instead of continuously. The
texel size is derived from `shadows.distance` and `shadows.mapSize`, so both are
captured per `applyLighting` call rather than once per module; a relight with
different numbers snaps to the new grid.

**Follow-ups** — the map is stable, not yet perfect: `bias: 0.006` is a fraction
of the 301 m depth range, i.e. about 1.81 m of push along the light, which is
visible peter-panning and should be revisited now that a before/after picture of
it means something. The terrain shader's four taps sit on a ±0.5-texel diamond
against Babylon's roughly twice as wide kernel, so the ground's shadow edge is
harder than a house's; widening it is a separate change with its own picture.

## How it was proven

Three measurements, because a moving camera renders differently every frame and
no single screenshot can show stability.

1. **The arithmetic.** `packages/engine/src/shadow-snap.test.ts`: the basis is
   orthonormal and survives a light pointing straight down, the snapped point
   lands on whole texels, never moves by more than half of one, is identical for
   two points inside the same texel and steps by exactly one when the focus
   does.
2. **The grid.** `packages/engine/src/lighting.test.ts` walks the focus point at
   4.5 m/s in 1/60 s steps under a `NullEngine` with the village's own profile
   and asserts the world origin's fractional texel coordinate is constant to
   four decimals across sixty frames — while the sun still follows 4.5 m of
   walking. Without the snap that phase runs from 0.700 to 0.419, and the test
   is red.
3. **The picture.** `?shadowFocus=dx,dz` (`apps/game/src/config.ts`) displaces
   the map's centre with camera, player and sun held still, and the perf views
   `square-focus-sub` (0.4 of a texel, 2.34 cm) and `square-focus-texel` (one
   whole texel, 5.86 cm) render it. Against `square`, measured with
   `pnpm perf:compare`:

   |                     | before                                   | after                    |
   | ------------------- | ---------------------------------------- | ------------------------ |
   | same view twice     | mean \|Δ\| 0.0000, 0 pixels changed      | mean \|Δ\| 0.0000        |
   | 0.4 texel displaced | mean \|Δ\| 0.0700, max 45, 1.16% changed | mean \|Δ\| 0.0000, max 0 |
   | one texel displaced | mean \|Δ\| 0.0715, max 42, 1.16% changed | mean \|Δ\| 0.0000, max 4 |

   The last row is the complement that keeps this from being a frozen map: the
   sun's recorded position shows the map did step, and the frame is the same
   picture anyway, because it stepped by a whole texel.

   Frame cost on `square` is unchanged — 14.37 ms of scene render before,
   14.17 ms after, on a machine whose repeat runs of the same build spread wider
   than that. The snap is about ten dot products a frame.
