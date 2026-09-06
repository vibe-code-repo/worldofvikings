import { describe, expect, it } from 'vitest';
import type { Glb, Gltf } from './glb.js';
import { readGlb, worldBounds, writeGlb } from './glb.js';
import {
  cutModel,
  elementSize,
  groupForStem,
  modelStem,
  planModels,
  storeStateOf,
  storeTexturePaths,
  subtreeOf,
  subtreeShape,
  textureNodeStem,
} from './scene-models.js';

/**
 * A miniature bundle with the two traits that make the real one hard: vertex
 * data interleaved into one shared buffer view with a stride, and two models
 * sharing that view, so a cut has to copy a *run of elements* rather than the
 * view.
 */
function bundle(): Glb {
  const stride = 20; // POSITION (12 bytes) + TEXCOORD_0 (8 bytes)
  const vertices = 8; // four per model
  const bin = Buffer.alloc(vertices * stride + 6 * 2 * 2 + 4);

  const positions: [number, number, number][] = [
    // model A, a 2 m box corner cloud around the origin
    [0, 0, 0],
    [2, 0, 0],
    [2, 1, 0],
    [0, 1, 0],
    // model B, somewhere else and larger
    [10, 0, 10],
    [14, 0, 10],
    [14, 3, 10],
    [10, 3, 10],
  ];
  positions.forEach((position, index) => {
    bin.writeFloatLE(position[0], index * stride);
    bin.writeFloatLE(position[1], index * stride + 4);
    bin.writeFloatLE(position[2], index * stride + 8);
    bin.writeFloatLE(index / 8, index * stride + 12);
    bin.writeFloatLE(0.5, index * stride + 16);
  });

  const indexBase = vertices * stride;
  for (const [slot, value] of [0, 1, 2, 0, 2, 3, 0, 1, 2, 0, 2, 3].entries()) {
    bin.writeUInt16LE(value, indexBase + slot * 2);
  }
  // A one-pixel PNG standing in for an embedded texture.
  const imageBase = indexBase + 24;
  bin.write('PNG!', imageBase, 'ascii');

  const json: Gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'Village', children: [1, 4] },
      { name: 'Floor', translation: [100, 0, 0], scale: [3, 3, 3], children: [2, 3] },
      { name: 'Slab', mesh: 0 },
      { name: 'Rail', translation: [0, 1, 0], mesh: 0 },
      { name: 'Barn', mesh: 1 },
    ],
    meshes: [
      {
        name: 'floor-mesh',
        primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 4, material: 0 }],
      },
      {
        name: 'barn-mesh',
        primitives: [{ attributes: { POSITION: 2, TEXCOORD_0: 3 }, indices: 5, material: 1 }],
      },
    ],
    materials: [
      { name: 'Village_Material', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } },
      { name: 'Barn_Material', pbrMetallicRoughness: { baseColorTexture: { index: 1 } } },
    ],
    textures: [{ source: 0 }, { source: 0 }],
    images: [{ bufferView: 2, mimeType: 'image/png' }],
    accessors: [
      {
        bufferView: 0,
        byteOffset: 0,
        componentType: 5126,
        count: 4,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [2, 1, 0],
      },
      { bufferView: 0, byteOffset: 12, componentType: 5126, count: 4, type: 'VEC2' },
      {
        bufferView: 0,
        byteOffset: 4 * stride,
        componentType: 5126,
        count: 4,
        type: 'VEC3',
        min: [10, 0, 10],
        max: [14, 3, 10],
      },
      { bufferView: 0, byteOffset: 4 * stride + 12, componentType: 5126, count: 4, type: 'VEC2' },
      { bufferView: 1, byteOffset: 0, componentType: 5123, count: 6, type: 'SCALAR' },
      { bufferView: 1, byteOffset: 12, componentType: 5123, count: 6, type: 'SCALAR' },
    ],
    bufferViews: [
      {
        buffer: 0,
        byteOffset: 0,
        byteLength: vertices * stride,
        byteStride: stride,
        target: 34962,
      },
      { buffer: 0, byteOffset: indexBase, byteLength: 24, target: 34963 },
      { buffer: 0, byteOffset: imageBase, byteLength: 4 },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  return { json, bin };
}

describe('elementSize', () => {
  it('measures a packed element', () => {
    expect(elementSize({ componentType: 5126, count: 1, type: 'VEC3' })).toBe(12);
    expect(elementSize({ componentType: 5123, count: 1, type: 'SCALAR' })).toBe(2);
  });

  it('refuses a type it does not know rather than guessing a size', () => {
    expect(() => elementSize({ componentType: 9999, count: 1, type: 'VEC3' })).toThrow();
  });
});

describe('subtreeOf', () => {
  it('lists the node first, then its descendants', () => {
    expect(subtreeOf(bundle().json, 1)).toEqual([1, 2, 3]);
  });

  it('measures mesh nodes and triangles under a node', () => {
    expect(subtreeShape(bundle().json, 1)).toEqual({ meshNodes: 2, triangles: 4 });
  });
});

describe('cutModel', () => {
  const source = bundle();
  const cut = cutModel(source, 1, 'floor');

  it('roots the model at the node it was cut from, without that node transform', () => {
    // The placement (translation 100, scale 3) belongs in the world file, not
    // in the model — applying it here would apply it twice.
    expect(cut.glb.json.nodes?.[0]).toEqual({ name: 'floor', children: [1, 2] });
  });

  it('keeps the children where they were relative to that node', () => {
    expect(cut.glb.json.nodes?.[2]?.translation).toEqual([0, 1, 0]);
  });

  it('copies only the meshes and materials the subtree uses', () => {
    expect(cut.glb.json.meshes).toHaveLength(1);
    expect(cut.glb.json.materials).toHaveLength(1);
    expect(cut.glb.json.materials?.[0]?.name).toBe('Village_Material');
  });

  it('repoints the material at the texture it copied, not at the bundle index', () => {
    const pbr = cut.glb.json.materials?.[0]?.['pbrMetallicRoughness'] as {
      baseColorTexture?: { index: number };
    };
    expect(pbr.baseColorTexture?.index).toBe(0);
    expect(cut.glb.json.textures).toHaveLength(1);
    expect(cut.glb.json.textures?.[0]?.source).toBe(0);
  });

  it('hands the embedded image over instead of leaving it in the buffer', () => {
    expect(cut.images).toHaveLength(1);
    expect(cut.images[0]?.bytes.toString('ascii')).toBe('PNG!');
    expect(cut.glb.json.images?.[0]?.bufferView).toBeUndefined();
  });

  it('de-interleaves the shared buffer view into runs of its own', () => {
    // The bundle's view is 160 bytes with a 20-byte stride; the cut takes
    // 4 positions (48 B), 4 texture coordinates (32 B) and 6 indices (12 B).
    const lengths = (cut.glb.json.bufferViews ?? []).map((view) => view.byteLength);
    expect(lengths.sort((a, b) => a - b)).toEqual([12, 32, 48]);
    for (const accessor of cut.glb.json.accessors ?? []) {
      expect(accessor.byteOffset ?? 0).toBe(0);
    }
    expect(cut.glb.bin.length).toBeLessThan(source.bin.length);
  });

  it('keeps the geometry it read, byte for byte', () => {
    const reread = readGlb(writeGlb(cut.glb));
    const bounds = worldBounds(reread.json, 'floor');
    // Model A spans 0..2 in x, 0..1 in y, and the second node lifts it by 1.
    expect(bounds?.min).toEqual([0, 0, 0]);
    expect(bounds?.max).toEqual([2, 2, 0]);
  });

  it('starts every buffer view on a four-byte boundary', () => {
    for (const view of cut.glb.json.bufferViews ?? []) {
      expect((view.byteOffset ?? 0) % 4).toBe(0);
    }
  });

  it('produces identical bytes for identical input', () => {
    expect(writeGlb(cutModel(bundle(), 1, 'floor').glb).equals(writeGlb(cut.glb))).toBe(true);
  });

  it('refuses a subtree with no geometry rather than writing an empty file', () => {
    const empty: Glb = {
      json: {
        asset: { version: '2.0' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ name: 'Waypoint' }],
      },
      bin: Buffer.alloc(0),
    };
    expect(() => cutModel(empty, 0, 'waypoint')).toThrow(/no geometry/);
  });
});

describe('modelStem', () => {
  it('folds the duplicate suffix a level editor appends', () => {
    expect(modelStem('Floor (3)')).toBe('floor');
    expect(modelStem('SM_Prop_Wood_Pile_01 2')).toBe('sm-prop-wood-pile-01');
    expect(modelStem('ChestTop')).toBe('chesttop');
  });
});

describe('planModels', () => {
  it('groups placements by name and counts them', () => {
    const plan = planModels(bundle().json, [
      { node: 1, name: 'Floor' },
      { node: 1, name: 'Floor (1)' },
      { node: 4, name: 'Barn' },
    ]);
    expect(plan.map((group) => [group.stem, group.instances])).toEqual([
      ['barn', 1],
      ['floor', 2],
    ]);
  });

  it('takes the most common shape when a name covers several', () => {
    // Two placements are the two-mesh floor, one is the single-mesh barn under
    // the same name. The majority wins, and the group says a choice was made.
    const plan = planModels(bundle().json, [
      { node: 1, name: 'Floor' },
      { node: 1, name: 'Floor (1)' },
      { node: 4, name: 'Floor (2)' },
    ]);
    expect(plan[0]?.shapes).toBe(2);
    expect(plan[0]?.node).toBe(1);
  });

  it('is sorted by name, so two runs write the same files in the same order', () => {
    const names = planModels(bundle().json, [
      { node: 4, name: 'Barn' },
      { node: 1, name: 'Floor' },
    ]).map((group) => group.stem);
    expect(names).toEqual([...names].sort());
  });
});

describe('groupForStem', () => {
  it('files the flat-shaded families by their prefix', () => {
    expect(groupForStem('sm-prop-wood-pile-01')).toBe('environment');
    expect(groupForStem('sm-plant-mushrooms-02')).toBe('vegetation');
  });

  it('files a plant by its name when there is no prefix', () => {
    expect(groupForStem('small-thin-tree-1a3')).toBe('vegetation');
    expect(groupForStem('large-bush-1a1')).toBe('vegetation');
    expect(groupForStem('branch-1a1')).toBe('vegetation');
  });

  it('does not mistake a wooden prop for a plant', () => {
    expect(groupForStem('sm-prop-log-02')).toBe('environment');
  });

  it('falls back to scenery, which is what a piece of a village is', () => {
    expect(groupForStem('floor')).toBe('environment');
    expect(groupForStem('chesttop')).toBe('environment');
  });
});

describe('storeStateOf', () => {
  it('calls a path the manifest names already known, whatever the store holds', () => {
    expect(storeStateOf('environment/a.glb', new Set(['environment/a.glb']), true)).toBe('known');
    expect(storeStateOf('environment/a.glb', new Set(['environment/a.glb']), false)).toBe('known');
  });

  it('calls an unnamed path with a file in the store adoptable', () => {
    // The regression: the file survives in the shared store while its manifest
    // row was dropped by another importer. Skipping it leaves a hole that costs
    // the world file a quarter of its entities.
    expect(storeStateOf('environment/a.glb', new Set(), true)).toBe('adopt');
  });

  it('calls an unnamed path with no file new', () => {
    expect(storeStateOf('environment/a.glb', new Set(), false)).toBe('new');
  });
});

describe('storeTexturePaths', () => {
  it('resolves a model-relative image URI against the model group folder', () => {
    const json = {
      asset: { version: '2.0' },
      images: [{ uri: 'textures/sm-env-barrel-01-1a2b3c4d.png' }, { uri: 'textures/other.png' }],
    } as unknown as Gltf;

    expect(storeTexturePaths(json, 'environment')).toEqual([
      'environment/textures/sm-env-barrel-01-1a2b3c4d.png',
      'environment/textures/other.png',
    ]);
  });

  it('ignores an embedded image, which is no file of its own', () => {
    const json = {
      asset: { version: '2.0' },
      images: [{ bufferView: 0 }, { uri: 'data:image/png;base64,AAAA' }],
    } as unknown as Gltf;

    expect(storeTexturePaths(json, 'environment')).toEqual([]);
  });

  it('names each file once even when two materials share it', () => {
    const json = {
      asset: { version: '2.0' },
      images: [{ uri: 'textures/atlas.png' }, { uri: 'textures/atlas.png' }],
    } as unknown as Gltf;

    expect(storeTexturePaths(json, 'vegetation')).toEqual(['vegetation/textures/atlas.png']);
  });
});

describe('textureNodeStem', () => {
  it('reads back the node a cut texture was named after', () => {
    expect(textureNodeStem('environment/textures/sm-env-barrel-01-1a2b3c4d.png')).toBe(
      'sm-env-barrel-01',
    );
  });

  it('returns nothing for a name that is not the cut convention', () => {
    expect(textureNodeStem('environment/textures/grass-ani.png')).toBeUndefined();
    expect(textureNodeStem('environment/textures/sm-env-barrel-01-XYZ.png')).toBeUndefined();
  });
});
