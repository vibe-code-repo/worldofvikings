/**
 * Cutting a standalone model out of a scene bundle.
 *
 * A scene bundle contains models that were never exported as files of their
 * own: a house floor, a wood pile, a brazier, a path made of loose bricks —
 * 433 placements under 142 names in the village alone. Without them the world
 * file can name only half of what a person actually built, so they are lifted
 * out of the bundle and become store models like any other.
 *
 * **What is copied, and what is not.** The subtree's meshes, the materials they
 * use and the images those materials point at — nothing else, and no vertex is
 * ever recomputed. The bundle's vertex data is interleaved into one 128 MB
 * buffer view shared by eight thousand accessors, so each accessor is copied as
 * a tightly packed run of its own elements rather than by copying the view; a
 * wood pile then costs a few kilobytes instead of the whole scene.
 *
 * **The origin is the one the bundle gives it.** The node the search stopped at
 * becomes the model's root with no transform of its own, and its children keep
 * their local placement. The transform that node had in the bundle is not lost:
 * it is the entity transform in the world file, which is where it belongs.
 *
 * Deterministic: same bundle, same node, same bytes.
 */
import { createHash } from 'node:crypto';
import type {
  Glb,
  Gltf,
  GltfAccessor,
  GltfBufferView,
  GltfMesh,
  GltfNode,
  GltfPrimitive,
} from '@wov/content-build';

/** Components per element, by glTF accessor type. */
const ELEMENT_COMPONENTS: Readonly<Record<string, number>> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

/** Bytes per component, by glTF component type. */
const COMPONENT_BYTES: Readonly<Record<number, number>> = {
  5120: 1, // BYTE
  5121: 1, // UNSIGNED_BYTE
  5122: 2, // SHORT
  5123: 2, // UNSIGNED_SHORT
  5125: 4, // UNSIGNED_INT
  5126: 4, // FLOAT
};

/** Bytes one element of this accessor occupies when packed tightly. */
export function elementSize(accessor: GltfAccessor): number {
  const components = ELEMENT_COMPONENTS[accessor.type];
  const bytes = COMPONENT_BYTES[accessor.componentType];
  if (components === undefined || bytes === undefined) {
    throw new Error(
      `accessor type ${accessor.type}/${String(accessor.componentType)} is not handled`,
    );
  }
  return components * bytes;
}

/** Every node of this subtree, the node itself first, in a stable order. */
export function subtreeOf(json: Gltf, node: number): number[] {
  const nodes = json.nodes ?? [];
  const order: number[] = [];
  const seen = new Set<number>();
  const descend = (index: number): void => {
    if (seen.has(index) || nodes[index] === undefined) {
      return;
    }
    seen.add(index);
    order.push(index);
    for (const child of nodes[index]?.children ?? []) {
      descend(child);
    }
  };
  descend(node);
  return order;
}

/** Mesh nodes and triangles under one node — the shape a name group is checked against. */
export function subtreeShape(json: Gltf, node: number): { meshNodes: number; triangles: number } {
  let meshNodes = 0;
  let triangles = 0;
  for (const index of subtreeOf(json, node)) {
    const mesh = json.nodes?.[index]?.mesh;
    if (mesh === undefined) {
      continue;
    }
    meshNodes += 1;
    for (const primitive of json.meshes?.[mesh]?.primitives ?? []) {
      const source =
        primitive.indices !== undefined
          ? json.accessors?.[primitive.indices]
          : json.accessors?.[primitive.attributes['POSITION'] ?? -1];
      triangles += Math.floor((source?.count ?? 0) / 3);
    }
  }
  return { meshNodes, triangles };
}

/** One image the cut model needs. The caller decides where the bytes go. */
export interface CutImage {
  /** Index into the produced file's `images`, so the caller can set its `uri`. */
  readonly slot: number;
  /** A readable name, from the material that uses it. */
  readonly name: string;
  readonly bytes: Buffer;
}

export interface CutModel {
  readonly glb: Glb;
  readonly images: readonly CutImage[];
}

function textureLabel(json: Gltf, textureIndex: number): string {
  const slots = [
    'baseColorTexture',
    'metallicRoughnessTexture',
    'normalTexture',
    'occlusionTexture',
    'emissiveTexture',
  ] as const;
  for (const material of json.materials ?? []) {
    const pbr = material['pbrMetallicRoughness'] as Record<string, unknown> | undefined;
    for (const slot of slots) {
      const reference = (pbr?.[slot] ?? material[slot]) as { index?: number } | undefined;
      if (reference?.index === textureIndex) {
        const suffix = slot === 'baseColorTexture' ? '' : `-${slot.replace('Texture', '')}`;
        return `${material.name ?? 'material'}${suffix}`;
      }
    }
  }
  return `texture-${String(textureIndex)}`;
}

/**
 * Rewrites every `…Texture: { index }` reference in a material, at any depth.
 *
 * Walking rather than listing the five known slots: an unhandled slot would
 * otherwise keep an index into the *bundle's* texture list, which in a
 * four-texture file points at whatever happens to sit there.
 */
function remapTextures(value: unknown, remap: (index: number) => number): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      remapTextures(item, remap);
    }
    return;
  }
  if (typeof value !== 'object' || value === null) {
    return;
  }
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if (
      key.endsWith('Texture') &&
      typeof child === 'object' &&
      child !== null &&
      typeof (child as { index?: unknown }).index === 'number'
    ) {
      (child as { index: number }).index = remap((child as { index: number }).index);
      continue;
    }
    remapTextures(child, remap);
  }
}

/** The node fields a world object carries. Cameras, skins and lights are not copied. */
function copyNodeFields(node: GltfNode): GltfNode {
  const copy: GltfNode = {};
  if (node.name !== undefined) {
    copy.name = node.name;
  }
  if (node.matrix !== undefined) {
    copy.matrix = [...node.matrix];
  }
  if (node.translation !== undefined) {
    copy.translation = [...node.translation];
  }
  if (node.rotation !== undefined) {
    copy.rotation = [...node.rotation];
  }
  if (node.scale !== undefined) {
    copy.scale = [...node.scale];
  }
  return copy;
}

/**
 * Builds a standalone GLB from one subtree of a bundle.
 *
 * @param rootName the name of the single root node, which is also the store
 *   file stem and the name the placeholder shares (ADR-0015).
 * @throws when the subtree draws nothing, so an empty file is never written.
 */
export function cutModel(source: Glb, node: number, rootName: string): CutModel {
  const json = source.json;
  const order = subtreeOf(json, node);

  const parts: Buffer[] = [];
  let offset = 0;
  const bufferViews: GltfBufferView[] = [];
  const accessors: GltfAccessor[] = [];
  const accessorMap = new Map<number, number>();

  /** Copies one accessor's elements, packed, into a buffer view of their own. */
  const copyAccessor = (index: number): number => {
    const existing = accessorMap.get(index);
    if (existing !== undefined) {
      return existing;
    }
    const accessor = json.accessors?.[index];
    if (accessor === undefined) {
      throw new Error(`${rootName}: accessor ${String(index)} is missing`);
    }
    if (accessor.sparse !== undefined) {
      throw new Error(`${rootName}: sparse accessors are not handled`);
    }
    if (accessor.bufferView === undefined) {
      throw new Error(`${rootName}: accessor ${String(index)} has no bufferView`);
    }
    const view = json.bufferViews?.[accessor.bufferView];
    if (view === undefined) {
      throw new Error(`${rootName}: bufferView ${String(accessor.bufferView)} is missing`);
    }

    const size = elementSize(accessor);
    const stride = view.byteStride ?? size;
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const bytes = Buffer.alloc(accessor.count * size);
    for (let element = 0; element < accessor.count; element += 1) {
      source.bin.copy(
        bytes,
        element * size,
        start + element * stride,
        start + element * stride + size,
      );
    }

    // glTF requires each buffer view to start on a four-byte boundary.
    const padding = (4 - (offset % 4)) % 4;
    if (padding > 0) {
      parts.push(Buffer.alloc(padding));
      offset += padding;
    }
    parts.push(bytes);
    bufferViews.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: bytes.length,
      ...(view.target === undefined ? {} : { target: view.target }),
    });
    offset += bytes.length;

    const copy: GltfAccessor = {
      bufferView: bufferViews.length - 1,
      componentType: accessor.componentType,
      count: accessor.count,
      type: accessor.type,
      ...(accessor.name === undefined ? {} : { name: accessor.name }),
      ...(accessor.min === undefined ? {} : { min: [...accessor.min] }),
      ...(accessor.max === undefined ? {} : { max: [...accessor.max] }),
    };
    accessors.push(copy);
    accessorMap.set(index, accessors.length - 1);
    return accessors.length - 1;
  };

  const images: { name: string; bytes: Buffer }[] = [];
  const imageMap = new Map<number, number>();
  const copyImage = (index: number, label: string): number => {
    const existing = imageMap.get(index);
    if (existing !== undefined) {
      return existing;
    }
    const image = json.images?.[index];
    if (image?.bufferView === undefined) {
      throw new Error(`${rootName}: image ${String(index)} is not embedded in the buffer`);
    }
    const view = json.bufferViews?.[image.bufferView];
    if (view === undefined) {
      throw new Error(`${rootName}: image ${String(index)} points at a missing bufferView`);
    }
    const from = view.byteOffset ?? 0;
    images.push({
      name: image.name ?? label,
      bytes: Buffer.from(source.bin.subarray(from, from + view.byteLength)),
    });
    imageMap.set(index, images.length - 1);
    return images.length - 1;
  };

  const samplers: Record<string, unknown>[] = [];
  const samplerMap = new Map<number, number>();
  const copySampler = (index: number): number => {
    const existing = samplerMap.get(index);
    if (existing !== undefined) {
      return existing;
    }
    const sampler = (json['samplers'] as Record<string, unknown>[] | undefined)?.[index];
    samplers.push({ ...(sampler ?? {}) });
    samplerMap.set(index, samplers.length - 1);
    return samplers.length - 1;
  };

  const textures: { source?: number; sampler?: number }[] = [];
  const textureMap = new Map<number, number>();
  const copyTexture = (index: number): number => {
    const existing = textureMap.get(index);
    if (existing !== undefined) {
      return existing;
    }
    const texture = json.textures?.[index];
    const copy: { source?: number; sampler?: number } = {};
    if (texture?.source !== undefined) {
      copy.source = copyImage(texture.source, textureLabel(json, index));
    }
    if (texture?.sampler !== undefined) {
      copy.sampler = copySampler(texture.sampler);
    }
    textures.push(copy);
    textureMap.set(index, textures.length - 1);
    return textures.length - 1;
  };

  const materials: Record<string, unknown>[] = [];
  const materialMap = new Map<number, number>();
  const copyMaterial = (index: number): number => {
    const existing = materialMap.get(index);
    if (existing !== undefined) {
      return existing;
    }
    const material = json.materials?.[index];
    const copy = JSON.parse(JSON.stringify(material ?? {})) as Record<string, unknown>;
    // Reserve the slot before descending, so a material that somehow refers to
    // itself cannot recurse forever.
    materials.push(copy);
    const target = materials.length - 1;
    materialMap.set(index, target);
    remapTextures(copy, copyTexture);
    return target;
  };

  const meshes: GltfMesh[] = [];
  const meshMap = new Map<number, number>();
  const copyMesh = (index: number): number => {
    const existing = meshMap.get(index);
    if (existing !== undefined) {
      return existing;
    }
    const mesh = json.meshes?.[index];
    if (mesh === undefined) {
      throw new Error(`${rootName}: mesh ${String(index)} is missing`);
    }
    const primitives: GltfPrimitive[] = mesh.primitives.map((primitive) => {
      const attributes: Record<string, number> = {};
      for (const name of Object.keys(primitive.attributes).sort()) {
        const accessor = primitive.attributes[name];
        if (accessor !== undefined) {
          attributes[name] = copyAccessor(accessor);
        }
      }
      return {
        attributes,
        ...(primitive.indices === undefined ? {} : { indices: copyAccessor(primitive.indices) }),
        ...(primitive.material === undefined ? {} : { material: copyMaterial(primitive.material) }),
        ...(primitive.mode === undefined ? {} : { mode: primitive.mode }),
      };
    });
    meshes.push({ ...(mesh.name === undefined ? {} : { name: mesh.name }), primitives });
    meshMap.set(index, meshes.length - 1);
    return meshes.length - 1;
  };

  // Nodes last, so meshes and materials are numbered in the order they are met.
  const nodeMap = new Map<number, number>();
  order.forEach((index, position) => nodeMap.set(index, position));
  const nodes: GltfNode[] = order.map((index, position) => {
    const original = json.nodes?.[index] ?? {};
    // The root loses its own transform: that transform is the *placement*, and
    // it lives in the world file. Keeping it here would apply it twice.
    const copy = position === 0 ? { name: rootName } : copyNodeFields(original);
    if (original.mesh !== undefined) {
      copy.mesh = copyMesh(original.mesh);
    }
    const children = (original.children ?? [])
      .map((child) => nodeMap.get(child))
      .filter((child): child is number => child !== undefined);
    if (children.length > 0) {
      copy.children = children;
    }
    return copy;
  });

  if (meshes.length === 0) {
    throw new Error(`${rootName}: the subtree contains no geometry`);
  }

  const cut: Gltf = {
    asset: { version: '2.0', generator: 'World of Vikings scene model extractor' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes,
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
    materials: materials as NonNullable<Gltf['materials']>,
    ...(textures.length === 0 ? {} : { textures }),
    ...(images.length === 0 ? {} : { images: images.map((image) => ({ name: image.name })) }),
    ...(samplers.length === 0 ? {} : { samplers }),
  };

  return {
    glb: { json: cut, bin: Buffer.concat(parts) },
    images: images.map((image, slot) => ({ slot, name: image.name, bytes: image.bytes })),
  };
}

// ------------------------------------------------------------------ grouping

/** `Floor (3)` and `Floor 3` are the same model placed three times. */
const DUPLICATE_SUFFIX = /(\s*\(\d+\)|\s+\d+)$/;

/** The store file stem a bundle node name would have, duplicate suffix dropped. */
export function modelStem(nodeName: string): string {
  return nodeName
    .replace(DUPLICATE_SUFFIX, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** One model to cut, and the placements that asked for it. */
export interface ModelGroup {
  readonly stem: string;
  /** The node the geometry is taken from. */
  readonly node: number;
  readonly instances: number;
  readonly triangles: number;
  /**
   * Distinct subtree shapes found under this name. More than one means the
   * bundle has variants, and only the most common one is cut.
   */
  readonly shapes: number;
}

/**
 * Groups unrecognised placements into one model per name.
 *
 * The bundle stores a separate copy of the mesh for every placement, so mesh
 * indices cannot say which placements are the same thing — only the name can.
 * Where a name covers more than one shape (three shelters, one of them with two
 * extra parts), the **most common** shape wins and the group reports that it
 * had a choice to make, because taking the first node in file order would
 * sometimes take the odd one out.
 */
export function planModels(
  json: Gltf,
  placements: readonly { readonly node: number; readonly name: string }[],
): ModelGroup[] {
  const groups = new Map<string, { node: number; name: string }[]>();
  for (const placement of placements) {
    const stem = modelStem(placement.name);
    if (stem === '') {
      continue;
    }
    const group = groups.get(stem);
    if (group === undefined) {
      groups.set(stem, [placement]);
    } else {
      group.push(placement);
    }
  }

  return [...groups]
    .sort((left, right) => left[0].localeCompare(right[0], 'en'))
    .map(([stem, placements_]) => {
      const shapes = new Map<string, { node: number; count: number; triangles: number }>();
      for (const placement of placements_) {
        const shape = subtreeShape(json, placement.node);
        const key = `${String(shape.meshNodes)}/${String(shape.triangles)}`;
        const known = shapes.get(key);
        if (known === undefined) {
          shapes.set(key, { node: placement.node, count: 1, triangles: shape.triangles });
        } else {
          known.count += 1;
          known.node = Math.min(known.node, placement.node);
        }
      }
      const chosen = [...shapes.values()].sort(
        (left, right) => right.count - left.count || left.node - right.node,
      )[0];
      return {
        stem,
        node: chosen?.node ?? placements_[0]?.node ?? 0,
        instances: placements_.length,
        triangles: chosen?.triangles ?? 0,
        shapes: shapes.size,
      };
    });
}

/**
 * Names that mark a plant, when the flat-shaded `sm-` families do not apply.
 *
 * Deliberately separate from `selection.ts`: that rule reads *export file
 * names*, which are uniformly prefixed, while these are names a level designer
 * typed into a hierarchy — `Floor`, `ChestTop`, `Small_Thin_Tree_1A3`. The word
 * has to be found anywhere in the name rather than at its start.
 */
const PLANT_WORDS = /(^|-)(tree|bush|branch|pine|grass|fern|flower|leaf|leaves|shrub)(-|\d|$)/;

/**
 * Which store folder a cut model belongs in.
 *
 * `sm-` names are the flat-shaded environment family, `sm-plant-` its
 * vegetation part; everything else is a plant if it is named after one and
 * scenery otherwise. Scenery is the fallback because that is what an
 * unrecognised piece of a village is — a floor, a chest lid, a pile of wood.
 */
export function groupForStem(stem: string): 'environment' | 'vegetation' {
  if (stem.startsWith('sm-plant-')) {
    return 'vegetation';
  }
  if (stem.startsWith('sm-')) {
    return 'environment';
  }
  return PLANT_WORDS.test(stem) ? 'vegetation' : 'environment';
}

/** `sha256-…`, the spelling the manifest uses. */
export function hashOf(bytes: Buffer): string {
  return `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
}

/**
 * What the store and the manifest together say about a model path.
 *
 * - `known` — the manifest names it; nothing to do.
 * - `adopt` — the store holds the file but the manifest has forgotten it. The
 *   file is kept as it is and the manifest row is written back from it.
 * - `new` — neither has it; cut it out of the bundle.
 *
 * `adopt` exists because the store outlives a single run and is shared between
 * importers: `import:world-assets` rewrites the manifest rows it owns, and a
 * pass that answered "the store already has this model" and then wrote nothing
 * left the row missing for good (ADR-0023).
 */
export type StoreState = 'known' | 'adopt' | 'new';

export function storeStateOf(
  path: string,
  manifestPaths: ReadonlySet<string>,
  fileInStore: boolean,
): StoreState {
  if (manifestPaths.has(path)) {
    return 'known';
  }
  return fileInStore ? 'adopt' : 'new';
}

/**
 * The store paths of the texture files a stored model points at, in order and
 * without repeats.
 *
 * A store model refers to its textures by a URI relative to its own folder and
 * free of `..` (ADR-0019), so `environment/x.glb` saying `textures/y.png` means
 * `environment/textures/y.png`. Images without a URI are embedded and are not
 * files of the store at all.
 */
export function storeTexturePaths(json: Gltf, folder: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const image of json.images ?? []) {
    const uri = image.uri;
    if (uri === undefined || uri.length === 0 || uri.startsWith('data:')) {
      continue;
    }
    const path = `${folder}/${uri}`;
    if (!seen.has(path)) {
      seen.add(path);
      paths.push(path);
    }
  }
  return paths;
}

/**
 * The node a cut texture was named after, read back out of its file name.
 *
 * A cut texture is `<folder>/textures/<stem>-<8 hex>.png`, named after the first
 * model that needed it. Reading the stem back is what lets an adopted row carry
 * the same provenance sentence the row it replaces carried, so a repaired
 * manifest is byte-identical to one that was never damaged. Anything not shaped
 * like that belongs to another importer and is left to it.
 */
export function textureNodeStem(texturePath: string): string | undefined {
  const fileName = texturePath.slice(texturePath.lastIndexOf('/') + 1);
  const match = /^(.+)-[0-9a-f]{8}\.png$/.exec(fileName);
  return match?.[1];
}
