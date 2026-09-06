import { z } from 'zod';
import { IdentifierSchema, Vector3Schema, findDuplicates, formatIssues } from './common.js';
import { LightingProfileSchema } from './lighting.js';
import { migrateWorldData } from './migrations.js';
import { TerrainDefinitionSchema } from './terrain.js';

/**
 * Version of the world file format understood by this build.
 *
 * Rule (spec §16, agent rule 11): never silently accept or rewrite a different
 * version. Bump this constant together with a documented migration in
 * `migrations.ts` — version 2 added the optional `terrain` on a zone (ADR-0020),
 * version 3 the optional `lighting` on a world and on a zone (ADR-0024).
 */
export const CURRENT_WORLD_SCHEMA_VERSION = 3;

/** A single placed entity. It references a prefab instead of inlining geometry. */
export const EntityDefinitionSchema = z.strictObject({
  id: IdentifierSchema,
  prefab: IdentifierSchema,
  position: Vector3Schema,
  rotation: Vector3Schema.optional(),
  scale: Vector3Schema.optional(),
});

/** A zone is the unit of streaming (spec §17), not a generation unit. */
export const ZoneDefinitionSchema = z.strictObject({
  id: IdentifierSchema,
  name: z.string().min(1),
  entities: z.array(EntityDefinitionSchema),
  /**
   * The ground of this zone: one height field with its texture layers, or
   * nothing at all (ADR-0020).
   *
   * Optional because a zone need not have ground — an interior, a dungeon
   * level or a zone still being blocked out has none — and because that is what
   * makes version 1 a version 2 file with the field absent.
   */
  terrain: TerrainDefinitionSchema.optional(),
  /**
   * How this zone is lit, overriding the world's profile group by group
   * (ADR-0024).
   *
   * Optional, and optional all the way down: a zone that says nothing is lit
   * like its world, and a zone that says only `{"fog": {"end": 60}}` is its
   * world's evening in a shorter view. That is what an interior needs — the
   * same sun, none of its reach.
   */
  lighting: LightingProfileSchema.optional(),
});

/** The root object of every file in `content/worlds/`. */
export const WorldDefinitionSchema = z
  .strictObject({
    schemaVersion: z.literal(CURRENT_WORLD_SCHEMA_VERSION),
    id: IdentifierSchema,
    name: z.string().min(1),
    zones: z.array(ZoneDefinitionSchema),
    /**
     * How this world is lit, unless a zone says otherwise (ADR-0024).
     *
     * Absent means the renderer's defaults, which are a lit outdoor scene and
     * not a black void — a world file is never *required* to describe light.
     */
    lighting: LightingProfileSchema.optional(),
  })
  .refine((world) => findDuplicates(world.zones.map((zone) => zone.id)).length === 0, {
    message: 'duplicate zone id',
  })
  .refine(
    (world) =>
      world.zones.every(
        (zone) => findDuplicates(zone.entities.map((entity) => entity.id)).length === 0,
      ),
    { message: 'duplicate entity id inside a zone' },
  );

export type Vector3 = z.infer<typeof Vector3Schema>;
export type EntityDefinition = z.infer<typeof EntityDefinitionSchema>;
export type ZoneDefinition = z.infer<typeof ZoneDefinitionSchema>;
export type WorldDefinition = z.infer<typeof WorldDefinitionSchema>;

/**
 * Result of {@link parseWorldDefinition}: either a world or human-readable
 * errors.
 *
 * `migratedFrom` is set when the file on disk was an older version that a
 * recorded migration brought forward. The caller decides what to do with that
 * — the API says so in its log, the editor shows it — but nothing is written
 * back until someone saves, so a migration is never silent (agent rule 11).
 */
export type WorldParseResult =
  | { readonly ok: true; readonly world: WorldDefinition; readonly migratedFrom?: number }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Validates unknown data as a {@link WorldDefinition}, migrating an older but
 * known `schemaVersion` forward first (see `migrations.ts`).
 *
 * A version this build has no path from — a newer one, or an older one with no
 * recorded step — gets a dedicated message so that a contributor immediately
 * sees a version problem instead of a field problem caused by one.
 */
export function parseWorldDefinition(data: unknown): WorldParseResult {
  const migrated = migrateWorldData(data, CURRENT_WORLD_SCHEMA_VERSION);
  if (!migrated.ok) {
    return { ok: false, errors: [migrated.error] };
  }

  const result = WorldDefinitionSchema.safeParse(migrated.data);
  if (!result.success) {
    return { ok: false, errors: formatIssues(result.error) };
  }
  return migrated.from === migrated.to
    ? { ok: true, world: result.data }
    : { ok: true, world: result.data, migratedFrom: migrated.from };
}
