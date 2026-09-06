# ADR-0028: The scene import carries authored blocks forward

- **Status:** accepted
- **Date:** 2026-09-06
- **Deciders:** world-data and tooling owners

## Context

`pnpm import:scene` rewrites a world file from a scene bundle (ADR-0021). The
bundle carries placements and nothing else, so anything else in that file is
authored somewhere other than the bundle:

- a zone's `terrain` block — a height field, its splat maps and the order of its
  layers (ADR-0020), written by the terrain import;
- a world's `lighting` block — the sun, the sky, the fog, the shadow map and the
  grade (ADR-0024), written by hand.

The importer already carried `terrain` forward, for exactly this reason. It did
not carry `lighting`, and the failure that produced is the quiet kind: running
the documented regeneration order — store import, prefabs, scene import — gave
back a village lit like a showroom. Nothing failed, nothing was logged, and the
world file still validated, because a world without a lighting profile is a
legal world that gets the renderer's defaults.

A second, smaller version of the same problem: the world file's key order. Zod
rebuilds a parsed object in the order the schema declares its fields, so that
declaration decides the key order of every tool that round-trips a world file —
`pnpm scatter` among them. `services/api` writes the lighting block before the
zones, deliberately, because a village's `zones` array is 39 000 lines and a
block behind it is a block nobody scrolls to. The schema declared it after. So
the same world written by the editor and by a script differed as files while
saying the same thing, and a diff of a scatter run was a diff of the light.

## Decision

**Everything in a world file that the bundle does not describe survives a
re-import, and one declaration decides the key order for every writer.**

- `carryOverAuthoredBlocks(fresh, previous)` in `tooling/scripts/scene-import.ts`
  copies the world's `lighting` and each zone's `terrain` and `lighting` from the
  file being replaced. Keyed by zone id and never by position, so a bundle that
  gained or lost a zone cannot hand one zone's ground to another; a zone the
  bundle no longer has is dropped with its blocks, because the fresh world is
  the list of zones that exist.
- The run names what it carried, so "the light survived" is something the
  operator reads rather than assumes.
- `WorldDefinitionSchema` declares `lighting` before `zones`, matching what
  `services/api` already wrote by hand.

**The scatter runs stay the exception.** A scatter is a command over _entities_
(ADR-0025), and entities are exactly what the import replaces; carrying them
over would mean a re-import silently kept placements the bundle no longer has.
They are re-run after an import instead, and the three runs that dressed
`village1` are written down in `docs/world-editor.md`.

## Alternatives considered

| Alternative                                                | Why not                                                                                                                                                                |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep the lighting somewhere else — a second file per world | Splits one world across two files, and the schema already says a world describes its own light. A world that has to be assembled from two places gets assembled wrong. |
| Re-apply the lighting by hand after each import            | This is what "silently drops it" means in practice: a step nobody is reminded of, whose omission has no symptom until somebody looks at the picture.                   |
| Carry the entities forward too, so scatter survives        | Then a re-import cannot remove a placement, and the bundle stops being the source of truth for what stands where.                                                      |
| Sort keys alphabetically everywhere instead                | Puts `id` after `entities` and `schemaVersion` last. The file is read by people; reading order beats sorting order.                                                    |

## Consequences

**Positive** — the documented regeneration order is safe to run: the manifest,
the prefab catalogue and the world file all reproduce, and the village keeps its
evening. A world written by the editor and by a script are the same file.

**Negative** — the importer now depends on the file it replaces being parseable.
It already did for `terrain`, and it still refuses to carry anything over from a
file it cannot parse rather than pretending the import succeeded.

**Follow-ups** — every future block that is authored into a world file rather
than imported has to be added to the carry-over, and there is nothing that
enforces that but this ADR and the test beside the function.
