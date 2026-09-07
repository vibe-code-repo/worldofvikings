# ADR-0031: The backdrop is its own prefab category

- **Status:** accepted, amended by [ADR-0034](0034-the-backdrop-takes-a-fog-that-reaches-past-it.md)
  on the fog: a backdrop is no longer excluded from it outright, it takes a fog
  that reaches past it. The claim below that the haze of distance is painted into
  the panorama already did not survive measurement — the panorama is a green
  painting, B−R −18 at saturation 0.26.
- **Date:** 2026-09-06
- **Deciders:** asset-pipeline, world-schema and game-client owners

## Context

The village had no horizon. Beyond the last metre of its 300 m tile the frame
was gradient sky all the way down to the ground, and the picture ended where the
height field did.

The source level solves that the way every level does: with painted distance.
Three kinds of geometry, none of which is a thing in the world —

- **two mountain shells**, hemispheres of about 297 m radius carrying a 360°
  panorama. The village stands the outer one at `y = 308.5` scaled `(2, 3, 2)`
  with a snowy panorama and the inner one at `y = 115.4` turned 180° with a
  snowless one, both centred on the middle of the tile;
- **a sky dome**, a much larger shell; and
- **23 clouds**, cards hanging 50–120 m up.

Every rule this project has about world objects is wrong for these. A shell
1 188 m across is not a prop: it has no collision volume worth computing, the
scatter tool must neither plant it nor plant onto it, the editor must not snap a
dragged prop to it, and it belongs in neither half of the shadow map — the sun's
map covers 120 m around the player and the nearest shell stands 290 m away, so a
backdrop put in it is a caster that stretches the map over the whole world and a
receiver that is nowhere near one.

Fog is the sharpest of them. This world's fog is linear from 80 m to 420 m
(`content/worlds/village1.json`) and the outer shell stands at 594 m. Fogged, it
is _entirely_ fog colour: the horizon comes out as one flat band that reads as a
sky and is a mountain range that is not there. Distance is already painted into
the panorama; applying fog counts it twice.

Two more properties of the same shape made this worth writing down rather than
patching in four readers:

- the scene import's plausibility limit excluded anything over 80 m across, on
  the sound reasoning that a "barrel" 300 m wide is a name that does not mean
  what it says. Every backdrop trips it;
- the clouds were already in the world file, filed as `prop` with a box
  collision, and standing in a zone nothing draws.

## Decision

**`backdrop` is a sixth `PrefabCategory`, and one predicate — `isBackdrop` in
`@wov/world-schema` — is what every reader asks.**

- The catalogue gives a backdrop `collision: { kind: 'none' }`; the scatter tool
  will not plant it and will not plant onto it; the editor viewport does not
  snap to it; the game leaves it out of the shadow map in
  both directions, and makes it unpickable.
- `pnpm import:backdrop` writes the three models into the private store from the
  modelling export rather than from the scene bundle, because the bundle points
  both shells at one embedded image — the exporter kept the mesh reference and
  dropped the material that told them apart. The export still has both panoramas
  as separate files, which is the difference between two backdrops and one
  backdrop drawn twice.
- The mountain panorama keeps its full 4096×2048. That is this store's one
  exception to the 2048 px ceiling and it is a measurement, not a preference:
  one image is stretched over 360° of horizon, so 4096 px is 11.4 texels per
  degree where a 1920 px viewport at a 60° field of view wants 32. Halving it
  would put 5.7 texels per degree on the one surface that fills the top half of
  every outdoor frame. Every other texture in the store covers a few metres of a
  model and gains nothing.
- The 80 m limit is lifted **by rule, not globally**: a cut whose name the
  pipeline knows as a backdrop, or whose prefab the catalogue files under
  `backdrop`, is measured against 4 km instead. A mis-exported 100× character
  prop is still excluded, which is what the limit is for.
- The shells and clouds are entities of the **village** zone, not of
  `surroundings`. The game draws exactly one zone — `playableZone` picks the one
  with ground under it — so an entity in `surroundings` is an entity nothing
  renders, and a horizon in the zone next door is a horizon nobody sees.
- The panorama is drawn `alphaMode: MASK`: 13 % of it is `alpha = 0`, because
  the sky above the peaks is a hole in the texture rather than a colour in it.
  Drawn `OPAQUE` the shell is a wall around the world with no sky above it.

**No rendering group, and no depth exception.** (The fog exception this section
describes became a condition rather than a flat no — see ADR-0034.)
Depth already does the work: the shells really are the furthest geometry in the
scene. A rendering group _sounds_ like the answer to "draw it behind everything"
and would have been a second, silent rule about draw order to keep in step with
the first.

**Nothing recomputes normals.** The cliff models are 82–91 % flat shaded and
those hard facets are the look. `ensureNormals` only ever _adds_ a missing
`NORMAL` attribute; measured on the four cliff models, export file against store
file, the facet share is identical to the digit — 82.0 / 86.3 / 87.4 / 90.5 %.
The same applies to the shells, whose smooth normals are what make a painted
range read as distance.

## Alternatives considered

| Alternative                                               | Why not                                                                                                                                                                                |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `backdrop: true` flag on `PrefabDefinition`             | The same information, but it can disagree with `category`. The asset browser groups by category anyway, so a flag would be a second place to look and a second to keep right.          |
| Keep the shells as `environment` and special-case by id   | Four readers each carrying a list of ids. The first backdrop nobody adds to the fourth list is a bug with no symptom.                                                                  |
| Raise the 80 m import limit for everything                | The limit exists to catch a unit mistake. Raising it globally to fit a 594 m shell lets a 100× prop back in.                                                                           |
| Draw the backdrop in its own rendering group              | Solves a problem depth does not have, and adds a draw-order rule that has to be maintained against the existing one.                                                                   |
| Make the panorama emissive so the evening does not dim it | `emissive + lit` is roughly twice the brightness of the ground in front of it — a white cut-out at the horizon. Lit like everything else, the evening stays an evening to the skyline. |
| Place the sky dome as well                                | Its material did not survive the export and this repository already draws a gradient sky (ADR-0024). It is imported so the editor has it, and left unplaced on purpose.                |

## Consequences

**Positive** — the village has a horizon, and it costs almost nothing: measured
at the north edge with the camera pitched up, 25.52 ms per frame with the
backdrop against 25.47 ms without it, for +8 draw calls and +4 128 triangles.
The category is one predicate, so the game, the editor, the scatter tool and the
catalogue cannot drift apart about what a backdrop is. Adding the value was
additive — no catalogue written before it used a value the list did not have —
so no schema bump and no migration.

**Negative** — the backdrop models are private (ADR-0015), so a clone without
`WOV_ASSET_STORE` gets placeholder hulls at the horizon and the proof test skips
itself. One texture in the store is now 4096 px wide, which is a rule with an
exception in it, and the exception has to be re-argued if a second one is ever
asked for.

**Follow-ups**

- **The 100 cliffs are still in a zone nothing draws, and are not ready to be
  moved.** They are in `content/worlds/village1.json` under `surroundings` with
  their transforms intact — 91 of the 100 unevenly scaled, 22 tilted — and they
  have never been on screen. Moving them into the village was tried and measured
  here, and the reason recorded in this section — that the ground under them is
  the 257² approximation of a 513² surface, so the finer field would fix it —
  **did not survive re-measurement and is withdrawn.** The finer field arrived
  with ADR-0032 and changed nothing: all four rasters this repository can read
  agree within 1.5 m, and 17 of the cliffs hang 3.8 m to 27.2 m over every
  surface the world has. The extent given above ("x 55–118, z 119–151") is wrong
  too; the cliffs are a ring around the whole tile. **[ADR-0037](0037-the-cliff-ring-stays-out-of-the-village.md)
  has the measurement, the corrected cause and the decision;** `pnpm seating`
  repeats it. The placements themselves are not wrong — they are byte-identical
  to the bundle, and snapping them down would be inventing placement (agent
  rule 16).
- Zone streaming will change what "one zone the game draws" means. It will not
  change which zone the backdrop belongs to.
- The sky dome is imported and unplaced. If the gradient sky is ever replaced by
  a textured one, the model is already in the store.
