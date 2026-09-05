import { z } from 'zod';

/**
 * The asset manifest: what `assets/` is supposed to contain.
 *
 * It exists for three reasons (spec §37, §38):
 *
 * 1. `pnpm validate:assets` can tell a contributor that a file was added,
 *    removed or changed without the manifest being updated.
 * 2. `bytes` makes download budgets checkable instead of a matter of opinion.
 * 3. `hash` is what immutable, cache-forever production file names are built
 *    from later — see {@link immutableAssetPath}.
 *
 * The manifest is *not* world data: it never decides what exists in the game,
 * only which files back it. World data lives in `content/` and is validated by
 * `@wov/world-schema` (ADR-0004).
 */

/**
 * Version of the manifest format understood by this build.
 *
 * Same rule as world data (agent rule 11): never silently accept or rewrite a
 * different version. Bump this together with a documented migration.
 */
export const CURRENT_ASSET_MANIFEST_VERSION = 1;

/** The manifest's file name, relative to `assets/`. */
export const ASSET_MANIFEST_FILE_NAME = 'manifest.json';

/**
 * Prefix of every {@link AssetEntry.hash}. Exported so the tooling that hashes
 * files and {@link immutableAssetPath} agree on one spelling instead of two
 * literals drifting apart.
 */
export const ASSET_HASH_PREFIX = 'sha256-';

/**
 * A repository-relative asset path, exactly as it is appended to the asset base
 * URL. Forward slashes only, so the manifest reads the same on every platform.
 */
export const AssetPathSchema = z
  .string()
  .min(1)
  .regex(/^[^/\\][^\\]*$/, 'must be a relative path using "/" as separator')
  .refine((path) => !path.split('/').includes('..'), { message: 'must not contain ".."' })
  .refine((path) => !path.split('/').includes(''), { message: 'must not contain empty segments' });

/** Lower-case hex SHA-256 of the file contents, algorithm-prefixed. */
export const AssetHashSchema = z
  .string()
  .regex(/^sha256-[0-9a-f]{64}$/, 'hash must look like "sha256-<64 lowercase hex characters>"');

/** One file in `assets/`. */
export const AssetEntrySchema = z.strictObject({
  path: AssetPathSchema,
  /** File size in bytes; the budget half of the manifest. */
  bytes: z.int().nonnegative(),
  /** Content hash; the identity half of the manifest. */
  hash: AssetHashSchema,
});

/** The root object of `assets/manifest.json`. */
export const AssetManifestSchema = z
  .strictObject({
    manifestVersion: z.literal(CURRENT_ASSET_MANIFEST_VERSION),
    /** When the manifest was last generated, ISO-8601 UTC. */
    generatedAt: z.iso.datetime(),
    assets: z.array(AssetEntrySchema),
  })
  .refine((manifest) => findDuplicates(manifest.assets.map((asset) => asset.path)).length === 0, {
    message: 'duplicate asset path',
  });

export type AssetEntry = z.infer<typeof AssetEntrySchema>;
export type AssetManifest = z.infer<typeof AssetManifestSchema>;

/** Result of {@link parseAssetManifest}: either a manifest or readable errors. */
export type AssetManifestParseResult =
  | { readonly ok: true; readonly manifest: AssetManifest }
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
 * Validates unknown data as an {@link AssetManifest}.
 *
 * An unsupported `manifestVersion` gets a dedicated message, so a contributor
 * sees the version problem instead of a wall of field errors.
 */
export function parseAssetManifest(data: unknown): AssetManifestParseResult {
  if (typeof data === 'object' && data !== null && 'manifestVersion' in data) {
    const version = (data as { manifestVersion: unknown }).manifestVersion;
    if (version !== CURRENT_ASSET_MANIFEST_VERSION) {
      return {
        ok: false,
        errors: [
          `unsupported manifestVersion ${String(version)}, expected ${CURRENT_ASSET_MANIFEST_VERSION}`,
        ],
      };
    }
  }

  const result = AssetManifestSchema.safeParse(data);
  if (result.success) {
    return { ok: true, manifest: result.data };
  }
  return {
    ok: false,
    errors: result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
      return `${path}: ${issue.message}`;
    }),
  };
}

/**
 * The immutable, content-addressed name for an asset (spec §37).
 *
 * `environment/tree.glb` with hash `sha256-a1b2c3d4…` becomes
 * `environment/tree.a1b2c3d4.glb`, which can be served with a cache-forever
 * header because a changed file gets a different name.
 *
 * Nothing serves these names yet; the manifest carries the hash so that turning
 * this on later is a deployment change, not a format change.
 */
export function immutableAssetPath(entry: Pick<AssetEntry, 'path' | 'hash'>): string {
  const shortHash = entry.hash.slice(ASSET_HASH_PREFIX.length, ASSET_HASH_PREFIX.length + 8);
  const lastSlash = entry.path.lastIndexOf('/');
  const fileName = entry.path.slice(lastSlash + 1);
  const dot = fileName.lastIndexOf('.');
  const renamed =
    dot <= 0
      ? `${fileName}.${shortHash}`
      : `${fileName.slice(0, dot)}.${shortHash}${fileName.slice(dot)}`;
  return lastSlash < 0 ? renamed : `${entry.path.slice(0, lastSlash + 1)}${renamed}`;
}

/** One file whose size or hash differs from what the manifest claims. */
export interface AssetMismatch {
  readonly path: string;
  readonly expected: { readonly bytes: number; readonly hash: string };
  readonly actual: { readonly bytes: number; readonly hash: string };
}

/** What `pnpm validate:assets` reports. Every list is sorted by path. */
export interface ManifestComparison {
  /** Listed in the manifest, absent from `assets/`. */
  readonly missing: readonly string[];
  /** Present in `assets/`, absent from the manifest. */
  readonly unlisted: readonly string[];
  /** Present in both, but with a different size or hash. */
  readonly changed: readonly AssetMismatch[];
}

/**
 * Compares the manifest against the files actually found on disk.
 *
 * Pure on purpose: the tooling script does the file system work and hashing,
 * this function does the comparison — so the comparison is unit-testable
 * without a fixture directory.
 */
export function compareManifestWithFiles(
  listed: readonly AssetEntry[],
  found: readonly AssetEntry[],
): ManifestComparison {
  const foundByPath = new Map(found.map((entry) => [entry.path, entry]));
  const listedByPath = new Map(listed.map((entry) => [entry.path, entry]));

  const missing: string[] = [];
  const changed: AssetMismatch[] = [];
  for (const entry of listed) {
    const actual = foundByPath.get(entry.path);
    if (actual === undefined) {
      missing.push(entry.path);
      continue;
    }
    if (actual.bytes !== entry.bytes || actual.hash !== entry.hash) {
      changed.push({
        path: entry.path,
        expected: { bytes: entry.bytes, hash: entry.hash },
        actual: { bytes: actual.bytes, hash: actual.hash },
      });
    }
  }

  const unlisted = found
    .filter((entry) => !listedByPath.has(entry.path))
    .map((entry) => entry.path);

  const byPath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  return {
    missing: missing.sort(byPath),
    unlisted: unlisted.sort(byPath),
    changed: changed.sort((a, b) => byPath(a.path, b.path)),
  };
}

/** True when the manifest describes `assets/` exactly. */
export function isManifestInSync(comparison: ManifestComparison): boolean {
  return (
    comparison.missing.length === 0 &&
    comparison.unlisted.length === 0 &&
    comparison.changed.length === 0
  );
}

/**
 * Whether a file found under `assets/` belongs in the manifest.
 *
 * Not everything in `assets/` is an asset. The manifest describes what the game
 * downloads, so three kinds of file are skipped:
 *
 * - the manifest itself, which would otherwise change its own hash on every run;
 * - Markdown, which documents the folder for contributors (`assets/README.md`)
 *   and is never requested by the client;
 * - anything with a dot-prefixed segment — `.gitkeep` placeholders and editor or
 *   OS droppings like `.DS_Store`.
 *
 * The rule lives here rather than in the validator script so the asset pipeline
 * and the validator cannot disagree about what an asset is.
 *
 * @param assetPath path relative to `assets/`, with `/` separators.
 */
export function isIndexedAssetFile(assetPath: string): boolean {
  if (assetPath === ASSET_MANIFEST_FILE_NAME) {
    return false;
  }
  const segments = assetPath.split('/');
  if (segments.some((segment) => segment.startsWith('.'))) {
    return false;
  }
  return !/\.md$/i.test(assetPath);
}

/**
 * Turns a {@link ManifestComparison} into the lines `pnpm validate:assets`
 * prints — one line per drifted file, empty when everything agrees.
 *
 * Each line says which side is ahead, because the fix differs: an unlisted file
 * means the manifest needs regenerating, a missing one means a file was deleted
 * or never committed.
 */
export function formatManifestReport(comparison: ManifestComparison): readonly string[] {
  return [
    ...comparison.missing.map(
      (path) => `missing  ${path} — listed in the manifest, not found in assets/`,
    ),
    ...comparison.unlisted.map(
      (path) => `unlisted ${path} — found in assets/, not listed in the manifest`,
    ),
    ...comparison.changed.map(
      (mismatch) =>
        `changed  ${mismatch.path} — manifest says ${mismatch.expected.bytes} bytes ` +
        `${mismatch.expected.hash}, file is ${mismatch.actual.bytes} bytes ${mismatch.actual.hash}`,
    ),
  ];
}
