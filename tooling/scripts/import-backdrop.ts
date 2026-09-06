/**
 * `pnpm import:backdrop` — the painted distance, out of the export and into the
 * store.
 *
 * ```bash
 * pnpm import:backdrop --source <export> --store <store>
 * pnpm import:backdrop --source <export> --store <store> --dry-run
 * ```
 *
 * Three models, listed in `tooling/asset-pipeline/backdrop.ts`: two mountain
 * panoramas that differ only in their texture, and a sky dome. Each one becomes
 * one store GLB with one material and one texture file beside it, named after
 * this repository rather than after the export, plus a hull placeholder in
 * `assets/` so a clone with no store still opens the world (ADR-0015).
 *
 * Order of a full import — this runs beside the other two, before the
 * catalogue, because the scene import needs the prefabs to exist:
 *
 * ```bash
 * pnpm import:world-assets --source <export> --store <store>
 * pnpm import:scene-models --scene <bundle> --store <store>
 * pnpm import:backdrop     --source <export> --store <store>   # this
 * pnpm generate:prefabs --store <store>
 * pnpm import:scene --scene <bundle> --world … --name …
 * ```
 *
 * **It owns exactly its own rows.** The manifest is shared with two other
 * importers, so what this run produced replaces same-path rows and everything
 * else is left alone or carried over from the store (ADR-0023,
 * `manifest-merge.ts`).
 *
 * **The panorama keeps its 4 096 px.** That is the store's one exception to the
 * 2 048 px ceiling and it is argued in `backdrop.ts` next to the number, not
 * here: one image covers 360° of horizon, and every other texture covers a few
 * metres of a model.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import {
  ASSET_MANIFEST_FILE_NAME,
  CURRENT_ASSET_MANIFEST_VERSION,
  UNDETERMINED_LICENSE,
  parseAssetManifest,
} from '@wov/asset-system/manifest';
import type { AssetEntry } from '@wov/asset-system/manifest';
import {
  BACKDROP_MODELS,
  assertSupported,
  backdropModelPath,
  backdropTexturePath,
  countTriangles,
  readGlb,
  worldBounds,
  writeGlb,
} from '@wov/content-build';
import type { Bounds } from '@wov/content-build';
import {
  PANORAMA_MAX_HEIGHT,
  PANORAMA_MAX_WIDTH,
  buildBackdropModel,
  fitsPanorama,
} from '../asset-pipeline/backdrop.js';
import { mergeOwnedEntries } from '../asset-pipeline/manifest-merge.js';
import { decodePng, encodePng, fitWithin, isPng, readPngSize } from '../asset-pipeline/png.js';
import { buildPlaceholderGlb, placeholderPathFor } from '../asset-pipeline/placeholder.js';
import { ENVIRONMENT_SET, SOURCE_FOLDERS } from '../asset-pipeline/selection.js';
import { repoRoot } from './repo-root.js';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name: string): string {
  const value = argument(name);
  if (value === undefined || value.length === 0) {
    process.stderr.write(
      'usage: tsx tooling/scripts/import-backdrop.ts --source <export> --store <store> ' +
        '[--dry-run]\n',
    );
    process.exit(2);
  }
  return value;
}

const sourceRoot = required('source');
const storeRoot = required('store');
const dryRun = process.argv.includes('--dry-run');
const assetsDir = join(repoRoot, 'assets');
const manifestFile = join(assetsDir, ASSET_MANIFEST_FILE_NAME);

/** Where a single model file lives in the export: the `mesh` source folder. */
const MODEL_FOLDER = SOURCE_FOLDERS.find((folder) => folder.kind === 'mesh')?.folder ?? 'Mesh';
/** Where a loose texture file lives in the export. */
const TEXTURE_FOLDER = 'Texture2D';

/** The one licence statement this import may make: none has been made. */
const IMPORT_LICENSE = UNDETERMINED_LICENSE;
const TEXTURE_PLACEHOLDER = 'placeholders/textures/unavailable.png';

function hashOf(bytes: Buffer): string {
  return `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
}

async function write(file: string, bytes: Buffer): Promise<void> {
  if (dryRun) {
    return;
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, bytes);
}

function rounded(bounds: Bounds): Bounds {
  const round = (value: number): number => Number(value.toFixed(4));
  return {
    min: [round(bounds.min[0]), round(bounds.min[1]), round(bounds.min[2])],
    max: [round(bounds.max[0]), round(bounds.max[1]), round(bounds.max[2])],
  };
}

const existing = parseAssetManifest(JSON.parse(await readFile(manifestFile, 'utf8')));
if (!existing.ok) {
  process.stderr.write(`FAIL assets/${ASSET_MANIFEST_FILE_NAME}: ${existing.errors.join('; ')}\n`);
  process.exit(1);
}

process.stdout.write(`export:  ${sourceRoot}\n`);
process.stdout.write(`store:   ${storeRoot}${dryRun ? '  (dry run, nothing written)' : ''}\n\n`);

const produced: AssetEntry[] = [];
const report: string[] = [];

for (const backdrop of BACKDROP_MODELS) {
  const modelFile = join(sourceRoot, MODEL_FOLDER, backdrop.model);
  const glb = readGlb(await readFile(modelFile));
  assertSupported(glb.json, backdrop.model);

  // The texture first: the model's image must point at its final file name
  // before the GLB is serialised, and a texture that turns out not to be a PNG
  // must stop the run rather than produce a model referring to nothing.
  let texturePath: string | undefined;
  if (backdrop.texture !== undefined) {
    const bytes = await readFile(join(sourceRoot, TEXTURE_FOLDER, backdrop.texture));
    if (!isPng(bytes)) {
      throw new Error(`${backdrop.stem}: "${backdrop.texture}" is not a PNG`);
    }
    const size = readPngSize(bytes);
    if (size === undefined) {
      throw new Error(`${backdrop.stem}: "${backdrop.texture}" has no readable PNG header`);
    }
    // Kept at full size when it is a panorama, halved down when it is bigger
    // than one. Reported either way, because "the horizon is soft" is a
    // question about this line and nothing else.
    const fits = fitsPanorama(size.width, size.height);
    const stored = fits ? bytes : encodePng(fitWithin(decodePng(bytes), PANORAMA_MAX_WIDTH));
    texturePath = backdropTexturePath(backdrop.stem);
    await write(join(storeRoot, texturePath), stored);
    report.push(
      `${texturePath} — ${String(size.width)}×${String(size.height)} px, ` +
        (fits
          ? `kept (panorama, ceiling ${String(PANORAMA_MAX_WIDTH)}×${String(PANORAMA_MAX_HEIGHT)})`
          : 'downscaled'),
    );
    produced.push({
      id: texturePath.replace(/\.png$/, ''),
      path: texturePath,
      kind: 'texture',
      bytes: stored.byteLength,
      hash: hashOf(stored),
      origin:
        'modelling export, loose texture file, stored at full panorama resolution ' +
        '(see PANORAMA_MAX_WIDTH in tooling/asset-pipeline/backdrop.ts)',
      source: ENVIRONMENT_SET.source,
      author: ENVIRONMENT_SET.author,
      license: IMPORT_LICENSE,
      redistributable: false,
      visibility: 'private',
      placeholder: TEXTURE_PLACEHOLDER,
    });
  }

  // Relative to the model's own URL and free of `..` (ADR-0019):
  // `environment/x.glb` says `textures/x.png`.
  const uri = texturePath?.slice(texturePath.indexOf('/') + 1);
  const model = buildBackdropModel(glb, backdrop.stem, uri);

  const path = backdropModelPath(backdrop.stem);
  const measured = worldBounds(model.json, path);
  if (measured === undefined) {
    throw new Error(`${path}: the source model has no geometry`);
  }
  const bounds = rounded(measured);
  const bytes = writeGlb(model);
  await write(join(storeRoot, path), bytes);

  const placeholderPath = placeholderPathFor(path);
  const placeholder = buildPlaceholderGlb(backdrop.stem, bounds);
  await write(join(assetsDir, placeholderPath), placeholder);

  produced.push({
    id: `environment/${backdrop.stem}`,
    path,
    kind: 'mesh',
    bytes: bytes.byteLength,
    hash: hashOf(bytes),
    bounds,
    origin:
      `modelling export, single model file, ${backdrop.note} ` +
      `(${String(countTriangles(model.json))} triangles, vertices untouched, one material ` +
      'written from the surface table)',
    source: ENVIRONMENT_SET.source,
    author: ENVIRONMENT_SET.author,
    license: IMPORT_LICENSE,
    redistributable: false,
    visibility: 'private',
    placeholder: placeholderPath,
  });
  produced.push({
    id: placeholderPath.replace(/\.[^./]+$/, '').toLowerCase(),
    path: placeholderPath,
    kind: 'mesh',
    bytes: placeholder.byteLength,
    hash: hashOf(placeholder),
    origin:
      'Generated by tooling/scripts/import-backdrop.ts from the hull of the private asset ' +
      'it stands in for (ADR-0015).',
    source: 'World of Vikings asset pipeline',
    author: 'World of Vikings contributors',
    license: 'CC0-1.0',
    redistributable: true,
    visibility: 'public',
  });

  const extent = Math.max(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  );
  report.push(
    `${path} — ${extent.toFixed(1)} m across, ${(bytes.byteLength / 1024).toFixed(1)} kB`,
  );
}

// Everything this run did not produce belongs to another importer and is kept
// as long as the store still holds it (ADR-0023). Tested against the store on
// disk and never against this run's own output: a predicate that only knew what
// this command wrote would prune five hundred rows it does not own.
const merged = mergeOwnedEntries(existing.manifest.assets, produced, (path) =>
  existsSync(join(storeRoot, path)),
);

const unchanged = JSON.stringify(merged.assets) === JSON.stringify(existing.manifest.assets);
if (!dryRun) {
  await writeFile(
    manifestFile,
    `${JSON.stringify(
      {
        manifestVersion: CURRENT_ASSET_MANIFEST_VERSION,
        generatedAt: unchanged ? existing.manifest.generatedAt : new Date().toISOString(),
        assets: merged.assets,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

for (const line of report) {
  process.stdout.write(`  ${line}\n`);
}
if (merged.dropped.length > 0) {
  process.stdout.write(`\n  dropped (${String(merged.dropped.length)}):\n`);
  for (const path of merged.dropped) {
    process.stdout.write(`    ${path}\n`);
  }
}
process.stdout.write(
  dryRun
    ? '\ndry run: nothing was written\n'
    : `\nwrote ${String(BACKDROP_MODELS.length)} backdrop model(s) and ` +
        `assets/${ASSET_MANIFEST_FILE_NAME} (${String(merged.assets.length)} entries)\n`,
);
