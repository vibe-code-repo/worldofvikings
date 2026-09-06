/**
 * Imports a modelling export (GLB per model, PNG textures) into the private
 * asset store, and the placeholders that stand in for it (ADR-0015). Only the
 * world-building subset is taken; `selection.ts` decides what that is.
 *
 * ```bash
 * pnpm import:world-assets --source ~/assets/export --store ~/assets/store
 * pnpm import:world-assets --source … --store … --dry-run   # report, write nothing
 * ```
 *
 * What one run does, per selected file:
 *
 * 1. **Select** — `selection.ts` decides whether it is world building at all,
 *    which group it belongs to, and what is honestly known about its pack.
 * 2. **Measure** — the hull is computed through the full node hierarchy, in the
 *    file's own units. Nothing is assumed: height, origin and units differ per
 *    file and per exporting tool, so a model outside its group's plausible size
 *    is *excluded and named*, never quietly rescaled.
 * 3. **Name one root, and normalise the origin where it is meaningless** — one
 *    root node is inserted, which is the node the placeholder shares its name
 *    with. Its translation is zero for meshes and prefabs, whose origins are
 *    authored anchors, and recentres terrain, whose origin is a container
 *    corner. `originShiftFor` carries the measurements behind that.
 * 4. **Extract textures** — embedded images become files under `textures/`,
 *    referenced by a relative URI, deduplicated by content hash, and halved
 *    until they fit the 2048 px budget.
 * 4b. **Compute the normals the exporter left out** — twelve terrains ship with
 *    `POSITION` and `TEXCOORD_0` only, which draws as a scatter of backfaces.
 *    This is the only vertex data the pipeline writes, and it is additive.
 * 5. **Write** — the normalised GLB into the store, a hull box into
 *    `assets/placeholders/`, and one manifest entry with the provenance.
 * 6. **Terrain** — after the folders, `terrain-import.ts` adds the playable half
 *    of the ground: a thinned copy of the village height field with rebuilt
 *    normals and UVs, and the eight ground textures a world file's `terrain`
 *    names by hand (ADR-0020). It is a step of this run rather than its own
 *    command, because the manifest rewrite below drops every private entry this
 *    script does not produce.
 *
 * **Why textures are separated rather than left embedded.** Ten rock prefabs in
 * this export embed the *same* 4096×4096 texture: 18 MB of duplicate bytes that
 * a browser downloads and decodes ten times. As files they are one download,
 * cached once, hashed once in the manifest, and — the reason this is not merely
 * an optimisation — individually checkable against the size budget, which an
 * embedded blob inside an 11 MB GLB is not.
 *
 * **Deterministic and idempotent.** Same input, same bytes out, same manifest:
 * texture file names are content hashes, the JSON is written with stable key
 * order, and `generatedAt` is only touched when the asset list actually changed.
 * Re-running over an unchanged source rewrites nothing of substance.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASSET_HASH_PREFIX,
  ASSET_MANIFEST_FILE_NAME,
  CURRENT_ASSET_MANIFEST_VERSION,
  UNDETERMINED_LICENSE,
  parseAssetManifest,
} from '@wov/asset-system/manifest';
import type { AssetEntry } from '@wov/asset-system/manifest';
import {
  assertSupported,
  countMissingNormals,
  countTriangles,
  ensureNormals,
  readGlb,
  repackBuffer,
  takeEmbeddedImages,
  worldBounds,
  wrapInRoot,
  writeGlb,
} from './glb.js';
import type { Bounds } from './glb.js';
import { MAX_TEXTURE_SIZE, decodePng, encodePng, fitWithin, isPng, readPngSize } from './png.js';
import { buildPlaceholderGlb, placeholderPathFor } from './placeholder.js';
import { SOURCE_FOLDERS, TERRAIN_SET, isSelection, originShiftFor, select } from './selection.js';
import type { Selection } from './selection.js';
import {
  HEIGHT_FIELDS,
  HEIGHT_FIELD_FOLDER,
  TERRAIN_TEXTURES,
  TEXTURE_FOLDER,
  decimateHeightField,
  fitTerrainTexture,
  heightFieldOrigin,
  terrainTextureOrigin,
  terrainTexturePath,
} from './terrain-import.js';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const assetsDir = join(repoRoot, 'assets');
const manifestFile = join(assetsDir, ASSET_MANIFEST_FILE_NAME);

/** The one licence statement this import may make: none has been made. */
const IMPORT_LICENSE = UNDETERMINED_LICENSE;

/** One shared stand-in for every private texture; see the note at its use. */
const TEXTURE_PLACEHOLDER = 'placeholders/textures/unavailable.png';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name: string): string {
  const value = argument(name);
  if (value === undefined || value.length === 0) {
    process.stderr.write(
      'usage: tsx tooling/asset-pipeline/import-world-assets.ts ' +
        '--source <export> --store <store> [--dry-run]\n',
    );
    process.exit(2);
  }
  return value;
}

const sourceRoot = required('source');
const storeRoot = required('store');
const dryRun = process.argv.includes('--dry-run');

function sha256(bytes: Buffer): string {
  return `${ASSET_HASH_PREFIX}${createHash('sha256').update(bytes).digest('hex')}`;
}

async function write(file: string, bytes: Buffer): Promise<void> {
  if (dryRun) {
    return;
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, bytes);
}

/** Largest side of a hull, in metres — the number the size rule is about. */
function largestExtent(bounds: Bounds): number {
  return Math.max(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  );
}

function shift(bounds: Bounds, by: readonly [number, number, number]): Bounds {
  const round = (value: number): number => Number(value.toFixed(4));
  return {
    min: [round(bounds.min[0] + by[0]), round(bounds.min[1] + by[1]), round(bounds.min[2] + by[2])],
    max: [round(bounds.max[0] + by[0]), round(bounds.max[1] + by[1]), round(bounds.max[2] + by[2])],
  };
}

interface TextureFile {
  readonly path: string;
  readonly bytes: Buffer;
  /**
   * False when an earlier model already produced these exact bytes. Ten rock
   * prefabs share one texture; without this the manifest would list it ten
   * times under one path and fail its own duplicate check.
   */
  readonly isNew: boolean;
}

/** Textures already written this run, keyed by the hash of their final bytes. */
const textures = new Map<string, TextureFile>();

/**
 * Turns one embedded image into a file under `textures/`, reusing an identical
 * one that a previous model already produced.
 *
 * The name is the model that first used the texture plus its slot, not the
 * material inside the file: a material name is an authoring detail of the
 * source, while "which model does this belong to" is what someone looking at
 * the store actually wants to know. Ten rock prefabs sharing one texture name
 * it after the first of them, which is stable because the walk is sorted.
 *
 * The file name also carries the content hash, which is what makes
 * deduplication and determinism the same mechanism: identical bytes get
 * identical names, and a changed texture gets a new name instead of a stale
 * cache entry.
 */
function takeTexture(name: string, raw: Buffer, label: string): TextureFile {
  let bytes = raw;
  const size = readPngSize(raw);
  if (!isPng(raw)) {
    throw new Error(`${label}: embedded image "${name}" is not a PNG`);
  }
  if (size !== undefined && (size.width > MAX_TEXTURE_SIZE || size.height > MAX_TEXTURE_SIZE)) {
    bytes = encodePng(fitWithin(decodePng(raw), MAX_TEXTURE_SIZE));
  }

  const hash = sha256(bytes);
  const existing = textures.get(hash);
  if (existing !== undefined) {
    return { ...existing, isNew: false };
  }
  const stem = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const file: TextureFile = {
    path: `textures/${stem === '' ? 'texture' : stem}-${hash.slice(ASSET_HASH_PREFIX.length, ASSET_HASH_PREFIX.length + 8)}.png`,
    bytes,
    isNew: true,
  };
  textures.set(hash, file);
  return file;
}

/** A 4×4 grey PNG, the stand-in a private texture points at. */
function unavailableTexture(): Buffer {
  return encodePng({
    width: 4,
    height: 4,
    channels: 4,
    data: Buffer.from(Array.from({ length: 4 * 4 * 4 }, (_, i) => (i % 4 === 3 ? 255 : 140))),
  });
}

interface Report {
  imported: number;
  normalsComputed: number;
  readonly skipped: Map<string, number>;
  readonly excluded: string[];
}

const entries: AssetEntry[] = [];
const report: Report = { imported: 0, normalsComputed: 0, skipped: new Map(), excluded: [] };
/** Which source file claimed each id, so a collision can name the winner. */
const byId = new Map<string, string>();

function skip(reason: string): void {
  report.skipped.set(reason, (report.skipped.get(reason) ?? 0) + 1);
}

/** Imports one selected file. Returns the manifest entries it produced. */
async function importOne(selection: Selection, sourceFile: string): Promise<AssetEntry[]> {
  const glb = readGlb(await readFile(sourceFile));
  assertSupported(glb.json, selection.path);

  const measured = worldBounds(glb.json, selection.path);
  if (measured === undefined) {
    report.excluded.push(`${selection.path} — no geometry (a particle emitter or an empty prefab)`);
    return [];
  }
  const extent = largestExtent(measured);
  if (extent > selection.sizeLimit) {
    report.excluded.push(
      `${selection.path} — ${extent.toFixed(1)} m across, over the ${String(selection.sizeLimit)} m ` +
        `limit for its group; exported inside a scaled rig rather than as a world object`,
    );
    return [];
  }

  const produced: AssetEntry[] = [];

  for (const image of takeEmbeddedImages(glb)) {
    const owner = selection.path.replace(/^.*\//, '').replace(/\.glb$/i, '');
    const texture = takeTexture(`${owner}-${String(image.index)}`, image.bytes, selection.path);
    const target = glb.json.images?.[image.index];
    if (target !== undefined) {
      // Relative to the GLB's own URL: `vegetation/x.glb` next to
      // `textures/y.png` resolves to `../textures/y.png` in any loader.
      target.uri = `../${texture.path}`;
    }
    if (!texture.isNew) {
      continue;
    }
    await write(join(storeRoot, texture.path), texture.bytes);
    produced.push({
      id: `textures/${texture.path.slice('textures/'.length).replace(/\.png$/, '')}`,
      path: texture.path,
      kind: 'texture',
      bytes: texture.bytes.byteLength,
      hash: sha256(texture.bytes),
      origin: `Texture slot ${String(image.index)} of ${selection.path}, extracted into its own file.`,
      source: selection.provenance.source,
      author: selection.provenance.author,
      license: IMPORT_LICENSE,
      redistributable: false,
      visibility: 'private',
      // A texture is only ever requested by a GLB that loaded, so this stand-in
      // is reached only when the store has the model but not its texture. One
      // shared 4x4 grey covers that; a per-texture stand-in would be 76 files
      // that differ in nothing.
      placeholder: TEXTURE_PLACEHOLDER,
    });
  }

  // The twelve terrains are exported with POSITION and TEXCOORD_0 alone, and a
  // height field with no normals barely shades and draws mostly as backfaces.
  // Counted before, so the report says how many files needed it.
  const lackedNormals = countMissingNormals(glb.json);
  if (lackedNormals > 0) {
    report.normalsComputed += 1;
  }

  const shifted = originShiftFor(selection.group, measured);
  wrapInRoot(glb.json, selection.id.split('/').pop() ?? selection.id, shifted);
  const normalised = writeGlb(repackBuffer(ensureNormals(glb, selection.path)));
  const bounds = shift(measured, shifted);

  await write(join(storeRoot, selection.path), normalised);

  const placeholderPath = placeholderPathFor(selection.path);
  const placeholder = buildPlaceholderGlb(selection.id.split('/').pop() ?? selection.id, bounds);
  await write(join(assetsDir, placeholderPath), placeholder);

  produced.push({
    id: selection.id,
    path: selection.path,
    kind: selection.kind,
    bytes: normalised.byteLength,
    hash: sha256(normalised),
    bounds,
    // Geometric facts only, and the wording must match what `originShiftFor`
    // actually does: only terrain tiles are moved (centred on x/z); everything
    // else keeps its authored origin, which is the ground-contact point and may
    // sit above geometry.
    origin: `${selection.group === 'terrain' ? 'Origin centred on x/z of the hull, y kept as authored' : 'Origin kept as authored: ground-contact point, geometry may extend below y=0'}, ${String(countTriangles(glb.json))} triangles.`,
    source: selection.provenance.source,
    author: selection.provenance.author,
    license: IMPORT_LICENSE,
    redistributable: false,
    visibility: 'private',
    placeholder: placeholderPath,
  });
  report.imported += 1;
  return produced;
}

// ------------------------------------------------------------------- the run

process.stdout.write(`importing from ${sourceRoot}\n`);
process.stdout.write(
  `store:         ${storeRoot}${dryRun ? '  (dry run, nothing written)' : ''}\n`,
);

for (const { folder } of SOURCE_FOLDERS) {
  let files: string[];
  try {
    files = (await readdir(join(sourceRoot, folder))).sort();
  } catch {
    process.stdout.write(`  ${folder}: not in this export, skipped\n`);
    continue;
  }

  let taken = 0;
  for (const fileName of files) {
    const selection = select(folder, fileName);
    if (!isSelection(selection)) {
      skip(selection.reason);
      continue;
    }
    const claimed = byId.get(selection.id);
    if (claimed !== undefined) {
      // Two source files mapping to one name would overwrite each other in the
      // store. `SOURCE_FOLDERS` is in priority order, so the first one to claim
      // a name is the richer file; this one is the duplicate.
      report.excluded.push(
        `${folder}/${fileName} — the same asset is already imported from ${claimed}`,
      );
      continue;
    }
    byId.set(selection.id, `${folder}/${fileName}`);
    entries.push(...(await importOne(selection, join(sourceRoot, folder, fileName))));
    taken += 1;
    if (taken % 50 === 0) {
      process.stdout.write(`  ${folder}: ${String(taken)} imported…\n`);
    }
  }
  process.stdout.write(`  ${folder}: ${String(taken)} selected of ${String(files.length)} files\n`);
}

// ------------------------------------------------------------------ terrain

/**
 * The ground: one thinned tile per entry in `HEIGHT_FIELDS`, plus the ground
 * textures a world file names by hand (ADR-0020).
 *
 * Runs after the folder loop and reports separately, because both halves are
 * chosen by name rather than by the size and family rules above.
 */
let terrainFiles = 0;
for (const heightField of HEIGHT_FIELDS) {
  const sourceFile = join(sourceRoot, HEIGHT_FIELD_FOLDER, heightField.file);
  let source: Buffer;
  try {
    source = await readFile(sourceFile);
  } catch {
    process.stdout.write(`  terrain: ${heightField.file} is not in this export, skipped\n`);
    continue;
  }

  const decimated = decimateHeightField(source, heightField.file, heightField.factor);
  await write(join(storeRoot, heightField.path), decimated.bytes);

  const placeholderPath = placeholderPathFor(heightField.path);
  const name =
    heightField.path
      .split('/')
      .pop()
      ?.replace(/\.glb$/, '') ?? heightField.path;
  await write(join(assetsDir, placeholderPath), buildPlaceholderGlb(name, decimated.bounds));

  entries.push({
    id: heightField.path.replace(/\.glb$/, ''),
    path: heightField.path,
    kind: 'terrain',
    bytes: decimated.bytes.byteLength,
    hash: sha256(decimated.bytes),
    bounds: decimated.bounds,
    origin: heightFieldOrigin(decimated),
    source: TERRAIN_SET.source,
    author: TERRAIN_SET.author,
    license: IMPORT_LICENSE,
    redistributable: false,
    visibility: 'private',
    placeholder: placeholderPath,
  });
  terrainFiles += 1;
  process.stdout.write(
    `  terrain: ${heightField.path} — ${String(decimated.columns)}x${String(decimated.rows)} ` +
      `vertices, ${String(decimated.triangles)} triangles, ` +
      `${decimated.size[0].toFixed(1)} x ${decimated.size[1].toFixed(1)} m, ` +
      `y ${decimated.bounds.min[1].toFixed(2)}…${decimated.bounds.max[1].toFixed(2)}, ` +
      `${(decimated.bytes.byteLength / 1024 / 1024).toFixed(1)} MB\n`,
  );
}

for (const texture of TERRAIN_TEXTURES) {
  const sourceFile = join(sourceRoot, TEXTURE_FOLDER, texture.file);
  let raw: Buffer;
  try {
    raw = await readFile(sourceFile);
  } catch {
    process.stdout.write(`  terrain: ${texture.file} is not in this export, skipped\n`);
    continue;
  }

  const bytes = fitTerrainTexture(raw, texture.file, texture.isSplatMap ?? false);
  const path = terrainTexturePath(texture);
  await write(join(storeRoot, path), bytes);
  entries.push({
    id: path.replace(/\.png$/, ''),
    path,
    kind: 'texture',
    bytes: bytes.byteLength,
    hash: sha256(bytes),
    origin: terrainTextureOrigin(texture),
    source: texture.provenance.source,
    author: texture.provenance.author,
    license: IMPORT_LICENSE,
    redistributable: false,
    visibility: 'private',
    placeholder: TEXTURE_PLACEHOLDER,
  });
  terrainFiles += 1;
}
process.stdout.write(`  terrain: ${String(terrainFiles)} file(s) for the ground\n`);

// The shared texture stand-in, written once whether or not a texture needed it,
// so `validate:assets` never reports a placeholder that is merely not reached.
await write(join(assetsDir, TEXTURE_PLACEHOLDER), unavailableTexture());

// --------------------------------------------------------------- the manifest

const existing = parseAssetManifest(JSON.parse(await readFile(manifestFile, 'utf8')));
if (!existing.ok) {
  process.stderr.write(`FAIL assets/${ASSET_MANIFEST_FILE_NAME}: ${existing.errors.join('; ')}\n`);
  process.exit(1);
}

const placeholders = new Set<string>();
for (const entry of entries) {
  if (entry.placeholder !== undefined) {
    placeholders.add(entry.placeholder);
  }
}

/** Placeholders are files in `assets/`, so they are public assets in their own right. */
const placeholderEntries: AssetEntry[] = [];
for (const path of [...placeholders].sort()) {
  const bytes = dryRun ? Buffer.alloc(0) : await readFile(join(assetsDir, path));
  placeholderEntries.push({
    id: path.replace(/\.[^./]+$/, '').toLowerCase(),
    path,
    kind: path.endsWith('.png') ? 'texture' : 'mesh',
    bytes: bytes.byteLength,
    hash: sha256(bytes),
    origin:
      'Generated by tooling/asset-pipeline/import-world-assets.ts from the hull of the private ' +
      'asset it stands in for (ADR-0015).',
    source: 'World of Vikings asset pipeline',
    author: 'World of Vikings contributors',
    license: 'CC0-1.0',
    redistributable: true,
    visibility: 'public',
  });
}

/**
 * Everything this run produced, by path. Re-running must replace these entries
 * rather than add a second copy of each — which is what makes the import
 * idempotent instead of merely repeatable.
 */
const produced = new Map<string, AssetEntry>();
for (const entry of [...placeholderEntries, ...entries]) {
  produced.set(entry.path, entry);
}

/**
 * Everything the manifest already had that this run does not own: the vendored
 * public assets. Private entries from a previous run are dropped, so an asset
 * that has since disappeared from the source disappears here too.
 */
const keep = existing.manifest.assets.filter(
  (entry) => entry.visibility === 'public' && !produced.has(entry.path),
);

const assets = [...keep, ...produced.values()].sort((a, b) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
);

const unchanged =
  JSON.stringify(assets) ===
  JSON.stringify(
    [...existing.manifest.assets].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  );

const manifest = {
  manifestVersion: CURRENT_ASSET_MANIFEST_VERSION,
  // Idempotence: an unchanged asset list keeps its timestamp, so re-running the
  // import does not put a one-line diff into a pull request.
  generatedAt: unchanged ? existing.manifest.generatedAt : new Date().toISOString(),
  assets,
};

if (!dryRun) {
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

// ----------------------------------------------------------------- the report

const storeBytes = entries.reduce((total, entry) => total + entry.bytes, 0);
const byGroup = new Map<string, number>();
for (const entry of entries) {
  const group = entry.path.split('/')[0] ?? '?';
  byGroup.set(group, (byGroup.get(group) ?? 0) + 1);
}

process.stdout.write('\n');
for (const [group, count] of [...byGroup].sort()) {
  process.stdout.write(`  ${group.padEnd(12)} ${String(count).padStart(5)} file(s)\n`);
}
process.stdout.write(
  `  ${'store total'.padEnd(12)} ${(storeBytes / 1024 / 1024).toFixed(1).padStart(5)} MB\n`,
);
process.stdout.write(
  `  ${'placeholders'.padEnd(12)} ${String(placeholderEntries.length).padStart(5)} file(s) in assets/\n`,
);
process.stdout.write(`  ${'manifest'.padEnd(12)} ${String(assets.length).padStart(5)} entries\n`);
process.stdout.write(
  `  ${'normals'.padEnd(12)} ${String(report.normalsComputed).padStart(5)} file(s) had none and were given them\n`,
);

if (report.excluded.length > 0) {
  process.stdout.write(`\n  excluded after measuring (${String(report.excluded.length)}):\n`);
  for (const line of report.excluded) {
    process.stdout.write(`    ${line}\n`);
  }
}
process.stdout.write('\n  not selected:\n');
for (const [reason, count] of [...report.skipped].sort((a, b) => b[1] - a[1])) {
  process.stdout.write(`    ${String(count).padStart(5)}  ${reason}\n`);
}
process.stdout.write(
  dryRun
    ? '\ndry run: nothing was written\n'
    : `\nwrote ${String(entries.length)} store file(s) and assets/${ASSET_MANIFEST_FILE_NAME}\n`,
);
