/**
 * The stand-in a clone loads when the private store is not reachable
 * (ADR-0015): a box with the imported model's hull, under the same root name.
 *
 * It is a *box*, not a scaled shared cube, for a reason that only shows up
 * later: the day an asset is cleared for release, `visibility` flips to
 * `public` and nothing else changes. If the placeholder carried its size as a
 * scale factor, the world file would have to change too.
 *
 * It is a box and not "nothing" for a reason that shows up immediately: an
 * object that silently fails to appear reads as a bug, while a grey box the
 * right size reads as a statement — and the on-screen counter names how many
 * of them there are.
 */
import { writeGlb } from '@wov/content-build';
import type { Bounds, Gltf } from '@wov/content-build';

/** A cube's eight corners, in the order the index list below expects. */
const CORNERS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];

/** Two triangles per face, wound so the outside faces out. */
const INDICES: readonly number[] = [
  0,
  2,
  1,
  0,
  3,
  2, // -z
  4,
  5,
  6,
  4,
  6,
  7, // +z
  0,
  1,
  5,
  0,
  5,
  4, // -y
  3,
  7,
  6,
  3,
  6,
  2, // +y
  0,
  4,
  7,
  0,
  7,
  3, // -x
  1,
  2,
  6,
  1,
  6,
  5, // +x
];

/**
 * Builds a placeholder GLB for one asset.
 *
 * @param rootName the imported model's root node name. Shared on purpose: a
 * scene dump, a debug overlay or a picking test sees the same name whether the
 * store answered or not, so "which one am I looking at" has one answer.
 * @param bounds the measured hull in metres. The box is exactly it.
 */
export function buildPlaceholderGlb(rootName: string, bounds: Bounds): Buffer {
  const size: [number, number, number] = [
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ];

  const positions = Buffer.alloc(CORNERS.length * 3 * 4);
  CORNERS.forEach((corner, index) => {
    for (let axis = 0; axis < 3; axis += 1) {
      positions.writeFloatLE(
        (bounds.min[axis] ?? 0) + (corner[axis] ?? 0) * (size[axis] ?? 0),
        (index * 3 + axis) * 4,
      );
    }
  });

  const indices = Buffer.alloc(INDICES.length * 2);
  INDICES.forEach((value, index) => {
    indices.writeUInt16LE(value, index * 2);
  });

  // The positions come first so their bufferView starts at 0 and stays aligned
  // to four bytes; the index view is padded up to the next multiple of four.
  const indicesOffset = positions.length;
  const padding = (4 - (indices.length % 4)) % 4;
  const bin = Buffer.concat([positions, indices, Buffer.alloc(padding)]);

  const json: Gltf = {
    asset: { version: '2.0', generator: 'world-of-vikings asset pipeline (placeholder)' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: rootName, children: [1] },
      { name: `${rootName}-hull`, mesh: 0 },
    ],
    meshes: [
      {
        name: `${rootName}-hull`,
        primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }],
      },
    ],
    materials: [
      {
        name: 'placeholder',
        // Flat, unlit-looking grey: it must not be mistaken for finished art.
        pbrMetallicRoughness: {
          baseColorFactor: [0.55, 0.55, 0.58, 1],
          metallicFactor: 0,
          roughnessFactor: 1,
        },
        doubleSided: true,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126, // FLOAT
        count: CORNERS.length,
        type: 'VEC3',
        min: [...bounds.min],
        max: [...bounds.max],
      },
      {
        bufferView: 1,
        componentType: 5123, // UNSIGNED_SHORT
        count: INDICES.length,
        type: 'SCALAR',
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.length, target: 34962 },
      { buffer: 0, byteOffset: indicesOffset, byteLength: indices.length, target: 34963 },
    ],
    buffers: [{ byteLength: bin.length }],
  };

  return writeGlb({ json, bin });
}

/** Where a private asset's placeholder lives, relative to `assets/`. */
export function placeholderPathFor(assetPath: string): string {
  return `placeholders/${assetPath}`;
}
