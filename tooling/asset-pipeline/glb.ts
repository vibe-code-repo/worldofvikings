/**
 * Reading, measuring and rewriting binary glTF, with `node:` built-ins only.
 *
 * **Why not `trimesh`, `pygltflib`, `gltf-transform` or Blender.** The pipeline
 * touches the container, not the geometry: it measures a hull, moves an origin
 * by editing one node's translation, and lifts embedded images out of the
 * binary chunk into files. No vertex is ever recomputed. A mesh library, a
 * Python runtime or a headless Blender would each be a required tool for a
 * normal contribution (agent rules 12 and 18) in exchange for capabilities this
 * does not use — and a re-meshing library is exactly what must *not* touch a
 * file whose provenance is being recorded.
 *
 * **What it refuses.** Compression extensions, sparse accessors and more than
 * one buffer are rejected with a message. Each of them would make the repack
 * below quietly wrong, and a quietly wrong model is worse than a missing one.
 */

/** A glTF node: either a `matrix` or a TRS triple, never both (glTF spec §5.24). */
export interface GltfNode {
  name?: string;
  children?: number[];
  mesh?: number;
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  [key: string]: unknown;
}

export interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
  sparse?: unknown;
  [key: string]: unknown;
}

export interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
  target?: number;
  [key: string]: unknown;
}

export interface GltfImage {
  bufferView?: number;
  mimeType?: string;
  uri?: string;
  name?: string;
  [key: string]: unknown;
}

export interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
  [key: string]: unknown;
}

export interface GltfMesh {
  name?: string;
  primitives: GltfPrimitive[];
  [key: string]: unknown;
}

export interface Gltf {
  asset: { version: string; generator?: string };
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: GltfMesh[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  buffers?: { byteLength: number; uri?: string }[];
  images?: GltfImage[];
  textures?: { source?: number; sampler?: number; [key: string]: unknown }[];
  materials?: { name?: string; [key: string]: unknown }[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  [key: string]: unknown;
}

/** A parsed GLB: its JSON chunk and its binary chunk. */
export interface Glb {
  readonly json: Gltf;
  readonly bin: Buffer;
}

const MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** Parses a GLB. Throws on anything that is not a two-chunk glTF 2.0 binary. */
export function readGlb(bytes: Buffer): Glb {
  if (bytes.length < 12 || bytes.readUInt32LE(0) !== MAGIC) {
    throw new Error('not a GLB file');
  }
  if (bytes.readUInt32LE(4) !== 2) {
    throw new Error(`unsupported GLB container version ${String(bytes.readUInt32LE(4))}`);
  }

  let json: Gltf | undefined;
  let bin = Buffer.alloc(0);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === CHUNK_JSON) {
      json = JSON.parse(body.toString('utf8')) as Gltf;
    } else if (type === CHUNK_BIN) {
      bin = Buffer.from(body);
    }
    offset += 8 + length + ((4 - (length % 4)) % 4);
  }

  if (json === undefined) {
    throw new Error('GLB has no JSON chunk');
  }
  return { json, bin };
}

/** Serialises a GLB. Both chunks are padded to four bytes, as the spec requires. */
export function writeGlb(glb: Glb): Buffer {
  // Separators removed so the JSON chunk is as small as the spec allows, and —
  // more importantly — identical for identical input on every machine.
  const jsonBytes = Buffer.from(JSON.stringify(glb.json), 'utf8');
  const jsonPadding = (4 - (jsonBytes.length % 4)) % 4;
  const binPadding = (4 - (glb.bin.length % 4)) % 4;

  const chunks: Buffer[] = [];
  const header = Buffer.alloc(12);
  header.writeUInt32LE(MAGIC, 0);
  header.writeUInt32LE(2, 4);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBytes.length + jsonPadding, 0);
  jsonHeader.writeUInt32LE(CHUNK_JSON, 4);
  chunks.push(jsonHeader, jsonBytes, Buffer.alloc(jsonPadding, 0x20));

  if (glb.bin.length > 0) {
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(glb.bin.length + binPadding, 0);
    binHeader.writeUInt32LE(CHUNK_BIN, 4);
    chunks.push(binHeader, glb.bin, Buffer.alloc(binPadding, 0));
  }

  const body = Buffer.concat(chunks);
  header.writeUInt32LE(12 + body.length, 8);
  return Buffer.concat([header, body]);
}

/**
 * Rejects the container features that would make {@link repackBuffer} or
 * {@link worldBounds} quietly wrong.
 *
 * Called before anything is written, so an unhandled file stops the import with
 * its name rather than being normalised into nonsense.
 */
export function assertSupported(json: Gltf, label: string): void {
  const extensions = [...(json.extensionsRequired ?? []), ...(json.extensionsUsed ?? [])];
  if (extensions.length > 0) {
    throw new Error(`${label}: glTF extensions are not handled (${extensions.join(', ')})`);
  }
  if ((json.buffers ?? []).length > 1) {
    throw new Error(`${label}: more than one buffer is not handled`);
  }
  if ((json.buffers ?? []).some((buffer) => buffer.uri !== undefined)) {
    throw new Error(`${label}: an external buffer URI is not handled`);
  }
  if ((json.accessors ?? []).some((accessor) => accessor.sparse !== undefined)) {
    throw new Error(`${label}: sparse accessors are not handled`);
  }
}

/** A 4×4 matrix in column-major order, the way glTF stores one. */
export type Matrix4 = readonly number[];

export const IDENTITY: Matrix4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** `a * b`, both column-major. */
export function multiply(a: Matrix4, b: Matrix4): Matrix4 {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += (a[k * 4 + row] ?? 0) * (b[column * 4 + k] ?? 0);
      }
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/** The local transform of a node: its `matrix`, or its TRS composed as T·R·S. */
export function nodeMatrix(node: GltfNode): Matrix4 {
  if (node.matrix !== undefined) {
    return node.matrix;
  }
  const [tx = 0, ty = 0, tz = 0] = node.translation ?? [];
  const [qx = 0, qy = 0, qz = 0, qw = 1] = node.rotation ?? [];
  const [sx = 1, sy = 1, sz = 1] = node.scale ?? [];

  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;

  return [
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,
    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,
    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

function transformPoint(
  matrix: Matrix4,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  return [
    (matrix[0] ?? 0) * x + (matrix[4] ?? 0) * y + (matrix[8] ?? 0) * z + (matrix[12] ?? 0),
    (matrix[1] ?? 0) * x + (matrix[5] ?? 0) * y + (matrix[9] ?? 0) * z + (matrix[13] ?? 0),
    (matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y + (matrix[10] ?? 0) * z + (matrix[14] ?? 0),
  ];
}

/** An axis-aligned box. `undefined` extents mean "nothing was measured". */
export interface Bounds {
  readonly min: [number, number, number];
  readonly max: [number, number, number];
}

/**
 * The model's hull in the file's own space, with every node transform applied.
 *
 * This is the measurement the placeholder box is built from, so it must be
 * *conservative*: taking each primitive's accessor `min`/`max`, transforming all
 * eight corners and expanding gives a box that is never smaller than the model,
 * only sometimes larger under rotation. A placeholder that is slightly too big
 * is a stand-in; one that is too small is a wrong footprint.
 *
 * Reading the accessor `min`/`max` rather than the vertex data is also the
 * reason this is fast enough to run over 470 files, some of them 11 MB.
 *
 * @returns `undefined` when the file contains no geometry at all — a particle
 * emitter or an empty prefab is a thing to leave out, not an error.
 * @throws if a mesh *is* there but cannot be measured, because a hull that is
 * quietly wrong is worse than one that is missing.
 */
export function worldBounds(json: Gltf, label: string): Bounds | undefined {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  walkNodes(json, (node, matrix) => {
    if (node.mesh === undefined) {
      return;
    }
    const mesh = json.meshes?.[node.mesh];
    for (const primitive of mesh?.primitives ?? []) {
      const accessorIndex = primitive.attributes['POSITION'];
      const accessor = accessorIndex === undefined ? undefined : json.accessors?.[accessorIndex];
      if (accessor?.min === undefined || accessor.max === undefined) {
        throw new Error(`${label}: a POSITION accessor has no min/max, so it cannot be measured`);
      }
      const [ax = 0, ay = 0, az = 0] = accessor.min;
      const [bx = 0, by = 0, bz = 0] = accessor.max;
      for (const x of [ax, bx]) {
        for (const y of [ay, by]) {
          for (const z of [az, bz]) {
            const point = transformPoint(matrix, x, y, z);
            for (let axis = 0; axis < 3; axis += 1) {
              min[axis] = Math.min(min[axis] ?? 0, point[axis] ?? 0);
              max[axis] = Math.max(max[axis] ?? 0, point[axis] ?? 0);
            }
          }
        }
      }
    }
  });

  return Number.isFinite(min[0]) ? { min, max } : undefined;
}

/** Visits every node of the default scene with its accumulated world matrix. */
export function walkNodes(json: Gltf, visit: (node: GltfNode, matrix: Matrix4) => void): void {
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? [];
  const seen = new Set<number>();

  const descend = (index: number, parent: Matrix4): void => {
    if (seen.has(index)) {
      // A cycle would otherwise hang the import. glTF forbids one; a ripped
      // file is not guaranteed to obey.
      return;
    }
    seen.add(index);
    const node = json.nodes?.[index];
    if (node === undefined) {
      return;
    }
    const matrix = multiply(parent, nodeMatrix(node));
    visit(node, matrix);
    for (const child of node.children ?? []) {
      descend(child, matrix);
    }
  };

  for (const root of roots) {
    descend(root, IDENTITY);
  }
}

/** Triangles in the whole file, for the budget column of the import report. */
export function countTriangles(json: Gltf): number {
  let triangles = 0;
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      // Mode 4 is TRIANGLES and the default; strips and fans are counted as if
      // they were triangles, which is close enough for a size report.
      const source =
        primitive.indices !== undefined
          ? json.accessors?.[primitive.indices]
          : json.accessors?.[primitive.attributes['POSITION'] ?? -1];
      triangles += Math.floor((source?.count ?? 0) / 3);
    }
  }
  return triangles;
}

/**
 * Every vertex of the file, in the file's own space, with node transforms
 * applied.
 *
 * `worldBounds` reads accessor `min`/`max` because a hull is all it needs;
 * this reads the vertices themselves, because measuring a tree's *trunk* means
 * looking at the points near its foot and a bounding box has none.
 *
 * The result is a flat `x, y, z` list, which is what every consumer of it wants
 * and what keeps 20 000 vertices out of 20 000 little arrays.
 */
export function worldPositions(glb: Glb): Float32Array {
  const chunks: Float32Array[] = [];
  let total = 0;

  walkNodes(glb.json, (node, matrix) => {
    if (node.mesh === undefined) {
      return;
    }
    for (const primitive of glb.json.meshes?.[node.mesh]?.primitives ?? []) {
      const accessorIndex = primitive.attributes['POSITION'];
      if (accessorIndex === undefined) {
        continue;
      }
      const local = readVec3(glb, accessorIndex);
      const world = new Float32Array(local.length);
      for (let index = 0; index < local.length; index += 3) {
        const point = transformPoint(
          matrix,
          local[index] ?? 0,
          local[index + 1] ?? 0,
          local[index + 2] ?? 0,
        );
        world[index] = point[0];
        world[index + 1] = point[1];
        world[index + 2] = point[2];
      }
      chunks.push(world);
      total += world.length;
    }
  });

  const all = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  return all;
}

/**
 * Inserts a single root node above the scene's current roots.
 *
 * This is how the origin is normalised: nothing in the geometry moves, one
 * translation is written, and the file keeps a predictable top-level name that
 * the placeholder can share.
 */
export function wrapInRoot(json: Gltf, name: string, translation: readonly number[]): void {
  const nodes = json.nodes ?? [];
  const sceneIndex = json.scene ?? 0;
  const roots = json.scenes?.[sceneIndex]?.nodes ?? [];

  const root: GltfNode = { name, children: [...roots] };
  if (translation.some((value) => value !== 0)) {
    root.translation = [...translation];
  }
  nodes.push(root);
  json.nodes = nodes;
  json.scenes = [{ nodes: [nodes.length - 1] }];
  json.scene = 0;
}

/**
 * A readable name for one image: the material that uses it, and in which slot.
 *
 * The exporter leaves `images[].name` empty, so without this the images inside
 * a rewritten GLB would all be called `image-0` and nothing in the file would
 * say which slot is which.
 *
 * This names images *inside* the GLB only. What a texture is called in the
 * store is decided by the import command, from the model that owns it.
 */
export function describeImage(json: Gltf, imageIndex: number): string | undefined {
  const textureIndex = (json.textures ?? []).findIndex((texture) => texture.source === imageIndex);
  if (textureIndex < 0) {
    return undefined;
  }
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
  return undefined;
}

/** Reads one scalar array out of the binary chunk, whatever its integer width. */
function readScalars(glb: Glb, accessorIndex: number): Uint32Array {
  const accessor = glb.json.accessors?.[accessorIndex];
  if (accessor?.bufferView === undefined) {
    throw new Error(`accessor ${String(accessorIndex)} has no bufferView`);
  }
  const view = glb.json.bufferViews?.[accessor.bufferView];
  const start = (view?.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const out = new Uint32Array(accessor.count);
  for (let i = 0; i < accessor.count; i += 1) {
    switch (accessor.componentType) {
      case 5121: // UNSIGNED_BYTE
        out[i] = glb.bin.readUInt8(start + i);
        break;
      case 5123: // UNSIGNED_SHORT
        out[i] = glb.bin.readUInt16LE(start + i * 2);
        break;
      case 5125: // UNSIGNED_INT
        out[i] = glb.bin.readUInt32LE(start + i * 4);
        break;
      default:
        throw new Error(`index componentType ${String(accessor.componentType)} is not handled`);
    }
  }
  return out;
}

/** Reads a float VEC3 accessor out of the binary chunk. */
function readVec3(glb: Glb, accessorIndex: number): Float32Array {
  const accessor = glb.json.accessors?.[accessorIndex];
  if (accessor?.bufferView === undefined || accessor.componentType !== 5126) {
    throw new Error(`accessor ${String(accessorIndex)} is not a float VEC3 in the buffer`);
  }
  const view = glb.json.bufferViews?.[accessor.bufferView];
  const start = (view?.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view?.byteStride ?? 12;
  const out = new Float32Array(accessor.count * 3);
  for (let i = 0; i < accessor.count; i += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      out[i * 3 + axis] = glb.bin.readFloatLE(start + i * stride + axis * 4);
    }
  }
  return out;
}

/**
 * Gives every primitive a `NORMAL` attribute, computing one where it is missing.
 *
 * Twelve files in the source export need this and no others: the terrains,
 * which arrive with `POSITION` and `TEXCOORD_0` alone. Loaded
 * as they are, a height field has no shading to speak of and — because Babylon
 * mirrors the glTF root on x to change handedness — draws mostly as backfaces:
 * on screen it is a scatter of pale slivers rather than a hill.
 *
 * This is the one place the pipeline writes vertex data. It is additive, never
 * a re-mesh: positions and indices are untouched, and the normals are the
 * ordinary area-weighted average of the adjacent triangle normals, which is
 * exactly what the exporter would have written had it been asked to.
 */
export function ensureNormals(glb: Glb, label: string): Glb {
  const additions: Buffer[] = [];
  let bin = glb.bin;
  let added = 0;

  for (const mesh of glb.json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      if (primitive.attributes['NORMAL'] !== undefined) {
        continue;
      }
      if ((primitive.mode ?? 4) !== 4) {
        throw new Error(
          `${label}: cannot compute normals for primitive mode ${String(primitive.mode)}`,
        );
      }
      const positionIndex = primitive.attributes['POSITION'];
      if (positionIndex === undefined) {
        throw new Error(`${label}: a primitive has neither NORMAL nor POSITION`);
      }
      const positions = readVec3(glb, positionIndex);
      const vertexCount = positions.length / 3;
      const indices =
        primitive.indices === undefined
          ? Uint32Array.from({ length: vertexCount }, (_, i) => i)
          : readScalars(glb, primitive.indices);

      const normals = new Float32Array(vertexCount * 3);
      for (let i = 0; i + 2 < indices.length; i += 3) {
        const [a, b, c] = [indices[i] ?? 0, indices[i + 1] ?? 0, indices[i + 2] ?? 0];
        const ax = positions[a * 3] ?? 0;
        const ay = positions[a * 3 + 1] ?? 0;
        const az = positions[a * 3 + 2] ?? 0;
        const ux = (positions[b * 3] ?? 0) - ax;
        const uy = (positions[b * 3 + 1] ?? 0) - ay;
        const uz = (positions[b * 3 + 2] ?? 0) - az;
        const vx = (positions[c * 3] ?? 0) - ax;
        const vy = (positions[c * 3 + 1] ?? 0) - ay;
        const vz = (positions[c * 3 + 2] ?? 0) - az;
        // Not normalised: the cross product's length is twice the triangle's
        // area, which is the weighting a vertex normal wants.
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        for (const vertex of [a, b, c]) {
          normals[vertex * 3] = (normals[vertex * 3] ?? 0) + nx;
          normals[vertex * 3 + 1] = (normals[vertex * 3 + 1] ?? 0) + ny;
          normals[vertex * 3 + 2] = (normals[vertex * 3 + 2] ?? 0) + nz;
        }
      }

      const bytes = Buffer.alloc(vertexCount * 12);
      for (let v = 0; v < vertexCount; v += 1) {
        const x = normals[v * 3] ?? 0;
        const y = normals[v * 3 + 1] ?? 0;
        const z = normals[v * 3 + 2] ?? 0;
        const length = Math.hypot(x, y, z);
        // A vertex touched by no triangle gets +y rather than NaN.
        const scale = length > 0 ? 1 / length : 0;
        bytes.writeFloatLE(length > 0 ? x * scale : 0, v * 12);
        bytes.writeFloatLE(length > 0 ? y * scale : 1, v * 12 + 4);
        bytes.writeFloatLE(length > 0 ? z * scale : 0, v * 12 + 8);
      }

      const byteOffset = bin.length + additions.reduce((sum, part) => sum + part.length, 0);
      additions.push(bytes);
      const bufferViews = glb.json.bufferViews ?? [];
      bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length, target: 34962 });
      glb.json.bufferViews = bufferViews;

      const accessors = glb.json.accessors ?? [];
      accessors.push({
        bufferView: bufferViews.length - 1,
        componentType: 5126,
        count: vertexCount,
        type: 'VEC3',
      });
      glb.json.accessors = accessors;
      primitive.attributes['NORMAL'] = accessors.length - 1;
      added += 1;
    }
  }

  if (added === 0) {
    return glb;
  }
  bin = Buffer.concat([bin, ...additions]);
  return { json: glb.json, bin };
}

/** How many primitives lack a `NORMAL` attribute. */
export function countMissingNormals(json: Gltf): number {
  let missing = 0;
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      if (primitive.attributes['NORMAL'] === undefined) {
        missing += 1;
      }
    }
  }
  return missing;
}

/** The bytes of one image that used to live in the binary chunk. */
export interface ExtractedImage {
  readonly index: number;
  readonly name: string;
  readonly bytes: Buffer;
}

/**
 * Lifts every embedded image out of the binary chunk.
 *
 * The caller decides where the files go and rewrites `images[i].uri`; this only
 * hands over the bytes and clears the `bufferView` reference. Afterwards the
 * buffer still contains the image bytes — {@link repackBuffer} drops them.
 */
export function takeEmbeddedImages(glb: Glb): ExtractedImage[] {
  const taken: ExtractedImage[] = [];
  (glb.json.images ?? []).forEach((image, index) => {
    if (image.bufferView === undefined) {
      return;
    }
    const view = glb.json.bufferViews?.[image.bufferView];
    if (view === undefined) {
      throw new Error(`image ${String(index)} points at a bufferView that does not exist`);
    }
    const offset = view.byteOffset ?? 0;
    taken.push({
      index,
      name: image.name ?? describeImage(glb.json, index) ?? `image-${String(index)}`,
      bytes: Buffer.from(glb.bin.subarray(offset, offset + view.byteLength)),
    });
    delete image.bufferView;
    delete image.mimeType; // meaningless once the file name carries the type
  });
  return taken;
}

/**
 * Rebuilds the binary chunk from the buffer views something still points at,
 * and renumbers every reference to match.
 *
 * Without this, dropping the images out of a tree GLB would leave two 1 MB
 * textures in the file that nothing reads — the extraction would cost space
 * rather than save it.
 */
export function repackBuffer(glb: Glb): Glb {
  const views = glb.json.bufferViews ?? [];
  const used = new Set<number>();
  for (const accessor of glb.json.accessors ?? []) {
    if (accessor.bufferView !== undefined) {
      used.add(accessor.bufferView);
    }
  }
  for (const image of glb.json.images ?? []) {
    if (image.bufferView !== undefined) {
      used.add(image.bufferView);
    }
  }

  const remap = new Map<number, number>();
  const parts: Buffer[] = [];
  const rebuilt: GltfBufferView[] = [];
  let offset = 0;

  views.forEach((view, index) => {
    if (!used.has(index)) {
      return;
    }
    const from = view.byteOffset ?? 0;
    const bytes = glb.bin.subarray(from, from + view.byteLength);
    const padding = (4 - (offset % 4)) % 4;
    if (padding > 0) {
      parts.push(Buffer.alloc(padding));
      offset += padding;
    }
    remap.set(index, rebuilt.length);
    rebuilt.push({ ...view, buffer: 0, byteOffset: offset, byteLength: view.byteLength });
    parts.push(Buffer.from(bytes));
    offset += view.byteLength;
  });

  const bin = Buffer.concat(parts);
  const relink = (viewIndex: number | undefined): number | undefined => {
    if (viewIndex === undefined) {
      return undefined;
    }
    const next = remap.get(viewIndex);
    if (next === undefined) {
      throw new Error(`a kept reference points at dropped bufferView ${String(viewIndex)}`);
    }
    return next;
  };

  for (const accessor of glb.json.accessors ?? []) {
    const next = relink(accessor.bufferView);
    if (next !== undefined) {
      accessor.bufferView = next;
    }
  }
  for (const image of glb.json.images ?? []) {
    const next = relink(image.bufferView);
    if (next !== undefined) {
      image.bufferView = next;
    }
  }

  glb.json.bufferViews = rebuilt;
  glb.json.buffers = [{ byteLength: bin.length }];
  return { json: glb.json, bin };
}
