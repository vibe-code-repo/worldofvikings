# @wov/world-schema

**Purpose.** The single source of truth for the world data format. Every reader
of a file in `content/worlds/` validates it here, so a broken or outdated file
fails loudly (spec §16, §44; ADR-0004).

**Public API.**

- `CURRENT_WORLD_SCHEMA_VERSION` — the format version this build understands.
- `WorldDefinitionSchema`, `ZoneDefinitionSchema`, `EntityDefinitionSchema`, `Vector3Schema` — Zod schemas.
- `parseWorldDefinition(data): WorldParseResult` — validates unknown data and returns either the world or human-readable errors.
- Types: `WorldDefinition`, `ZoneDefinition`, `EntityDefinition`, `Vector3`, `WorldParseResult`.

**Dependencies.** `zod` only — chosen because schema and TypeScript type come
from one declaration (ADR-0004). This package must never depend on Babylon.js,
React or Node built-ins; the boundary is enforced by `pnpm lint:boundaries`.

**Ownership.** Core maintainers. Format changes require a schema version bump
and a documented migration — never a silent change (agent rule 11).
