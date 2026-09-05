/**
 * @wov/world-schema — the single source of truth for world data files.
 *
 * World data lives in `content/`, never in TypeScript source (see ADR-0004).
 * Everything that reads a world file must validate it through this package so
 * that a broken or outdated file fails loudly instead of silently.
 */
export {
  CURRENT_WORLD_SCHEMA_VERSION,
  EntityDefinitionSchema,
  Vector3Schema,
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
