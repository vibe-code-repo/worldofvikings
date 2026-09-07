# ADR-0038: A blocked move slides along the face it met

- **Status:** accepted
- **Date:** 2026-09-07
- **Deciders:** `fix/slide-along-walls`

## Context

Since ADR-0026 every entity in the village collides, and since then the village
has been close to unwalkable. `ObstacleQuery` answered one question — _may this
body move straight from here to there?_ — with a boolean, and `MovementSystem`
did the only thing a boolean allows: it tried the whole move, then the move on
the x axis alone, then on the z axis alone, and gave up. The village is a
hand-built place whose houses stand at whatever angle they were placed at, so
against most of its walls all three attempts run into the same wall and all
three are refused.

Measured on the village with the private store mounted, in the browser, against
the collision geometry the client itself built. First a survey: eight spawn
points, and from each one four five-second walks in turn — north, west, south,
east — each beginning where the one before it ended. Thirty-two walks, run
identically on both commits, scored on the path actually covered:

|                              | before      | after      |
| ---------------------------- | ----------- | ---------- |
| median path in five seconds  | **2.40 m**  | **6.05 m** |
| mean path                    | 3.47 m      | 8.05 m     |
| walks that covered under 1 m | **13 / 32** | **5 / 32** |

Then two of those walks in detail, each held for eight seconds and sampled twice
a second, because an average hides which second the player stopped in:

| walk                                                                      | before                                | after       |
| ------------------------------------------------------------------------- | ------------------------------------- | ----------- |
| from `152,170`, holding east along a wall the village built at an angle   | **3.12 m**, all of it in second one   | **12.71 m** |
| from `166,150`, pressed north into a nook for four seconds, then reversed | **7.43 m**, stopped after two seconds | **31.10 m** |

The second walk is the one that says what was really wrong. The player was not
stopped by a wall — that would be correct — it was wedged, and it could not
reverse out either, because the query casts six rays from around the body and
once the body is touching a wall some of those rays _start inside it_. A ray that
starts inside geometry reports a hit whichever way it is aimed, including
straight back the way the player came.

Two separate faults, then: nothing turns a blocked move into a move along the
wall, and a body that is already touching something is refused every direction
at once.

## Decision

**The obstacle query reports the surface, not a verdict, and the movement system
drops a blocked move onto that surface's plane.**

Three parts:

1. `ObstacleQuery.isFree(from, to, radius): boolean` becomes
   `ObstacleQuery.firstHit(from, to, radius): ObstacleHit | null`, where an
   `ObstacleHit` carries the surface normal and how far ahead it was.
2. `slideMove` in `@wov/gameplay` — a pure function, no renderer, no physics —
   takes the component of the move that runs _into_ the face away and keeps the
   component that runs _along_ it, then asks again. At most two deflections, so
   at most three queries. Two faces whose free directions contradict each other
   are a corner: the move is given up rather than resolved into one of the two
   walls. The velocity loses exactly what the move lost.
3. A surface is only in the way of a move that **approaches** it, and only if it
   is steep enough to be a wall — steep enough meaning it would rise more than
   `STEP_HEIGHT` across the width of the body. The first rule is what lets a
   player back out of a wall they are touching, and lets a move that has already
   been dropped onto a face (and is therefore exactly parallel to it) through.
   The second is what stops the terrain — collision geometry too, and grazed by
   every probe on every slope — from walling the player in with the ground they
   are standing on.

The dev build's bridge reports the last face met on `window.__wov.player` as
`normalX/normalY/normalZ` and `contactDistance`, and `__wov.rayHit` now returns
the normal and distance of what it hit. Sliding is a claim about a _direction_,
and no position on its own can check a direction.

## Alternatives considered

| Alternative                                                     | Why not                                                                                                                                                                                                          |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep the boolean; try more directions (8, 16, …) when refused   | Costs six raycasts per direction tried and still cannot follow a wall — it snaps to whichever of the fixed directions happens to be free, so the player's speed and heading depend on how the house was rotated. |
| Move the solving into the query, next to the physics            | Puts a gameplay rule behind the backend seam, where it cannot be unit-tested without Havok and where two implementations would have to agree about it (ADR-0009, ADR-0014).                                      |
| Swap the six rays for a swept capsule and use its contact       | A shape cast cannot be filtered by collision layer in this backend, so it catches the terrain under the player's feet on every slope — the reason `physics-obstacles.ts` uses rays at chosen heights at all.     |
| Let the physics engine's own character controller do the moving | Hands the simulation's determinism to the backend and ends the pure-function movement system (ADR-0009). A later phase may still want it; that is a bigger decision than this bug.                               |
| Push the body out of a wall it is inside (depenetration)        | Needs a penetration depth the ray query does not have, and treats the symptom. Not approaching a surface you are touching is enough to leave every corner.                                                       |

## Consequences

**Positive** — walking at a house is walking along a house. The player can
always reverse out of whatever they walked into, whatever the probes that start
inside it report. A slope gentle enough for the ground query to walk up is no
longer also a wall, so the terrain stops blocking moves the ground query would
have carried out anyway. The movement rules stay pure functions with unit tests
covering a wall met head-on, at 30°, at 60°, a corner, and backing out; the
physics stays behind its contract.

**Negative** — a blocked step still costs at most three obstacle queries, the
same number the axis fallback used, so the worst case is eighteen raycasts as
before and the common case — a clear path — is one query and six. The
"is this a wall or a slope" rule is a threshold, and a surface just either side
of it behaves differently; it is derived from `STEP_HEIGHT` and the body radius
rather than chosen, so it moves when those move. A corner still stops the
player — that is the intended answer, not a limitation being hidden.

**Follow-ups** — the probes still reach exactly one body radius past the
destination, so the player stops one radius from a wall rather than touching it;
closing that gap wants a swept query and is a separate change. The village has
places where two walls make a nook a metre wide, and no amount of sliding gets a
0.4 m body through one — those are level-design bugs and want an editor pass, not
a movement rule.
