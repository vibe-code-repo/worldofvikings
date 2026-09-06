/**
 * `pnpm import:scene-models` — the second pass of a bundle import.
 *
 * ```bash
 * pnpm import:scene-models --scene <export>/SceneHierarchyObject/Village1.glb \
 *                          --store <store>
 * pnpm import:scene-models --scene … --store … --dry-run       # report, write nothing
 * ```
 *
 * The first pass (`pnpm import:scene`) matches bundle nodes against the models
 * that were exported as their own files. Everything it cannot match is not
 * missing — it is geometry that only ever existed inside the bundle: a house
 * floor, a wood pile, a brazier, a path of loose bricks. This pass cuts one
 * store model out of the bundle per unmatched name, so the world file has
 * something to reference.
 *
 * Order of a full import:
 *
 * ```bash
 * pnpm import:scene-models --scene <bundle> --store <store>   # this, first
 * pnpm generate:prefabs                                       # then the catalogue
 * pnpm import:scene --scene <bundle> --world … --name …       # then the world
 * ```
 *
 * **It only ever adds.** A store path that already exists is left alone and
 * named in the report: an existing file is one the export pipeline produced,
 * and a bundle copy is not automatically better than it. Same for textures,
 * which are matched to what the store already holds by content hash, so a
 * shared 2048 px atlas is one file rather than one per model (ADR-0015).
 *
 * **But a file left alone still gets its manifest row.** The store outlives a
 * run and is shared with `import:world-assets`, which rewrites the rows it owns.
 * A pass that saw the file, said "already there" and wrote nothing left the row
 * missing for good — the prefab catalogue then lost 138 prefabs and the next
 * world import wrote a village with a quarter of its entities gone. So "already
 * there" now splits in two: the manifest names it (nothing to do), or only the
 * store has it (the row is written back from the file, byte for byte). See
 * ADR-0023.
 */
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  ASSET_MANIFEST_FILE_NAME,
  CURRENT_ASSET_MANIFEST_VERSION,
  UNDETERMINED_LICENSE,
  parseAssetManifest,
} from '@wov/asset-system/manifest';
import type { AssetEntry } from '@wov/asset-system/manifest';
import { assertSupported, readGlb, worldBounds, writeGlb } from '../asset-pipeline/glb.js';
import type { Bounds } from '../asset-pipeline/glb.js';
import {
  MAX_TEXTURE_SIZE,
  decodePng,
  encodePng,
  fitWithin,
  isPng,
  readPngSize,
} from '../asset-pipeline/png.js';
import { applySurfaces } from '../asset-pipeline/material-binding.js';
import { buildPlaceholderGlb, placeholderPathFor } from '../asset-pipeline/placeholder.js';
import {
  cutModel,
  groupForStem,
  hashOf,
  planModels,
  storeStateOf,
  storeTexturePaths,
  textureNodeStem,
} from '../asset-pipeline/scene-models.js';
import { repoRoot } from './prefab-catalog.js';
import { loadPrefabStems } from './prefab-stems.js';
import { DEFAULT_ZONES, scanScene } from './scene-import.js';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name: string): string {
  const value = argument(name);
  if (value === undefined || value.length === 0) {
    process.stderr.write(
      'usage: tsx tooling/scripts/import-scene-models.ts --scene <bundle.glb> ' +
        '--store <store> [--dry-run]\n',
    );
    process.exit(2);
  }
  return value;
}

const sceneFile = required('scene');
const storeRoot = required('store');
const dryRun = process.argv.includes('--dry-run');
const assetsDir = join(repoRoot, 'assets');
const manifestFile = join(assetsDir, ASSET_MANIFEST_FILE_NAME);

/**
 * The largest a cut model may plausibly be, in metres.
 *
 * Same reasoning as the export importer's limit: it *excludes and names*, it
 * never rescales. A bundle also contains a sky dome and distance backdrops,
 * which are hundreds of metres across and are not props.
 */
const SIZE_LIMIT = 80;

/** The one licence statement this import may make: none has been made. */
const IMPORT_LICENSE = UNDETERMINED_LICENSE;
const TEXTURE_PLACEHOLDER = 'placeholders/textures/unavailable.png';

const bundleName = sceneFile.split('/').at(-1) ?? sceneFile;

async function write(file: string, bytes: Buffer): Promise<void> {
  if (dryRun) {
    return;
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, bytes);
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function largestExtent(bounds: Bounds): number {
  return Math.max(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  );
}

function rounded(bounds: Bounds): Bounds {
  const round = (value: number): number => Number(value.toFixed(4));
  return {
    min: [round(bounds.min[0]), round(bounds.min[1]), round(bounds.min[2])],
    max: [round(bounds.max[0]), round(bounds.max[1]), round(bounds.max[2])],
  };
}

// ------------------------------------------------------------- what the store has

/**
 * Every texture the store already holds, by group and by content hash.
 *
 * This is what keeps a 2048 px atlas one file: the bundle embeds the same image
 * the per-model export embedded, so after the same downscale it hashes the same
 * and the cut model simply points at the file that is already there.
 *
 * Textures live in the model group's own `textures/` folder, never in a shared
 * one at the top of the store, because a model may only refer to a texture with
 * a URI that has no `..` in it — Babylon.js rejects those outright (ADR-0019).
 * So the index is per group, and a texture two groups both need is stored twice.
 */
const textureByGroup = new Map<string, Map<string, string>>();
async function texturesOf(group: string): Promise<Map<string, string>> {
  const known = textureByGroup.get(group);
  if (known !== undefined) {
    return known;
  }
  const byHash = new Map<string, string>();
  textureByGroup.set(group, byHash);
  try {
    for (const fileName of (await readdir(join(storeRoot, group, 'textures'))).sort()) {
      if (!fileName.endsWith('.png')) {
        continue;
      }
      const bytes = await readFile(join(storeRoot, group, 'textures', fileName));
      byHash.set(hashOf(bytes), `${group}/textures/${fileName}`);
    }
  } catch {
    process.stdout.write(`  store has no ${group}/textures/ folder yet\n`);
  }
  return byHash;
}

const existingManifest = parseAssetManifest(JSON.parse(await readFile(manifestFile, 'utf8')));
if (!existingManifest.ok) {
  process.stderr.write(
    `FAIL assets/${ASSET_MANIFEST_FILE_NAME}: ${existingManifest.errors.join('; ')}\n`,
  );
  process.exit(1);
}
const manifestPaths = new Set(existingManifest.manifest.assets.map((entry) => entry.path));

// ------------------------------------------------------------------ the scan

const { byStem: prefabsByStem } = await loadPrefabStems(join(repoRoot, 'content', 'prefabs'));
process.stdout.write(`bundle:   ${sceneFile}\n`);
process.stdout.write(`store:    ${storeRoot}${dryRun ? '  (dry run, nothing written)' : ''}\n`);

const bundle = readGlb(await readFile(sceneFile));
assertSupported(bundle.json, bundleName);
const scan = scanScene(bundle.json, { zones: DEFAULT_ZONES, prefabsByStem });
const plan = planModels(bundle.json, scan.misses);

process.stdout.write(
  `unmatched: ${String(scan.misses.length)} placement(s) under ${String(plan.length)} name(s)\n\n`,
);

// -------------------------------------------------------------------- cutting

const produced: AssetEntry[] = [];
const producedPaths = new Set<string>();
const skipped: string[] = [];
const adopted: string[] = [];
const excluded: string[] = [];
const variants: string[] = [];
const newTexturePaths: string[] = [];
let reusedTextures = 0;

function record(entry: AssetEntry): void {
  if (producedPaths.has(entry.path)) {
    return;
  }
  producedPaths.add(entry.path);
  produced.push(entry);
}

/** The provenance sentence a cut model carries, so an adopted row repeats it exactly. */
function modelOrigin(stem: string, triangles: number, instances: number): string {
  return (
    `modelling export, scene bundle ${bundleName}, node "${stem}" ` +
    `(cut out with its material and texture reference, origin kept as in the bundle, ` +
    `${String(triangles)} triangles, ${String(instances)} placement(s))`
  );
}

/** The provenance sentence a cut texture carries, for the same reason. */
function textureOrigin(stem: string): string {
  return `modelling export, scene bundle ${bundleName} (embedded texture of node "${stem}", extracted)`;
}

/** Downscaled image bytes, keyed by the bytes the bundle embedded. */
const resized = new Map<string, Buffer>();

for (const group of plan) {
  const folder = groupForStem(group.stem);
  const path = `${folder}/${group.stem}.glb`;
  const state = storeStateOf(path, manifestPaths, await exists(join(storeRoot, path)));

  if (state === 'known') {
    skipped.push(`${path} — the store already has this model`);
    continue;
  }

  if (state === 'adopt') {
    // The file is in the store but no manifest row names it. That is not a
    // reason to cut a second copy, and it is not a reason to walk past either:
    // an unnamed store file is invisible to the prefab catalogue, so the world
    // file loses every entity that referenced it. The row is written back from
    // the file that is already there, byte for byte (ADR-0023).
    const bytes = await readFile(join(storeRoot, path));
    const stored = readGlb(bytes);
    const measured = worldBounds(stored.json, path);
    if (measured === undefined) {
      excluded.push(`${path} — in the store but has no geometry`);
      continue;
    }
    const bounds = rounded(measured);
    const placeholderPath = placeholderPathFor(path);
    await write(join(assetsDir, placeholderPath), buildPlaceholderGlb(group.stem, bounds));

    for (const texturePath of storeTexturePaths(stored.json, folder)) {
      if (manifestPaths.has(texturePath) || producedPaths.has(texturePath)) {
        continue;
      }
      const textureBytes = await readFile(join(storeRoot, texturePath));
      record({
        id: texturePath.replace(/\.png$/, ''),
        path: texturePath,
        kind: 'texture',
        bytes: textureBytes.byteLength,
        hash: hashOf(textureBytes),
        origin: textureOrigin(textureNodeStem(texturePath) ?? group.stem),
        source: 'scene bundle of the authored village level',
        author: 'unknown',
        license: IMPORT_LICENSE,
        redistributable: false,
        visibility: 'private',
        placeholder: TEXTURE_PLACEHOLDER,
      });
    }

    record({
      id: `${folder}/${group.stem}`,
      path,
      kind: 'mesh',
      bytes: bytes.byteLength,
      hash: hashOf(bytes),
      bounds,
      origin: modelOrigin(group.stem, group.triangles, group.instances),
      source: 'scene bundle of the authored village level',
      author: 'unknown',
      license: IMPORT_LICENSE,
      redistributable: false,
      visibility: 'private',
      placeholder: placeholderPath,
    });
    adopted.push(`${path} — already in the store, its manifest entry written back`);
    continue;
  }

  const cut = cutModel(bundle, group.node, group.stem);
  const measured = worldBounds(cut.glb.json, path);
  if (measured === undefined) {
    excluded.push(`${path} — no geometry`);
    continue;
  }
  const extent = largestExtent(measured);
  if (extent > SIZE_LIMIT) {
    excluded.push(
      `${path} — ${extent.toFixed(1)} m across, over the ${String(SIZE_LIMIT)} m limit; ` +
        'a backdrop or a sky dome rather than a world object',
    );
    continue;
  }
  if (group.shapes > 1) {
    variants.push(
      `${group.stem} — ${String(group.shapes)} shapes under one name, the most common one was cut`,
    );
  }

  // Textures first: the model's images must point at their final files before
  // the GLB is serialised.
  for (const image of cut.images) {
    if (!isPng(image.bytes)) {
      throw new Error(`${path}: embedded image "${image.name}" is not a PNG`);
    }
    // A hundred and thirty models embed the same handful of atlases, and
    // halving a 4096 px one costs about a second. Keying the result on the
    // *embedded* bytes turns that from once per model into once per image.
    const embeddedHash = hashOf(image.bytes);
    let bytes = resized.get(embeddedHash);
    if (bytes === undefined) {
      const size = readPngSize(image.bytes);
      bytes =
        size !== undefined && (size.width > MAX_TEXTURE_SIZE || size.height > MAX_TEXTURE_SIZE)
          ? encodePng(fitWithin(decodePng(image.bytes), MAX_TEXTURE_SIZE))
          : image.bytes;
      resized.set(embeddedHash, bytes);
    }

    const hash = hashOf(bytes);
    const known = await texturesOf(folder);
    let texturePath = known.get(hash);
    if (texturePath === undefined) {
      // Named after the first model that needs it rather than after the
      // material: a material name here names the pack it came from, and a
      // repository path is not the place to record an unconfirmed attribution
      // (that lives in the manifest's provenance fields, once).
      texturePath = `${folder}/textures/${group.stem}-${hash.slice('sha256-'.length, 'sha256-'.length + 8)}.png`;
      known.set(hash, texturePath);
      await write(join(storeRoot, texturePath), bytes);
      newTexturePaths.push(texturePath);
      record({
        id: texturePath.replace(/\.png$/, ''),
        path: texturePath,
        kind: 'texture',
        bytes: bytes.byteLength,
        hash,
        origin: textureOrigin(group.stem),
        source: 'scene bundle of the authored village level',
        author: 'unknown',
        license: IMPORT_LICENSE,
        redistributable: false,
        visibility: 'private',
        placeholder: TEXTURE_PLACEHOLDER,
      });
    } else {
      reusedTextures += 1;
    }

    const target = cut.glb.json.images?.[image.slot];
    if (target !== undefined) {
      // Relative to the GLB's own URL and free of `..`, the convention the
      // store already uses (ADR-0019): `environment/x.glb` says
      // `textures/y.png` and means `environment/textures/y.png`.
      target.uri = texturePath.slice(texturePath.indexOf('/') + 1);
    }
  }

  // The cut keeps the bundle's material, and the bundle wrote no factors: a
  // leaf card arrives opaque, single-sided, metallic and grey. The surface
  // table decides all four, the same one the other importer consults, so a
  // bush cut out of the bundle and a bush imported as a file look alike.
  applySurfaces(cut.glb.json);

  const bytes = writeGlb(cut.glb);
  await write(join(storeRoot, path), bytes);

  const bounds = rounded(measured);
  const placeholderPath = placeholderPathFor(path);
  await write(join(assetsDir, placeholderPath), buildPlaceholderGlb(group.stem, bounds));

  record({
    id: `${folder}/${group.stem}`,
    path,
    kind: 'mesh',
    bytes: bytes.byteLength,
    hash: hashOf(bytes),
    bounds,
    origin: modelOrigin(group.stem, group.triangles, group.instances),
    source: 'scene bundle of the authored village level',
    author: 'unknown',
    license: IMPORT_LICENSE,
    redistributable: false,
    visibility: 'private',
    placeholder: placeholderPath,
  });
}

// --------------------------------------------------------------- the manifest

const placeholderPaths = new Set<string>();
for (const entry of produced) {
  if (entry.placeholder !== undefined && entry.placeholder !== TEXTURE_PLACEHOLDER) {
    placeholderPaths.add(entry.placeholder);
  }
}
for (const path of [...placeholderPaths].sort()) {
  const bytes = dryRun ? Buffer.alloc(0) : await readFile(join(assetsDir, path));
  record({
    id: path.replace(/\.[^./]+$/, '').toLowerCase(),
    path,
    kind: 'mesh',
    bytes: bytes.byteLength,
    hash: hashOf(bytes),
    origin:
      'Generated by tooling/scripts/import-scene-models.ts from the hull of the private asset ' +
      'it stands in for (ADR-0015).',
    source: 'World of Vikings asset pipeline',
    author: 'World of Vikings contributors',
    license: 'CC0-1.0',
    redistributable: true,
    visibility: 'public',
  });
}

const producedByPath = new Map(produced.map((entry) => [entry.path, entry]));
// Everything already in the manifest stays: this pass adds models, it is not
// the owner of the manifest and must not drop another importer's entries.
const assets = [
  ...existingManifest.manifest.assets.filter((entry) => !producedByPath.has(entry.path)),
  ...producedByPath.values(),
].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

const unchanged =
  JSON.stringify(assets) ===
  JSON.stringify(
    [...existingManifest.manifest.assets].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    ),
  );

if (!dryRun) {
  await writeFile(
    manifestFile,
    `${JSON.stringify(
      {
        manifestVersion: CURRENT_ASSET_MANIFEST_VERSION,
        generatedAt: unchanged ? existingManifest.manifest.generatedAt : new Date().toISOString(),
        assets,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

// ----------------------------------------------------------------- the report

const models = produced.filter((entry) => entry.kind === 'mesh' && entry.visibility === 'private');
const storeBytes = models.reduce((total, entry) => total + entry.bytes, 0);
process.stdout.write(
  `  models cut     ${String(models.length).padStart(5)}  (${(storeBytes / 1024 / 1024).toFixed(1)} MB into the store)\n`,
);
process.stdout.write(
  `  textures       ${String(newTexturePaths.length).padStart(5)} new, ${String(reusedTextures)} reference(s) to textures the store already had\n`,
);
process.stdout.write(`  placeholders   ${String(placeholderPaths.size).padStart(5)}  in assets/\n`);
process.stdout.write(`  manifest       ${String(assets.length).padStart(5)}  entries\n`);

for (const [title, lines] of [
  ['already in the store, left alone', skipped],
  ['in the store but missing from the manifest, entry restored', adopted],
  ['excluded after measuring', excluded],
  ['one name, several shapes', variants],
  ['textures new to the store', newTexturePaths],
] as const) {
  if (lines.length > 0) {
    process.stdout.write(`\n  ${title} (${String(lines.length)}):\n`);
    for (const line of lines) {
      process.stdout.write(`    ${line}\n`);
    }
  }
}

process.stdout.write(
  dryRun
    ? '\ndry run: nothing was written\n'
    : `\nwrote ${String(models.length)} store model(s), ${String(newTexturePaths.length)} texture(s) and assets/${ASSET_MANIFEST_FILE_NAME}\n`,
);
