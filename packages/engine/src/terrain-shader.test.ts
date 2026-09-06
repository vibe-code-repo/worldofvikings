import { describe, expect, it } from 'vitest';
import {
  MAX_TERRAIN_LAYERS,
  layerRepeats,
  TERRAIN_VERTEX_SOURCE,
  terrainFragmentSource,
  terrainSamplerNames,
  terrainUniformNames,
} from './terrain-shader.js';

describe('terrainFragmentSource', () => {
  it('declares exactly the samplers the material binds', () => {
    const source = terrainFragmentSource(6, 2);
    for (const name of terrainSamplerNames(6, 2)) {
      expect(source).toContain(`uniform sampler2D ${name};`);
    }
    // Nothing beyond that: a sampler nobody binds reads as black on some
    // drivers and as the previous texture on others.
    expect(source).not.toContain('uLayer6');
    expect(source).not.toContain('uSplat2');
  });

  it('declares a scale uniform for every layer', () => {
    const source = terrainFragmentSource(3, 1);
    for (const name of terrainUniformNames(3)) {
      if (name.startsWith('uLayerScale')) {
        expect(source).toContain(`uniform vec2 ${name};`);
      }
    }
  });

  it('reads each layer’s weight from its own channel, in RGBA order', () => {
    const source = terrainFragmentSource(6, 2);
    expect(source).toContain('weights0.r * texture2D(uLayer0');
    expect(source).toContain('weights0.a * texture2D(uLayer3');
    expect(source).toContain('weights1.r * texture2D(uLayer4');
    expect(source).toContain('weights1.g * texture2D(uLayer5');
  });

  it('normalises by the sum of the weights it actually uses', () => {
    const source = terrainFragmentSource(6, 2);
    expect(source).toContain(
      'float total = weights0.r + weights0.g + weights0.b + weights0.a + ' +
        'weights1.r + weights1.g;',
    );
    expect(source).toContain('return blended / total;');
  });

  it('falls back to the first layer where nothing is painted', () => {
    expect(terrainFragmentSource(4, 1)).toContain('if (total < 0.0001)');
  });

  it('samples one texture directly when there is a layer but no splat map', () => {
    const source = terrainFragmentSource(1, 0);
    expect(source).toContain('return texture2D(uLayer0, vUv * uLayerScale0).rgb;');
    expect(source).not.toContain('uSplat0');
  });

  it('returns a flat colour when there is no layer at all', () => {
    const source = terrainFragmentSource(0, 0);
    expect(source).toContain('return uBaseColor;');
    expect(source).not.toContain('sampler2D');
  });

  it('refuses more layers than the splat maps can weight', () => {
    expect(() => terrainFragmentSource(5, 1)).toThrow(/more than 1 splat map/);
    expect(() => terrainFragmentSource(MAX_TERRAIN_LAYERS + 1, 2)).toThrow(/layerCount/);
    expect(() => terrainFragmentSource(2, 3)).toThrow(/splatCount/);
  });

  it('applies fog with the same linear range the base scene sets', () => {
    const source = terrainFragmentSource(0, 0);
    expect(source).toContain('(uFogRange.y - distanceToCamera) / (uFogRange.y - uFogRange.x)');
  });
});

describe('TERRAIN_VERTEX_SOURCE', () => {
  it('hands the fragment stage a world position, a world normal and the tile UV', () => {
    expect(TERRAIN_VERTEX_SOURCE).toContain('varying vec2 vUv;');
    expect(TERRAIN_VERTEX_SOURCE).toContain('varying vec3 vNormalW;');
    expect(TERRAIN_VERTEX_SOURCE).toContain('varying vec3 vPositionW;');
  });
});

describe('layerRepeats', () => {
  it('turns metres per repeat into repeats across the tile', () => {
    // 300 m across at 3 m per repeat is 100 repeats; 150 m deep is 50.
    expect(layerRepeats([300, 150], 3)).toEqual([100, 50]);
  });

  it('refuses a tile size that would divide by zero', () => {
    expect(() => layerRepeats([300, 300], 0)).toThrow(/positive number of metres/);
    expect(() => layerRepeats([300, 300], -2)).toThrow(/positive number of metres/);
  });
});
