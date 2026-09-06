import { z } from 'zod';
import {
  IdentifierSchema,
  Vector3Schema,
  checkSchemaVersion,
  findDuplicates,
  formatIssues,
} from './common.js';

/**
 * Version of the prefab catalog format understood by this build.
 *
 * Same rule as the world format (spec §16, agent rule 11): never silently
 * accept or rewrite a different version — bump this together with a migration.
 */
export const CURRENT_PREFAB_SCHEMA_VERSION = 1;

/**
 * What a prefab is *for*, which is what the editor's asset browser groups by
 * (spec §13: "Models | Prefabs | … | Vegetation").
 *
 * Five values, each earning its place by being handled differently somewhere:
 * - `terrain` is placed once per zone and is the ground the player walks on.
 * - `vegetation` is scattered in bulk, needs wind/LOD treatment and is the one
 *   group a scatter tool writes into a world file (spec §12).
 * - `environment` is static scenery that shapes the world: buildings, rocks,
 *   walls, paths.
 * - `prop` is a small, movable object — barrels, crates, tools, loot — the
 *   group gameplay later attaches interaction to (spec §32).
 * - `dungeon` is the modular dungeon kit (spec §20), which is authored against
 *   a grid instead of freely placed.
 *
 * No asset carries `dungeon` yet; the value exists because the kit is a named
 * part of the spec and a hand-written catalog will use it before the importer
 * does. A sixth value must earn its place the same way.
 */
export const PREFAB_CATEGORIES = [
  'environment',
  'vegetation',
  'terrain',
  'prop',
  'dungeon',
] as const;
export type PrefabCategory = (typeof PREFAB_CATEGORIES)[number];
export const PrefabCategorySchema = z.enum(PREFAB_CATEGORIES);

/**
 * Where the asset bytes are: in this repository, or in the private asset store
 * (ADR-0015).
 *
 * Deliberately duplicated from `@wov/asset-system`: this package describes
 * *data files* and must stay dependency-free apart from Zod, so that world data
 * can be validated without an asset pipeline (agent rule 9, ADR-0004). The two
 * lists are short, closed and change together with an ADR, never silently.
 */
export const PREFAB_VISIBILITIES = ['private', 'public'] as const;
export type PrefabVisibility = (typeof PREFAB_VISIBILITIES)[number];
export const PrefabVisibilitySchema = z.enum(PREFAB_VISIBILITIES);

/**
 * A path relative to whichever root serves the file — `assets/` or the private
 * store — exactly as it is appended to the asset base URL.
 *
 * The rule is duplicated from `AssetPathSchema` in `@wov/asset-system` on
 * purpose (see {@link PREFAB_VISIBILITIES}): forward slashes only, never
 * absolute, no `..`, no empty segments. If one of the two changes, the other
 * changes with it in the same commit — this is the only place the duplication
 * lives, and both carry this note.
 */
export const PrefabAssetPathSchema = z
  .string()
  .min(1)
  .regex(/^[^/\\][^\\]*$/, 'must be a relative path using "/" as separator')
  .refine((path) => !path.split('/').includes('..'), { message: 'must not contain ".."' })
  .refine((path) => !path.split('/').includes(''), { message: 'must not contain empty segments' });

/**
 * The prefab's axis-aligned hull in metres, copied from the asset manifest.
 *
 * Recorded rather than assumed: height, origin and units differ per source file
 * and per exporting tool. The editor uses it for framing and grid fitting, so a
 * wrong hull is visible instead of silent.
 */
export const PrefabBoundsSchema = z
  .strictObject({
    min: Vector3Schema,
    max: Vector3Schema,
  })
  .refine((bounds) => bounds.max.every((value, axis) => value >= (bounds.min[axis] ?? 0)), {
    message: 'bounds.max must not be smaller than bounds.min on any axis',
  });

/**
 * One reusable placeable thing (spec §19). Entities in a world reference it by
 * `id`; geometry is never inlined into a world file.
 */
export const PrefabDefinitionSchema = z
  .strictObject({
    /** Referenced from `EntityDefinition.prefab`; unique across all catalogs. */
    id: IdentifierSchema,
    /** Human-readable label for the hierarchy and the asset browser. */
    name: z.string().min(1),
    /** The model this prefab places. */
    asset: PrefabAssetPathSchema,
    /** Whether {@link PrefabDefinition.asset} ships in the repository. */
    visibility: PrefabVisibilitySchema,
    /** Public stand-in used when the private asset is unavailable (ADR-0015). */
    placeholder: PrefabAssetPathSchema.optional(),
    category: PrefabCategorySchema,
    bounds: PrefabBoundsSchema.optional(),
    /** Author-chosen default scale; absent means `[1, 1, 1]`. */
    defaultScale: Vector3Schema.optional(),
  })
  .superRefine((prefab, ctx) => {
    // A private prefab without a stand-in is a hole in every clone that has no
    // asset store — the editor would have nothing to draw (ADR-0015).
    if (prefab.visibility === 'private' && prefab.placeholder === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['placeholder'],
        message: 'a private prefab needs a placeholder',
      });
    }
    // A public asset is always there, so a placeholder for it would be a second
    // truth about which file to load.
    if (prefab.visibility === 'public' && prefab.placeholder !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['placeholder'],
        message: 'a public prefab must not carry a placeholder',
      });
    }
  });

/** The root object of every file in `content/prefabs/`. */
export const PrefabCatalogSchema = z
  .strictObject({
    schemaVersion: z.literal(CURRENT_PREFAB_SCHEMA_VERSION),
    /** Catalog name, matching the file name (`base.json` → `base`). */
    id: IdentifierSchema,
    prefabs: z.array(PrefabDefinitionSchema),
  })
  .superRefine((catalog, ctx) => {
    for (const duplicate of findDuplicates(catalog.prefabs.map((prefab) => prefab.id))) {
      ctx.addIssue({
        code: 'custom',
        path: ['prefabs'],
        message: `duplicate prefab id "${duplicate}"`,
      });
    }
  });

export type PrefabDefinition = z.infer<typeof PrefabDefinitionSchema>;
export type PrefabCatalog = z.infer<typeof PrefabCatalogSchema>;
export type PrefabBounds = z.infer<typeof PrefabBoundsSchema>;

/** Result of {@link parsePrefabCatalog}: a catalog or human-readable errors. */
export type PrefabCatalogParseResult =
  | { readonly ok: true; readonly catalog: PrefabCatalog }
  | { readonly ok: false; readonly errors: readonly string[] };

/** Validates unknown data as a {@link PrefabCatalog}. */
export function parsePrefabCatalog(data: unknown): PrefabCatalogParseResult {
  const versionError = checkSchemaVersion(data, CURRENT_PREFAB_SCHEMA_VERSION);
  if (versionError !== null) {
    return { ok: false, errors: [versionError] };
  }

  const result = PrefabCatalogSchema.safeParse(data);
  if (result.success) {
    return { ok: true, catalog: result.data };
  }
  return { ok: false, errors: formatIssues(result.error) };
}
