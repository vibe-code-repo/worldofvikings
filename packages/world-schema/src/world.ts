import { z } from 'zod';

/**
 * Version of the world file format understood by this build.
 *
 * Rule (spec §16, agent rule 11): never silently accept or rewrite a different
 * version. Bump this constant together with a documented migration.
 */
export const CURRENT_WORLD_SCHEMA_VERSION = 1;

/** `[x, y, z]` in world units (metres), Babylon.js left-handed convention. */
export const Vector3Schema = z.tuple([z.number(), z.number(), z.number()]);

const identifier = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'ids must be lowercase and may contain a-z, 0-9, "_" and "-"');

/** A single placed entity. It references a prefab instead of inlining geometry. */
export const EntityDefinitionSchema = z.strictObject({
  id: identifier,
  prefab: identifier,
  position: Vector3Schema,
  rotation: Vector3Schema.optional(),
  scale: Vector3Schema.optional(),
});

/** A zone is the unit of streaming (spec §17), not a generation unit. */
export const ZoneDefinitionSchema = z.strictObject({
  id: identifier,
  name: z.string().min(1),
  entities: z.array(EntityDefinitionSchema),
});

/** The root object of every file in `content/worlds/`. */
export const WorldDefinitionSchema = z
  .strictObject({
    schemaVersion: z.literal(CURRENT_WORLD_SCHEMA_VERSION),
    id: identifier,
    name: z.string().min(1),
    zones: z.array(ZoneDefinitionSchema),
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

/** Result of {@link parseWorldDefinition}: either a world or human-readable errors. */
export type WorldParseResult =
  | { readonly ok: true; readonly world: WorldDefinition }
  | { readonly ok: false; readonly errors: readonly string[] };

function findDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates];
}

/**
 * Validates unknown data as a {@link WorldDefinition}.
 *
 * Unsupported `schemaVersion` values get a dedicated message so that a
 * contributor immediately sees a version problem instead of a field problem.
 */
export function parseWorldDefinition(data: unknown): WorldParseResult {
  if (typeof data === 'object' && data !== null && 'schemaVersion' in data) {
    const version = (data as { schemaVersion: unknown }).schemaVersion;
    if (version !== CURRENT_WORLD_SCHEMA_VERSION) {
      return {
        ok: false,
        errors: [
          `unsupported schemaVersion ${String(version)}, expected ${CURRENT_WORLD_SCHEMA_VERSION}`,
        ],
      };
    }
  }

  const result = WorldDefinitionSchema.safeParse(data);
  if (result.success) {
    return { ok: true, world: result.data };
  }
  return {
    ok: false,
    errors: result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
      return `${path}: ${issue.message}`;
    }),
  };
}
