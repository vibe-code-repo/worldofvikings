import { z } from 'zod';

/**
 * The one spelling of an id used by every world data format.
 *
 * Lower-case so a file name, a URL fragment and a JSON key can never differ by
 * case only; `_` and `-` are allowed because both spellings already exist in
 * authored data (`tree_001`, `pine-1b1`).
 */
export const IdentifierSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'ids must be lowercase and may contain a-z, 0-9, "_" and "-"');

/** `[x, y, z]` in world units (metres), Babylon.js left-handed convention. */
export const Vector3Schema = z.tuple([z.number(), z.number(), z.number()]);

/**
 * A colour as `#rrggbb`, the one spelling world data writes colours in.
 *
 * Six digits and a hash, nothing else. Babylon's `Color3.FromHexString` answers
 * black for anything it cannot parse, and a black sun looks like a lighting bug
 * a long way from the typo that caused it — so the file is refused here instead
 * (agent rule 10). `@wov/engine` repeats the same rule at its own edge, for the
 * same reason `AssetPathSchema` is repeated: neither package may depend on the
 * other, and both are handed values from outside.
 */
export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb colour');

/**
 * A path relative to whichever root serves the file — `assets/` or the private
 * store — exactly as it is appended to the asset base URL.
 *
 * The rule is duplicated from `AssetPathSchema` in `@wov/asset-system` on
 * purpose: this package describes *data files* and must stay dependency-free
 * apart from Zod, so that world data can be validated without an asset pipeline
 * (agent rule 9, ADR-0004, ADR-0016). Forward slashes only, never absolute, no
 * `..`, no empty segments. If one of the two changes, the other changes with it
 * in the same commit — this is the only place the duplication lives inside this
 * package, and both sides carry this note.
 */
export const AssetPathSchema = z
  .string()
  .min(1)
  .regex(/^[^/\\][^\\]*$/, 'must be a relative path using "/" as separator')
  .refine((path) => !path.split('/').includes('..'), { message: 'must not contain ".."' })
  .refine((path) => !path.split('/').includes(''), { message: 'must not contain empty segments' });

/**
 * What kind of file an asset path names — metadata, never a rule.
 *
 * The vocabulary is the asset manifest's own `kind` field
 * (`@wov/asset-system`), repeated here by name rather than imported, for the
 * same reason {@link AssetPathSchema} is repeated: this package must stay free
 * of every dependency but Zod (agent rule 9). It changes with that list in the
 * same commit.
 */
export type AssetKindHint = 'mesh' | 'prefab' | 'terrain' | 'texture' | 'audio';

/**
 * An asset path that also says *what kind* of file it names.
 *
 * Validation is untouched — every asset path is checked by exactly the rules in
 * {@link AssetPathSchema}, and a field annotated with the wrong kind is still
 * accepted. The kind is for whoever has to build a control for the field:
 * `describeFields` in `@wov/editor-core` reads it out of the JSON Schema and
 * the editor offers the matching entries of the asset manifest instead of a
 * bare text box (ADR-0033). A path field without an annotation still works; it
 * just gets nothing to choose from.
 *
 * This is the one way a *data* schema is allowed to say something about a
 * *panel*, and it earns it: the alternative is a list of field names in
 * `apps/editor` saying "these three are textures", which is exactly the drift
 * ADR-0033 exists to prevent.
 */
export function assetPathOf(kind: AssetKindHint): typeof AssetPathSchema {
  return AssetPathSchema.meta({ asset: kind });
}

/**
 * Which editor command writes a field — metadata, never a rule.
 *
 * A block is normally edited field by field, and one patch is one command. A
 * few fields are not: how a ground layer *behaves* — its metalness, its
 * smoothness, how hard its normal map tilts the surface, and whether the whole
 * tile is drawn facetted — is written by `updateTerrainSurface`, because that
 * is the command `pnpm terrain-surface` calls, and a value typed into a panel
 * and a value passed on a command line have to travel one path or they will
 * eventually be refused in two different places (ADR-0032).
 *
 * Marking it here rather than in `apps/editor` is the same bargain
 * {@link assetPathOf} makes, for the same reason: the alternative is a list of
 * four field names in a panel, which drifts the first time a fifth arrives
 * (ADR-0033). Validation is untouched.
 *
 * `emitterAnchor` is the same bargain for a different question. An emitter says
 * where it is with exactly one of `prefab`, `entity` or `position`
 * (`sound.ts`), and *which one* is not something an author decides from an
 * entity: with a brazier selected the anchor is already answered — it is this
 * entity — and three boxes to contradict that with is how a sound ends up bound
 * to nothing. So the entity inspector leaves those three fields to the sound
 * panel, and it knows which three they are because the schema says so and not
 * because a panel keeps a list of names.
 */
export type FieldCommandHint = 'terrainSurface' | 'emitterAnchor';

/** Annotates a field with the command that writes it. See {@link FieldCommandHint}. */
export function turnedBy<T extends z.ZodType>(command: FieldCommandHint, schema: T): T {
  return schema.meta({ command }) as T;
}

export type Identifier = z.infer<typeof IdentifierSchema>;

/** Turns Zod issues into `path: message` lines a contributor can act on. */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
    return `${path}: ${issue.message}`;
  });
}

/**
 * Rejects a file whose `schemaVersion` this build does not understand, with a
 * dedicated message so a contributor sees the version problem first instead of
 * a field-level error caused by it (agent rule 11).
 */
export function checkSchemaVersion(data: unknown, expected: number): string | null {
  if (typeof data === 'object' && data !== null && 'schemaVersion' in data) {
    const version = (data as { schemaVersion: unknown }).schemaVersion;
    if (version !== expected) {
      return `unsupported schemaVersion ${String(version)}, expected ${expected}`;
    }
  }
  return null;
}

/** Values that occur more than once, in first-seen order. */
export function findDuplicates(values: readonly string[]): string[] {
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
