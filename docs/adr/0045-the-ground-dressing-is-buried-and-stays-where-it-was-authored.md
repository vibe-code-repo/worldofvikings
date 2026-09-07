# ADR-0045: The ground dressing is buried, and stays where it was authored

- **Status:** accepted, with its cause corrected by
  [ADR-0059](0059-the-ground-is-read-on-the-worlds-axes.md) and its numbers
  re-measured by [ADR-0060](0060-the-turned-ground-re-measured.md); see the
  amendment at the end of this file. Its rule — the placements stay where they
  were authored — held, and is why the fix was possible.
- **Date:** 2026-09-07
- **Deciders:** world-data owners

## Context

Stones and small rocks were reported missing from the village. Two explanations
were plausible and they call for opposite answers, so both were measured before
anything was changed.

**The importer drops nothing.** `pnpm import:scene --dry-run` over the village
bundle places 1 297 525 of 1 297 845 triangles — 100.0 % — with exactly one
unmatched node in 6 927 (a sky dome, 320 triangles) and zero dropped entities.
Every rock-ish entity of the bundle's village root is in
`content/worlds/village1.json`, prefab for prefab: 286 of the village zone's
5 273, 12 of `interiors`' 164, 126 of `surroundings`' 177. There was no silent
loss to repair.

**The ground sits too high.** The height field this repository draws is a
reconstruction of the surface the props were authored on, and it is off by
roughly the thickness of a paving stone: over 5 249 in-tile placements the
difference runs p05 −0.84 m, median −0.12 m, p95 +1.03 m, and 89 % of it is
negative — the ground is above where the prop expected it. Under a house that is
invisible. Under a 0.16 m path rock it is fatal: **77 of 5 273 placements show
less than 5 % of themselves**, and almost all of those are ground dressing —
kerbs, slabs, path rocks, pebble groups.

The tempting alternative explanation was tested and rejected. "The paths were
never carved into the reconstruction" predicts that path pieces sit deeper than
their neighbours; measured over 371 path pieces against the props beside them,
the difference is a median of −0.03 m. The burial is uniform, not path-shaped.

An earlier draft of this decision answered the second finding with a measured
per-entity height correction stored beside each placement. That was rejected by
the author: **the stones are a placement matter, and placement is authored.**

## Decision

Record the measurement and change no position. The height field is what is
wrong; a correction stored next to a placement would move hand-authored world
data by a number an agent computed, and would do it in a way that goes stale
without a symptom the moment the terrain is re-baked.

The importer gains one thing instead: it now reports, by name, every node it
claimed as one prefab that holds recognisable meshes of its own
(`SceneInstance.swallowed`). Claiming a node claims its subtree, which is what
makes a house one entity rather than eighty planks and is right almost always.
`Environments/Start position` is the exception — it carries a mesh of its own
_and_ matches a store model, so 21 recognisable meshes under it, six of them
rocks, never become entities. That is lossless today only because the model cut
from that node happens to contain all of them. The next node shaped like it need
not be so lucky, and a silent drop is the one failure of this importer nobody
can see. So it is counted and said out loud rather than fixed by splitting,
because splitting would scatter every house into its planks.

## Alternatives considered

| Alternative                                                                  | Why not                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A measured `dy` correction per placement, in its own block beside `position` | Rejected by the author: a lift is a move, and the world is hand-crafted. It also goes stale silently — every number is measured against today's tile, and a terrain edit voids all of them with nothing on screen to show it. |
| Move the buried props in the world file                                      | Same objection, without even the block that made it reviewable.                                                                                                                                                               |
| Split the importer on nodes that swallow meshes                              | Would turn every house into its planks. The swallowing is reported instead.                                                                                                                                                   |
| Re-cut the height field so the authored surface is reproduced                | The real fix, and out of scope here: it is a terrain-import task with its own measurements, and it invalidates nothing else in the world file.                                                                                |

## Consequences

**Positive** — the missing-stones report has a cause with numbers behind it, and
the world file is unchanged. The importer can no longer lose a recognisable mesh
without saying so. `pnpm perf:frame --view workyard` names the place where a
change to the ground shows first.

**Negative** — the 77 buried placements stay buried until the height field is
re-cut. The village's ground dressing therefore still reads as sparser than it
was authored to be.

**Follow-ups**

- Re-cut the village height field against the authored surface, then re-measure
  the 77. That is the fix this decision defers, not one it rules out.
- The reference the author is working from is strewn far more densely than the
  61 pieces of dressing this measurement found. The bundle cannot supply that
  density — its detail stamps (nodes 4150–4203) are empty transform nodes with
  no mesh and no children — so it is a placement decision for the author, by
  hand or with `pnpm scatter`, and it is not made here.
- `Environments/Start position` swallows 19 recognisable meshes including six
  rocks. Worth deciding whether that one pattern should split.

## Amendment, 2026-09-07: the ground was not too high, it was turned

This ADR's rule stands and its refusal to move anything was right: the fix, when
it came, moved no placement. Three of its findings need correcting.

- **"The ground sits too high", p05 −0.84 m / median −0.12 m / p95 +1.03 m,
  89 % negative.** The distribution is real and it is mostly this repository's
  own output: 4 032 of the 5 249 in-tile placements are `pnpm scatter` tufts
  whose `y` was baked from that very surface, so they are negative by
  construction and testify about nothing. Over the 1 216 authored, non-backdrop
  placements the median gap is −0.041 m. There is no uniform vertical offset,
  and the ground is not uniformly too high.
- **The cause.** Not decimation, not an offset, not a tilt: the export writes
  its raster and its scene placements in two different frames and the
  difference is one reflection, which the import absorbed only half of
  (ADR-0059). The village sits near the line the two readings agree on, so a
  0.3 m error there read as ground dressing a paving stone too deep.
- **"77 of 5 273 show less than 5 % of themselves."** 14 of the 77 are clouds
  and the two painted shells, which stand outside the tile and cannot be
  measured this way (ADR-0031). The real count was 63. On the corrected ground
  62 of the 63 come out, one stays buried
  (`environment-sm-env-stonewall-03_0069`), and one that was 35 % visible is
  now under the surface (`environment-sm-env-stonewall-03_0124`) — the only
  such regression in the world. Both are single placements and neither moves.
  The full before/after is in ADR-0060.
