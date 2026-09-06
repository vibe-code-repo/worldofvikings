# ADR-0021: Authored worlds are imported from scene bundles into world files

- **Status:** accepted
- **Date:** 2026-09-06
- **Deciders:** project maintainers

## Context

The project has a world editor, a prefab catalogue of 438 models and a world
format — and one world file in it, holding a single barrel. Everything the
editor can do, it can do to nothing.

There is a village. It exists as a **scene bundle**: one 150 MB GLB from the
modelling export whose node hierarchy is a whole level, 6 900 nodes deep, with
every house, wall, path plank and hay bale standing exactly where a person put
it. Nothing about it is random. It is the most valuable authored content this
project has, and it was unreachable, because the repository's format is a list
of prefab references and the bundle is a tree of meshes.

Three problems stood between the two.

**The bundle is not only world data.** Alongside the village it carries the user
interface, characters, dialogue, cut scenes, cameras, lights, audio emitters,
invisible collision boxes and level-design markers. An import that takes
everything produces a world full of things that must never be in one.

**Half of the models are not in the store.** The per-model export
(ADR-0015) has the houses, the walls and the trees, but 446 of the placements
name geometry that only ever existed inside the bundle: house floors, wood
piles, braziers, path rock groups, spike walls. The names do not resolve because
there is no file to resolve them to.

**The two exports disagree about x.** The scene bundle's exporter negated the x
axis; the height field's did not. The disagreement is invisible in either file
on its own and total when they are put in one scene.

Behind all three sits agent rule 16 and AGENTS §7: **no procedural world
generation, ever.** A tool that reads a bundle and writes placements is close
enough to a generator that the difference has to be written down rather than
assumed.

## Decision

**1. Authored worlds are imported, and an import is a transcription.**
`pnpm import:scene` reads a scene bundle and writes `content/worlds/<id>.json`.
Every number in that file is a measurement of the bundle. Nothing is scattered,
nothing is randomised, nothing is derived from a seed. Run twice over the same
bundle it writes the same bytes, and a diff therefore means the bundle changed.
This is the same kind of thing `pnpm generate:prefabs` is (ADR-0016): authored
data, derived once, committed, and read from then on.

**2. Zones are an allow-list of bundle subtrees.** `Village/Village1` becomes
the `village` zone, `Village/Village Interiors` becomes `interiors`, and
`Environments`, `Effects` and the treasure chests become `surroundings`.
Everything else is left out **and named in the report** with the mesh nodes it
holds. An allow-list rather than a deny-list, so a node type nobody anticipated
lands in the report instead of in the world.

**3. One instance is the highest node whose name is a known model.** The search
descends until a node name folds onto a store file stem, takes that node's whole
subtree as one entity, and stops. That is what makes a house one entity rather
than its eighty planks. A node that draws and is not recognised also stops the
search — as a _miss_, reported by name and triangle count, never dropped.

**4. Bundle-only models become store models.** `pnpm import:scene-models` cuts
one store model per unmatched name out of the bundle: the subtree's meshes, the
materials they use and the images those materials point at, with the origin the
bundle gives them. They enter the private store, the manifest and the generated
catalogue exactly like an exported model (ADR-0015), and the world file then
references them by prefab id like any other.

**5. The world file is in Babylon's coordinates, and the format says so.**
Positions are metres, rotations are **radians in Y-X-Z order**, scale keeps
negative components. That is not a choice made by the importer: it is what
`apps/editor` does with the three numbers, and `docs/world-format.md` now
records it so the next tool does not have to guess.

**6. The mirroring is a measurement, not a convention.** The importer conjugates
every world matrix with a mirror on x. The evidence is in `docs/world-format.md`:
mirrored, all 1 216 village entities land inside the height field and 98.3 % of
them within 3 m of the ground under them; unmirrored, **none** of them is inside
the terrain at all.

## Alternatives considered

| Alternative                                                      | Why not                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Load the scene bundle at runtime as one large GLB                | It is 150 MB, it cannot be edited, it carries the user interface and the characters, and world data would live outside `content/` — against AGENTS §7 and rule 9. Every later edit would have to happen in another tool. |
| Generate a village procedurally instead                          | Forbidden (rule 16), and it would throw away the one thing the bundle is worth having: a level a person designed.                                                                                                        |
| Keep the unmatched placements out of the world                   | It loses 446 placements and 48 % of the triangles — every house floor and every path. Silence about half a village is worse than a store that grew by 138 models.                                                        |
| Inline the bundle-only geometry into the world file              | Against spec §19: entities reference prefabs, geometry is never inlined. It would also put megabytes of vertices into a reviewable JSON file.                                                                            |
| Store a quaternion per entity instead of Euler angles            | A format change (a new `schemaVersion` and a migration) for a rotation the editor's gizmo writes back as Euler anyway. Worth doing when something needs it; not as a side effect of an import.                           |
| Bake the mirroring into the store models instead of the matrices | The store is shared with the per-model import, whose models are already correct. Mirroring them to suit one bundle would break every world that does not come from one.                                                  |
| Import by walking to every mesh node                             | It produces 1 900 entities for nine houses, no two of which can be selected or moved as a house. The instance is the unit an author edits.                                                                               |

## Consequences

**Positive.** The editor has a real world to open: 1 580 entities in three
zones, 99.9 % of the bundle's world-building triangles placed. The village is
ordinary content from here on — reviewable as a text diff, editable with the
gizmos, saved through the API (ADR-0017). The store gained 138 models that were
previously unreachable, and two textures; everything else deduplicated against
what was already there. Both tools report what they did not take, so the gap
between "the bundle" and "the world file" is a list, not a mystery.

**Negative.** `content/worlds/village1.json` is 417 kB, which is large for a
reviewable file; a change to the import rules rewrites all of it. The
bundle-only models carry the origin the bundle gave them, which is an authored
anchor for a wall but arbitrary for a floor slab. Two backdrops and a sky dome
are excluded by the size limit and are therefore missing from the horizon. One
name in the bundle (`Roof_SM_Bld_Preset_Shelter_02`) covers two different
shapes, and the more common one is used for both.

**Follow-ups.** The terrain itself is not yet an entity in the world file — the
height field is centred on x/z in the store (ADR-0015) and needs a placement
rule of its own. Material properties the export dropped (alpha masking on
foliage, two-sided leaves, emissive crystals) are being restored separately, and
the cut models will need the same treatment. Zones are still a grouping only:
nothing streams them yet.
