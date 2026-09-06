import { z } from 'zod';
import { ASSET_KINDS, ASSET_VISIBILITIES, isGeometryKind } from './asset-facts.js';
import type { AssetVisibility } from './asset-facts.js';

/**
 * The asset manifest: every file the game may download, and where it came from.
 *
 * It exists for four reasons (spec §37, §38, §46; ADR-0015):
 *
 * 1. `pnpm validate:assets` can tell a contributor that a file was added,
 *    removed or changed without the manifest being updated.
 * 2. `bytes` makes download budgets checkable instead of a matter of opinion.
 * 3. `hash` is what immutable, cache-forever production file names are built
 *    from later — see {@link immutableAssetPath}.
 * 4. Provenance — `origin`, `source`, `author`, `license`, `redistributable` —
 *    is recorded per file and machine-checkable, instead of living only in a
 *    Markdown table that nothing verifies.
 *
 * Since version 2 the manifest also describes assets that are **not** in the
 * repository. `visibility: 'private'` means the bytes are served from the
 * private asset store and the repository holds only a
 * {@link AssetEntry.placeholder} — a box with the same hull — so a clean clone
 * still runs (ADR-0015).
 *
 * The manifest is *not* world data: it never decides what exists in the game,
 * only which files back it. World data lives in `content/` and is validated by
 * `@wov/world-schema` (ADR-0004).
 */

/**
 * Version of the manifest format understood by this build.
 *
 * Same rule as world data (agent rule 11): never silently accept or rewrite a
 * different version. Bump this together with a documented migration —
 * {@link parseAssetManifest} carries the one for version 1.
 */
export const CURRENT_ASSET_MANIFEST_VERSION = 2;

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
 *
 * `PrefabAssetPathSchema` in `@wov/world-schema` states the same rule a second
 * time, because world data must stay validatable without the asset pipeline
 * (ADR-0016). The two are changed together, in one commit — nowhere else is
 * this path rule spelled out.
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

/**
 * The Zod views of the two vocabularies. The lists themselves live in
 * `asset-facts.ts`, which has no Zod in it, so the client can compare against
 * `'private'` without being able to reach this module (ADR-0012).
 */
export const AssetKindSchema = z.enum(ASSET_KINDS);
export const AssetVisibilitySchema = z.enum(ASSET_VISIBILITIES);

/**
 * A stable, machine-readable name: lower-case, `-` inside a segment, `/` for
 * the group. Unlike `path` it survives a file being renamed or re-normalised,
 * which is what lets world data and the licence table point at an asset.
 */
export const AssetIdSchema = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/,
    'id must be lower-case kebab-case segments joined by "/", e.g. "vegetation/pine-1b1"',
  );

/**
 * Free text that must actually say something.
 *
 * `z.string().min(1)` would accept `"   "`, and a blank licence field is
 * exactly the failure this project cannot afford (spec §46).
 */
const DescriptiveText = z
  .string()
  .refine((value) => value.trim().length > 0, { message: 'must not be blank' });

const Vector3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

/**
 * The model's axis-aligned hull in metres, in its own space after
 * normalisation.
 *
 * Recorded rather than assumed: height, origin and units differ per source file
 * and per exporting tool, and the placeholder box is built from exactly these
 * numbers — so a wrong hull is a visibly wrong stand-in, not a silent one.
 */
export const AssetBoundsSchema = z
  .strictObject({
    min: Vector3Schema,
    max: Vector3Schema,
  })
  .refine((bounds) => bounds.max.every((value, axis) => value >= (bounds.min[axis] ?? 0)), {
    message: 'bounds.max must not be smaller than bounds.min on any axis',
  });

/** One file the game may download — from `assets/` or from the store. */
export const AssetEntrySchema = z
  .strictObject({
    /** Stable name; see {@link AssetIdSchema}. */
    id: AssetIdSchema,
    /**
     * Path the file is requested under, relative to whichever root serves it:
     * `assets/` for a public asset, the store root for a private one.
     */
    path: AssetPathSchema,
    kind: AssetKindSchema,
    /** File size in bytes; the budget half of the manifest. */
    bytes: z.int().nonnegative(),
    /** Content hash; the identity half of the manifest. */
    hash: AssetHashSchema,
    /** Hull in metres. Geometry only — see {@link AssetBoundsSchema}. */
    bounds: AssetBoundsSchema.optional(),
    /** Where this file came from, concretely enough to find it again. */
    origin: DescriptiveText,
    /** The pack, kit or project it belongs to. */
    source: DescriptiveText,
    /** Who made it. `unknown` is an answer; empty is not. */
    author: DescriptiveText,
    /** SPDX identifier where one applies, otherwise free text. */
    license: DescriptiveText,
    /** Whether this project may hand the file to third parties. */
    redistributable: z.boolean(),
    visibility: AssetVisibilitySchema,
    /**
     * Repository-relative path of the stand-in used when the real file is not
     * reachable. Required for private assets, forbidden for public ones.
     */
    placeholder: AssetPathSchema.optional(),
  })
  .superRefine((entry, context) => {
    if (entry.visibility === 'private' && entry.placeholder === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['placeholder'],
        message: 'a private asset needs a placeholder — a clean clone has nothing else to load',
      });
    }
    if (entry.visibility === 'public' && entry.placeholder !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['placeholder'],
        message: 'a public asset is served as itself and must not carry a placeholder',
      });
    }
    if (isGeometryKind(entry.kind)) {
      if (entry.visibility === 'private' && entry.bounds === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['bounds'],
          message: 'private geometry needs bounds — the placeholder box is built from them',
        });
      }
    } else if (entry.bounds !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['bounds'],
        message: `bounds describe an extent in metres and do not apply to a ${entry.kind}`,
      });
    }
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
  })
  .refine((manifest) => findDuplicates(manifest.assets.map((asset) => asset.id)).length === 0, {
    message: 'duplicate asset id',
  });

export type AssetBounds = z.infer<typeof AssetBoundsSchema>;
// Re-exported so a consumer of the manifest needs one import, not two.
export { ASSET_KINDS, ASSET_VISIBILITIES } from './asset-facts.js';
export type { AssetKind, AssetVisibility } from './asset-facts.js';
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
 * Derives an {@link AssetIdSchema} id from a file path.
 *
 * Drops the extension and kebab-cases each remaining segment, so
 * `environment/SM_Env_Rock_03.glb` becomes `environment/sm-env-rock-03`. Pure
 * and machine-independent: the import pipeline and a migrated version 1
 * manifest must produce the same id for the same path, on every checkout.
 */
export function assetIdFromPath(assetPath: string): string {
  const withoutExtension = assetPath.replace(/\.[^./]+$/, '');
  return withoutExtension
    .split('/')
    .map((segment) =>
      segment
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    )
    .filter((segment) => segment.length > 0)
    .join('/');
}

/** What a version 1 entry could say: a path, a size and a hash. */
const LegacyAssetEntrySchema = z.strictObject({
  path: AssetPathSchema,
  bytes: z.int().nonnegative(),
  hash: AssetHashSchema,
});

const LegacyAssetManifestSchema = z.strictObject({
  manifestVersion: z.literal(1),
  generatedAt: z.iso.datetime(),
  assets: z.array(LegacyAssetEntrySchema),
});

/**
 * SPDX's own token for "no licence determination was made".
 *
 * Used where a field is genuinely unknown, because inventing `MIT` for a
 * migrated row would be worse than admitting the gap — and because
 * {@link DescriptiveText} will not accept an empty string (spec §46).
 */
export const UNDETERMINED_LICENSE = 'NOASSERTION';

/** Extensions that identify a texture; everything else is treated as a mesh. */
const TEXTURE_EXTENSIONS = /\.(png|jpe?g|webp|ktx2|basis)$/i;

/**
 * Version 1 → 2.
 *
 * Version 1 knew only where a file was and what it hashed to, so everything the
 * new fields ask for is filled in as "unknown" rather than guessed: the licence
 * becomes `NOASSERTION`, redistribution is assumed *not* granted, and no bounds
 * are invented. Every asset is `public`, because version 1 could only describe
 * files that were in `assets/` to begin with.
 */
function migrateFromVersion1(legacy: z.infer<typeof LegacyAssetManifestSchema>): unknown {
  return {
    manifestVersion: CURRENT_ASSET_MANIFEST_VERSION,
    generatedAt: legacy.generatedAt,
    assets: legacy.assets.map((entry) => ({
      id: assetIdFromPath(entry.path),
      path: entry.path,
      kind: TEXTURE_EXTENSIONS.test(entry.path) ? 'texture' : 'mesh',
      bytes: entry.bytes,
      hash: entry.hash,
      origin: 'unknown — migrated from asset manifest version 1',
      source: 'unknown',
      author: 'unknown',
      license: UNDETERMINED_LICENSE,
      redistributable: false,
      visibility: 'public',
    })),
  };
}

/**
 * Validates unknown data as an {@link AssetManifest}.
 *
 * A version 1 document is migrated (see {@link migrateFromVersion1}) rather than
 * rejected, so an older checkout or an unregenerated branch still reads. Any
 * other unsupported `manifestVersion` gets a dedicated message, so a contributor
 * sees the version problem instead of a wall of field errors.
 */
export function parseAssetManifest(data: unknown): AssetManifestParseResult {
  if (typeof data === 'object' && data !== null && 'manifestVersion' in data) {
    const version = (data as { manifestVersion: unknown }).manifestVersion;
    if (version === 1) {
      const legacy = LegacyAssetManifestSchema.safeParse(data);
      if (legacy.success) {
        return parseAssetManifest(migrateFromVersion1(legacy.data));
      }
      return { ok: false, errors: describeIssues(legacy.error) };
    }
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
  return { ok: false, errors: describeIssues(result.error) };
}

function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
    return `${path}: ${issue.message}`;
  });
}

/**
 * The entries served from one place: `assets/` in the repository, or the store.
 *
 * The two are checked against different things — the repository half against
 * files on disk, the private half against the store when it is reachable — so
 * the split is made explicit here instead of being repeated at each call site.
 */
export function selectByVisibility(
  entries: readonly AssetEntry[],
  visibility: AssetVisibility,
): readonly AssetEntry[] {
  return entries.filter((entry) => entry.visibility === visibility);
}

/**
 * Placeholder files a private asset points at but the repository does not have.
 *
 * This is the check that keeps agent rule 20 true: without its placeholder, a
 * clone with no access to the store has nothing to draw and no way to say so.
 *
 * @param repositoryPaths every path found under `assets/`, `/`-separated.
 */
export function findMissingPlaceholders(
  entries: readonly AssetEntry[],
  repositoryPaths: readonly string[],
): readonly string[] {
  const present = new Set(repositoryPaths);
  const missing = new Set<string>();
  for (const entry of selectByVisibility(entries, 'private')) {
    if (entry.placeholder !== undefined && !present.has(entry.placeholder)) {
      missing.add(entry.placeholder);
    }
  }
  return [...missing].sort();
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
