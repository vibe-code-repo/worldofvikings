# ADR-0037: The cliff ring stays out of the village, and the reason is measured

- **Status:** accepted. Corrects the follow-up note in
  [ADR-0031](0031-the-backdrop-is-its-own-prefab-category.md), whose stated
  cause did not survive measurement.
- **Date:** 2026-09-07
- **Deciders:** world-data and asset-pipeline owners

## Context

`content/worlds/village1.json` carries 100 cliff instances — 97 from the
bundle's `Environments/Rocks`, 3 from `Environments/Environments Outside
Village` — in the zone `surroundings`. That zone has no terrain, `playableZone`
picks the zone that has one, and the game draws exactly one zone
(`apps/game/src/world-scene.ts`), so those 100 placements have never been on
screen.

ADR-0031 left a follow-up saying why they had not been moved: against this
zone's height field 22 of the 97 floated more than 3 m, one of them by 29 m, and
the cause given was resolution — _"the cliffs were authored against a 513²
surface and this repository ships the 257² reduction, which loses a quarter of
the faces steeper than 60°"_. It concluded: **"This needs the finer height field
first, and then the zone rule is a one-line change."**

The finer height field arrived with ADR-0032. The world file now names both an
adaptive tile (`heightField`) and the full 513² raster (`heightSamples`). So the
condition the note set was met, and this is the re-measurement it asked for.

## Decision

**The cliffs stay in `surroundings`. The resolution of the height field was
never the reason, and the finer field changes nothing.**

The table below is `pnpm seating --world village1 --zone surroundings --prefab
rock-cliff`, which this change adds so the numbers can be reproduced rather than
quoted. A gap is the smallest `model point y − ground under that point` over the
model's own vertices, transformed the way the game transforms them. The two
sections after it go past what the command reports and say how they were
measured.

### The rasters agree, and so do the answers

| ground the gap is measured against     | seated ≤ 0.5 m | over 0.5 m | over 3 m | worst   |
| -------------------------------------- | -------------- | ---------- | -------- | ------- |
| `heightSamples`, the full 513² raster  | 81 / 100       | 19         | 18       | 27.21 m |
| `heightField`, the drawn adaptive tile | 81 / 100       | 19         | 18       | 27.22 m |
| the modelling export's own 513² raster | 81 / 100       | 19         | 18       | 27.21 m |
| the 257² reduction ADR-0031 blamed     | 81 / 100       | 19         | 18       | 27.22 m |

The four grounds differ from each other by at most 1.49 m on any one cliff, and
by 0.02 m on average across the village (22 500 probes, adaptive tile against
the 513² raster; the largest disagreement anywhere is 0.45 m). **Going from the
257² reduction to the drawn adaptive tile is worth at most 1.5 m on a cliff; the
floating is worth 27 m.** It never was the resolution.

The export raster was checked against the shipped one in all eight ways a square
raster can be laid down. Exactly one reading matches — rows along x, columns
along z — and it matches _exactly_, mean |Δ| 0.0000 m. So the orientation is not
the cause either, and the tile is the export's own surface, not an approximation
of it.

### The bounding box was the second wrong answer

ADR-0031's 22-of-97 came from the corner of a transformed model box. 91 of these
100 instances are unevenly scaled and 22 are tilted, so a box corner is metres
away from any geometry. Measured on the model's own vertices instead, the same
world file gives 19 floating rather than 26, and 18 over 3 m rather than 22.
Both numbers are about the same placements; one of them is about the model and
the other about a box around it.

### Nothing else in the world is under them either

Two of the 19 rest on a neighbouring cliff rather than on the ground — a stacked
formation is a real thing and counts as seated. For the remaining 17 the nearest
surface underneath, over every entity of every zone within 45 m and the tile
itself, is still the ground: 17 placements hang 3.8 m to 27.2 m over everything
this repository has. Three of them have a bush under them, which is not a
footing.

**83 of 100 seated is the honest figure, against a bar of 95 %.** The 17 are not
a rounding error at the edge of a threshold: every one of them is over 3 m, and
six stand in a row along the north rim (z > 285) between 15.6 m and 27.2 m up,
fully visible, with 100 % of their geometry in the air. `pnpm perf:frame --view
rim` — a view this change adds, aimed at exactly that stretch of sky — takes the
picture: with the zone rule changed, the same frame carries a line of
house-sized rocks hanging over the rim with nothing under them.

### What the placements actually are

The 100 cliffs are a **ring around the tile**, not a feature inside it — 64 of
them stand within 15 m of an edge of the 300 m tile, spanning x 4.8–292.3 and
z 3.2–294.5. (ADR-0031's note says "x 55–118, z 119–151", which is a third
measurement that does not hold: four of the hundred stand in that rectangle.)
They ring the village the way a level's boundary does, and their heights follow
something that is not this tile: along the east edge they sink 33 m into it,
along the north edge they float 27 m over it. A single offset cannot fit both,
and no reading of the raster fits either.

That is the shape of geometry authored against a landscape this repository does
not have. The bundle's ground is stamped from shapes up to 859 m across on a
300 m tile, so the surface it describes does not stop where the tile does — and
the tile is the one square that was imported. The cliffs at the rim lean on what
is outside it.

### The rest is not a reason to move them either

- **21 of the 100 show less than 5 % of themselves** above the drawn tile, and
  19 rise less than 1 m out of it. Half the ring is buried. Moving all 100 buys
  79 visible rocks and 21 invisible ones that still cost a draw call and a body.
- **Every cliff prefab collides as `box`** (`content/prefabs/imported.json`), the
  catalogue's default for anything that is not vegetation, an opening or a
  backdrop. A hull box around `sm-env-rock-cliff-02-1` is 11.5 × 20.6 × 12.4 m
  before the instance scale — for a crate that is the right answer and for a
  jagged rock it is an invisible wall metres off its face. 100 of them is a ring
  of invisible walls, which is a decision of its own and not a side effect a
  zone rule should have.
- **The frame cost is small.** `pnpm perf:frame --view slope`, the view whose
  budget this project argues against: 16.61 → 16.91 ms scene render, 369 → 377
  draw calls, 27 → 65 active meshes. At `--view rim` the moved build measured
  _faster_ (16.44 → 15.27 ms, 365 → 371 draw calls), which is what an aimed view
  half full of sky is worth as a budget number and why the decision does not
  rest on it. Collision grows from 1 145 bodies / 210 shapes to 1 245 / 241 —
  100 new bodies, all of them hull boxes.

## Alternatives considered

| Alternative                                         | Why not                                                                                                                                                                                                         |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Move all 100 and accept 17 floating rocks           | They are not subtle. Six of them stand over the north rim between 15 m and 27 m up, in full view, and a horizon with rocks hanging in it is worse than a horizon with no rocks in it.                           |
| Move the 83 that are seated and leave the 17        | The ring is a wall. Taking 17 stones out of it — 10 of them within 8 m of the map's edge — leaves gaps a player walks through, and choosing which placements survive by a threshold is curation, not an import. |
| Snap the 17 down onto the tile                      | Inventing placement (agent rule 16, "no invented placement"). It is also not a small lie: 27 m down puts a rock through the ridge it was standing beside.                                                       |
| Raise the tile under them so they land              | The same invention, on the ground instead of on the rocks, and it would move the terrain under everything else that is already seated there.                                                                    |
| Import the neighbouring landscape the ring leans on | Possibly the real answer one day, but it is a new zone, a second tile and a streaming question (ADR-0031's own follow-up). It is not a zone rule.                                                               |
| Leave the note in ADR-0031 as it stands             | It sends the next reader to re-measure a height field that was already fine, and its three numbers — 22 of 97, the resolution, the extent — are all wrong in different directions.                              |

## Consequences

**Positive** — the reason the cliffs stay where they are is now a measurement
anybody can repeat in one command, against both rasters, instead of a sentence
that had to be believed. `pnpm seating` is not about cliffs: it answers "do
these placements touch the ground?" for any zone of any world, which is the
question every future import of a hand-placed group raises. The two claims that
were wrong are corrected where they were written down, in `scene-import.ts` and
in ADR-0031, and a test pins the zone rule to the reason rather than to a
comment.

**Negative** — 100 hand-placed cliffs stay invisible, and the village's rim is
still bare where a wall of rock was authored. The condition for changing that is
no longer "a finer height field" — which was cheap — but "the ground outside the
village tile", which is a zone, a tile and a streaming decision. That is a
larger bill than ADR-0031 implied, and it is better to know it now.

**Neutral** — `pnpm seating` reads the private store (ADR-0015), so a clone
without `WOV_ASSET_STORE` cannot run it. It fails saying so rather than
measuring placeholder hulls.

**Follow-ups**

- The 3 cliffs under `Environments/Environments Outside Village` were measured
  with the other 97 and behave no differently; there is no separate case for
  them.
- If the surrounding landscape is ever imported, re-run `pnpm seating` before
  touching the zone rule. The bar stays 95 % seated within 0.5 m.
- The collision kind for a large irregular rock is worth its own decision. It is
  not blocking anything today, because nothing in the village is a cliff.
