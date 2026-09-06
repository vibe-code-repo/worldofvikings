import { describe, expect, it } from 'vitest';
import {
  assertSupported,
  countMissingNormals,
  countTriangles,
  describeImage,
  ensureNormals,
  multiply,
  nodeMatrix,
  readGlb,
  repackBuffer,
  takeEmbeddedImages,
  worldBounds,
  wrapInRoot,
  writeGlb,
} from './glb.js';
import type { Gltf } from './glb.js';

/**
 * A two-node model: a unit cube's accessor bounds under a child node that is
 * translated ten metres up. The gap between "read the accessor" and "walk the
 * hierarchy" is exactly where a hull measurement goes wrong, so the fixture is
 * built to make that visible.
 */
function model(overrides: Partial<Gltf> = {}): Gltf {
  return {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'root', children: [1] },
      { name: 'body', mesh: 0, translation: [0, 10, 0] },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 8,
        type: 'VEC3',
        min: [-1, 0, -2],
        max: [1, 3, 2],
      },
      { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 96 },
      { buffer: 0, byteOffset: 96, byteLength: 72 },
    ],
    buffers: [{ byteLength: 168 }],
    ...overrides,
  };
}

describe('readGlb / writeGlb', () => {
  it('round-trips a model, chunk padding included', () => {
    const bin = Buffer.alloc(168, 7);
    const bytes = writeGlb({ json: model(), bin });

    expect(bytes.length % 4).toBe(0);
    expect(bytes.readUInt32LE(8)).toBe(bytes.length);

    const parsed = readGlb(bytes);
    expect(parsed.json.nodes?.[1]?.name).toBe('body');
    expect(parsed.bin.subarray(0, 168).equals(bin)).toBe(true);
  });

  it('produces identical bytes for identical input', () => {
    const glb = { json: model(), bin: Buffer.alloc(168, 3) };
    expect(writeGlb(glb).equals(writeGlb({ json: model(), bin: Buffer.alloc(168, 3) }))).toBe(true);
  });

  it('refuses bytes that are not a GLB rather than reading garbage', () => {
    expect(() => readGlb(Buffer.from('this is not a glb file'))).toThrow(/not a GLB/);
  });
});

describe('worldBounds', () => {
  it('applies the node hierarchy instead of reading the accessor alone', () => {
    // The naive answer is the accessor's own [-1,0,-2]..[1,3,2]. The right one
    // has the child's ten-metre lift in it.
    expect(worldBounds(model(), 'fixture')).toEqual({ min: [-1, 10, -2], max: [1, 13, 2] });
  });

  it('grows, never shrinks, under rotation — a placeholder must not be too small', () => {
    const rotated = model();
    // 45° about y: the box's diagonal becomes its extent.
    const half = Math.SQRT1_2;
    rotated.nodes = [
      { name: 'root', children: [1] },
      { name: 'body', mesh: 0, rotation: [0, half, 0, half] },
    ];
    const bounds = worldBounds(rotated, 'fixture');
    expect(bounds?.max[0]).toBeGreaterThanOrEqual(2);
    expect(bounds?.max[2]).toBeGreaterThanOrEqual(1);
  });

  it('says so rather than guessing when a POSITION accessor has no min/max', () => {
    const blind = model();
    delete blind.accessors?.[0]?.min;
    expect(() => worldBounds(blind, 'blind.glb')).toThrow(/blind\.glb.*min\/max/);
  });

  it('answers nothing — not an empty box — when the file has no geometry', () => {
    // A particle emitter is a real thing in this export. It is something to
    // leave out with a named reason, not something to measure as a point.
    expect(worldBounds({ ...model(), meshes: [], nodes: [] }, 'empty.glb')).toBeUndefined();
  });

  it('survives a node cycle instead of hanging the import', () => {
    const looped = model();
    looped.nodes = [
      { name: 'root', children: [1] },
      { name: 'body', mesh: 0, children: [0] },
    ];
    expect(() => worldBounds(looped, 'looped.glb')).not.toThrow();
  });
});

describe('nodeMatrix', () => {
  it('prefers an explicit matrix over TRS', () => {
    const matrix = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 1, 2, 3, 1];
    expect(nodeMatrix({ matrix, translation: [9, 9, 9] })).toBe(matrix);
  });

  it('is the identity for a node with no transform at all', () => {
    expect(nodeMatrix({})).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });

  it('composes as translate · rotate · scale, in that order', () => {
    const scaled = nodeMatrix({ scale: [2, 2, 2], translation: [5, 0, 0] });
    // Translation is not scaled by the node's own scale; the point at x=1 in
    // local space lands at 5 + 2 = 7, not at (5 + 1) * 2.
    expect(multiply([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], scaled)[12]).toBe(5);
    expect(scaled[0]).toBe(2);
  });
});

describe('countTriangles', () => {
  it('counts from the index accessor when there is one', () => {
    expect(countTriangles(model())).toBe(12);
  });

  it('falls back to the position count for a non-indexed primitive', () => {
    const nonIndexed = model();
    delete nonIndexed.meshes?.[0]?.primitives[0]?.indices;
    expect(countTriangles(nonIndexed)).toBe(2);
  });
});

describe('wrapInRoot', () => {
  it('adds one named root above the scene and keeps the old roots as children', () => {
    const json = model();
    wrapInRoot(json, 'sm-env-rock-03', [0, -10, 0]);

    expect(json.scenes).toEqual([{ nodes: [2] }]);
    expect(json.nodes?.[2]).toEqual({
      name: 'sm-env-rock-03',
      children: [0],
      translation: [0, -10, 0],
    });
    // And the whole model has moved with it.
    expect(worldBounds(json, 'wrapped')).toEqual({ min: [-1, 0, -2], max: [1, 3, 2] });
  });

  it('leaves the translation out entirely when the origin is already right', () => {
    const json = model();
    wrapInRoot(json, 'centred', [0, 0, 0]);
    expect(json.nodes?.[2]).toEqual({ name: 'centred', children: [0] });
  });
});

describe('takeEmbeddedImages and repackBuffer', () => {
  function withImage(): { json: Gltf; bin: Buffer } {
    const json = model();
    json.images = [{ name: 'bark', bufferView: 2, mimeType: 'image/png' }];
    json.bufferViews = [
      { buffer: 0, byteOffset: 0, byteLength: 96 },
      { buffer: 0, byteOffset: 96, byteLength: 72 },
      { buffer: 0, byteOffset: 168, byteLength: 4 },
    ];
    json.buffers = [{ byteLength: 172 }];
    const bin = Buffer.concat([
      Buffer.alloc(96, 1),
      Buffer.alloc(72, 2),
      Buffer.from([9, 9, 9, 9]),
    ]);
    return { json, bin };
  }

  it('hands over the image bytes and unhooks the bufferView', () => {
    const glb = withImage();
    const taken = takeEmbeddedImages(glb);

    expect(taken).toHaveLength(1);
    expect(taken[0]?.name).toBe('bark');
    expect([...(taken[0]?.bytes ?? [])]).toEqual([9, 9, 9, 9]);
    expect(glb.json.images?.[0]?.bufferView).toBeUndefined();
  });

  it('drops the image bytes from the buffer, which is the point of extracting', () => {
    const glb = withImage();
    takeEmbeddedImages(glb);
    const packed = repackBuffer(glb);

    expect(packed.bin.length).toBe(168);
    expect(packed.json.buffers).toEqual([{ byteLength: 168 }]);
  });

  it('renumbers the accessors so nothing points at a view that moved', () => {
    const glb = withImage();
    // Drop the *first* view's user, so the second view has to be renumbered.
    glb.json.accessors = [glb.json.accessors?.[1] as NonNullable<Gltf['accessors']>[number]];
    takeEmbeddedImages(glb);
    const packed = repackBuffer(glb);

    expect(packed.json.bufferViews).toHaveLength(1);
    expect(packed.json.accessors?.[0]?.bufferView).toBe(0);
    // And the bytes that survived are the ones the surviving accessor pointed at.
    expect(packed.bin.length).toBe(72);
    expect(packed.bin[0]).toBe(2);
  });

  it('keeps every remaining view aligned to four bytes', () => {
    const glb = withImage();
    glb.json.bufferViews = [
      { buffer: 0, byteOffset: 0, byteLength: 3 },
      { buffer: 0, byteOffset: 4, byteLength: 8 },
    ];
    glb.json.accessors = [
      { bufferView: 0, componentType: 5121, count: 3, type: 'SCALAR' },
      { bufferView: 1, componentType: 5126, count: 2, type: 'SCALAR' },
    ];
    glb.json.images = [];
    const packed = repackBuffer(glb);
    expect(packed.json.bufferViews?.[1]?.byteOffset).toBe(4);
  });
});

describe('ensureNormals', () => {
  /** One flat triangle in the xz plane, wound counter-clockwise seen from +y. */
  function flatTriangle(): { json: Gltf; bin: Buffer } {
    const positions = Buffer.alloc(36);
    const corners = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 0, 1],
    ];
    corners.forEach((corner, i) =>
      corner.forEach((value, axis) => positions.writeFloatLE(value, (i * 3 + axis) * 4)),
    );
    const indices = Buffer.alloc(6);
    [0, 2, 1].forEach((value, i) => indices.writeUInt16LE(value, i * 2));

    return {
      json: {
        asset: { version: '2.0' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
        accessors: [
          {
            bufferView: 0,
            componentType: 5126,
            count: 3,
            type: 'VEC3',
            min: [0, 0, 0],
            max: [1, 0, 1],
          },
          { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
        ],
        bufferViews: [
          { buffer: 0, byteOffset: 0, byteLength: 36 },
          { buffer: 0, byteOffset: 36, byteLength: 6 },
        ],
        buffers: [{ byteLength: 42 }],
      },
      bin: Buffer.concat([positions, indices]),
    };
  }

  it('gives a primitive that has none a unit normal per vertex', () => {
    // Twelve terrains in the source export ship with POSITION and TEXCOORD_0
    // only. Without this they draw as backfaces and barely shade at all.
    const glb = ensureNormals(flatTriangle(), 'flat.glb');
    const primitive = glb.json.meshes?.[0]?.primitives[0];
    const accessorIndex = primitive?.attributes['NORMAL'];
    expect(accessorIndex).toBeDefined();

    const accessor = glb.json.accessors?.[accessorIndex ?? -1];
    expect(accessor?.count).toBe(3);

    const view = glb.json.bufferViews?.[accessor?.bufferView ?? -1];
    const at = view?.byteOffset ?? 0;
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const x = glb.bin.readFloatLE(at + vertex * 12);
      const y = glb.bin.readFloatLE(at + vertex * 12 + 4);
      const z = glb.bin.readFloatLE(at + vertex * 12 + 8);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
      // The triangle is wound so its face points up; a flipped cross product
      // would give -1 here and light the terrain from underneath.
      expect(y).toBeCloseTo(1, 5);
    }
  });

  it('leaves a primitive that already has normals completely alone', () => {
    const glb = flatTriangle();
    const primitive = glb.json.meshes?.[0]?.primitives[0];
    if (primitive) {
      primitive.attributes['NORMAL'] = 0;
    }
    expect(ensureNormals(glb, 'has-normals.glb')).toBe(glb);
  });

  it('never smooths facet normals — a flat-shaded rock keeps its hard edges', () => {
    // The reason this is worth its own test: the cliff models are 82–91 % flat
    // shaded (every vertex normal within 2.6° of its triangle's face normal),
    // and those hard facets *are* the look. An importer that recomputed normals
    // would average them into a smooth blob, and nothing in the pipeline would
    // report it. Measured on the four cliff models, export file against store
    // file: 82.0 / 86.3 / 87.4 / 90.5 % — the same on both sides to the digit,
    // because this function only ever *adds* a missing NORMAL (ADR-0031).
    const glb = flatTriangle();
    const primitive = glb.json.meshes?.[0]?.primitives[0];
    if (primitive) {
      primitive.attributes['NORMAL'] = 0;
    }
    const accessors = JSON.stringify(glb.json.accessors);
    const bin = Buffer.from(glb.bin);

    const result = ensureNormals(glb, 'flat-shaded.glb');

    expect(result.json.meshes?.[0]?.primitives[0]?.attributes['NORMAL']).toBe(0);
    expect(JSON.stringify(result.json.accessors)).toBe(accessors);
    expect(result.bin.equals(bin)).toBe(true);
  });

  it('counts what is missing, so the import can report it', () => {
    expect(countMissingNormals(flatTriangle().json)).toBe(1);
    expect(countMissingNormals(ensureNormals(flatTriangle(), 'x').json)).toBe(0);
  });
});

describe('describeImage', () => {
  const textured: Gltf = {
    ...model(),
    images: [{}, {}],
    textures: [{ source: 0 }, { source: 1 }],
    materials: [
      {
        name: 'Birch_Bark_A',
        pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
        normalTexture: { index: 1 },
      },
    ],
  };

  it('names an image after the material that uses it', () => {
    // The exporter leaves image names empty, so without this every extracted
    // texture in the store would be called `image-0`.
    expect(describeImage(textured, 0)).toBe('Birch_Bark_A');
  });

  it('says which slot a non-colour map fills', () => {
    expect(describeImage(textured, 1)).toBe('Birch_Bark_A-normal');
  });

  it('answers nothing for an image no material references', () => {
    expect(describeImage(textured, 7)).toBeUndefined();
  });
});

describe('assertSupported', () => {
  it('refuses a compressed or otherwise extended file by name', () => {
    expect(() =>
      assertSupported({ ...model(), extensionsUsed: ['KHR_draco_mesh_compression'] }, 'tree.glb'),
    ).toThrow(/tree\.glb.*KHR_draco_mesh_compression/);
  });

  it('refuses sparse accessors, which the repack would silently break', () => {
    const sparse = model();
    (sparse.accessors ?? [])[0] = { ...(sparse.accessors?.[0] ?? {}), sparse: {} } as never;
    expect(() => assertSupported(sparse, 'sparse.glb')).toThrow(/sparse/);
  });

  it('accepts the plain two-chunk file the exporter actually produces', () => {
    expect(() => assertSupported(model(), 'plain.glb')).not.toThrow();
  });
});
