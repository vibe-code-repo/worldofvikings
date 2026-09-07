# ADR-0032: Terrain layers carry a surface, and the ground reflects the sky

- **Status:** accepted
- **Date:** 2026-09-06
- **Deciders:** project maintainers

## Context

ADR-0020 put the ground into the world format as a height field plus splat
layers, and left three things open that the source landscape depends on.

**Which splat channel drives which layer was a guess.** ADR-0020 states the
axis question as measured — the control maps are mirrored on the anti-diagonal
relative to the height field — but the _order_ of the six village layers was
arrived at by trying permutations in the editor. One of the six was wrong.

**The layers have no surface.** Every hand-made ground layer in the source
carries a metallic between 0.5 and 0.85 at a smoothness of 0 to 0.25, plus a
normal map with a strength between 1.2 and 5. None of that reaches a world file,
so a rock face and a meadow differ only in the colour of their texture. That is
why the ground reads as a painted plane: what makes the original's rock look
like cold stone is that almost all of what it shows is _reflected sky_, and the
renderer had no sky to reflect and no dial to ask for it.

**Thinning rounds the cliffs off.** The village tile is imported at 257² from a
513² source. Measured on the triangle area actually standing past 60°: the
source has 17.55 %, the thinned tile 16.06 %. A twelfth of the cliff faces stop
being cliff faces, and they are exactly the faces the source landscape's look is
built on. (The earlier note in the analysis said a quarter; that figure came from
a per-vertex slope count, and the per-area measurement above supersedes it.)

## Decision

### 1. The channel order is measured, not tried

For each of the eight ways to lay a square control map over the tile, the
correlation between each channel's weight and the terrain's own slope was
computed on the 512² grid. One placement stands out — mean |r| 0.195 against
0.09–0.13 for the other seven — and it is the one the importer already produces:
the anti-diagonal mirror of ADR-0020, sampled with the tile's own UV. So the
raster placement was already right and is now measured rather than assumed.

Under that placement the six channels are:

| Channel | Area   | Mean slope | Mean height | corr(slope) | Layer                        |
| ------- | ------ | ---------- | ----------- | ----------- | ---------------------------- |
| `0.R`   | 1.3 %  | 8.0°       | 13.2 m      | −0.02       | path gravel                  |
| `0.G`   | 15.6 % | 42.0°      | 30.2 m      | +0.38       | rock wall                    |
| `0.B`   | 65.8 % | 20.5°      | 20.3 m      | −0.27       | grass — the base layer       |
| `0.A`   | 10.9 % | 12.8°      | 12.0 m      | −0.23       | pebbles and sand             |
| `1.R`   | 0.15 % | 73.3°      | 40.7 m      | +0.12       | rough rock — the cliff faces |
| `1.G`   | 6.3 %  | 32.6°      | 23.6 m      | +0.16       | moss                         |

`0.R` was a second grass in the world file and is a gravel path here. That is
measured too, and not from the slope: sampled at the placed entities, the channel
carries 0.131 mean weight under the stone-and-brick path props and 0.161 under
the wooden ones, against 0.039 under the bushes and 0.079 under the grass tufts.
A grass layer would follow the grass. This one follows the paths, so the import
takes the export's second, paler pebbles-and-sand image for it under the name
`terrain-gravel-path.png`.

_Amended 2026-09-07:_ on a large screen the pale image read as a whitish sheet
rather than as stone, so the path layer now uses the same dark pebbles image as
`0.A` with the same surface values. The pale image stays in the store for a
world that wants a lighter road.

### 2. Four fields per layer, one per terrain, at schema version 4

```json
{
  "texture": "textures/terrain-rock-a.png",
  "tileSize": 2,
  "normalMap": "textures/terrain-rock-a-normal.png",
  "normalScale": 1.5,
  "metallic": 0.85,
  "smoothness": 0.1
}
```

and on the terrain itself, `"flatNormals": false` and `"heightSamples"` (below).
All of them are optional and default to what the renderer already did, so a
version 3 file is a version 4 file whose ground is plain diffuse. The migration
is the version number and nothing else — writing the village's measured values
into every old world would be the migration deciding how those worlds look.

`normalScale` without a `normalMap` is refused: a strength for a map that is not
there is a number that does nothing, and a number that does nothing is a number
someone will trust.

### 3. The ground reflects the sky, evaluated rather than sampled

The terrain program blends a tangent-space normal, a metallic and a smoothness
per layer with the same normalised weights it blends colour with, and lights the
result as

```
diffuse     = albedo × (1 − metallic)
reflectance = mix(0.04, albedo, metallic)
colour      = diffuse × (ambient + sun × shadow) + envBRDF(reflectance, roughness) × sky
```

The sky term is `SKY_GRADIENT_FUNCTION` — the _same GLSL_ the sky dome runs,
pasted into both programs — evaluated along the reflection vector, bent back
towards the normal as the surface roughens. **No cube map is rendered.** The sky
here is already an analytic gradient with no asset behind it (ADR-0024); a
rendered cube map of it could only be a coarser copy of a formula we have, plus
a render target, plus a way for the two to drift apart. What the cube map would
have bought — a blurred reflection for rough surfaces — is bought instead by
Lazarov's analytic fit to the split-sum environment BRDF, two multiply-adds. It
is not optional: without it a meadow at metallic 0.5 comes out the colour of the
zenith, which is what the first measured frame showed.

The tangent frame is not a vertex attribute. A terrain tile's UV _is_ its own x
and z (`height-field.ts`), so the tangent is world +x projected onto the surface
and the bitangent is world +z; an attribute would be three floats per vertex
restating that.

`sky.groundReflection` in the lighting profile is the one dial over the whole
effect, and it lives with the sky rather than with the terrain because it is a
property of the light in the zone, not of the ground in it.

### 4. The village is relit for it

A layer at metallic 0.5 keeps half its diffuse. The meadow lost 40 % of its
brightness the moment the surface fields arrived, so the village's sun goes from
2.3 to 3.3 and its fill from 0.62 to 0.85. The sun is the right lever precisely
because the dark layers barely feel it: they are mostly reflected sky. Measured
over the same patches, same camera, same frame count:

| Patch       | Before                        | After                         |
| ----------- | ----------------------------- | ----------------------------- |
| Gravel path | R 81.8 G 79.6 B 59.1, B−R −23 | R 45.8 G 49.5 B 43.9, B−R −2  |
| Meadow      | R 68.9 G 70.0 B 28.2, luma 56 | R 48.9 G 52.6 B 21.7, luma 41 |

The path turns from warm and yellow to neutral and faintly cool while staying
dark; the meadow stays green and comes back to within a quarter of its old
brightness.

Repeated afterwards on the hillside west of the village — the reference view of
§8, which frames a rock band, a meadow and shaded ground at once:

| Patch on the hillside        | Before                        | After                         |
| ---------------------------- | ----------------------------- | ----------------------------- |
| Rock band across the slope   | R 86.5 G 86.5 B 31.3, B−R −55 | R 79.7 G 80.6 B 55.0, B−R −25 |
| Meadow on the left slope     | R 56.6 G 64.0 B 31.1, G−R +7  | R 55.7 G 66.2 B 33.0, G−R +10 |
| Shaded ground, foreground    | R 75.1 G 74.1 B 48.9, luma 73 | R 42.8 G 46.7 B 31.5, luma 45 |
| All ground below the horizon | R 79.6 G 79.7 B 36.8, B−R −43 | R 60.2 G 63.7 B 32.3, B−R −28 |

The rock keeps its brightness (82.5 → 78.6 luma) and loses its yellow: thirty
points of B−R, which is the sky arriving on it. The meadow stays a meadow and
gets greener rather than greyer, because the diffuse it lost to metallic came
back as sun. The ground the sun does not reach falls to two thirds of its
brightness and to within eleven points of neutral. That last row is the one the
old frame could not produce at all: before, every dark patch was dark _yellow_.
84.5 % of the pixels above the HUD differ between the two frames.

### 5. One adaptive tile, not two meshes

The importer writes a second copy of the village tile that keeps the source
resolution in every coarse cell holding a triangle past 35° and thins the rest,
as **one** mesh. A fine vertex lying on the boundary between a fine cell and a
coarse one is placed on the straight coarse edge, at the average of the two
coarse heights, which closes the T-junction that would otherwise be a moving
hairline of background through the ground. The tile's own border keeps its
detail: there is no neighbour on the other side to match.

| Tile            | Triangles | Vertices | Area past 60° |
| --------------- | --------- | -------- | ------------- |
| Source 513²     | 524 288   | 263 169  | 17.55 %       |
| Thinned 257²    | 131 072   | 66 049   | 16.06 %       |
| Adaptive at 35° | 281 216   | 148 228  | 17.60 %       |
| Adaptive at 45° | 232 244   | 122 867  | 17.64 %       |
| Adaptive at 55° | 194 204   | 101 659  | 17.64 %       |

35° is the threshold in the world file because it is where the source's own paint
changes: the rock channel takes over at about 42° mean slope and the rough-rock
channel at 73°. It takes all the cliff area back for 2.1× the triangles rather
than 4×.

What it costs was measured twice, from two cameras, and the two answers are far
apart — so both are here rather than the flattering one. Over the whole village
from the first camera, 280 frames: 15.8 ms before, 20.0 ms after. From the
reference view of §8, alternating the two worlds in the same browser three times
and taking the median of the three, 280 frames each: 19.3 ms before, 19.6 ms
after, with the whole tile in frame both times (3 594 546 vs 3 744 690
triangles — the full 150 144 the tile grew by). The reading spread by 4 ms
between rounds on a machine that was also building something else, which is more
than the difference being measured; what the pair of measurements supports is
that a 2.1× ground costs somewhere between nothing and a fifth of the frame,
because the ground is not what this frame is spent on.

`terrain.heightSamples` names a regular-grid copy of the ground for tools that
sample heights without a renderer. The drawn tile is no longer a grid, and
`pnpm scatter` needs one; rather than have an offline tool guess which file to
read, the world says it.

### 6. `flatNormals`, off by default

The normal comes from the screen-space derivatives of the world position instead
of from the vertex normal, forced into the vertex normal's hemisphere so no
triangle comes out inside-out. Derivatives rather than a second, flat-shaded
vertex buffer: the height field is a shared grid, so a facetted copy would be
three times the vertices for a switch that is off.

It is off by default and stays off in `village1.json`. The source world gets its
angular look from flat-shaded rock meshes standing on a _smooth_ height field,
so a facetted height field is a different ground, not a better-lit one. Measured
on the same frame, it changes 10.2 % of the pixels above the HUD from the first
camera and 5.1 % from the reference view of §8 — it is a change to the shading of
the ground, so how much of a frame it touches is how much ground that frame
shows. The patch means barely move (rock band B−R −24.7 against −24.5): the
facets change where the light falls, not what colour the ground is.

### 7. Editor parity

`updateTerrainSurface` in `@wov/editor-core` is the only way these fields
change. The editor's ground panel dispatches it; `pnpm terrain-surface` builds
the same command from a command line and writes the document it produced. The
smoke test drives the panel and reads the _tile's compiled shader key_ out of the
scene, so a panel wired to nothing and a command that reaches the document but
not the picture both fail.

The command is deliberately narrow: it cannot add a layer, change a texture or
move the tile. Those have an asset and an import behind them (ADR-0020,
ADR-0021).

The panel's own witness is `Ctrl+Z` after ticking the facets box, and it found a
bug that had nothing to do with the ground: the shell ignored every shortcut
while the focus was in an `<input>`, and a checkbox is an `<input>`. So ticking a
box and pressing undo did nothing, in the ground panel and anywhere else a
checkbox will ever be. `swallowsKeystrokes` in `apps/editor/src/keyboard.ts` now
asks what the input _does_ rather than what it is: text fields, text areas,
selects and content-editable elements keep their keystrokes, and buttons,
checkboxes, radios and ranges let a shortcut past.

### 8. The frame these numbers come from

Every "before" above is `village1` with the terrain block of schema version 3 —
no surface fields, the 257² tile, the sun at 2.3 and the fill at 0.62 — served
from a throwaway content directory as its own world so the two can be shot in
one browser session. Every "after" is `content/worlds/village1.json` as it
stands.

The reference view is the hillside west of the village:

```
/?world=village1&spawn=120,120&look=-105,14
```

which puts the camera at x 125.6, y 13.4, z 121.5, yaw −105°, pitch 14°, with
1280×720, the ANGLE flags the smoke config uses, and 280 settled frames before
the shutter. The patches are rectangles in that frame: the rock band at
(800,190)–(1200,270), the meadow at (100,200)–(420,300), the shaded foreground at
(40,380)–(560,440), and all ground below the horizon at (0,170)–(1280,480).
`?look=` exists so this is a line someone can paste rather than a mouse gesture
someone has to repeat (`config.ts`).

## Alternatives considered

| Alternative                                        | Why not                                                                                                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Render a small cube map of the sky and sample it   | The sky is a formula with no asset (ADR-0024). A rendered copy is coarser, costs a render target, and is a second thing that can disagree with the dome. |
| Babylon's `PBRMaterial` for the ground             | It cannot blend six layers by a splat map; that is why the material is hand-written GLSL in the first place (ADR-0020).                                  |
| Keep the reflection at full strength               | Measured: a meadow at metallic 0.5 comes out the colour of the zenith. The environment BRDF is what makes a rough surface rough.                         |
| A separate steep-slope patch mesh over a full tile | Two meshes overlapping in the steep area z-fight, and hole-punching the coarse tile leaves the same T-junctions with an extra draw call.                 |
| A quadtree with several levels                     | The tile has one thinning step (513² → 257²), so there is exactly one seam to close. A general quadtree would be code for levels that do not exist.      |
| Bake facetted normals at import                    | `flatNormals` is a switch an author flips while watching the viewport; a baked copy is a second asset and a re-import per experiment.                    |
| Leave the layer order as it was                    | Measured wrong: the channel it called a second grass carries three to four times as much weight under the path props as under the bushes.                |

## Consequences

**Positive.** The ground has the surface the source landscape describes, driven
by numbers that are in the world file and reachable in the editor. The dark
layers read as cold stone because they show the sky the scene is actually lit
under, not a colour someone picked. The cliffs keep the shape the source gave
them.

**Negative.** Every tile now carries an environment term, so a world with no
surface fields at all is about 4 % brighter than it was — the dielectric floor.
Six layers with normal maps is up to twelve texture fetches per ground pixel.
The village tile is 2.1× the triangles it was, and its collision mesh with it.
The layer order change means the village's ground is repainted: anyone with a
screenshot of the old paths will see different ground under them.

**Follow-ups.** The second grass texture (`terrain-grass-b.png`) is imported and
no longer used by any world; whether the base grass layer is that one or
`terrain-grass-a.png` is not settled by the splat data, and both are in the store
for whoever settles it. The backdrop shells, the cloud layer and the flat-shaded
cliff instances of the source landscape are still ahead (see the analysis note);
so is calibrating fog and sky against a reference frame.
