import { describe, expect, it } from 'vitest';
import {
  BACKDROP_MODELS,
  BACKDROP_SIZE_LIMIT,
  PANORAMA_MAX_HEIGHT,
  PANORAMA_MAX_WIDTH,
  WORLD_OBJECT_SIZE_LIMIT,
  backdropModelPath,
  backdropTexturePath,
  buildBackdropModel,
  cutSizeLimit,
  fitsPanorama,
  isBackdropName,
} from './backdrop.js';
import { ALPHA_CUTOFF, METALLIC_FACTOR, ROUGHNESS_FACTOR } from './materials.js';
import type { Glb } from './glb.js';

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

describe('the backdrop list', () => {
  it('gives every model a store path under environment/, with its texture beside it', () => {
    for (const model of BACKDROP_MODELS) {
      expect(backdropModelPath(model.stem)).toBe(`environment/${model.stem}.glb`);
      expect(backdropTexturePath(model.stem)).toBe(`environment/textures/${model.stem}.png`);
      // The reference a model writes must resolve against its own URL and carry
      // no `..`, which Babylon rejects outright (ADR-0019).
      const relative = backdropTexturePath(model.stem).slice('environment/'.length);
      expect(relative).not.toContain('..');
    }
  });

  it('names both mountain shells but keeps them apart by node', () => {
    const mountains = BACKDROP_MODELS.filter((model) =>
      model.stem.startsWith('backdrop-mountains'),
    );
    expect(mountains).toHaveLength(2);
    // Same geometry file, different painting: this is the whole reason the
    // models come from the export rather than out of the bundle, where both
    // shells point at one embedded image.
    expect(new Set(mountains.map((model) => model.model)).size).toBe(1);
    expect(new Set(mountains.map((model) => model.texture)).size).toBe(2);
    expect(new Set(mountains.flatMap((model) => model.nodes)).size).toBe(2);
  });
});

describe('isBackdropName', () => {
  it('knows this project’s own store stems by their prefix', () => {
    expect(isBackdropName('backdrop-mountains-snow')).toBe(true);
    expect(isBackdropName('backdrop-anything-later')).toBe(true);
  });

  it('knows the bundle node names from the list', () => {
    for (const node of BACKDROP_MODELS.flatMap((model) => model.nodes)) {
      expect(isBackdropName(node)).toBe(true);
    }
  });

  it('says no to an ordinary world object', () => {
    expect(isBackdropName('sm-env-stonewall-01')).toBe(false);
    expect(isBackdropName('sm-prop-barrel-01')).toBe(false);
  });
});

describe('cutSizeLimit', () => {
  it('keeps the 80 m limit for everything that is not a backdrop', () => {
    expect(cutSizeLimit('sm-prop-barrel-01')).toBe(WORLD_OBJECT_SIZE_LIMIT);
    expect(cutSizeLimit('sm-item-sword', 'prop')).toBe(WORLD_OBJECT_SIZE_LIMIT);
  });

  it('lifts it by name list', () => {
    expect(cutSizeLimit('MountainSkybox')).toBe(BACKDROP_SIZE_LIMIT);
  });

  it('lifts it by category', () => {
    // A name the list has never heard of, filed under `backdrop` by the
    // catalogue: the two halves of the rule are independent on purpose.
    expect(cutSizeLimit('something-nobody-listed', 'backdrop')).toBe(BACKDROP_SIZE_LIMIT);
  });

  it('is still a limit — a shell exported in centimetres is over even the backdrop one', () => {
    expect(118_800).toBeGreaterThan(BACKDROP_SIZE_LIMIT);
  });
});

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
