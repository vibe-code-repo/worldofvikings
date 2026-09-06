# @wov/world-schema

**Purpose.** The single source of truth for the world data format. Every reader
of a file in `content/worlds/` validates it here, so a broken or outdated file
fails loudly (spec §16, §44; ADR-0004).

**Public API.**

World files (`content/worlds/*.json`):

- `CURRENT_WORLD_SCHEMA_VERSION` — the format version this build understands.
- `WorldDefinitionSchema`, `ZoneDefinitionSchema`, `EntityDefinitionSchema` — Zod schemas.
- `parseWorldDefinition(data): WorldParseResult` — validates unknown data and returns either the world or human-readable errors.
- Types: `WorldDefinition`, `ZoneDefinition`, `EntityDefinition`, `WorldParseResult`.

Prefab catalogs (`content/prefabs/*.json`, ADR-0016):

- `CURRENT_PREFAB_SCHEMA_VERSION`, `PREFAB_CATEGORIES`, `PREFAB_VISIBILITIES`.
- `PrefabCatalogSchema`, `PrefabDefinitionSchema`, `PrefabCategorySchema`, `PrefabVisibilitySchema`, `PrefabAssetPathSchema`, `PrefabBoundsSchema`.
- `parsePrefabCatalog(data): PrefabCatalogParseResult`.
- Types: `PrefabCatalog`, `PrefabDefinition`, `PrefabCategory`, `PrefabVisibility`, `PrefabBounds`, `PrefabCatalogParseResult`.

Shared: `IdentifierSchema`, `Vector3Schema`, types `Identifier`, `Vector3`.

**Dependencies.** `zod` only — chosen because schema and TypeScript type come
from one declaration (ADR-0004). This package must never depend on Babylon.js,
React, Node built-ins or `@wov/asset-system`; the boundaries are enforced by
`pnpm lint:boundaries`. The asset path rule in `PrefabAssetPathSchema` is
therefore a deliberate copy of `AssetPathSchema`; both sides carry a note
saying they change together (ADR-0016).

**Ownership.** Core maintainers. Format changes require a schema version bump
and a documented migration — never a silent change (agent rule 11).
