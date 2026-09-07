# ADR-0045: The ground dressing is buried, and stays where it was authored

- **Status:** accepted.
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
