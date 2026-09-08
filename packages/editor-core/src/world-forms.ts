/**
 * The blocks the editor's panels draw, described once (ADR-0033).
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
  SoundEmitterSchema,
  SoundProfileSchema,
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

/**
 * Every field of a sound profile: master, bed, footsteps, emitters, cull
 * distance (ADR-0062).
 *
 * Including the footstep banks and the emitter list, which are lists of groups
 * — `SchemaFields` already draws those with add, remove and reorder, and it
 * draws them for the terrain layers today. The clip fields inside them arrive
 * as asset pickers filtered to audio, because the *schema* says
 * `assetPathOf('audio')`; nothing in `apps/editor` names a sound field.
 */
export const SOUND_FIELDS: readonly FormField[] = describeFields(SoundProfileSchema);

/**
 * One emitter on its own, for the panel that edits the emitter of a *selected
 * entity* rather than the zone's whole list.
 *
 * The same descriptors the list inside {@link SOUND_FIELDS} carries. Derived
 * again from the emitter schema instead of dug out of the profile's field tree,
 * because reaching into `SOUND_FIELDS[3].item.fields` would be a panel knowing
 * that `emitters` is the fourth key — which is the sort of thing that keeps
 * working right up until somebody adds a group above it.
 */
export const SOUND_EMITTER_FIELDS: readonly FormField[] = describeFields(SoundEmitterSchema);

/** What a prefab collides as (ADR-0026): the kind, its collider file, its box. */
export const PREFAB_COLLISION_FIELDS: readonly FormField[] = describeFields(PrefabCollisionSchema);
