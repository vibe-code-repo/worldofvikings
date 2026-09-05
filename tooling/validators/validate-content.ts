/**
 * Content validation (spec §44).
 *
 * Validates every file in `content/worlds/` against `@wov/world-schema`.
 * Exits non-zero on the first invalid file so CI and agents get a clear signal.
 *
 * Phase 0 covers world files only; prefab, item and asset-reference checks are
 * added together with those formats.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorldDefinition } from '@wov/world-schema';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const worldsDir = join(repoRoot, 'content', 'worlds');

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

const files = await listJsonFiles(worldsDir);
let failures = 0;

for (const file of files) {
  const relative = file.slice(repoRoot.length + 1);
  let data: unknown;
  try {
    data = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    failures += 1;
    process.stderr.write(`FAIL ${relative}: invalid JSON — ${String(error)}\n`);
    continue;
  }

  const result = parseWorldDefinition(data);
  if (result.ok) {
    const entities = result.world.zones.reduce((sum, zone) => sum + zone.entities.length, 0);
    process.stdout.write(
      `OK   ${relative} (${result.world.zones.length} zones, ${entities} entities)\n`,
    );
  } else {
    failures += 1;
    process.stderr.write(`FAIL ${relative}\n`);
    for (const message of result.errors) {
      process.stderr.write(`       ${message}\n`);
    }
  }
}

process.stdout.write(`\nvalidate: ${files.length} world file(s), ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
