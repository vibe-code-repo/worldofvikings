# content/

Authored game data — **never** TypeScript source (agent rule 9, ADR-0004).

Every file is plain, human-readable, reviewable JSON, carries a `schemaVersion`
and is validated by `pnpm validate` against `@wov/world-schema`.

| Folder       | Contains                                      | Status in Phase 0 |
| ------------ | --------------------------------------------- | ----------------- |
| `worlds/`    | `WorldDefinition` files written by the editor | schema + example  |
| `prefabs/`   | Reusable entity definitions (spec §19)        | empty             |
| `items/`     | Item database (spec §32)                      | empty             |
| `enemies/`   | Data-driven enemy definitions (spec §30)      | empty             |
| `quests/`    | Quest and objective definitions (spec §33)    | empty             |
| `skills/`    | Skill definitions                             | empty             |
| `dialogues/` | NPC dialogue trees                            | empty             |

`worlds/example.json` is a hand-written minimal world that exists so
`pnpm validate` has something real to check. It is not the game world.

The world is hand-crafted in the editor and never procedurally generated
(spec §11). Scatter tools may randomise, but their result is written into these
files (spec §12).
