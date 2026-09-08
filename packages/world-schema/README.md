# @wov/world-schema

**Purpose.** The single source of truth for the world data format. Every reader
of a file in `content/worlds/` validates it here, so a broken or outdated file
fails loudly (spec §16, §44; ADR-0004).

**Public API.**

World files (`content/worlds/*.json`):

- `CURRENT_WORLD_SCHEMA_VERSION` — the format version this build understands.
- `WorldDefinitionSchema`, `ZoneDefinitionSchema`, `EntityDefinitionSchema` — Zod schemas.
- `parseWorldDefinition(data): WorldParseResult` — validates unknown data, migrating a known older version forward first; returns either the world (with `migratedFrom` when a migration ran) or human-readable errors.
- `TerrainDefinitionSchema`, `TerrainLayerSchema`, `terrainAssetPaths(terrain)`, `MAX_TERRAIN_LAYERS`, `LAYERS_PER_SPLAT_MAP` — a zone's ground (ADR-0020), including each layer's optional `normalMap`, `normalScale`, `metallic` and `smoothness`, the terrain's `flatNormals` and its `heightSamples` (ADR-0032).
- `LightingProfileSchema` and its groups (`SunLightSchema`, `AmbientLightSchema`, `SkySchema`, `FogSchema`, `ShadowsSchema`, `PostProcessingSchema`, `BloomSchema`, `VignetteSchema`, `SsaoSchema`), plus `SHADOW_FILTERS` and `TONE_MAPPINGS` — how a world or a zone is lit (ADR-0024). Every group and every field is optional; what a file leaves out comes from the renderer's defaults.
- `SoundProfileSchema` and its groups (`SoundMasterSchema`, `AmbienceSchema`, `FootstepsSchema`, `FootstepBankSchema`, `SoundEmitterSchema`), plus `AUDIO_DISTANCE_MODELS` and `AUDIO_PANNING_MODELS` — how a world or a zone sounds (ADR-0062). Optional all the way down like `lighting`, but the default is silence rather than a stand-in: a world that names no clips has nothing to play. An emitter carries exactly one of `prefab` (a rule over every placement of that prefab), `entity` or `position`.
- `migrateWorldData(data, target)`, `WORLD_MIGRATIONS` — the recorded upgrade steps between versions.
- Types: `WorldDefinition`, `ZoneDefinition`, `EntityDefinition`, `WorldParseResult`, `TerrainDefinition`, `TerrainLayer`, `LightingProfile`, `SoundProfile` (and one type per group), `WorldMigration`, `WorldMigrationResult`.

Prefab catalogs (`content/prefabs/*.json`, ADR-0016):

- `CURRENT_PREFAB_SCHEMA_VERSION`, `PREFAB_CATEGORIES`, `PREFAB_VISIBILITIES`.
- `PrefabCatalogSchema`, `PrefabDefinitionSchema`, `PrefabCategorySchema`, `PrefabVisibilitySchema`, `PrefabAssetPathSchema`, `PrefabBoundsSchema`.
- `parsePrefabCatalog(data): PrefabCatalogParseResult`.
- `isBackdrop(prefab)` — whether a prefab is painted distance rather than a thing in the world (ADR-0031).
- `castsShadows(prefab)`, `SHADOW_CASTER_MINIMUM_HEIGHT` — whether a prefab belongs in the sun's shadow map, answered from its **measured bounds**: vegetation under 0.5 m does not cast, a backdrop never does, and a prefab with no measured bounds does (ADR-0027, ADR-0031). It lives here rather than in `apps/game` because the editor has to draw the same light and no app may import another (ADR-0049).
- Types: `PrefabCatalog`, `PrefabDefinition`, `PrefabCategory`, `PrefabVisibility`, `PrefabBounds`, `PrefabCatalogParseResult`, `ShadowCastingPrefab` (the `{category, bounds?}` shape `castsShadows` asks for, so a catalogue row, a manifest row or a literal can all answer).

Shared: `IdentifierSchema`, `Vector3Schema`, `HexColorSchema`, `AssetPathSchema`,
`assetPathOf(kind)`, types `Identifier`, `Vector3`, `AssetKindHint`.

Entity ids: `sceneEntityId(prefab, n)`, `isSceneEntityId(id, prefab)`,
`SCENE_ENTITY_ID_DIGITS` — the one declaration of which id shape the scene
import owns, so a re-import knows what is its to replace and what somebody
authored (ADR-0036).

`assetPathOf('texture')` is `AssetPathSchema` with the _kind_ of file the field
names attached through Zod's `.meta()`. It changes no validation. It exists so a
panel can offer the asset store's own images for a ground texture without
`apps/editor` holding a list of which fields are paths (ADR-0033); the
vocabulary is the asset manifest's `kind`, repeated by name because this package
may not depend on `@wov/asset-system`.

**Dependencies.** `zod` only — chosen because schema and TypeScript type come
from one declaration (ADR-0004). This package must never depend on Babylon.js,
React, Node built-ins or `@wov/asset-system`; the boundaries are enforced by
`pnpm lint:boundaries`. The asset path rule in `PrefabAssetPathSchema` is
therefore a deliberate copy of `AssetPathSchema`; both sides carry a note
saying they change together (ADR-0016).

**Ownership.** Core maintainers. Format changes require a schema version bump
and a documented migration — never a silent change (agent rule 11).
