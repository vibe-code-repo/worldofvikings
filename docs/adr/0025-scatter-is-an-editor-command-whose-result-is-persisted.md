# ADR-0025: Scatter is an editor command whose result is persisted

- **Status:** accepted
- **Date:** 2026-09-06
- **Deciders:** project maintainers

## Context

The village needed ground cover. The reference look is a village square with
dense tufts of grass between the flagstones and bushes filling the gaps between
the houses — a few thousand small plants — and placing a few thousand of
anything by hand is not authoring, it is data entry.

The obvious answer is a scatter tool, and the obvious risk is that a scatter
tool is procedural world generation wearing a hat. Agent rule 16 forbids
procedural world generation outright; rule 17 allows randomisation in the editor
**only when the result is persisted**. The two rules together do not say "no
scatter" — they say exactly where the line is, and this ADR records which side
of it each part of the tool falls on.

Two further pressures shaped the design:

- **A reviewer must be able to reproduce a run.** A scatter that only exists as
  a gesture inside a browser is not reviewable: the pull request would carry
  three thousand entities that nobody can regenerate or argue with.
- **Thousands of scene nodes are not free.** The zone already places its props
  as one `TransformNode` per entity, which is what makes each of them
  selectable. Doing the same for 3 473 tufts of grass adds 3 473 transforms to
  recompute and 3 473 nodes for the culler to weigh, every frame, for objects
  nobody will ever click on.

## Decision

**A scatter is one editor command, and its entire output is ordinary entities in
the world file.**

1. **`planScatter` is a pure function** in `@wov/editor-core`: region, prefab
   weights, density, scale and yaw ranges, minimum distance, seed and a height
   function in — a list of `EntityDefinition` out. It touches no document, no
   scene and no renderer.
2. **The randomness is a seed, never `Math.random`.** `random.ts` is a
   mulberry32 generator with the seed as its only input, and its first draws are
   pinned in a test. Same options, same seed, same entities — on any machine.
3. **The result is one `addEntities` command.** Not a new command kind: the
   entities a scatter makes are indistinguishable from hand-placed ones, so they
   travel through the same code path, the history holds **one** entry, and one
   Ctrl+Z takes the whole field back.
4. **The id says which run made it:** `<prefab>_s<seed>_<n>`, zero-padded so
   that sorting by id is sorting by run. Re-running with the same seed collides
   on every id and is refused by `applyCommand`, loudly, instead of doubling the
   field.
5. **Two front ends, one function.** The editor's Scatter panel and
   `pnpm scatter` both call `planScatter` and apply the same command. The
   command line is what makes a run in a pull request reproducible:
   `pnpm scatter --world village1 --zone village --region … --seed 7`.
6. **The game draws vegetation as thin instances.** Prefabs of category
   `vegetation` are drawn as one mesh with a matrix buffer — no node, not
   pickable. The editor keeps the nodes, because there every tuft has to be
   selectable (ADR-0018). The two agree on the world file, not on how it is
   drawn.

**Where the line is.** The world is not generated: it is authored _with a tool_,
and the tool's output is checked into `content/worlds/village1.json` as 4 032
entities that a person can now select, move or delete one by one. The seed is
how an author repeats a gesture, not how the world is stored. Nothing re-runs
`planScatter` at play time; the game has never heard of it, and the boundary
rule keeps it that way (`apps/game` may not import `@wov/editor-core`).

## Alternatives considered

**A `scatter` command kind stored in the history.** The command would hold the
parameters and regenerate the entities on redo. Rejected: the command would then
have to carry a height _function_, which is not data, and the history would hold
a recipe rather than a result — one step closer to the world file storing a seed
instead of a village.

**Storing the seed in the world file and expanding it at load time.** This is
procedural world generation, exactly what rule 16 forbids, and it would make
every scattered plant un-editable: an author who moves one tuft would have their
change overwritten by the next expansion.

**Density over the region rectangle rather than over the usable area.**
Simpler to implement and wrong in use: excluding the houses and the paved paths
from the village square would then silently thin the grass between them instead
of only making the field smaller. The usable area is measured with a 128 × 128
lattice probe, because the region is a rectangle minus a polygon minus a list of
possibly overlapping rectangles, and the closed form for that is a clipping
library.

**Keeping vegetation as scene nodes in the game too.** Measured on the village
at the same viewpoint: 1 216 entities at 118 draw calls before, 5 248 entities at
129 draw calls after. Nodes for all of it would have cost thousands of transform
updates per frame for objects with no behaviour.

## Consequences

**Positive.** The village has ground cover that a person can edit. A scatter is
undoable in one keystroke, reproducible from a command line, and reviewable as a
diff. The density parameter means what it says. Vegetation costs draw calls
roughly in proportion to the number of distinct plants, not to the number of
plants.

**Negative.** The world file grew from 418 KB to 1.4 MB, and a diff that touches
a scatter run is large. Scattered vegetation cannot be picked in the game — an
acceptable trade today, and one that has to be revisited when a plant becomes
interactive (a bush that can be searched, grass that can be cut). Re-running
`pnpm import:scene` regenerates `content/worlds/village1.json` from the bundle
and drops every scattered entity; the scatter runs have to be replayed after it,
which is why the exact command lines are recorded in `docs/world-editor.md`.

**Not decided here.** The panel takes its region from two clicks on the ground
or from four numbers; a dragged rubber band in the viewport would be nicer and
is not implemented. Exclusion regions in the panel are limited to what the
rectangle and the keep-out patterns give; the polygon and per-entity keep-outs
are available from the command line only.

## How it is proved

- `packages/editor-core/src/scatter.test.ts` — determinism, the count against
  the usable area, the minimum distance, the id shape, that a second run with
  the same seed is refused, and that one undo removes the whole field.
- `packages/editor-core/src/random.test.ts` — the generator's first draws are
  pinned, and a scatter is run with `Math.random` replaced by a throwing stub.
- `packages/editor-core/src/footprint.test.ts` — the keep-out rectangles derived
  from placed buildings and paving.
- `apps/game/src/render/thin-instances.test.ts` — the matrix composition, and a
  real `Mesh` accepting a matrix buffer (the witness for the side-effect import
  that `Mesh.thinInstanceSetBuffer` needs).
- `tooling/smoke/smoke.spec.ts` — the panel previews a count, scatters twenty
  instances into the document _and_ into the scene, and gives them back on one
  Ctrl+Z.
- The village run itself: 3 473 grass tufts, 466 bushes and 93 small bushes,
  written by three `pnpm scatter` calls whose command lines are in
  `docs/world-editor.md`.
