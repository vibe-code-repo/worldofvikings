/**
 * Content validation (spec §44).
 *
 * Validates `content/prefabs/` and `content/worlds/` against `@wov/world-schema`
 * and checks what no single file can know: prefab ids are unique across all
 * catalogs, every entity references a prefab that exists (ADR-0016), and every
 * asset a zone's terrain names is declared in `assets/manifest.json` (ADR-0020).
 *
 * Reading the manifest here is a read of a committed file, not a use of the
 * asset pipeline: a clone with no asset store still validates its content.
 *
 * Exits non-zero on any invalid file so CI and agents get a clear signal.
 *
 * Item, enemy and quest checks are added together with those formats.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePrefabCatalog, parseWorldDefinition } from '@wov/world-schema';
import { ASSET_MANIFEST_FILE_NAME, parseAssetManifest } from '@wov/asset-system/manifest';
import {
  collectPrefabIds,
  findMissingTerrainAssets,
  findUnknownPrefabReferences,
  type LoadedCatalog,
} from './content-references.js';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const prefabsDir = join(repoRoot, 'content', 'prefabs');
const worldsDir = join(repoRoot, 'content', 'worlds');
const manifestFile = join(repoRoot, 'assets', ASSET_MANIFEST_FILE_NAME);

let failures = 0;

function fail(relative: string, messages: readonly string[]): void {
  failures += 1;
  process.stderr.write(`FAIL ${relative}\n`);
  for (const message of messages) {
    process.stderr.write(`       ${message}\n`);
  }
}

async function listJsonFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => join(directory, entry.name))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/** Reads a JSON file; a parse error is a failure of that file, not of the run. */
async function readJson(file: string, relative: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch (error) {
    fail(relative, [`invalid JSON — ${String(error)}`]);
    return undefined;
  }
}

const relativeTo = (file: string): string => file.slice(repoRoot.length + 1);

const catalogFiles = await listJsonFiles(prefabsDir);
const catalogs: LoadedCatalog[] = [];

for (const file of catalogFiles) {
  const relative = relativeTo(file);
  const data = await readJson(file, relative);
  if (data === undefined) {
    continue;
  }

  const result = parsePrefabCatalog(data);
  if (!result.ok) {
    fail(relative, result.errors);
    continue;
  }

  catalogs.push({ file: relative, catalog: result.catalog });
  process.stdout.write(`OK   ${relative} (${result.catalog.prefabs.length} prefabs)\n`);
}

const prefabIndex = collectPrefabIds(catalogs);
if (prefabIndex.duplicates.length > 0) {
  fail('content/prefabs/', prefabIndex.duplicates);
}

/**
 * Every asset path the manifest declares — what a terrain reference is checked
 * against. An unreadable manifest is one failure, not one per world file.
 */
const manifestPaths = new Set<string>();
{
  const data = await readJson(manifestFile, `assets/${ASSET_MANIFEST_FILE_NAME}`);
  if (data !== undefined) {
    const parsed = parseAssetManifest(data);
    if (parsed.ok) {
      for (const asset of parsed.manifest.assets) {
        manifestPaths.add(asset.path);
      }
    } else {
      fail(`assets/${ASSET_MANIFEST_FILE_NAME}`, parsed.errors);
    }
  }
}

const worldFiles = await listJsonFiles(worldsDir);

for (const file of worldFiles) {
  const relative = relativeTo(file);
  const data = await readJson(file, relative);
  if (data === undefined) {
    continue;
  }

  const result = parseWorldDefinition(data);
  if (!result.ok) {
    fail(relative, result.errors);
    continue;
  }

  const problems = [
    ...findUnknownPrefabReferences(result.world, prefabIndex.ids),
    ...findMissingTerrainAssets(result.world, manifestPaths),
  ];
  if (problems.length > 0) {
    fail(relative, problems);
    continue;
  }

  if (result.migratedFrom !== undefined) {
    // Loud, not silent: the file on disk is still the old version, and it stays
    // that way until someone saves it through the editor (agent rule 11).
    process.stdout.write(
      `NOTE ${relative} is schemaVersion ${String(result.migratedFrom)} and was read through a ` +
        'migration; save it to write the current version\n',
    );
  }

  const entities = result.world.zones.reduce((sum, zone) => sum + zone.entities.length, 0);
  process.stdout.write(
    `OK   ${relative} (${result.world.zones.length} zones, ${entities} entities)\n`,
  );
}

process.stdout.write(
  `\nvalidate: ${catalogFiles.length} prefab catalog(s), ${worldFiles.length} world file(s), ` +
    `${failures} failure(s)\n`,
);
process.exit(failures === 0 ? 0 : 1);
