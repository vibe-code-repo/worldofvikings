/**
 * Asset manifest validation (spec §37, §44, §46; ADR-0015).
 *
 * Four questions, in the order a contributor can act on them:
 *
 * 1. Is `assets/manifest.json` a valid manifest at all?
 * 2. Do the **public** entries match the files actually present in `assets/`?
 * 3. Does every **private** entry have its placeholder committed, so a clone
 *    without store access still runs?
 * 4. Do the private entries still match the store — checked only when the store
 *    is reachable, skipped with a message when it is not. A contributor without
 *    `WOV_ASSET_STORE` must not fail CI for something they cannot see.
 * 5. Is the village's control map still the right way up (ADR-0043)? A hash
 *    says the bytes did not change; it does not say they were right, and a
 *    wrongly turned splat map paints a plausible landscape that nothing else
 *    notices. Also store-only, for the same reason as 4.
 *
 * ```bash
 * pnpm validate:assets            # check, exits 1 on drift
 * pnpm validate:assets --write    # refresh sizes and hashes from disk
 * ```
 *
 * `--write` never invents provenance. It re-measures `bytes` and `hash` for
 * files it already knows and refuses a file nobody has declared, because "every
 * asset carries source, author and licence" (spec §46) is not something a script
 * gets to fill in with a plausible guess.
 *
 * All the decisions live in `@wov/asset-system/manifest` — which files count as
 * assets, how the manifest is validated, how drift reads. This script only does
 * the things a browser package must not do: touch the file system and hash
 * bytes. The manifest schema sits behind its own entry point so that importing
 * it here does not put Zod into the game's bundle (spec §38).
 */
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASSET_HASH_PREFIX,
  ASSET_MANIFEST_FILE_NAME,
  CURRENT_ASSET_MANIFEST_VERSION,
  compareManifestWithFiles,
  findMissingPlaceholders,
  formatManifestReport,
  isIndexedAssetFile,
  isManifestInSync,
  parseAssetManifest,
  selectByVisibility,
} from '@wov/asset-system/manifest';
import type { AssetEntry } from '@wov/asset-system/manifest';
import { readGlb } from '@wov/content-build';
import { readHeightGrid } from '../asset-pipeline/height-field.js';
import { decodePng } from '../asset-pipeline/png.js';
import {
  isSplatOrientationCorrect,
  measureChannelSlope,
} from '../asset-pipeline/splat-orientation.js';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const assetsDir = join(repoRoot, 'assets');
const manifestFile = join(assetsDir, ASSET_MANIFEST_FILE_NAME);
const write = process.argv.includes('--write');

/**
 * The private asset store, if this machine has one.
 *
 * Same variable the asset server reads, so "the check passed" and "the server
 * would serve it" are statements about the same directory.
 */
const storeRoot = process.env['WOV_ASSET_STORE']?.trim();

/**
 * Lists every file under a directory as a `/`-separated relative path.
 * Joins with `/` explicitly so a Windows checkout produces the same manifest as
 * a Linux one (agent rule 11: the format must not depend on the machine).
 */
async function listFiles(directory: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await listFiles(join(directory, entry.name), relative)));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files.sort();
}

interface Measurement {
  readonly bytes: number;
  readonly hash: string;
}

async function measure(file: string): Promise<Measurement> {
  const bytes = await readFile(file);
  return {
    bytes: bytes.byteLength,
    hash: `${ASSET_HASH_PREFIX}${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

// ------------------------------------------------------------- the manifest

let manifestVersionOnDisk: unknown;
let listed: readonly AssetEntry[] = [];
try {
  const raw: unknown = JSON.parse(await readFile(manifestFile, 'utf8'));
  manifestVersionOnDisk =
    typeof raw === 'object' && raw !== null && 'manifestVersion' in raw
      ? (raw as { manifestVersion: unknown }).manifestVersion
      : undefined;
  const parsed = parseAssetManifest(raw);
  if (!parsed.ok) {
    process.stderr.write(`FAIL assets/${ASSET_MANIFEST_FILE_NAME}\n`);
    for (const message of parsed.errors) {
      process.stderr.write(`       ${message}\n`);
    }
    process.exit(1);
  }
  listed = parsed.manifest.assets;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
    fail(`FAIL assets/${ASSET_MANIFEST_FILE_NAME}: ${String(error)}`);
  }
  fail(
    `FAIL assets/${ASSET_MANIFEST_FILE_NAME} is missing — it cannot be generated from nothing: ` +
      `every asset needs source, author and licence recorded by a person (spec §46)`,
  );
}

// ------------------------------------------------------- the repository half

const repositoryPaths = (await listFiles(assetsDir)).filter((path) => isIndexedAssetFile(path));
const found: AssetEntry[] = [];
const listedByPath = new Map(listed.map((entry) => [entry.path, entry]));
const undeclared: string[] = [];

for (const assetPath of repositoryPaths) {
  const declared = listedByPath.get(assetPath);
  if (declared === undefined || declared.visibility !== 'public') {
    undeclared.push(assetPath);
    continue;
  }
  found.push({ ...declared, ...(await measure(join(assetsDir, assetPath))) });
}

const comparison = compareManifestWithFiles(selectByVisibility(listed, 'public'), found);

if (write) {
  if (undeclared.length > 0) {
    process.stderr.write(
      `FAIL assets/${ASSET_MANIFEST_FILE_NAME} cannot be regenerated: ` +
        `${String(undeclared.length)} file(s) are not declared\n`,
    );
    for (const path of undeclared) {
      process.stderr.write(`       undeclared ${path}\n`);
    }
    process.stderr.write(
      `\n       Add an entry with id, kind, origin, source, author, license,\n` +
        `       redistributable and visibility first — this script measures files,\n` +
        `       it does not decide who made them (spec §46).\n`,
    );
    process.exit(1);
  }
  // Only rewrite when something really changed: a fresh `generatedAt` on every
  // run would put a meaningless diff into every pull request.
  if (manifestVersionOnDisk === CURRENT_ASSET_MANIFEST_VERSION && isManifestInSync(comparison)) {
    process.stdout.write(`OK   assets/${ASSET_MANIFEST_FILE_NAME} already up to date\n`);
    process.exit(0);
  }
  const measured = new Map(found.map((entry) => [entry.path, entry]));
  const manifest = {
    manifestVersion: CURRENT_ASSET_MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    assets: [...listed]
      .map((entry) => measured.get(entry.path) ?? entry)
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  };
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `WROTE assets/${ASSET_MANIFEST_FILE_NAME} (${String(manifest.assets.length)} entries)\n`,
  );
  process.exit(0);
}

const problems: string[] = [];

for (const path of undeclared) {
  problems.push(`undeclared ${path} — found in assets/, not listed as a public asset`);
}
problems.push(...formatManifestReport(comparison));

// ---------------------------------------------------------- the private half

const privateEntries = selectByVisibility(listed, 'private');

for (const placeholder of findMissingPlaceholders(listed, repositoryPaths)) {
  problems.push(
    `placeholder ${placeholder} — referenced by a private asset, missing from assets/. ` +
      `Without it a clone with no store access has nothing to draw.`,
  );
}

let storeReport: string;
if (privateEntries.length === 0) {
  storeReport = 'no private assets';
} else if (storeRoot === undefined || storeRoot.length === 0) {
  storeReport = `${String(privateEntries.length)} private, store check skipped (WOV_ASSET_STORE is not set)`;
} else {
  const storeFound: AssetEntry[] = [];
  const unreadable: string[] = [];
  for (const entry of privateEntries) {
    try {
      storeFound.push({ ...entry, ...(await measure(join(storeRoot, entry.path))) });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        continue; // the comparison below reports it as `missing`
      }
      unreadable.push(`${entry.path}: ${String(error)}`);
    }
  }
  if (unreadable.length > 0) {
    storeReport = `${String(privateEntries.length)} private, store check skipped (${storeRoot} is not readable)`;
    for (const line of unreadable.slice(0, 3)) {
      process.stdout.write(`     ! ${line}\n`);
    }
  } else {
    // `unlisted` is dropped on purpose: the store may hold files this manifest
    // does not describe yet, and that is not drift the repository can fix.
    const storeDrift = compareManifestWithFiles(privateEntries, storeFound);
    problems.push(
      ...formatManifestReport({ ...storeDrift, unlisted: [] }).map((line) => `store ${line}`),
    );
    storeReport = `${String(privateEntries.length)} private, checked against ${storeRoot}`;
  }
}

// ------------------------------------------------- the control map's axes

/**
 * The one splat channel whose meaning is unambiguous, and the tile it paints.
 *
 * `village-splat-b.png` channel 0 is the rough-rock layer: 0.32 % of the tile,
 * so it can only be a cliff face. It is measured against
 * `terrain-village1-samples.glb` — the file the import writes and the world
 * file names as `heightSamples` — and against nothing else. The store also
 * holds `terrain-village1.glb`, the raster as the export wrote it, on the
 * export's own axes (ADR-0059); measuring against that one scores a placement
 * that is right for a ground the game does not draw, which is how this check
 * passed with the same number after the ground had been turned under it.
 */
const SPLAT_ORIENTATION_CHECK = {
  map: 'textures/village-splat-b.png',
  channel: 0,
  heightField: 'terrain/terrain-village1-samples.glb',
} as const;

let orientationReport = 'splat orientation not checked';
if (storeRoot !== undefined && storeRoot.length > 0) {
  try {
    const grid = readHeightGrid(
      readGlb(await readFile(join(storeRoot, SPLAT_ORIENTATION_CHECK.heightField))),
      SPLAT_ORIENTATION_CHECK.heightField,
    );
    const map = decodePng(await readFile(join(storeRoot, SPLAT_ORIENTATION_CHECK.map)));
    const measured = measureChannelSlope(grid, map, SPLAT_ORIENTATION_CHECK.channel);
    const numbers =
      `cliff channel ${measured.channelGradient.toFixed(2)}, ` +
      `tile p95 ${measured.tilePercentile.toFixed(2)}`;
    if (isSplatOrientationCorrect(measured)) {
      orientationReport = `splat orientation ok (${numbers})`;
    } else {
      problems.push(
        `store ${SPLAT_ORIENTATION_CHECK.map} is turned the wrong way onto the ground: ` +
          `${numbers}. The cliff channel has to sit on ground steeper than the tile's own ` +
          `95th percentile (ADR-0043); re-run pnpm import:world-assets.`,
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      orientationReport = 'splat orientation not checked (not in this store)';
    } else {
      throw error;
    }
  }
}

if (problems.length > 0) {
  process.stderr.write(`FAIL assets/${ASSET_MANIFEST_FILE_NAME} does not describe reality\n`);
  for (const line of problems) {
    process.stderr.write(`       ${line}\n`);
  }
  process.stderr.write(
    `\n       run \`pnpm validate:assets --write\` after checking the changes\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `OK   assets/${ASSET_MANIFEST_FILE_NAME} (${String(listed.length)} entries: ` +
    `${String(found.length)} in assets/, ${storeReport}; ${orientationReport})\n`,
);
