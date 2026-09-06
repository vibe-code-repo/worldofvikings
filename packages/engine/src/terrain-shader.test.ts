import { describe, expect, it } from 'vitest';
import {
  MAX_TERRAIN_LAYERS,
  layerRepeats,
  shadowTapOffsets,
  TERRAIN_VERTEX_SOURCE,
  terrainFragmentSource,
  terrainSamplerNames,
  terrainUniformNames,
  terrainVertexSource,
  type TerrainSurfaceShader,
} from './terrain-shader.js';
import { SKY_GRADIENT_FUNCTION } from './sky-shader.js';

/** A surface shape: which layers have a normal map, and facets on or off. */
function surface(normalMaps: boolean[], flatNormals = false): TerrainSurfaceShader {
  return { normalMaps, flatNormals };
}

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
    expect(source).toContain('albedo /= total;');
  });

  it('falls back to the first layer where nothing is painted', () => {
    expect(terrainFragmentSource(4, 1)).toContain('if (total < 0.0001)');
  });

  it('samples one texture directly when there is a layer but no splat map', () => {
    const source = terrainFragmentSource(1, 0);
    expect(source).toContain('albedo = texture2D(uLayer0, vUv * uLayerScale0).rgb;');
    expect(source).not.toContain('uSplat0');
  });

  it('returns a flat colour when there is no layer at all', () => {
    const source = terrainFragmentSource(0, 0);
    expect(source).toContain('albedo = uBaseColor;');
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

describe('the ground receiving shadows', () => {
  const shadows = { mapSize: 2048, float: true, taps: 4 } as const;

  it('samples no shadow map when the tile receives none', () => {
    const source = terrainFragmentSource(2, 1);
    expect(source).not.toContain('uShadowMap');
    // The lighting line is the same string either way; the difference is what
    // `shadowFactor()` answers, so it cannot drift between the two programs.
    expect(source).toContain('uSunColor * key * shadowFactor()');
    expect(source).toContain('float shadowFactor(void) {\n  return 1.0;\n}');
  });

  it('declares the sampler, the varyings and the uniforms it binds', () => {
    const source = terrainFragmentSource(2, 1, shadows);
    expect(source).toContain('uniform sampler2D uShadowMap;');
    expect(source).toContain('uniform vec3 uShadowInfo;');
    expect(source).toContain('varying vec4 vPositionFromLight;');
    expect(source).toContain('varying float vShadowDepth;');
    expect(terrainSamplerNames(2, 1, true)).toContain('uShadowMap');
    expect(terrainUniformNames(2, true)).toEqual(
      expect.arrayContaining(['uShadowMatrix', 'uShadowDepthValues', 'uShadowInfo']),
    );
  });

  it('names none of them when the tile has no shadow lookup', () => {
    expect(terrainSamplerNames(2, 1, false)).not.toContain('uShadowMap');
    expect(terrainUniformNames(2, false)).not.toContain('uShadowMatrix');
  });

  it('computes the same depth the shadow pass stored', () => {
    // Babylon's caster writes `(z + depthValues.x) / depthValues.y`. A receiver
    // that computes anything else compares two different numbers, which is a
    // ground striped in shadow for no visible reason.
    expect(terrainVertexSource(true)).toContain(
      '(vPositionFromLight.z + uShadowDepthValues.x) / uShadowDepthValues.y',
    );
    expect(terrainVertexSource(false)).not.toContain('uShadowDepthValues');
  });

  it('unpacks the depth when the shadow map is not a float target', () => {
    const asFloat = terrainFragmentSource(2, 1, { ...shadows, float: true });
    const packed = terrainFragmentSource(2, 1, { ...shadows, float: false });
    expect(asFloat).toContain('texture2D(uShadowMap, uv).x');
    expect(packed).toContain('bitShift');
    expect(packed).not.toContain('texture2D(uShadowMap, uv).x');
  });

  it('emits one texture fetch per tap and averages them', () => {
    for (const taps of [1, 4, 9] as const) {
      const source = terrainFragmentSource(2, 1, { ...shadows, taps });
      expect([...source.matchAll(/lit \+= step\(/g)]).toHaveLength(taps);
      expect(source).toContain(`lit /= ${taps.toFixed(1)};`);
      expect(shadowTapOffsets(taps)).toHaveLength(taps);
    }
  });

  it('answers "lit" outside the map rather than "in shadow"', () => {
    // Beyond the shadow distance the sun is simply unoccluded. Answering
    // darkness there would draw the edge of the shadow map as a dark square.
    const source = terrainFragmentSource(2, 1, shadows);
    expect(source).toMatch(
      /uv\.x > 1\.0 \|\| uv\.y < 0\.0 \|\| uv\.y > 1\.0\) \{\n\s+return 1\.0;/,
    );
  });

  it('refuses a tap count it has no offsets for', () => {
    expect(() => terrainFragmentSource(2, 1, { ...shadows, taps: 3 as unknown as 1 })).toThrow(
      /taps must be 1, 4 or 9/,
    );
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

describe('the ground’s surface layers', () => {
  it('declares a normal sampler only for the layers that have a map', () => {
    const shape = surface([true, false, true]);
    const source = terrainFragmentSource(3, 1, undefined, shape);
    expect(source).toContain('uniform sampler2D uLayerNormal0;');
    expect(source).not.toContain('uniform sampler2D uLayerNormal1;');
    expect(source).toContain('uniform sampler2D uLayerNormal2;');
    expect(terrainSamplerNames(3, 1, false, shape)).toEqual([
      'uSplat0',
      'uLayer0',
      'uLayerNormal0',
      'uLayer1',
      'uLayer2',
      'uLayerNormal2',
    ]);
  });

  it('gives a layer without a map a flat tilt rather than a black texel', () => {
    const source = terrainFragmentSource(2, 1, undefined, surface([true, false]));
    expect(source).toContain('bump += weights0.g * vec3(0.0, 0.0, 1.0);');
  });

  it('blends tilt, metallic and smoothness by the weights the colour uses', () => {
    const source = terrainFragmentSource(2, 1, undefined, surface([true, true]));
    for (const line of [
      'albedo += weights0.r * texture2D(uLayer0, vUv * uLayerScale0).rgb;',
      'bump += weights0.r * wovLayerBump(texture2D(uLayerNormal0, vUv * uLayerScale0).rgb, ' +
        'uLayerSurface0.x);',
      'metallic += weights0.r * uLayerSurface0.y;',
      'smoothness += weights0.r * uLayerSurface0.z;',
    ]) {
      expect(source).toContain(line);
    }
    expect(source).toContain('bump /= total;');
  });

  it('declares one surface uniform per layer, next to its scale', () => {
    expect(terrainUniformNames(2)).toContain('uLayerSurface0');
    expect(terrainUniformNames(2)).toContain('uLayerSurface1');
    expect(terrainUniformNames(2)).not.toContain('uLayerSurface2');
  });

  it('refuses a normal-map mask that does not cover every layer', () => {
    expect(() => terrainFragmentSource(3, 1, undefined, surface([true, false]))).toThrow(
      /2 normal-map flags for 3 layers/,
    );
  });

  it('builds the tangent frame from the tile’s own axes, not from an attribute', () => {
    const source = terrainFragmentSource(1, 0, undefined, surface([true]));
    // u runs along world x and v along world z (`height-field.ts`), so the
    // frame is those two projected onto the surface.
    expect(source).toContain('vec3 tangent = vec3(1.0, 0.0, 0.0) - n * n.x;');
    expect(source).toContain('vec3 bitangent = cross(tangent, n);');
  });

  it('leaves the normal alone when no layer has a map', () => {
    const source = terrainFragmentSource(2, 1, undefined, surface([false, false]));
    expect(source).not.toContain('bitangent');
  });
});

describe('facetted ground', () => {
  it('is off unless asked for, and then asks for derivatives', () => {
    expect(terrainFragmentSource(1, 0)).not.toContain('dFdx');
    const flat = terrainFragmentSource(1, 0, undefined, surface([false], true));
    expect(flat.startsWith('#extension GL_OES_standard_derivatives : enable\n')).toBe(true);
    expect(flat).toContain('cross(dFdx(vPositionW), dFdy(vPositionW))');
  });

  it('keeps the facet on the same side as the vertex normal', () => {
    // Without this the winding decides which way a triangle faces, and half the
    // tile lights from underneath — with nothing in any log to say so.
    const flat = terrainFragmentSource(1, 0, undefined, surface([false], true));
    expect(flat).toContain('vec3 n = facet * sign(dot(facet, smoothNormal));');
  });
});

describe('the sky the ground reflects', () => {
  it('evaluates the very gradient the sky dome draws', () => {
    const source = terrainFragmentSource(1, 0);
    expect(source).toContain(SKY_GRADIENT_FUNCTION);
    expect(source).toContain('wovSkyColor(direction, uSkyZenith, uSkyHorizon, glow');
  });

  it('names the sky uniforms the material binds', () => {
    const names = terrainUniformNames(0);
    expect(names).toEqual(
      expect.arrayContaining(['uSkyZenith', 'uSkyHorizon', 'uSkyGlow', 'uSkyParams']),
    );
  });

  it('pays for the reflection through the environment BRDF, not at full strength', () => {
    // Without this a meadow at metallic 0.5 comes out the colour of the zenith.
    const source = terrainFragmentSource(1, 0);
    expect(source).toContain('vec2 wovEnvBrdf(float nDotV, float roughness)');
    expect(source).toContain('(reflectance * brdf.x + vec3(brdf.y)) * sky * uSkyParams.y');
  });

  it('splits the surface into a diffuse half and a reflected half', () => {
    const source = terrainFragmentSource(1, 0);
    expect(source).toContain('vec3 diffuse = albedo * (1.0 - metallic);');
    expect(source).toContain('vec3 reflectance = mix(vec3(0.04), albedo, metallic);');
  });

  it('blurs the reflection as the surface roughens', () => {
    // A rough layer taking a mirror sample is a ground full of sun discs.
    expect(terrainFragmentSource(1, 0)).toContain(
      'normalize(mix(reflect(-view, n), n, roughness * roughness))',
    );
  });
});
