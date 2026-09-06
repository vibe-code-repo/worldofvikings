/**
 * Content validation (spec §44).
 *
 * Validates `content/prefabs/` and `content/worlds/` against `@wov/world-schema`
 * and checks what no single file can know: prefab ids are unique across all
 * catalogs, and every entity references a prefab that exists (ADR-0016).
 *
 * Exits non-zero on any invalid file so CI and agents get a clear signal.
 *
 * Item, enemy and quest checks are added together with those formats.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePrefabCatalog, parseWorldDefinition } from '@wov/world-schema';
import {
  collectPrefabIds,
  findUnknownPrefabReferences,
  type LoadedCatalog,
} from './content-references.js';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const prefabsDir = join(repoRoot, 'content', 'prefabs');
const worldsDir = join(repoRoot, 'content', 'worlds');

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

  const unknownPrefabs = findUnknownPrefabReferences(result.world, prefabIndex.ids);
  if (unknownPrefabs.length > 0) {
    fail(relative, unknownPrefabs);
    continue;
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
