import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Gltf } from './glb.js';
import { writeGlb } from './glb.js';
import {
  indexSceneBundle,
  openSceneBundle,
  readSceneBindings,
  resolveByVertexCount,
} from './scene-bindings.js';

/**
 * A miniature scene bundle: one tree instance whose trunk and leaves are two
 * primitives with different vertex counts, plus a node the store knows nothing
 * about.
 */
function bundle(images: number[][] = [[1], [2]]): { json: Gltf; bin: Buffer } {
  const parts = images.map((bytes) => Buffer.from(bytes));
  const json: Gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 3] }],
    nodes: [
      { name: 'Tree_1A3 (2)', children: [1, 2] },
      { name: 'trunk', mesh: 0 },
      { name: 'leaves', mesh: 1 },
      { name: 'Directional Light' },
    ],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0 }, material: 0 }] },
      { primitives: [{ attributes: { POSITION: 1 }, material: 1 }] },
    ],
    accessors: [
      { componentType: 5126, count: 2564, type: 'VEC3' },
      { componentType: 5126, count: 14852, type: 'VEC3' },
    ],
    materials: [
      { name: 'Birch_Bark_A', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } },
      { name: 'Leaves Birch 1', pbrMetallicRoughness: { baseColorTexture: { index: 1 } } },
    ],
    textures: [{ source: 0 }, { source: 1 }],
    images: [{ bufferView: 0 }, { bufferView: 1 }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: parts[0]?.length ?? 0 },
      { buffer: 0, byteOffset: 4, byteLength: parts[1]?.length ?? 0 },
    ],
    buffers: [{ byteLength: 8 }],
  };
  const bin = Buffer.alloc(8);
  parts[0]?.copy(bin, 0);
  parts[1]?.copy(bin, 4);
  return { json, bin };
}

describe('indexSceneBundle', () => {
  it('finds a store model through its duplicate suffix and records its materials by vertex count', () => {
    const index = indexSceneBundle(bundle().json, new Set(['tree-1a3']));
    expect(index.hits).toBe(1);
    const counts = index.models.get('tree-1a3');
    expect([...(counts?.keys() ?? [])].sort((a, b) => a - b)).toEqual([2564, 14852]);
    expect([...(counts?.get(2564)?.keys() ?? [])]).toEqual(['Birch_Bark_A']);
    expect([...(counts?.get(14852)?.keys() ?? [])]).toEqual(['Leaves Birch 1']);
  });

  it('ignores nodes that name nothing in the store', () => {
    const index = indexSceneBundle(bundle().json, new Set(['something-else']));
    expect(index.hits).toBe(0);
    expect(index.models.size).toBe(0);
  });

  it('records which image each material draws its base colour from', () => {
    const index = indexSceneBundle(bundle().json, new Set(['tree-1a3']));
    expect(index.materialImages.get('Birch_Bark_A')).toBe(0);
    expect(index.materialImages.get('Leaves Birch 1')).toBe(1);
  });
});

describe('resolveByVertexCount', () => {
  it('takes the material the bundles agree on', () => {
    const resolved = resolveByVertexCount(new Map([[100, new Map([['Trunks', 7]])]]));
    expect(resolved.get(100)).toEqual({ material: 'Trunks', contested: false });
  });

  it('takes the most frequent name when the bundles disagree, and says so', () => {
    const resolved = resolveByVertexCount(
      new Map([
        [
          100,
          new Map([
            ['Oak_Bark_A', 3],
            ['Trunks', 11],
          ]),
        ],
      ]),
    );
    expect(resolved.get(100)).toEqual({ material: 'Trunks', contested: true });
  });

  it('breaks a tie alphabetically, so the read order of the bundles cannot change the result', () => {
    const forwards = resolveByVertexCount(
      new Map([
        [
          100,
          new Map([
            ['Trunks', 4],
            ['Oak_Bark_A', 4],
          ]),
        ],
      ]),
    );
    const backwards = resolveByVertexCount(
      new Map([
        [
          100,
          new Map([
            ['Oak_Bark_A', 4],
            ['Trunks', 4],
          ]),
        ],
      ]),
    );
    expect(forwards.get(100)?.material).toBe('Oak_Bark_A');
    expect(backwards.get(100)?.material).toBe('Oak_Bark_A');
  });
});

describe('openSceneBundle and readSceneBindings', () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'wov-scenes-'));
    const first = bundle([[0xaa], [0xbb]]);
    await writeFile(join(directory, 'Level1.glb'), writeGlb(first));
    // A second bundle with the same trunk image: the merge must not read it
    // twice or list it twice.
    const second = bundle([[0xaa], [0xcc]]);
    await writeFile(join(directory, 'Level2.glb'), writeGlb(second));
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('reads the JSON chunk and only the image bytes it asks for', async () => {
    const opened = await openSceneBundle(join(directory, 'Level1.glb'));
    try {
      expect(opened.json.nodes?.[0]?.name).toBe('Tree_1A3 (2)');
      expect([...(await opened.imageBytes(0))]).toEqual([0xaa]);
      expect([...(await opened.imageBytes(1))]).toEqual([0xbb]);
    } finally {
      await opened.close();
    }
  });

  it('merges the bundles into one binding per model and one buffer per material', async () => {
    const bindings = await readSceneBindings(
      directory,
      ['Level1.glb', 'Level2.glb'],
      new Set(['tree-1a3']),
    );
    expect(bindings.bundles.map((entry) => entry.hits)).toEqual([1, 1]);
    expect(bindings.byModel.get('tree-1a3')?.get(2564)?.material).toBe('Birch_Bark_A');
    expect([...(bindings.images.get('Birch_Bark_A') ?? [])]).toEqual([0xaa]);
    // The first bundle to name a material owns its image, so a second bundle
    // embedding a different atlas under the same name cannot change the result.
    expect([...(bindings.images.get('Leaves Birch 1') ?? [])]).toEqual([0xbb]);
    expect(bindings.imageSources.get('Birch_Bark_A')).toBe('Level1.glb');
    expect(bindings.withoutImage).toEqual([]);
  });

  it('reads the bundles in name order whatever order it is handed them', async () => {
    const forwards = await readSceneBindings(
      directory,
      ['Level1.glb', 'Level2.glb'],
      new Set(['tree-1a3']),
    );
    const backwards = await readSceneBindings(
      directory,
      ['Level2.glb', 'Level1.glb'],
      new Set(['tree-1a3']),
    );
    expect(backwards.bundles.map((entry) => entry.file)).toEqual(
      forwards.bundles.map((entry) => entry.file),
    );
    expect([...(backwards.images.get('Leaves Birch 1') ?? [])]).toEqual([0xbb]);
  });
});
