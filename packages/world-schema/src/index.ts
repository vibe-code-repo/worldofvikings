/**
 * @wov/world-schema — the single source of truth for world data files.
 *
 * World data lives in `content/`, never in TypeScript source (see ADR-0004).
 * Everything that reads a world file must validate it through this package so
 * that a broken or outdated file fails loudly instead of silently.
 */
export {
  AssetPathSchema,
  assetPathOf,
  HexColorSchema,
  IdentifierSchema,
  turnedBy,
  Vector3Schema,
} from './common.js';
export type { AssetKindHint, FieldCommandHint, Identifier } from './common.js';
export { SCENE_ENTITY_ID_DIGITS, isSceneEntityId, sceneEntityId } from './entity-ids.js';
export {
  AmbientLightSchema,
  BloomSchema,
  FogSchema,
  LightingProfileSchema,
  PostProcessingSchema,
  SHADOW_FILTERS,
  ShadowFilterSchema,
  ShadowsSchema,
  SkySchema,
  SsaoSchema,
  SunLightSchema,
  TONE_MAPPINGS,
  ToneMappingSchema,
  VignetteSchema,
} from './lighting.js';
export type {
  AmbientLight,
  Bloom,
  Fog,
  LightingProfile,
  PostProcessing,
  ShadowFilter,
  Shadows,
  Sky,
  Ssao,
  SunLight,
  ToneMapping,
  Vignette,
} from './lighting.js';
export {
  AUDIO_DISTANCE_MODELS,
  AUDIO_PANNING_MODELS,
  AmbienceSchema,
  AudioDistanceModelSchema,
  AudioPanningModelSchema,
  FootstepBankSchema,
  FootstepsSchema,
  SoundEmitterSchema,
  SoundMasterSchema,
  SoundProfileSchema,
  SurfaceIdSchema,
} from './sound.js';
export type {
  Ambience,
  AudioDistanceModelName,
  AudioPanningModelName,
  FootstepBank,
  Footsteps,
  SoundEmitter,
  SoundMaster,
  SoundProfile,
} from './sound.js';
export {
  CURRENT_WORLD_SCHEMA_VERSION,
  EntityDefinitionSchema,
  WorldDefinitionSchema,
  ZoneDefinitionSchema,
  parseWorldDefinition,
} from './world.js';
export type {
  EntityDefinition,
  Vector3,
  WorldDefinition,
  WorldParseResult,
  ZoneDefinition,
} from './world.js';
export {
  LAYERS_PER_SPLAT_MAP,
  MAX_TERRAIN_LAYERS,
  TerrainDefinitionSchema,
  TerrainLayerSchema,
  terrainAssetPaths,
} from './terrain.js';
export type { TerrainDefinition, TerrainLayer } from './terrain.js';
export { WORLD_MIGRATIONS, migrateWorldData } from './migrations.js';
export type { WorldMigration, WorldMigrationResult } from './migrations.js';
export {
  CURRENT_PREFAB_SCHEMA_VERSION,
  PREFAB_CATEGORIES,
  PREFAB_COLLISION_KINDS,
  PREFAB_VISIBILITIES,
  PrefabAssetPathSchema,
  PrefabBoundsSchema,
  PrefabCatalogSchema,
  PrefabCategorySchema,
  PrefabColliderAssetSchema,
  PrefabCollisionKindSchema,
  PrefabCollisionSchema,
  PrefabDefinitionSchema,
  PrefabVisibilitySchema,
  isBackdrop,
  parsePrefabCatalog,
} from './prefab.js';
export type {
  PrefabBounds,
  PrefabCatalog,
  PrefabCatalogParseResult,
  PrefabCategory,
  PrefabColliderAsset,
  PrefabCollision,
  PrefabCollisionKind,
  PrefabDefinition,
  PrefabVisibility,
} from './prefab.js';
