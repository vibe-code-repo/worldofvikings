/**
 * `pnpm generate:prefabs` — writes `content/prefabs/imported.json` from
 * `assets/manifest.json` (ADR-0016).
 *
 * ```bash
 * pnpm generate:prefabs                       # store from WOV_ASSET_STORE
 * pnpm generate:prefabs --store <store>       # or named explicitly
 * ```
 *
 * Run it after the asset manifest changes. The result is committed: it is world
 * data derived once from the manifest, not something the game builds at
 * runtime, and a clone with no asset store still gets the full prefab list.
 *
 * **Why it reads the store.** A tree's collision shape is a box around its
 * *trunk*, and the only place the trunk's width is written down is the model
 * (ADR-0026). So this command opens the vegetation models it needs and measures
 * them. Everything else it decides from the manifest alone; a run without a
 * store fails on the first tree instead of quietly filing a crown as a trunk.
 *
 * The output is formatted with Prettier — the repository's own formatter,
 * already a dev dependency — so that a regeneration never shows up as a
 * `pnpm format` diff.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { parsePrefabCatalog } from '@wov/world-schema';
import { parseAssetManifest } from '@wov/asset-system/manifest';
import { measureTrunkBox, roundBounds } from '../asset-pipeline/collision.js';
import { readGlb, worldPositions, type Bounds } from '../asset-pipeline/glb.js';
import {
  IMPORTED_CATALOG_ID,
  buildImportedCatalog,
  hasTrunk,
  isPlaceableAsset,
  repoRoot,
} from './prefab-catalog.js';

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

/**
 * Where a model's bytes are: the private store for a private asset, `assets/`
 * for a public one. The same split the asset server serves (ADR-0015).
 */
function fileOf(assetPath: string, visibility: string): string {
  return visibility === 'private'
    ? join(storeRoot ?? '', assetPath)
    : join(repoRoot, 'assets', assetPath);
}

const storeArgument = process.argv.indexOf('--store');
const storeRoot =
  storeArgument >= 0
    ? resolve(process.argv[storeArgument + 1] ?? '')
    : (process.env['WOV_ASSET_STORE']?.trim() ?? '') !== ''
      ? resolve(process.env['WOV_ASSET_STORE'] ?? '')
      : undefined;

const trunkBoxes = new Map<string, Bounds>();
let measured = 0;
for (const asset of manifestResult.manifest.assets) {
  if (!isPlaceableAsset(asset) || !asset.path.startsWith('vegetation/') || !hasTrunk(asset.path)) {
    continue;
  }
  const file = fileOf(asset.path, asset.visibility);
  let bytes;
  try {
    bytes = await readFile(file);
  } catch {
    process.stderr.write(
      `FAIL cannot measure the trunk of "${asset.path}": ${file} is not readable.\n` +
        "       Pass --store <store> or set WOV_ASSET_STORE; a tree's collision box is its\n" +
        '       trunk, and the manifest only knows its crown.\n',
    );
    process.exit(1);
  }
  const box = measureTrunkBox(worldPositions(readGlb(bytes)));
  if (box === undefined) {
    process.stderr.write(`FAIL "${asset.path}" has no geometry to measure a trunk on\n`);
    process.exit(1);
  }
  trunkBoxes.set(asset.path, roundBounds(box));
  measured += 1;
}

const catalog = buildImportedCatalog(manifestResult.manifest.assets, { trunkBoxes });

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
const shapes = new Map<string, number>();
for (const prefab of catalog.prefabs) {
  const kind = prefab.collision?.kind ?? 'undecided';
  shapes.set(kind, (shapes.get(kind) ?? 0) + 1);
}
const shapeReport = [...shapes]
  .sort(([left], [right]) => left.localeCompare(right, 'en'))
  .map(([kind, count]) => `${String(count)} ${kind}`)
  .join(', ');

process.stdout.write(
  `wrote ${relative} (${catalog.prefabs.length} prefabs from ${manifestResult.manifest.assets.length} assets)\n` +
    `collision: ${shapeReport} — ${String(measured)} trunk(s) measured on the model\n`,
);
