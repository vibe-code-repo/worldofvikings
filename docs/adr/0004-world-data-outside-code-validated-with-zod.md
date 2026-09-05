# ADR-0004: World data lives outside the code and is validated with Zod

- **Status:** accepted
- **Date:** 2026-09-05
- **Deciders:** project maintainers

## Context

The world is hand-crafted in the editor, not generated (spec §11). Editor and
game communicate purely through data (spec §16). In an open-source project many
people contribute content, so invalid or outdated files are a certainty, and a
world file must never break silently (§44, agent rules 9-11).

## Decision

World, prefab, item, enemy and quest data live as human-readable JSON under
`content/`, never in TypeScript source. Every file carries a `schemaVersion`.
All readers validate through `@wov/world-schema`, which defines the format with
**Zod**. `pnpm validate` checks `content/` in CI. An unknown `schemaVersion` is a
hard error with a dedicated message, never a silent migration.

## Alternatives considered

| Alternative                                  | Why not                                                                                                                                                                     |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript files as world data               | Content changes would become code changes; non-programmer designers could not contribute; diffs become unreviewable.                                                        |
| Hand-written JSON Schema                     | Types and schema drift apart because they are two declarations of the same thing. Zod derives the TypeScript type from the schema; JSON Schema can still be exported later. |
| Zod alternatives (Valibot, ArkType, TypeBox) | Smaller or faster, but Zod's error reporting and ecosystem familiarity matter more here; validation is not on a hot path.                                                   |
| Binary format from the start                 | Unreviewable in a pull request. Consider a build-time binary form for published worlds later, keeping JSON as the authored format.                                          |

## Consequences

**Positive** — content is reviewable in PRs; one declaration yields both runtime
validation and static types; broken content fails in CI, not in a player's
browser.

**Negative** — one runtime dependency (`zod`) in a package the game bundles;
JSON is verbose for large worlds.

**Follow-ups** — add zone/prefab/item schemas as those formats appear; export
JSON Schema if external tooling needs it; measure the payload size of large
worlds before Phase 5 and consider a compiled form for published builds.
