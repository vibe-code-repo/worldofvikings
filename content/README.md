# content/

Authored game data — **never** TypeScript source (agent rule 9, ADR-0004).

Every file is plain, human-readable, reviewable JSON, carries a `schemaVersion`
and is validated by `pnpm validate` against `@wov/world-schema`.

| Folder       | Contains                                      | Status in Phase 0 |
| ------------ | --------------------------------------------- | ----------------- |
| `worlds/`    | `WorldDefinition` files written by the editor | schema + example  |
| `prefabs/`   | `PrefabCatalog` files (spec §19, ADR-0016)    | schema + catalogs |
| `items/`     | Item database (spec §32)                      | empty             |
| `enemies/`   | Data-driven enemy definitions (spec §30)      | empty             |
| `quests/`    | Quest and objective definitions (spec §33)    | empty             |
| `skills/`    | Skill definitions                             | empty             |
| `dialogues/` | NPC dialogue trees                            | empty             |

`worlds/example.json` is a hand-written minimal world that exists so
`pnpm validate` has something real to check. It is not the game world.

`prefabs/base.json` is hand-written. `prefabs/imported.json` is written by
`pnpm generate:prefabs` from `assets/manifest.json` and committed: one prefab
per placeable asset, so a clone without the private asset store still sees the
whole catalogue (ADR-0016). Never edit it by hand — change the manifest or the
generator and run the command again. Curated prefabs, including a better
category or a default scale than the importer can derive, belong in a
hand-written catalog next to it.

A prefab id is unique across **all** catalogs, because an entity references it
by that id alone. `pnpm validate` checks it, together with every entity
reference.

The world is hand-crafted in the editor and never procedurally generated
(spec §11). Scatter tools may randomise, but their result is written into these
files (spec §12).
