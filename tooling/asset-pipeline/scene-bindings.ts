/**
 * Reads the scene bundles and works out which material every store model wears.
 *
 * **The problem.** 388 of the 437 models in the store carry a single material
 * called `DefaultMaterial` with no texture: they come from the per-model part of
 * the export, which drops the material assignment. The same models appear
 * inside the scene bundles *with* their materials and textures. So the binding
 * exists — it just lives in a different file from the geometry.
 *
 * **How a model is recognised in a scene.** By node name, through the candidate
 * rules in `scene-names.ts`.
 *
 * **How a material is assigned to a primitive: by vertex count, not by order.**
 * A scene instance and the store copy of the same model do not have the same
 * primitive structure. The store copy of `Tree_1A3 1` is one primitive of 2564
 * vertices; the scene instance is two, of 2564 (`Birch_Bark_A`) and 14852
 * (`Leaves Birch 1`). Pairing them by index would put leaves on a trunk. The
 * vertex count is what actually survives both export paths unchanged, so that
 * is the key: a store primitive of 2564 vertices takes the material that the
 * scenes give to 2564-vertex primitives of that model.
 *
 * This was checked against the 20 models in the store that still carry real
 * material names: 18 reproduce their own material exactly, and the two that
 * differ (`grass-short-clump-1`, `tree-1e2`) differ by material *instance* —
 * `Maple Leaves 1` where the model says `Maple Leaves` — not by slot. Index
 * pairing gets 280 models; vertex-count pairing gets 309, with nothing
 * partially bound.
 *
 * **Cost.** The bundles are 1.3 GB. Only the JSON chunk and the handful of
 * image ranges are read, by seeking — never the geometry, which is all of the
 * size and none of the answer.
 */
import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Gltf } from './glb.js';
import { matchStoreId } from './scene-names.js';

const MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** A scene bundle opened for reading, without its geometry in memory. */
export interface SceneBundle {
  readonly json: Gltf;
  /** The bytes of one embedded image, read from the file on demand. */
  imageBytes(index: number): Promise<Buffer>;
  close(): Promise<void>;
}

async function readExactly(handle: FileHandle, length: number, position: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) {
    throw new Error(`scene bundle ends inside a chunk (wanted ${String(length)} bytes)`);
  }
  return buffer;
}

/**
 * Opens a GLB and parses only its JSON chunk.
 *
 * The counterpart of `readGlb` in `glb.ts`, which reads whole files because the
 * models it handles are megabytes. A scene bundle is up to 240 MB of geometry
 * this pipeline never touches.
 */
export async function openSceneBundle(file: string): Promise<SceneBundle> {
  const handle = await open(file, 'r');
  try {
    const header = await readExactly(handle, 12, 0);
    if (header.readUInt32LE(0) !== MAGIC) {
      throw new Error(`${file}: not a GLB file`);
    }
    const total = header.readUInt32LE(8);

    let json: Gltf | undefined;
    let binOffset = 0;
    let offset = 12;
    while (offset + 8 <= total) {
      const chunkHeader = await readExactly(handle, 8, offset);
      const length = chunkHeader.readUInt32LE(0);
      const type = chunkHeader.readUInt32LE(4);
      if (type === CHUNK_JSON) {
        json = JSON.parse((await readExactly(handle, length, offset + 8)).toString('utf8')) as Gltf;
      } else if (type === CHUNK_BIN) {
        binOffset = offset + 8;
      }
      offset += 8 + length + ((4 - (length % 4)) % 4);
    }
    if (json === undefined) {
      throw new Error(`${file}: GLB has no JSON chunk`);
    }
    const gltf = json;

    return {
      json: gltf,
      async imageBytes(index: number): Promise<Buffer> {
        const image = gltf.images?.[index];
        const view =
          image?.bufferView === undefined ? undefined : gltf.bufferViews?.[image.bufferView];
        if (view === undefined) {
          throw new Error(`${file}: image ${String(index)} is not embedded`);
        }
        return readExactly(handle, view.byteLength, binOffset + (view.byteOffset ?? 0));
      },
      async close(): Promise<void> {
        await handle.close();
      },
    };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

/** What one bundle says about the models the store holds. */
export interface SceneIndex {
  /** store id → vertex count → material name → how often that pairing appeared. */
  readonly models: Map<string, Map<number, Map<string, number>>>;
  /** material name → the index of its base colour image in *this* bundle. */
  readonly materialImages: Map<string, number>;
  /** How many nodes named a store model. */
  readonly hits: number;
}

function baseColourImage(json: Gltf, materialIndex: number): number | undefined {
  const material = json.materials?.[materialIndex];
  const pbr = material?.['pbrMetallicRoughness'] as Record<string, unknown> | undefined;
  const reference = pbr?.['baseColorTexture'] as { index?: number } | undefined;
  if (reference?.index === undefined) {
    return undefined;
  }
  return json.textures?.[reference.index]?.source;
}

/**
 * Reads one bundle's JSON into the two things the binding needs: which material
 * sits on which vertex count of which model, and which image each material uses.
 */
export function indexSceneBundle(json: Gltf, storeIds: ReadonlySet<string>): SceneIndex {
  const nodes = json.nodes ?? [];
  const meshes = json.meshes ?? [];
  const materials = json.materials ?? [];
  const accessors = json.accessors ?? [];

  const index: SceneIndex = { models: new Map(), materialImages: new Map(), hits: 0 };
  let hits = 0;

  for (const [nodeIndex, node] of nodes.entries()) {
    const storeId = matchStoreId(node.name ?? '', storeIds);
    if (storeId === undefined) {
      continue;
    }
    hits += 1;
    const byVertexCount = index.models.get(storeId) ?? new Map<number, Map<string, number>>();
    index.models.set(storeId, byVertexCount);

    // Iterative rather than recursive: the deepest bundle nests 40 levels and
    // the widest holds 23 000 nodes, and a subtree may be walked per node.
    const pending = [nodeIndex];
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined) {
        break;
      }
      const visiting = nodes[current];
      if (visiting === undefined) {
        continue;
      }
      const mesh = visiting.mesh === undefined ? undefined : meshes[visiting.mesh];
      for (const primitive of mesh?.primitives ?? []) {
        const position = primitive.attributes['POSITION'];
        const count = position === undefined ? undefined : accessors[position]?.count;
        const name =
          primitive.material === undefined ? undefined : materials[primitive.material]?.name;
        if (count === undefined || name === undefined) {
          continue;
        }
        const seen = byVertexCount.get(count) ?? new Map<string, number>();
        byVertexCount.set(count, seen);
        seen.set(name, (seen.get(name) ?? 0) + 1);

        if (!index.materialImages.has(name)) {
          const image = baseColourImage(json, primitive.material as number);
          if (image !== undefined) {
            index.materialImages.set(name, image);
          }
        }
      }
      pending.push(...(visiting.children ?? []));
    }
  }
  return { ...index, hits };
}

/** The single material a vertex count resolves to, and how the tie was broken. */
export interface ResolvedBinding {
  readonly material: string;
  /** True when the scenes disagreed and the most frequent name was taken. */
  readonly contested: boolean;
}

/**
 * Picks one material per vertex count.
 *
 * Most counts see exactly one material. Where several bundles disagree — the
 * same model dressed differently in two levels — the most frequent name wins,
 * and ties are broken alphabetically so that the result does not depend on the
 * order the bundles happened to be read in.
 */
export function resolveByVertexCount(
  counts: ReadonlyMap<number, Map<string, number>>,
): Map<number, ResolvedBinding> {
  const resolved = new Map<number, ResolvedBinding>();
  for (const [count, names] of counts) {
    const ranked = [...names].sort((a, b) =>
      a[1] === b[1] ? a[0].localeCompare(b[0]) : b[1] - a[1],
    );
    const winner = ranked[0];
    if (winner !== undefined) {
      resolved.set(count, { material: winner[0], contested: ranked.length > 1 });
    }
  }
  return resolved;
}

/** Everything the scene bundles contribute to the import. */
export interface SceneBindings {
  /** store id → vertex count → the material that wears it. */
  readonly byModel: ReadonlyMap<string, ReadonlyMap<number, ResolvedBinding>>;
  /** material name → its base colour image, as PNG bytes. */
  readonly images: ReadonlyMap<string, Buffer>;
  /** material name → the bundle the image was read from, for the manifest. */
  readonly imageSources: ReadonlyMap<string, string>;
  /** One line per bundle, for the run report. */
  readonly bundles: readonly { readonly file: string; readonly hits: number }[];
  /** Material names that no bundle gave a base colour image. */
  readonly withoutImage: readonly string[];
}

/** An empty result, for a source tree that ships no scene bundles. */
export const NO_SCENE_BINDINGS: SceneBindings = {
  byModel: new Map(),
  images: new Map(),
  imageSources: new Map(),
  bundles: [],
  withoutImage: [],
};

/**
 * Reads every bundle in a directory and merges them into one binding table.
 *
 * Images are deduplicated by content hash across bundles: the same atlas is
 * embedded in all thirteen, and the 38 distinct images are a few tens of
 * megabytes where the bundles are gigabytes.
 */
export async function readSceneBindings(
  directory: string,
  files: readonly string[],
  storeIds: ReadonlySet<string>,
  onBundle?: (file: string, hits: number) => void,
): Promise<SceneBindings> {
  const merged = new Map<string, Map<number, Map<string, number>>>();
  const materialImages = new Map<string, string>();
  const materialBundles = new Map<string, string>();
  const imagesByHash = new Map<string, Buffer>();
  const bundles: { file: string; hits: number }[] = [];

  for (const file of [...files].sort()) {
    const bundle = await openSceneBundle(join(directory, file));
    try {
      const index = indexSceneBundle(bundle.json, storeIds);
      for (const [storeId, counts] of index.models) {
        const target = merged.get(storeId) ?? new Map<number, Map<string, number>>();
        merged.set(storeId, target);
        for (const [count, names] of counts) {
          const seen = target.get(count) ?? new Map<string, number>();
          target.set(count, seen);
          for (const [name, times] of names) {
            seen.set(name, (seen.get(name) ?? 0) + times);
          }
        }
      }
      for (const [material, imageIndex] of index.materialImages) {
        if (materialImages.has(material)) {
          continue;
        }
        const bytes = await bundle.imageBytes(imageIndex);
        const hash = createHash('sha256').update(bytes).digest('hex');
        materialImages.set(material, hash);
        materialBundles.set(material, file);
        if (!imagesByHash.has(hash)) {
          imagesByHash.set(hash, bytes);
        }
      }
      bundles.push({ file, hits: index.hits });
      onBundle?.(file, index.hits);
    } finally {
      await bundle.close();
    }
  }

  const byModel = new Map<string, ReadonlyMap<number, ResolvedBinding>>();
  const materialsUsed = new Set<string>();
  for (const [storeId, counts] of merged) {
    const resolved = resolveByVertexCount(counts);
    byModel.set(storeId, resolved);
    for (const binding of resolved.values()) {
      materialsUsed.add(binding.material);
    }
  }

  const images = new Map<string, Buffer>();
  const imageSources = new Map<string, string>();
  const withoutImage: string[] = [];
  for (const material of [...materialsUsed].sort()) {
    const hash = materialImages.get(material);
    const bytes = hash === undefined ? undefined : imagesByHash.get(hash);
    const bundle = materialBundles.get(material);
    if (bytes === undefined || bundle === undefined) {
      withoutImage.push(material);
    } else {
      images.set(material, bytes);
      imageSources.set(material, bundle);
    }
  }

  return { byModel, images, imageSources, bundles, withoutImage };
}
