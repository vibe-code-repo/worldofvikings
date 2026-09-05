/**
 * Asset manifest validation (spec §37, §44).
 *
 * Compares `assets/manifest.json` against the files actually present in
 * `assets/` and exits non-zero on any drift, so a model added, replaced or
 * deleted without updating the manifest fails CI instead of silently shipping a
 * 404 to players.
 *
 * ```bash
 * pnpm validate:assets            # check, exits 1 on drift
 * pnpm validate:assets --write    # regenerate the manifest from assets/
 * ```
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
  formatManifestReport,
  isIndexedAssetFile,
  isManifestInSync,
  parseAssetManifest,
} from '@wov/asset-system/manifest';
import type { AssetEntry } from '@wov/asset-system/manifest';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const assetsDir = join(repoRoot, 'assets');
const manifestFile = join(assetsDir, ASSET_MANIFEST_FILE_NAME);
const write = process.argv.includes('--write');

/**
 * Lists every file under `assets/` as a `/`-separated path relative to it.
 * Joins with `/` explicitly so a Windows checkout produces the same manifest as
 * a Linux one (agent rule 11: the format must not depend on the machine).
 */
async function listAssetFiles(directory: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await listAssetFiles(join(directory, entry.name), relative)));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files.sort();
}

async function describeFile(assetPath: string): Promise<AssetEntry> {
  const bytes = await readFile(join(assetsDir, assetPath));
  return {
    path: assetPath,
    bytes: bytes.byteLength,
    hash: `${ASSET_HASH_PREFIX}${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const found: AssetEntry[] = [];
for (const assetPath of await listAssetFiles(assetsDir)) {
  if (isIndexedAssetFile(assetPath)) {
    found.push(await describeFile(assetPath));
  }
}

let listed: readonly AssetEntry[] = [];
let manifestExists = true;
try {
  const parsed = parseAssetManifest(JSON.parse(await readFile(manifestFile, 'utf8')));
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
  manifestExists = false;
}

const comparison = compareManifestWithFiles(listed, found);

if (write) {
  // Only rewrite when the asset list really changed: a fresh `generatedAt` on
  // every run would put a meaningless diff into every pull request.
  if (manifestExists && isManifestInSync(comparison)) {
    process.stdout.write(`OK   assets/${ASSET_MANIFEST_FILE_NAME} already up to date\n`);
    process.exit(0);
  }
  const manifest = {
    manifestVersion: CURRENT_ASSET_MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    assets: found,
  };
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `WROTE assets/${ASSET_MANIFEST_FILE_NAME} (${found.length} asset file(s))\n`,
  );
  process.exit(0);
}

if (!manifestExists) {
  fail(
    `FAIL assets/${ASSET_MANIFEST_FILE_NAME} is missing — run \`pnpm validate:assets --write\` to create it`,
  );
}

const report = formatManifestReport(comparison);
if (report.length > 0) {
  process.stderr.write(`FAIL assets/${ASSET_MANIFEST_FILE_NAME} does not describe assets/\n`);
  for (const line of report) {
    process.stderr.write(`       ${line}\n`);
  }
  process.stderr.write(
    `\n       run \`pnpm validate:assets --write\` after checking the changes\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `OK   assets/${ASSET_MANIFEST_FILE_NAME} (${found.length} asset file(s), 0 failure(s))\n`,
);
