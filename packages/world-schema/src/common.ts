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
