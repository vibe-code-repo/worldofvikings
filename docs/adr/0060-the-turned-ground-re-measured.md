# ADR-0060: What stood on the old ground, re-measured on the new one

- **Status:** accepted
- **Date:** 2026-09-07
- **Deciders:** world pipeline

## Context

[ADR-0059](0059-the-ground-is-read-on-the-worlds-axes.md) turned the village's
height field onto the world's axes. Every number this repository has about
where something stands — the seating tables of
[ADR-0037](0037-the-cliff-ring-stays-out-of-the-village.md) and
[ADR-0045](0045-the-ground-dressing-is-buried-and-stays-where-it-was-authored.md),
the scattered field of [ADR-0025](0025-scatter-is-an-editor-command-whose-result-is-persisted.md),
the collision mesh, the named camera positions of `tooling/perf/views.ts` and
two fixed coordinates inside the smoke suite — was measured against the ground
as it was read before. This is the re-measurement, taken back to back on one
machine against two asset stores that differ in nothing but the tiles the
height-field import builds.

**How the "before" side was produced.** The store copy this branch works
against had already been re-imported, so the old tiles no longer existed. They
were rebuilt from the same export through the same functions with the one call
`transposeGrid` removed, into a second store, and the world file was taken from
the commit before ADR-0059 so that `heightSamples` still points where it did.
That reconstruction reproduces every published pre-change figure exactly —
4 931 of 5 273 seated, 77 showing less than 5 %, 81 of 100 cliffs, worst cliff
gap 27.22 m — which is what makes it usable as a baseline rather than an
approximation of one.

Everything below was measured with `WOV_ASSET_STORE` pointing at one of those
two stores and nothing else changed. The store on this branch still carries the
control maps mirrored about z = 150, so **no judgement here is about colour or
surface**; every number is geometry, read from height rasters, model vertices
and the physics world.

## Decision

**The re-cut is sound and stays. It is not finished: it invalidates the
scattered field of ADR-0025, which this change may not touch, and that is now
the one thing standing between this branch and a village that is right
everywhere.**

Three of the four groups that stood on the old ground come out better, one of
them dramatically. The fourth is the scatter output, which is regenerated data
measured against the ground it was generated from, and it is wrong by metres.

### The burial, before and after

`pnpm seating --world village1 --zone village`, 5 273 placements:

| measure                                      | old ground     | new ground     |
| -------------------------------------------- | -------------- | -------------- |
| seated within 0.5 m, against `heightSamples` | 4 931 (93.5 %) | 4 098 (77.7 %) |
| seated within 0.5 m, against the drawn tile  | 4 932 (93.7 %) | 4 093 (77.8 %) |
| median share of a model above the ground     | 70 %           | 87 %           |
| **showing less than 5 % of themselves**      | **77**         | **1 197**      |

Read as a headline that is a catastrophe, and it is the wrong reading. 4 032 of
the 5 273 are `pnpm scatter` output whose `y` was baked from the old surface, so
they were seated by construction and are now wrong by construction. Split by
who authored the placement, the same run says the opposite:

| group                        |     n | showing under 5 % | seated ≤ 0.5 m  | median gap        |
| ---------------------------- | ----: | ----------------- | --------------- | ----------------- |
| scattered (`_sN_`, ADR-0025) | 4 032 | 0 → **1 181**     | 100 % → 76.5 %  | −0.125 → −0.111 m |
| authored, backdrop excluded  | 1 216 | **63 → 2**        | 73.8 % → 82.7 % | −0.041 → −0.015 m |
| backdrop category (ADR-0031) |    25 | 14 → 14           | 8 % → 8 %       | not on the tile   |

### What happened to the 77, one by one

**14 of the 77 were never ground props.** Twelve clouds and the two painted
mountain shells stand outside the tile in x or z, so no point of them has
ground underneath and `visible` is 0 by definition. They are the backdrop
category of ADR-0031 and the metric cannot speak about them. They are unchanged
and should never have been in the count.

**62 of the remaining 63 come out of the ground.** Every one of them, measured
per entity on both grounds, crosses from under 5 % visible to over it.

**One of the 63 stays buried:** `environment-sm-env-stonewall-03_0069` at
(196.5, 191.9), which goes from 1 % to 4 % of itself showing — better, still
under the bar. It is a single placement, it is a wall segment, and it is worth
one person looking at by hand.

**One placement is a regression, and it is the only one in the world.**

| entity                                 |     x |     z | shows before | shows after | gap before | gap after |
| -------------------------------------- | ----: | ----: | ------------ | ----------- | ---------- | --------- |
| `environment-sm-env-stonewall-03_0124` | 156.6 | 183.0 | 35 %         | **0 %**     | −0.63 m    | −1.18 m   |

It is a wall segment in the yard north-west of the square that was already
two-thirds sunk and is now under the surface. Over all three zones and 5 614
placements it is the only entity that was visible and is not. It does not move:
that is a finding about a metre of ground in one yard, and it belongs with the
one above as the short list a person walks to.

### The cliff ring of ADR-0037 seats

`pnpm seating --world village1 --zone surroundings --prefab rock-cliff`:

| measure                  | old ground | new ground    |
| ------------------------ | ---------- | ------------- |
| seated within 0.5 m      | 81 / 100   | **100 / 100** |
| floating more than 0.5 m | 19         | **0**         |
| floating more than 3 m   | 18         | **0**         |
| worst gap                | +27.21 m   | **−0.81 m**   |
| showing less than 5 %    | 21         | **0**         |

The whole `surroundings` zone follows: 144 of 177 seated → 173 of 177, and 51
showing under 5 % → 10. The remaining 10 are the five chest tops and five chest
bottoms authored at (0, 0), which are off the tile in the same way the clouds
are. ADR-0037's central finding — that 17 cliffs hang over nothing this
repository has, and the ring therefore waits on a neighbouring tile — does not
survive. That ADR is amended in place; see the section added to it.

`interiors` moves the same way: 14 placements showing under 5 % → **0**.

### The scattered field of ADR-0025 is the price, and it is not paid here

`pnpm scatter` writes each tuft's `y` as the height of the surface under it, so
the direct measurement is the entity's own origin minus the ground beneath it —
no model, no minimum, no room for argument:

| ground             |      p05 |      p50 |      p95 | \|max\| | more than 0.3 m under | more than 0.3 m over |
| ------------------ | -------: | -------: | -------: | ------: | --------------------: | -------------------: |
| the old drawn tile | −0.036 m | −0.000 m | +0.036 m |  0.23 m |                     — |                    — |
| the new drawn tile | −5.180 m | −0.004 m | +6.077 m | 27.75 m |             **1 358** |            **1 274** |

That is the field the workyard picture shows: on the old ground the grass
carpets the yard, on the new one two thirds of it has gone into the hill or up
into the air. 4 032 entities is 76 % of the zone, they carry `collision: none`
and are drawn as thin instances excluded from casting, so nothing in the client
and no test in the suite notices — which is exactly why it is written down here
with a number instead of left to be discovered.

**This change does not fix it.** Re-running `pnpm scatter` from its seed is the
correct fix and it rewrites 4 032 entries of `entities` in
`content/worlds/village1.json`, which this branch is not permitted to touch and
which is the author's decision under ADR-0025. Until it is run, the village's
ground cover is wrong wherever the tile is not near the line x = z.

### Physics: the ground is walked on, not reasoned about

The collision report is unchanged in every view: **1 145 bodies from 210
shapes, 944 triangles, 4 128 walk-through**, and the terrain contributes the
same **281 216 collision triangles** before and after — the tile is the same
mesh, read the right way round (ADR-0059), and it is still the collision
geometry (`apps/game/src/main.ts` hands every terrain mesh to
`addStaticMesh`).

Driven in the built client, spawned at each named view and left alone for five
seconds:

| view       | spawn    | capsule y before | capsule y after | drift over 5 s |
| ---------- | -------- | ---------------: | --------------: | -------------: |
| `square`   | 150, 150 |           10.914 |          10.914 |        0.000 m |
| `slope`    | 120, 120 |           10.460 |          10.460 |        0.000 m |
| `workyard` | 178, 154 |           11.223 |      **12.049** |        0.000 m |
| `rim`      | 77, 255  |           14.143 |      **44.436** |        0.000 m |

`square` and `slope` do not move at all, and the reason is worth stating so
nobody reads it as "nothing changed": both spawn on the diagonal x = z, which
is the line a swap of the horizontal axes leaves alone. `workyard` and `rim`
are off it and they move. The capsule stands still at all four, `rim` included,
where the ground is now a 46° face — so the contract of `tooling/perf/views.ts`
("all four spawn on level ground, so two runs differ by 0.0000/255") is not
broken by sliding. What **is** broken is `rim` as a picture: it was aimed at
the north rim's sky and it now stands 30 m higher on a different hillside. It
must be re-aimed before any frame taken there is compared with an older one,
and the picture ADR-0037 takes from it is no longer that picture.

The one-sided ground probe (`GROUND_PROBE_HEIGHT = STEP_HEIGHT = 0.45`, so
ground that drops is free and ground that rises further than a step under a
walking player reports no ground) is measured rather than feared. Over a 1 m
grid, counting how far the surface rises to a neighbouring cell:

| ground | whole tile         | village core (x 120–215, z 105–215)       |
| ------ | ------------------ | ----------------------------------------- |
| old    | 33.9 % past 0.45 m | 2.4 % past 0.45 m, worst 1.17 m per metre |
| new    | 33.9 % past 0.45 m | 3.1 % past 0.45 m, worst 2.96 m per metre |

Identical over the tile, because the landscape is the same landscape; slightly
more of it inside the village. The risk is real and pre-existing, it is not
created by this change, and it still has no test.

`pnpm smoke` is green, 45 of 45, including the four assertions that wait on
`terrain ready — N collision triangles`: the zone finishes arriving. Two of
those 45 had to be corrected first and both are described below.

### Frame cost

`pnpm perf:frame` on ports 5289 / 3289 / 9289, same machine, back to back:

| view       | draw calls | active meshes | scene render     |
| ---------- | ---------- | ------------- | ---------------- |
| `square`   | 549 → 549  | 974 → 974     | 22.53 → 16.14 ms |
| `slope`    | 369 → 369  | 27 → 27       | 13.75 → 12.95 ms |
| `workyard` | 477 → 477  | 468 → 470     | 15.99 → 14.12 ms |

The counters are the number that means something and they do not move: the tile
is the same 281 216 triangles and the same two draw calls it always was. The
times are not a comparison — the "before" pass also built the bundles and ran
first on a cold machine, and `square` at 22.53 ms is that, not the old ground
costing 6 ms more. Nothing here is offered as a performance improvement.

The two rasters the world file names now answer the same world coordinates:
`heightSamples` against the drawn tile over 90 000 probes is a mean of
**0.019 m** apart with a worst case of **0.422 m**, all of it at the seams that
close the adaptive tile's T-junctions (ADR-0059).

### Two smoke tests were measuring the old ground and were corrected

Both failed on the new ground, both passed on the old one, and neither is a
failure of the re-cut. They are the two places in the suite that had a height
or a coordinate baked into them.

**`game leaves every gate in the village open`** probed for a clear corridor at
0.5 m and 1.4 m above each archway's _own origin_. That was only ever the
player's knee and chest by accident: on the old ground an archway sat anywhere
from 0.6 m above the surface to 2.7 m under it, and on the corrected ground all
nine settle about half a metre into it — so the knee probe of the deepest gate
now starts inside the hill and reports it bricked up. It is not. Driven in the
client, the player walks through that gate and keeps going 23 m past it. The
test now reads the floor from the client's own `groundAt`, three metres out on
either side of the gate (asking under the middle answers 4.58 m, which is the
top of the arch), and probes from there. The narrowest of the nine leaves
**2.50 m** clear at both heights with both posts solid, and the corrected test
**fails on the old ground** — it is stricter, not weaker.

**`walks along an angled wall instead of sticking to it`** (ADR-0038) held `d`
from (152, 170) and expected more than 8 m of path. That yard held a planter
box sunk 1.15 m into the old ground — a hole in the collision world the walk
went straight past. Read the right way round the box stands on the surface with
0.17 m embedded, and the old approach now wedges between it and the wall after
3.86 m, correctly, because a solid box is in the way. The spawn moves to
(146, 174), which meets the same run of stone at the same angle without a
planter on the line: **11.51 m of path for 10.33 m of displacement**, so 1.2 m
of it is the deflection the test exists for. No threshold was lowered.

## Alternatives considered

| Alternative                                                          | Why not                                                                                                                                                                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Re-run `pnpm scatter` in this change so the headline number recovers | It rewrites 4 032 entries of `entities`, which is authored world data and the author's decision (ADR-0025, ADR-0036). Doing it here would also hide the size of the effect inside a 4 032-line diff.         |
| Revert the re-cut because 77 became 1 197                            | The 1 197 is 1 181 tufts placed against the old surface plus the 16 already explained. On the placements that can testify — the ones a person put there — the same run says 63 buried became 2.              |
| Relax the two smoke assertions so they pass                          | Forbidden, and unnecessary: both were measuring from the wrong reference. The corrected gate test fails on the old ground, which is the proof it was not weakened.                                           |
| Move `environment-sm-env-stonewall-03_0124` up so nothing is buried  | It is authored placement. One buried wall segment is a finding about a yard's ground, and inventing a height for it is exactly what ADR-0045's rejected first attempt did.                                   |
| Re-aim `rim` in this change so ADR-0037's picture can be retaken     | The view's purpose was to frame the sky the cliff ring would hang in. The ring no longer hangs, so what that view should show is a question for whoever moves the cliffs, not a coordinate to guess at here. |

## Consequences

**Positive.** The three groups that can testify about the ground all agree with
it: 62 of the 63 buried ground props come out, all 100 cliffs seat, and the
`interiors` zone has nothing buried left. Every number ADR-0037 and ADR-0045
rest on has a measured successor, taken against a reconstructed baseline that
reproduces their published figures exactly. The physics world is unchanged in
size and the capsule stands still at all four named views.

**Negative.** The scattered field is wrong by up to 27 m and cannot be fixed
here. `rim` is no longer the view it was named for. One authored wall segment
is newly buried and one stays buried. Two smoke tests had coordinates in them
that only worked on the old ground, and the suite has no way to notice when the
next one does.

**Neutral.** Everything in this ADR needs `WOV_ASSET_STORE` (ADR-0015). A clone
without one cannot reproduce a single figure in it, and `pnpm seating` says so
rather than measuring placeholder hulls.

**Follow-ups.**

1. **Re-run `pnpm scatter` for the village's vegetation.** Nothing else on this
   branch is finished until that is decided. It is ADR-0059's first follow-up
   and this ADR is the measurement of what it costs to leave undone.
2. Re-aim `rim` in `tooling/perf/views.ts`, and re-take ADR-0037's picture from
   wherever the cliff ring now stands.
3. Look at `environment-sm-env-stonewall-03_0124` (156.6, 183.0) and
   `…_0069` (196.5, 191.9) by hand. Two placements, one yard each.
4. Give `pnpm seating` a `--scattered` switch and a backdrop exclusion, so its
   headline stops mixing regenerated output and unmeasurable prefabs into a
   count of buried props. Both splits in this ADR had to be made by hand.
5. The ground rising past `STEP_HEIGHT` under a walking player still has no
   test. It is now measured — 3.1 % of the village core, worst 2.96 m in one
   metre — which is the number a test would assert against.
