import { z } from 'zod';

/**
 * A temporary, deliberately small catalogue schema.
 *
 * TODO: replace with `parsePrefabCatalog` from `@wov/world-schema` as soon as
 * that package owns the prefab format (it is being written on
 * `feat/editor-document`). The API must not be the place where a content
 * format is defined — `content/` is validated by `@wov/world-schema` and by
 * `pnpm validate:content` (ADR-0004). Until then this checks the envelope the
 * editor depends on, and nothing more.
 *
 * That is why a prefab entry is validated loosely: `id` and `name` are what the
 * asset browser needs, and every other field is passed through untouched, so
 * this file never silently drops something the real schema will define
 * (agent rule 11).
 */
export const CURRENT_PREFAB_CATALOG_VERSION = 1;

const identifier = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'ids must be lowercase and may contain a-z, 0-9, "_" and "-"');

export const PrefabDefinitionSchema = z.looseObject({
  id: identifier,
  name: z.string().min(1),
});

export const PrefabCatalogSchema = z.object({
  schemaVersion: z.literal(CURRENT_PREFAB_CATALOG_VERSION),
  id: identifier,
  prefabs: z.array(PrefabDefinitionSchema),
});

export type PrefabDefinition = z.infer<typeof PrefabDefinitionSchema>;
export type PrefabCatalog = z.infer<typeof PrefabCatalogSchema>;

export type PrefabCatalogParseResult =
  | { readonly ok: true; readonly catalog: PrefabCatalog }
  | { readonly ok: false; readonly errors: readonly string[] };

/** Validates unknown data as a prefab catalogue, in the shape of `parseWorldDefinition`. */
export function parsePrefabCatalog(data: unknown): PrefabCatalogParseResult {
  if (typeof data === 'object' && data !== null && 'schemaVersion' in data) {
    const version = (data as { schemaVersion: unknown }).schemaVersion;
    if (version !== CURRENT_PREFAB_CATALOG_VERSION) {
      return {
        ok: false,
        errors: [
          `unsupported schemaVersion ${String(version)}, expected ${CURRENT_PREFAB_CATALOG_VERSION}`,
        ],
      };
    }
  }

  const result = PrefabCatalogSchema.safeParse(data);
  if (result.success) {
    return { ok: true, catalog: result.data };
  }
  return {
    ok: false,
    errors: result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
      return `${path}: ${issue.message}`;
    }),
  };
}
