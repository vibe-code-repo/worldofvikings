/**
 * `pnpm generate:prefabs` — writes `content/prefabs/imported.json` from
 * `assets/manifest.json` (ADR-0016).
 *
 * Run it after the asset manifest changes. The result is committed: it is world
 * data derived once from the manifest, not something the game builds at
 * runtime, and a clone with no asset store still gets the full prefab list.
 *
 * The output is formatted with Prettier — the repository's own formatter,
 * already a dev dependency — so that a regeneration never shows up as a
 * `pnpm format` diff.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { parsePrefabCatalog } from '@wov/world-schema';
import { parseAssetManifest } from '@wov/asset-system/manifest';
import { IMPORTED_CATALOG_ID, buildImportedCatalog, repoRoot } from './prefab-catalog.js';

const manifestFile = join(repoRoot, 'assets', 'manifest.json');
const catalogDirectory = join(repoRoot, 'content', 'prefabs');
const catalogFile = join(catalogDirectory, `${IMPORTED_CATALOG_ID}.json`);

const manifestResult = parseAssetManifest(JSON.parse(await readFile(manifestFile, 'utf8')));
if (!manifestResult.ok) {
  process.stderr.write(`FAIL assets/manifest.json\n`);
  for (const message of manifestResult.errors) {
    process.stderr.write(`       ${message}\n`);
  }
  process.exit(1);
}

const catalog = buildImportedCatalog(manifestResult.manifest.assets);

// The generator writes content that `pnpm validate:content` will check, so it
// checks it here first: a broken generator must fail now, not in someone's
// pull request.
const validation = parsePrefabCatalog(catalog);
if (!validation.ok) {
  process.stderr.write('FAIL generated catalog does not satisfy the prefab schema\n');
  for (const message of validation.errors) {
    process.stderr.write(`       ${message}\n`);
  }
  process.exit(1);
}

const prettierOptions = await resolveConfig(catalogFile);
const json = await format(JSON.stringify(catalog), {
  ...prettierOptions,
  filepath: catalogFile,
  parser: 'json',
});

await mkdir(catalogDirectory, { recursive: true });
await writeFile(catalogFile, json, 'utf8');

const relative = catalogFile.slice(repoRoot.length + 1);
process.stdout.write(
  `wrote ${relative} (${catalog.prefabs.length} prefabs from ${manifestResult.manifest.assets.length} assets)\n`,
);
