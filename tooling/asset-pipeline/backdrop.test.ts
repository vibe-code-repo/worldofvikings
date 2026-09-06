import { describe, expect, it } from 'vitest';
import {
  PANORAMA_MAX_HEIGHT,
  PANORAMA_MAX_WIDTH,
  buildBackdropModel,
  fitsPanorama,
} from './backdrop.js';
import { ALPHA_CUTOFF, METALLIC_FACTOR, ROUGHNESS_FACTOR } from './materials.js';
import type { Glb } from '@wov/content-build';

/** A one-primitive model shaped like the export's shells: no texture, one default material. */
function sourceModel(rootName: string): Glb {
  return {
    json: {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [
        { name: rootName, children: [1] },
        { name: 'SubMesh_0', mesh: 0 },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0 }] }],
      materials: [{ name: 'DefaultMaterial', pbrMetallicRoughness: {} }],
      buffers: [{ byteLength: 0 }],
    },
    bin: Buffer.alloc(0),
  };
}

describe('fitsPanorama', () => {
  it('keeps a 2:1 panorama at 4096 px', () => {
    expect(fitsPanorama(PANORAMA_MAX_WIDTH, PANORAMA_MAX_HEIGHT)).toBe(true);
  });

  it('refuses anything bigger on either axis', () => {
    expect(fitsPanorama(PANORAMA_MAX_WIDTH * 2, PANORAMA_MAX_HEIGHT)).toBe(false);
    expect(fitsPanorama(PANORAMA_MAX_WIDTH, PANORAMA_MAX_HEIGHT * 2)).toBe(false);
  });
});

describe('buildBackdropModel', () => {
  it('writes one material named after the store stem, cut out and double-sided', () => {
    const built = buildBackdropModel(
      sourceModel('MountainSkybox'),
      'backdrop-mountains-snow',
      'textures/backdrop-mountains-snow.png',
    );

    expect(built.json.materials).toHaveLength(1);
    const material = built.json.materials?.[0] as Record<string, unknown>;
    expect(material['name']).toBe('backdrop-mountains-snow');
    // From the surface table, which is where every material setting in this
    // pipeline comes from — not written here a second time.
    expect(material['alphaMode']).toBe('MASK');
    expect(material['alphaCutoff']).toBe(ALPHA_CUTOFF);
    expect(material['doubleSided']).toBe(true);
    expect(material['pbrMetallicRoughness']).toMatchObject({
      metallicFactor: METALLIC_FACTOR,
      roughnessFactor: ROUGHNESS_FACTOR,
      baseColorTexture: { index: 0 },
    });
    expect(built.json.images).toEqual([{ uri: 'textures/backdrop-mountains-snow.png' }]);
  });

  it('renames every node, so no source name reaches the store or the placeholder', () => {
    const built = buildBackdropModel(
      sourceModel('MountainSkybox'),
      'backdrop-mountains-snow',
      'textures/x.png',
    );
    const names = (built.json.nodes ?? []).map((node) => node.name ?? '');
    expect(names[0]).toBe('backdrop-mountains-snow');
    expect(names.some((name) => name.toLowerCase().includes('mountainskybox'))).toBe(false);
    expect(names.every((name) => name.startsWith('backdrop-mountains-snow'))).toBe(true);
  });

  it('leaves a model with no texture without an image', () => {
    const built = buildBackdropModel(sourceModel('SkyDome'), 'backdrop-sky-dome', undefined);
    expect(built.json.images).toBeUndefined();
    expect(built.json.textures).toBeUndefined();
    expect(built.json.materials?.[0]?.['name']).toBe('backdrop-sky-dome');
  });

  it('touches no vertex data', () => {
    const source = sourceModel('MountainSkybox');
    const before = JSON.stringify({
      meshes: source.json.meshes,
      accessors: source.json.accessors,
      bufferViews: source.json.bufferViews,
    });
    const built = buildBackdropModel(source, 'backdrop-mountains-snow', 'textures/x.png');
    // The material index is the one thing a primitive may gain; nothing else in
    // the geometry may move. Smooth normals are what makes a painted range read
    // as distance, and recomputing them is the same mistake as smoothing a cliff.
    expect(built.json.meshes?.[0]?.primitives[0]?.attributes).toEqual({ POSITION: 0, NORMAL: 1 });
    expect(built.json.accessors).toBe(JSON.parse(before).accessors ?? undefined);
    expect(built.bin.byteLength).toBe(0);
  });
});
