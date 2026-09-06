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
 * 4. **Extract textures** — embedded images become files in the model group's
 *    own `textures/` folder, referenced by a sibling-relative URI, deduplicated
 *    by content hash, and halved until they fit the 2048 px budget.
 * 4a. **Bind the materials the per-model export dropped** — 388 of the 437
 *    models arrive with one untextured `DefaultMaterial`, because the material
 *    assignment lives in the scene bundles rather than in the model files. The
 *    bundles are read once, up front, and every model that appears in one gets
 *    its material back, with a base colour pointing at a shared texture file.
 *    `scene-bindings.ts` explains how a model is recognised and why the
 *    material is paired by vertex count; `materials.ts` is the checked table
 *    that decides which of them are cut out, double-sided or self-lit.
 * 4b. **Compute the normals the exporter left out** — twelve terrains ship with
 *    `POSITION` and `TEXCOORD_0` only, which draws as a scatter of backfaces.
 *    This is the only vertex data the pipeline writes, and it is additive.
 * 5. **Write** — the normalised GLB into the store, a hull box into
 *    `assets/placeholders/`, and one manifest entry with the provenance.
 * 6. **Terrain** — after the folders, `terrain-import.ts` adds the playable half
 *    of the ground: a thinned copy of the village height field with rebuilt
 *    normals and UVs, and the eight ground textures a world file's `terrain`
 *    names by hand (ADR-0020). It is a step of this run rather than its own
 *    command, so that one run owns every manifest row it is responsible for.
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
 *
 * **And idempotent next to the other importers.** This command does not own the
 * whole manifest. `import:scene-models` writes private rows for models it cuts
 * out of a scene bundle into the same store, and those rows are carried over
 * here for as long as the store still holds their files — see
 * `manifest-merge.ts` for why the store is a second source of truth, and
 * ADR-0023 for the incident that made it one.
 */
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
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
import { mergeOwnedEntries } from './manifest-merge.js';
import { buildPlaceholderGlb, placeholderPathFor } from './placeholder.js';
import { bindMaterials } from './material-binding.js';
import { NO_SCENE_BINDINGS, readSceneBindings } from './scene-bindings.js';
import type { SceneBindings } from './scene-bindings.js';
import {
  SCENE_BUNDLE_FOLDER,
  SOURCE_FOLDERS,
  TERRAIN_SET,
  isSelection,
  originShiftFor,
  select,
} from './selection.js';
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

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
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
  /** Set when the source image was over the budget, as `4096→2048`. */
  readonly resizedFrom?: string;
}

/**
 * Textures already written this run, keyed by group and by the hash of their
 * final bytes — see {@link takeTexture} for why the group is part of the key.
 */
const textures = new Map<string, TextureFile>();

/**
 * Turns one image into a file in the model's own `textures/` folder, reusing an
 * identical one that a previous model of the same group already produced.
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
 *
 * **Why one `textures/` folder per group instead of one for the store.** The
 * reference in the GLB has to be a relative URI that Babylon.js will accept,
 * and Babylon refuses any URI containing `..` outright
 * (`GLTFLoader._ValidateUri`) — so `environment/rock.glb` cannot point at
 * `../textures/atlas.png`, however correct that is by the glTF specification.
 * It can point at `textures/atlas.png`, which resolves next to the model. The
 * price is a second copy of any atlas that two groups share; measured against
 * this export that price is zero, because no texture is used by more than one
 * group — the flat-shaded atlases are environment, the leaf atlases vegetation.
 */
function takeTexture(group: string, name: string, raw: Buffer, label: string): TextureFile {
  let bytes = raw;
  let resizedFrom: string | undefined;
  const size = readPngSize(raw);
  if (!isPng(raw)) {
    throw new Error(`${label}: embedded image "${name}" is not a PNG`);
  }
  if (size !== undefined && (size.width > MAX_TEXTURE_SIZE || size.height > MAX_TEXTURE_SIZE)) {
    const fitted = fitWithin(decodePng(raw), MAX_TEXTURE_SIZE);
    bytes = encodePng(fitted);
    resizedFrom = `${String(size.width)}×${String(size.height)}→${String(fitted.width)}×${String(fitted.height)}`;
  }

  const hash = sha256(bytes);
  const key = `${group}:${hash}`;
  const existing = textures.get(key);
  if (existing !== undefined) {
    return { ...existing, isNew: false };
  }
  const stem = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const file: TextureFile = {
    path: `${group}/textures/${stem === '' ? 'texture' : stem}-${hash.slice(ASSET_HASH_PREFIX.length, ASSET_HASH_PREFIX.length + 8)}.png`,
    bytes,
    isNew: true,
    ...(resizedFrom === undefined ? {} : { resizedFrom }),
  };
  textures.set(key, file);
  return file;
}

/**
 * How a model refers to one of its textures: a sibling folder, never `..`.
 *
 * `environment/rock.glb` says `textures/atlas.png`, which every glTF loader
 * resolves against the model's own URL — `…/store/environment/textures/…` over
 * the asset server, `environment/textures/…` on disk.
 */
function textureUri(texture: TextureFile): string {
  return texture.path.slice(texture.path.indexOf('/') + 1);
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
  /** Models that carried their own textured material out of the export. */
  authoredTextures: number;
  /** Models a scene bundle gave a material to. */
  boundFromScenes: number;
  /** Models that ended the run with no base colour anywhere. */
  readonly untextured: string[];
  /** Textures that were over the size budget, as `path 4096×4096→2048×2048`. */
  readonly resized: string[];
  /** Material names met that `materials.ts` does not list. */
  readonly unlistedMaterials: Set<string>;
  readonly skipped: Map<string, number>;
  readonly excluded: string[];
}

const entries: AssetEntry[] = [];
const report: Report = {
  imported: 0,
  normalsComputed: 0,
  authoredTextures: 0,
  boundFromScenes: 0,
  untextured: [],
  resized: [],
  unlistedMaterials: new Set(),
  skipped: new Map(),
  excluded: [],
};
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

  /** The manifest entry for a texture file this model was the first to need. */
  const textureEntry = (texture: TextureFile, origin: string): AssetEntry => {
    if (texture.resizedFrom !== undefined) {
      report.resized.push(`${texture.path} ${texture.resizedFrom}`);
    }
    return {
      id: texture.path.replace(/\.png$/, ''),
      path: texture.path,
      kind: 'texture',
      bytes: texture.bytes.byteLength,
      hash: sha256(texture.bytes),
      origin,
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
    };
  };

  // The model that owns a texture names it: `owner-slot-hash.png`. Slots are
  // counted across both sources below, so the same model never claims one
  // number twice.
  const owner = selection.id.split('/').pop() ?? selection.id;
  const embedded = takeEmbeddedImages(glb);

  for (const image of embedded) {
    const texture = takeTexture(
      selection.group,
      `${owner}-${String(image.index)}`,
      image.bytes,
      selection.path,
    );
    const target = glb.json.images?.[image.index];
    if (target !== undefined) {
      target.uri = textureUri(texture);
    }
    if (!texture.isNew) {
      continue;
    }
    await write(join(storeRoot, texture.path), texture.bytes);
    produced.push(
      textureEntry(
        texture,
        `Texture slot ${String(image.index)} of ${selection.path}, extracted into its own file.`,
      ),
    );
  }

  // --- material bindings from the scene bundles ---------------------------
  //
  // The per-model export dropped the material assignment; the scene bundles
  // kept it. `bindMaterials` writes it back, and every texture it asks for
  // becomes a file in the model's own `textures/` folder exactly like an
  // embedded one.
  const byVertexCount = sceneBindings.byModel.get(owner);
  const pending: TextureFile[] = [];
  let slot = embedded.length;
  const outcome = bindMaterials(
    glb.json,
    (vertices) => byVertexCount?.get(vertices)?.material,
    (material) => {
      const image = sceneBindings.images.get(material);
      if (image === undefined) {
        return undefined;
      }
      const taken = slot;
      slot += 1;
      const texture = takeTexture(
        selection.group,
        `${owner}-${String(taken)}`,
        image,
        selection.path,
      );
      if (texture.isNew) {
        pending.push(texture);
        produced.push(
          textureEntry(
            texture,
            `Texture slot ${String(taken)} of ${selection.path}, taken from the scene bundle ` +
              `that assigns this model its material.`,
          ),
        );
      }
      return textureUri(texture);
    },
  );
  for (const texture of pending) {
    await write(join(storeRoot, texture.path), texture.bytes);
  }
  for (const material of outcome.unlisted) {
    report.unlistedMaterials.add(material);
  }
  if (outcome.bound > 0) {
    report.boundFromScenes += 1;
  }
  if (outcome.kept > 0) {
    report.authoredTextures += 1;
  }
  if (outcome.bound === 0 && outcome.kept === 0) {
    const reasons = [...new Set(outcome.unbound.map((primitive) => primitive.reason))].sort();
    report.untextured.push(`${selection.path} — ${reasons.join(', ') || 'no geometry'}`);
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

/**
 * Which ids the store will hold, decided before a single file is opened.
 *
 * The scene bundles have to be read first — a model needs its material before
 * it is written — and matching a scene node to a model needs the whole list of
 * names. `select` is pure, so the list costs three directory reads.
 */
async function plannedStoreIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const { folder } of SOURCE_FOLDERS) {
    let files: string[];
    try {
      files = await readdir(join(sourceRoot, folder));
    } catch {
      continue;
    }
    for (const fileName of files) {
      const selection = select(folder, fileName);
      if (isSelection(selection)) {
        ids.add(selection.id.split('/').pop() ?? selection.id);
      }
    }
  }
  return ids;
}

const sceneBindings: SceneBindings = await (async (): Promise<SceneBindings> => {
  const directory = join(sourceRoot, SCENE_BUNDLE_FOLDER);
  let files: string[];
  try {
    files = (await readdir(directory)).filter((file) => /\.glb$/i.test(file));
  } catch {
    process.stdout.write(`  ${SCENE_BUNDLE_FOLDER}: not in this export, no material bindings\n`);
    return NO_SCENE_BINDINGS;
  }
  const ids = await plannedStoreIds();
  process.stdout.write(
    `  ${SCENE_BUNDLE_FOLDER}: reading ${String(files.length)} scene bundle(s) for material bindings\n`,
  );
  const bindings = await readSceneBindings(directory, files, ids, (file, hits) => {
    process.stdout.write(
      `    ${file.padEnd(20)} ${String(hits).padStart(6)} node(s) named a model\n`,
    );
  });
  process.stdout.write(
    `    ${String(bindings.byModel.size)} model(s) bound, ${String(bindings.images.size)} material(s) with a base colour\n`,
  );
  return bindings;
})();

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
 * Everything this run produced. Re-running must replace these entries rather
 * than add a second copy of each — which is what makes the import idempotent
 * instead of merely repeatable.
 */
const produced = [...placeholderEntries, ...entries];

/**
 * Which of the manifest's private paths the store still holds. Stat'ed up front
 * because `mergeOwnedEntries` decides synchronously, and only for the paths that
 * can reach the question at all — everything this run produced is owned and is
 * never asked about, so a dry run stats nothing it just declined to write.
 */
const ownedPaths = new Set(produced.map((entry) => entry.path));
const storeFiles = new Set<string>();
for (const entry of existing.manifest.assets) {
  if (entry.visibility === 'private' && !ownedPaths.has(entry.path)) {
    if (await exists(join(storeRoot, entry.path))) {
      storeFiles.add(entry.path);
    }
  }
}

/**
 * Merged with what the manifest already had, by the rule in `manifest-merge.ts`:
 * public entries stay, and a private entry this run does not own stays for as
 * long as the store still holds its file. Those rows belong to
 * `import:scene-models`, which cuts models out of a scene bundle into the same
 * store; deleting them here used to take 138 prefabs out of the catalogue behind
 * that command's back, and the next world import then wrote a village with a
 * quarter of its entities missing.
 */
const merged = mergeOwnedEntries(existing.manifest.assets, produced, (path) =>
  storeFiles.has(path),
);
const assets = merged.assets;

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
  `  ${'carried over'.padEnd(12)} ${String(merged.carriedOver.length).padStart(5)} private entry(s) ` +
    `another importer owns, still in the store\n`,
);
process.stdout.write(
  `  ${'normals'.padEnd(12)} ${String(report.normalsComputed).padStart(5)} file(s) had none and were given them\n`,
);

const textured = report.imported - report.untextured.length;
process.stdout.write(
  `  ${'textured'.padEnd(12)} ${String(textured).padStart(5)} of ${String(report.imported)} model(s) ` +
    `(${String(report.authoredTextures)} kept their own material, ` +
    `${String(report.boundFromScenes)} bound from a scene bundle)\n`,
);
if (report.resized.length > 0) {
  process.stdout.write(
    `\n  over the ${String(MAX_TEXTURE_SIZE)} px budget, scaled down (${String(report.resized.length)}):\n`,
  );
  for (const line of report.resized) {
    process.stdout.write(`    ${line}\n`);
  }
}
if (report.unlistedMaterials.size > 0) {
  // Not a failure: an unlisted material renders opaque, which is a visible
  // wrong rather than a silent one. It is printed so the table can be extended.
  process.stdout.write(
    `\n  materials not in the surface table (${String(report.unlistedMaterials.size)}), rendered opaque:\n`,
  );
  for (const name of [...report.unlistedMaterials].sort()) {
    process.stdout.write(`    ${name}\n`);
  }
}
if (report.untextured.length > 0) {
  process.stdout.write(
    `\n  imported without a base colour (${String(report.untextured.length)}):\n`,
  );
  for (const line of report.untextured) {
    process.stdout.write(`    ${line}\n`);
  }
}

if (merged.dropped.length > 0) {
  // Named rather than silent: these rows described a private asset that is no
  // longer in the store, so the manifest stops claiming it exists.
  process.stdout.write(`\n  dropped, no longer in the store (${String(merged.dropped.length)}):\n`);
  for (const path of merged.dropped) {
    process.stdout.write(`    ${path}\n`);
  }
}

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
