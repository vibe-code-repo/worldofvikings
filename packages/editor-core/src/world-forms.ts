/**
 * The three blocks the editor's panels draw, described once (ADR-0033).
 *
 * `describeFields` walks a schema, which is cheap but not free, and the answer
 * cannot change while the program runs — so it is computed here at module load
 * and the panels import the result. It also means there is exactly one place
 * that names which schema a panel is for, instead of three panels each reaching
 * into `@wov/world-schema` for a different one.
 */
import {
  LightingProfileSchema,
  PrefabCollisionSchema,
  TerrainDefinitionSchema,
} from '@wov/world-schema';
import { describeFields, type FormField } from './schema-form.js';

/** Every field of a lighting profile: sun, ambient, sky, fog, shadows, grade. */
export const LIGHTING_FIELDS: readonly FormField[] = describeFields(LightingProfileSchema);

/**
 * Every field of a zone's ground.
 *
 * Including the ones that do not exist yet: the terrain work is adding
 * `normalMap`, `normalScale`, `metallic` and `smoothness` to a layer, and they
 * will appear in the inspector the moment the schema accepts them, with no
 * change to `apps/editor`.
 */
export const TERRAIN_FIELDS: readonly FormField[] = describeFields(TerrainDefinitionSchema);

/** What a prefab collides as (ADR-0026): the kind, its collider file, its box. */
export const PREFAB_COLLISION_FIELDS: readonly FormField[] = describeFields(PrefabCollisionSchema);
