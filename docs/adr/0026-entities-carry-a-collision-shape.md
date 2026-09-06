# ADR-0026: Entities carry a collision shape, decided at import time

- **Status:** accepted
- **Date:** 2026-09-06
- **Deciders:** engine and world-data owners

## Context

Until now the only thing in the game the player could not walk through was the
terrain (ADR-0022). The village zone stands 1216 entities from 139 models on
that terrain — houses, palisades, stone walls, docks, trees — and the player
walks through every one of them. That is the single largest gap between what is
drawn and what is simulated, and no screenshot shows it.

Four things make it more than "add a collider":

1. **Cost.** 1216 entities is 1216 bodies if nothing is shared, and building a
   convex hull or a triangle mesh per entity means building the same one eighty
   times. The frame budget (spec §38) does not have room for that, and neither
   does the memory.
2. **Transforms.** The world file scales almost every entity, 632 of them
   unevenly and 133 of them negatively (mirrored). A rigid-body solver has
   nowhere to put a scale.
3. **The shape is not the model.** A tree's hull is its _crown_: 6.8 m across
   for a pine whose trunk is 0.6 m. Colliding against the hull turns a wood into
   a wall. An archway's hull is a slab: colliding against it bricks up the
   opening. Neither is visible in a test that only asks "does it collide".
4. **Nothing stops anything today.** The player is moved by a pure function over
   a `GroundQuery` — a downward raycast — with no capsule in the simulation at
   all. Static bodies alone would change nothing.

## Decision

**A prefab says what it is shaped like, the importer decides it, and the game
builds one shared shape per prefab and scale.**

- `PrefabDefinition.collision` is a new optional field:
  `kind: none | box | hull | mesh`, plus `asset` for a separate low-triangle
  collider model and `box` for a box measured somewhere other than the hull.
  Optional, so the format change is additive; **absent means undecided and a
  reader treats it as `none`**, which is what the game did before.
- `pnpm generate:prefabs` fills it in from rules over the manifest: scenery and
  props get `box`, the ground gets `mesh`, grass and bushes get `none`, a model
  that ships a `-collision` file is collided against that file, a model named as
  an opening gets `mesh`, and a tree gets a `box` **measured at its trunk** — for
  which the command reads the model out of the asset store, because the trunk's
  width is written down nowhere else. Those collider files stop being placeable
  prefabs of their own.
- `PhysicsWorld.addStaticGroup` takes one shape and every placement of it. The
  village's 1216 entities are 220 distinct _(prefab, scale)_ pairs, so 220
  shapes carry 1216 bodies. A placement is a position and a rotation quaternion:
  **the scale is baked into the shape's coordinates**, which is also how a
  mirrored entity gets a mirrored shape with its triangles wound the other way.
- Gameplay gets an `ObstacleQuery` — the sibling of `GroundQuery`, one method,
  no renderer — and `MovementSystem` consults it: if the move it computed is
  refused it retries on one axis and then the other, so a player walking into a
  wall stops and one walking into it at an angle slides along it.
- The game answers that query with six rays per step, at two heights above the
  feet and along both shoulders. The lower height is `STEP_HEIGHT` — the same
  number the ground probe now uses, so anything the player can be pulled up onto
  is below the lowest ray and a kerb they are standing on cannot stop them.
- Interiors stay out: only the playable zone is built, and `interiors` is not it.

## Alternatives considered

| Alternative                                        | Why not                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A simulated character capsule pushed by the solver | It moves the authority over the player's position out of `MovementSystem` and into Havok, which breaks ADR-0009's "systems are pure functions" and makes the simulation non-reproducible. It is the right long-term answer for a character with mass; it is not a prerequisite for walls. |
| A swept capsule (`shapeCast`) instead of rays      | The backend's shape cast takes no collision-layer filter, so the sweep catches the terrain under the player's own feet and stops them walking uphill. Rays can be aimed exactly where a wall is and take a filter.                                                                        |
| One collider per entity, no sharing                | 1216 shapes instead of 220, and the same convex hull rebuilt eighty times.                                                                                                                                                                                                                |
| Scale on the body, shape shared across scales      | Havok's shape scaling goes through a container shape per body, which is a shape per entity again — and the mirrored case is exactly where it is least trustworthy.                                                                                                                        |
| Collision shapes hand-authored in the world file   | 1216 hand-decisions that go stale the moment the assets are re-imported. The rule belongs with the model, not with the placement.                                                                                                                                                         |
| A `capsule` kind for tree trunks                   | A second round shape to keep in step for a difference the player cannot feel at a 0.4 m trunk. A narrow box measured at the trunk is the same answer for less.                                                                                                                            |
| Reading the hull out of `assets/manifest.json`     | The manifest measures the model file's space; Babylon mirrors a glTF on its root node, so a box copied from the manifest is mirrored against what the player sees. The hull is measured on the container that was actually loaded.                                                        |
| Deciding the shape in the game at load time        | It would be decided again on every start, could not be reviewed in a diff, and could not read the trunk of a model the client does not download.                                                                                                                                          |

## Consequences

**Positive.** The village is solid: houses, walls and palisades stop the player,
trees stop them at the trunk and not at the crown, grass and bushes do not. What
each thing is shaped like is data, reviewable in a diff, regenerated with the
assets. The cost is measured and published on the dev bridge rather than
assumed.

**Negative.**

- The zone becomes solid a few seconds after it becomes visible: the shapes are
  built from the loaded models, so they cannot exist before those models do. The
  status line says which of the two has happened.
- `box` is a coarse answer for anything with a hole in it that is not named like
  one. A palisade run with a gate in the middle collides as a solid slab until
  someone gives it a `-collision` file or an opening in its name.
- The ground probe now starts one step above the feet instead of at head height.
  That is what stops a low roof from being reported as the floor now that roofs
  are collision geometry — but it also means a surface more than `STEP_HEIGHT`
  above the feet can never be stepped onto, only walked around.
- A prefab catalogue without `collision` collides against nothing. That is the
  safe reading, and it is silent: the count of undeclared entities is reported
  on the dev bridge so it is at least visible.

**Follow-ups.**

- A real character capsule, once there is a character (spec §25). The
  `ObstacleQuery` seam is where it plugs in: the query goes away, the movement
  rules do not.
- Zone streaming will need `StaticBody.dispose` per zone; `addStaticGroup`
  already hands back one handle per group for exactly that.
- Interiors need collision when they become enterable, which needs portals
  first.
