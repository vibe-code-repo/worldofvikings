# ADR-0036: A re-import keeps the entities the bundle never had

- **Status:** accepted
- **Date:** 2026-09-07
- **Deciders:** world-data and tooling owners

## Context

ADR-0028 made `pnpm import:scene` carry a world's authored `terrain` and
`lighting` blocks forward, and it drew one deliberate exception: the entities.
"A scatter is a command over _entities_, and entities are exactly what the
import replaces." So a re-import kept the ground and the evening and deleted
4 032 scattered plants — 28 224 lines of `content/worlds/village1.json` — and
the defence against that was a paragraph in `docs/world-editor.md` telling the
operator to re-run three commands afterwards.

That is the same failure ADR-0028 had just fixed, one field further along.
Nothing errors, nothing is logged, the file still validates, and the world is
simply barer than it was. The reasoning that produced it was not wrong, only
too coarse: **the bundle is the source of truth for the placements it
describes, not for every placement in the file.** A scattered tuft of grass is
not a placement the bundle has a worse version of; it is a placement the bundle
has never heard of.

The same is true of anything dropped into a zone by hand in the editor, which
before this change was quietly deleted by the next import as well.

## Decision

**Everything in a world file that the bundle does not describe survives a
re-import — the ground, the light, and every entity the importer did not
mint itself.**

1. **The id says who minted an entity**, and that is declared once, in
   `packages/world-schema/src/entity-ids.ts`:

   | minted by             | shape                  | on a re-import |
   | --------------------- | ---------------------- | -------------- |
   | the scene import      | `<prefab>_0001`        | replaced       |
   | a scatter run         | `<prefab>_s<seed>_<n>` | kept           |
   | placing in the editor | `<prefab>_001`         | kept           |

   `sceneEntityId` mints the first shape and `isSceneEntityId` recognises it:
   the entity's own prefab, an underscore, and then nothing but digits, four or
   more of them. `toEntities` in `@wov/content-build` is the only caller of the
   first, and `carryOverAuthoredBlocks` the only caller of the second.

2. **The namespace is reserved, not merely conventional.** `nextEntityId` in
   `@wov/editor-core` pads to three digits and, past 999, writes `_h1000`
   rather than `_1000`, so a hand-placed prop can never wear an id a re-import
   would read as the bundle's. A test walks 1 200 placements of one prefab and
   asserts that none of them is a scene id.

3. **Order is fresh first, carried after**, each in its own previous order. That
   is the order `village1.json` already has on disk, which is what makes the
   proof below possible.

4. **The run says what it kept.** `entitiesCarried` names the zones and the
   counts, and `entitiesDropped` counts authored entities lost with a zone the
   bundle no longer has — the one case where this still deletes work, now with a
   number in front of it instead of silence.

5. **One implementation, two front doors** (ADR-0033). The **World → Import
   scene bundle…** menu reaches the same `importSceneBundle`, so the editor
   keeps a scattered field for the same reason the command line does.

**The proof is that nothing happens.** Re-importing the real bundle over
`content/worlds/village1.json` now writes it back byte for byte: 5 614 entities,
1 582 of them re-minted from the bundle and 4 032 carried. Before the change the
same run deleted 28 224 lines. That is the property worth having — an import
with nothing new to say must say nothing.

## Alternatives considered

| Alternative                                                            | Why not                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Keep ADR-0028's rule and re-run the scatter commands after each import | This is what "silently drops it" means in practice: three commands nobody is reminded of, whose omission has no symptom until somebody looks at the ground. The same argument ADR-0028 made about the light.                                                 |
| An `origin: "scene"` field on every entity                             | A schema version, a migration, and a rewrite of every world file on disk — 1 582 entities gaining a field to record what their ids already record. It also goes stale in a way an id cannot: an entity can be duplicated, and a duplicated marker then lies. |
| Diff the fresh entities against the previous ones by transform         | Then a bundle entity somebody nudged in the editor is "different" and is kept _as well as_ replaced, and every re-import doubles it. Identity has to be an id, not a position.                                                                               |
| Keep every previous entity and add only what is new                    | Then a re-import can never remove a placement and the bundle stops being the truth about the placements it does describe — ADR-0028's objection, which stands.                                                                                               |
| Store the scatter runs in the world file and replay them after import  | A world file that holds a recipe instead of a village. Rejected once already in ADR-0025, for the same reason (agent rule 16).                                                                                                                               |

## Consequences

**Positive** — the documented regeneration chain is safe to run end to end: the
manifest, the prefab catalogue and the world file all reproduce, and the village
keeps its ground, its evening _and_ its 4 032 plants. Work done in the editor on
top of an imported world is no longer at the mercy of the next import. The three
scatter commands in `docs/world-editor.md` are now a record of how the field was
made, not a chore.

**Negative** — the importer now depends on an entity's id to know where it came
from, so renaming a prefab in a world file by hand (without renaming its
entities) can make a bundle entity look authored, and it would then be kept
alongside its replacement. `pnpm validate:content` rejects duplicate ids inside
a zone, so this fails loudly rather than doubling anything, but it fails at a
distance from its cause.

**Follow-ups** — `nextEntityId`'s `_h` fallback is only reachable past a
thousand copies of one prefab in one zone. If a third minter is ever added, it
belongs in the table in `entity-ids.ts` and needs a test that it stays out of
the reserved namespace.

## How it is proved

- `packages/world-schema/src/entity-ids.test.ts` — the three namespaces, and
  that what `sceneEntityId` mints `isSceneEntityId` recognises.
- `packages/content-build/src/scene-import.test.ts` — a scattered field and a
  hand-placed prop survive; a moved or deleted bundle entity does not; the
  carry-over is keyed by zone id, keeps the zone's key order, and is idempotent.
- `packages/editor-core/src/ids.test.ts` — 1 200 editor placements, none of them
  inside the reserved namespace.
- `tooling/smoke/editor-parity.spec.ts` — the fixture bundle imported from the
  **World** menu into a world the **Scatter** panel has planted, twice, with the
  world the API serves read back both times.
- The village itself: `pnpm import:scene --scene … --world village1` leaves
  `git status` clean.
