/**
 * The GLSL the terrain material runs, generated for the number of layers a tile
 * actually has (ADR-0020).
 *
 * Generated rather than written once with eight `#ifdef`s: the layer count is
 * world data, the shader must not sample a texture that was never bound, and a
 * loop over a `uniform` array of samplers is not portable GLSL. Generating the
 * exact chain of adds keeps the compiled shader as small as the tile is simple —
 * a two-layer tile compiles two texture fetches, not eight.
 *
 * Kept in its own module, free of Babylon.js, so the strings can be asserted in
 * a unit test. A shader that compiles is not a shader that is right, but a
 * shader that never declares `uSplat2` while the material binds it is wrong in
 * a way a test can see.
 */

import { SKY_GRADIENT_FUNCTION } from './sky-shader.js';

/** Splat weights per map: one per RGBA channel. */
export const CHANNELS_PER_SPLAT_MAP = 4;

/** The most layers the material supports — two RGBA maps (see the schema). */
export const MAX_TERRAIN_LAYERS = 8;

/** The channel letter each layer's weight is read from. */
const CHANNELS = ['r', 'g', 'b', 'a'] as const;

/** Names the uniforms and attributes a generated program uses. */
export const TERRAIN_ATTRIBUTES = ['position', 'normal', 'uv'] as const;

/**
 * How a generated terrain program samples the sun's shadow map, or that it does
 * not (ADR-0024).
 *
 * The ground has to receive shadows through hand-written GLSL because it *is*
 * hand-written GLSL: `mesh.receiveShadows = true` only means something to a
 * material Babylon generated, and the multi-layer splat blend is the reason
 * this material is not one (ADR-0020). So the lookup is spelled out here, in
 * the same terms Babylon's own shadow includes use, and the two agree on one
 * number — `(z + depthValues.x) / depthValues.y`, the depth the caster pass
 * stored.
 *
 * `float` is not a preference. `ShadowGenerator` renders depth into a float or
 * half-float target where the hardware supports one and into a packed RGBA
 * byte target where it does not, and the two are read differently. It is
 * measured off the shadow map's own `textureType` at material creation, never
 * assumed — a wrong guess here is a ground that is entirely in shadow or
 * entirely out of it, with no error anywhere.
 */
export interface TerrainShadowShader {
  /** Texels across the shadow map; the PCF offsets are one texel wide. */
  readonly mapSize: number;
  /** True when the shadow map holds depth as a float in its red channel. */
  readonly float: boolean;
  /** Samples per pixel: 1 (hard), 4 (rotated square) or 9 (3×3 PCF). */
  readonly taps: 1 | 4 | 9;
}

/**
 * What a tile's layers do beyond showing a colour (ADR-0032).
 *
 * The mask is per layer and not a single flag because normal maps are world
 * data: the village's gravel has one and, until someone imports it, its moss
 * may not. A program that declares `uLayerNormal3` while the material binds
 * nothing to it samples black — which reads as a surface tilted hard in one
 * direction, everywhere, and looks like a lighting bug rather than a missing
 * file.
 */
export interface TerrainSurfaceShader {
  /** One flag per layer: true when a normal map is bound for it. */
  readonly normalMaps: readonly boolean[];
  /**
   * Draw the ground facetted, taking the normal from screen-space derivatives
   * instead of from the interpolated vertex normal.
   *
   * Derivatives rather than a second, flat-shaded vertex buffer: the height
   * field is a shared grid, so a facetted copy would be three times the
   * vertices for a switch that is off by default.
   */
  readonly flatNormals: boolean;
}

/** A tile with no normal maps and smooth normals — what a plain world gets. */
export function plainSurface(layerCount: number): TerrainSurfaceShader {
  return { normalMaps: Array.from({ length: layerCount }, () => false), flatNormals: false };
}

/**
 * The uniforms Babylon fills in by name, plus the ones the material binds.
 *
 * `world`, `worldViewProjection` and `cameraPosition` are Babylon's own
 * built-ins for a `ShaderMaterial`; the rest are set from the scene's lights and
 * fog when the material binds, so the tile is lit by the same sun as everything
 * else instead of by a second, hard-coded one.
 */
export function terrainUniformNames(layerCount: number, shadows = false): string[] {
  const uniforms = [
    'world',
    'worldViewProjection',
    'cameraPosition',
    'uBaseColor',
    'uSunDirection',
    'uSunColor',
    'uAmbientSky',
    'uAmbientGround',
    'uFogColor',
    'uFogRange',
    // The sky the ground reflects (ADR-0032). Always declared, never optional:
    // every surface reflects something, and a dielectric at 4 % is the floor.
    'uSkyZenith',
    'uSkyHorizon',
    'uSkyGlow',
    'uSkyParams',
  ];
  if (shadows) {
    uniforms.push('uShadowMatrix', 'uShadowDepthValues', 'uShadowInfo');
  }
  for (let layer = 0; layer < layerCount; layer += 1) {
    uniforms.push(`uLayerScale${String(layer)}`);
    // x: normal strength, y: metallic, z: smoothness — one vector rather than
    // three floats, because they are always set together and a layer that has
    // two of the three is a layer someone forgot to finish.
    uniforms.push(`uLayerSurface${String(layer)}`);
  }
  return uniforms;
}

/**
 * How often one layer texture repeats across a tile: metres across, divided by
 * metres per repeat.
 *
 * The world file states `tileSize` in metres so that resizing a tile does not
 * resize its gravel, which means this division is the one place the two meet.
 *
 * @throws when `tileSize` is not a positive number — a zero would divide the
 * ground by nothing and hand the shader an infinity.
 */
export function layerRepeats(size: readonly [number, number], tileSize: number): [number, number] {
  if (!Number.isFinite(tileSize) || tileSize <= 0) {
    throw new Error(
      `terrain: tileSize must be a positive number of metres, got ${String(tileSize)}`,
    );
  }
  return [size[0] / tileSize, size[1] / tileSize];
}

/** The sampler names a generated program declares, in binding order. */
export function terrainSamplerNames(
  layerCount: number,
  splatCount: number,
  shadows = false,
  surface?: TerrainSurfaceShader | undefined,
): string[] {
  const samplers: string[] = [];
  for (let map = 0; map < splatCount; map += 1) {
    samplers.push(`uSplat${String(map)}`);
  }
  for (let layer = 0; layer < layerCount; layer += 1) {
    samplers.push(`uLayer${String(layer)}`);
    if (surface?.normalMaps[layer] === true) {
      samplers.push(`uLayerNormal${String(layer)}`);
    }
  }
  if (shadows) {
    samplers.push('uShadowMap');
  }
  return samplers;
}

/**
 * The vertex program: world position, world normal and the tile's own UV — and,
 * when the tile receives shadows, its position in the sun's clip space.
 *
 * `vShadowDepth` is computed here rather than in the fragment program because
 * it is the *exact* expression the shadow-map pass stored
 * (`shadowMapVertexMetric`): `(z + depthValues.x) / depthValues.y`. Restating
 * it per pixel would be the same arithmetic; restating it differently would be
 * a ground that shadows itself in stripes.
 */
export function terrainVertexSource(shadows = false): string {
  return `precision highp float;

attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;

uniform mat4 world;
uniform mat4 worldViewProjection;
${shadows ? 'uniform mat4 uShadowMatrix;\nuniform vec2 uShadowDepthValues;\n' : ''}
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPositionW;
${shadows ? 'varying vec4 vPositionFromLight;\nvarying float vShadowDepth;\n' : ''}
void main(void) {
  vec4 worldPosition = world * vec4(position, 1.0);
  vPositionW = worldPosition.xyz;
  // mat3(world) is enough here: a terrain tile is placed with a translation and
  // at most a mirror, never with a non-uniform scale, so the inverse transpose
  // would only differ by a length this normalises away anyway.
  vNormalW = normalize(mat3(world) * normal);
  vUv = uv;
${
  shadows
    ? '  vPositionFromLight = uShadowMatrix * worldPosition;\n' +
      '  vShadowDepth = (vPositionFromLight.z + uShadowDepthValues.x) / uShadowDepthValues.y;\n'
    : ''
}  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;
}

/** The vertex program of a tile that receives no shadows. */
export const TERRAIN_VERTEX_SOURCE = terrainVertexSource(false);

/**
 * Builds the fragment program for a tile with `layerCount` layers weighted by
 * `splatCount` maps.
 *
 * The weights are **normalised**: the exported maps hold one weight per layer
 * that already sum to roughly 255 across all channels, and dividing by the
 * actual sum is what keeps a tile from going dark where the paint is thin — and
 * what makes a six-layer tile with a half-empty second map correct rather than
 * washed out. Where nothing is painted at all, layer 0 stands in, because a
 * black hole in the ground is worse than a wrong-looking patch.
 *
 * Lighting is one hemispheric term and one directional term, with linear fog —
 * exactly what `createBaseScene` puts into the scene, bound from the scene's own
 * lights rather than restated here.
 */
export function terrainFragmentSource(
  layerCount: number,
  splatCount: number,
  shadows?: TerrainShadowShader | undefined,
  surface?: TerrainSurfaceShader | undefined,
): string {
  if (!Number.isInteger(layerCount) || layerCount < 0 || layerCount > MAX_TERRAIN_LAYERS) {
    throw new Error(`terrain: layerCount must be 0..${String(MAX_TERRAIN_LAYERS)}`);
  }
  if (!Number.isInteger(splatCount) || splatCount < 0 || splatCount > 2) {
    throw new Error('terrain: splatCount must be 0, 1 or 2');
  }
  if (layerCount > splatCount * CHANNELS_PER_SPLAT_MAP && splatCount > 0) {
    throw new Error(
      `terrain: ${String(layerCount)} layers need more than ${String(splatCount)} splat map(s)`,
    );
  }
  if (surface !== undefined && surface.normalMaps.length !== layerCount) {
    throw new Error(
      `terrain: ${String(surface.normalMaps.length)} normal-map flags for ` +
        `${String(layerCount)} layers`,
    );
  }

  if (shadows !== undefined && ![1, 4, 9].includes(shadows.taps)) {
    throw new Error(`terrain: shadow taps must be 1, 4 or 9, got ${String(shadows.taps)}`);
  }
  if (shadows !== undefined && (!Number.isFinite(shadows.mapSize) || shadows.mapSize <= 0)) {
    throw new Error(`terrain: shadow mapSize must be positive, got ${String(shadows.mapSize)}`);
  }

  const shape = surface ?? plainSurface(layerCount);

  const declarations: string[] = [];
  for (let map = 0; map < splatCount; map += 1) {
    declarations.push(`uniform sampler2D uSplat${String(map)};`);
  }
  for (let layer = 0; layer < layerCount; layer += 1) {
    declarations.push(`uniform sampler2D uLayer${String(layer)};`);
    if (shape.normalMaps[layer] === true) {
      declarations.push(`uniform sampler2D uLayerNormal${String(layer)};`);
    }
    declarations.push(`uniform vec2 uLayerScale${String(layer)};`);
    declarations.push(`uniform vec3 uLayerSurface${String(layer)};`);
  }

  const extension = shape.flatNormals ? '#extension GL_OES_standard_derivatives : enable\n' : '';

  return `${extension}precision highp float;

varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPositionW;

uniform vec3 cameraPosition;
uniform vec3 uBaseColor;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uAmbientSky;
uniform vec3 uAmbientGround;
uniform vec3 uFogColor;
/** x: start, y: end, z: 1 when fog is on. */
uniform vec3 uFogRange;
/** The gradient sky this ground reflects, and the sun's glow in it. */
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyGlow;
/** x: sun spread, y: how much of the sky reaches the ground. */
uniform vec2 uSkyParams;
${declarations.join('\n')}
${shadowDeclarations(shadows)}
${SKY_GRADIENT_FUNCTION}
vec3 wovLayerBump(vec3 texel, float strength) {
  vec3 bump = texel * 2.0 - 1.0;
  bump.xy *= strength;
  return bump;
}

${blendFunction(layerCount, splatCount, shape)}
${normalFunction(shape)}
${shadowFunction(shadows)}
/**
 * How much of a reflection survives the surface, by roughness and view angle.
 *
 * Lazarov's analytic fit to the split-sum environment BRDF — two multiply-adds
 * instead of the 2D lookup table a full physically based renderer stores. It is
 * here because without it a rough layer mirrors the sky at full strength: a
 * meadow at metallic 0.5 came out the colour of the zenith, measured on the
 * village tile before this line existed. At roughness 1 it keeps about 45 % of
 * the reflectance and none of the grazing blow-out.
 */
vec2 wovEnvBrdf(float nDotV, float roughness) {
  vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
  vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 r = roughness * c0 + c1;
  float a004 = min(r.x * r.x, exp2(-9.28 * nDotV)) * r.x + r.y;
  return vec2(-1.04, 1.04) * a004 + r.zw;
}

vec3 environmentLight(vec3 n, vec3 reflectance, float smoothness) {
  vec3 view = normalize(cameraPosition - vPositionW);
  float nDotV = clamp(dot(n, view), 0.0, 1.0);
  float roughness = 1.0 - clamp(smoothness, 0.0, 1.0);
  vec3 direction = normalize(mix(reflect(-view, n), n, roughness * roughness));
  // A mirror-sharp sun disc has no business in gravel: the glow fades out with
  // the square of smoothness, so only a near-mirror layer ever shows one.
  vec3 glow = uSkyGlow * smoothness * smoothness;
  vec3 sky = wovSkyColor(direction, uSkyZenith, uSkyHorizon, glow, uSunDirection, uSkyParams.x);
  vec2 brdf = wovEnvBrdf(nDotV, roughness);
  return (reflectance * brdf.x + vec3(brdf.y)) * sky * uSkyParams.y;
}

void main(void) {
  vec3 albedo;
  vec3 bump;
  float metallic;
  float smoothness;
  blendLayers(albedo, bump, metallic, smoothness);

  vec3 n = shadeNormal(bump);

  // One hemispheric fill and one key light: the same two createBaseScene adds.
  vec3 ambient = mix(uAmbientGround, uAmbientSky, n.y * 0.5 + 0.5);
  float key = max(dot(n, -uSunDirection), 0.0);
  vec3 direct = ambient + uSunColor * key * shadowFactor();

  // Metallic is the dial between "this layer has a colour" and "this layer
  // shows the sky". A dielectric still reflects 4 %, which is why every tile
  // carries an environment term even when no layer asked for one.
  vec3 diffuse = albedo * (1.0 - metallic);
  vec3 reflectance = mix(vec3(0.04), albedo, metallic);
  vec3 lit = diffuse * direct + environmentLight(n, reflectance, smoothness);

  float distanceToCamera = length(cameraPosition - vPositionW);
  float fog = clamp((uFogRange.y - distanceToCamera) / (uFogRange.y - uFogRange.x), 0.0, 1.0);
  fog = mix(1.0, fog, uFogRange.z);
  gl_FragColor = vec4(mix(uFogColor, lit, fog), 1.0);
}
`;
}

/**
 * `blendLayers()`: the weighted sum of everything a layer contributes.
 *
 * Colour, tilt, metallic and smoothness are blended by the **same** normalised
 * weights in one pass, because they describe the same square centimetre of
 * ground. Blending them apart would be three chances for the rock's metallic to
 * land half a metre from the rock.
 *
 * The weights are normalised: the exported maps hold one weight per layer that
 * already sums to roughly 255 across all channels, and dividing by the actual
 * sum is what keeps a tile from going dark where the paint is thin — and what
 * makes a six-layer tile with a half-empty second map correct rather than washed
 * out. Where nothing is painted at all, layer 0 stands in, because a black hole
 * in the ground is worse than a wrong-looking patch.
 */
function blendFunction(
  layerCount: number,
  splatCount: number,
  surface: TerrainSurfaceShader,
): string {
  const bumpOf = (layer: number): string => {
    const index = String(layer);
    return surface.normalMaps[layer] === true
      ? `wovLayerBump(texture2D(uLayerNormal${index}, vUv * uLayerScale${index}).rgb, ` +
          `uLayerSurface${index}.x)`
      : 'vec3(0.0, 0.0, 1.0)';
  };

  /** Everything layer 0 alone contributes, at the given indent. */
  const onlyFirstLayer = (indent: string): string[] => [
    `${indent}albedo = texture2D(uLayer0, vUv * uLayerScale0).rgb;`,
    `${indent}bump = ${bumpOf(0)};`,
    `${indent}metallic = uLayerSurface0.y;`,
    `${indent}smoothness = uLayerSurface0.z;`,
  ];

  const lines: string[] = [
    'void blendLayers(out vec3 albedo, out vec3 bump, out float metallic, out float smoothness) {',
  ];

  if (layerCount === 0) {
    lines.push(
      '  albedo = uBaseColor;',
      '  bump = vec3(0.0, 0.0, 1.0);',
      '  metallic = 0.0;',
      '  smoothness = 0.0;',
      '}',
    );
    return lines.join('\n');
  }
  if (splatCount === 0) {
    lines.push(...onlyFirstLayer('  '), '}');
    return lines.join('\n');
  }

  for (let map = 0; map < splatCount; map += 1) {
    lines.push(`  vec4 weights${String(map)} = texture2D(uSplat${String(map)}, vUv);`);
  }

  const weightOf = (layer: number): string => {
    const map = Math.floor(layer / CHANNELS_PER_SPLAT_MAP);
    const channel = CHANNELS[layer % CHANNELS_PER_SPLAT_MAP] as string;
    return `weights${String(map)}.${channel}`;
  };

  const sum = Array.from({ length: layerCount }, (_, layer) => weightOf(layer)).join(' + ');
  lines.push(`  float total = ${sum};`);
  // Unpainted ground falls back to the first layer instead of going black.
  lines.push('  if (total < 0.0001) {');
  lines.push(...onlyFirstLayer('    '));
  lines.push('    return;');
  lines.push('  }');
  lines.push('  albedo = vec3(0.0);');
  lines.push('  bump = vec3(0.0);');
  lines.push('  metallic = 0.0;');
  lines.push('  smoothness = 0.0;');
  for (let layer = 0; layer < layerCount; layer += 1) {
    const index = String(layer);
    const weight = weightOf(layer);
    lines.push(`  albedo += ${weight} * texture2D(uLayer${index}, vUv * uLayerScale${index}).rgb;`);
    lines.push(`  bump += ${weight} * ${bumpOf(layer)};`);
    lines.push(`  metallic += ${weight} * uLayerSurface${index}.y;`);
    lines.push(`  smoothness += ${weight} * uLayerSurface${index}.z;`);
  }
  lines.push('  albedo /= total;');
  lines.push('  bump /= total;');
  lines.push('  metallic /= total;');
  lines.push('  smoothness /= total;');
  lines.push('}');
  return lines.join('\n');
}

/**
 * `shadeNormal()`: the normal the lighting actually uses.
 *
 * Two steps, both of which can be a no-op. The geometric normal is the
 * interpolated vertex normal, or — with `flatNormals` — the cross product of the
 * world position's screen-space derivatives, forced into the same hemisphere as
 * the vertex normal so that no triangle comes out inside-out.
 *
 * The tangent frame is not read from the mesh, because a terrain tile does not
 * need one read: its UV **is** the tile's own x and z (`height-field.ts`), so
 * the tangent is world +x projected onto the surface and the bitangent is world
 * +z. A vertex attribute would be three floats per vertex restating that.
 */
function normalFunction(surface: TerrainSurfaceShader): string {
  const geometric = surface.flatNormals
    ? `  vec3 smoothNormal = normalize(vNormalW);
  vec3 facet = normalize(cross(dFdx(vPositionW), dFdy(vPositionW)));
  vec3 n = facet * sign(dot(facet, smoothNormal));`
    : '  vec3 n = normalize(vNormalW);';

  const tilt = surface.normalMaps.some((has) => has)
    ? `  vec3 tangent = vec3(1.0, 0.0, 0.0) - n * n.x;
  float span = length(tangent);
  tangent = span > 0.0001 ? tangent / span : vec3(0.0, 0.0, 1.0);
  vec3 bitangent = cross(tangent, n);
  return normalize(tangent * bump.x + bitangent * bump.y + n * max(bump.z, 0.0001));`
    : '  return n;';

  return `vec3 shadeNormal(vec3 bump) {
${geometric}
${tilt}
}
`;
}

/** The extra varyings, uniforms and sampler a shadow-receiving tile declares. */
function shadowDeclarations(shadows: TerrainShadowShader | undefined): string {
  if (shadows === undefined) {
    return '';
  }
  return `varying vec4 vPositionFromLight;
varying float vShadowDepth;
uniform sampler2D uShadowMap;
/** x: darkness in full shade, y: one texel in UV, z: 1 when shadows are on. */
uniform vec3 uShadowInfo;
`;
}

/**
 * `shadowFactor()`: 1 in full sun, `uShadowInfo.x` in full shade.
 *
 * A tile that receives no shadows still calls it — the function is then a
 * `return 1.0` the compiler folds away — so the one lighting line in `main` is
 * the same string in both programs and cannot drift between them.
 *
 * Outside the map the answer is 1, not darkness: beyond `shadows.distance` the
 * sun is simply unoccluded, which is the honest answer for ground the map never
 * covered and the reason the edge of the shadow distance is invisible rather
 * than a dark square.
 */
function shadowFunction(shadows: TerrainShadowShader | undefined): string {
  if (shadows === undefined) {
    return 'float shadowFactor(void) {\n  return 1.0;\n}\n';
  }

  // The caster pass writes depth into the red channel of a float target where
  // the hardware has one, and packs it across RGBA where it does not.
  const sample = shadows.float
    ? '  return texture2D(uShadowMap, uv).x;'
    : `  const vec4 bitShift = vec4(1.0 / (255.0 * 255.0 * 255.0), 1.0 / (255.0 * 255.0), 1.0 / 255.0, 1.0);
  return dot(texture2D(uShadowMap, uv), bitShift);`;

  const offsets = shadowTapOffsets(shadows.taps);
  const taps = offsets
    .map(
      ([x, y]) =>
        `  lit += step(depth, shadowDepthAt(uv + vec2(${x.toFixed(1)}, ${y.toFixed(1)}) * texel));`,
    )
    .join('\n');

  return `float shadowDepthAt(vec2 uv) {
${sample}
}

float shadowFactor(void) {
  if (uShadowInfo.z < 0.5) {
    return 1.0;
  }
  vec3 clip = vPositionFromLight.xyz / vPositionFromLight.w;
  vec2 uv = 0.5 * clip.xy + vec2(0.5);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    return 1.0;
  }
  float depth = clamp(vShadowDepth, 0.0, 1.0);
  float texel = uShadowInfo.y;
  float lit = 0.0;
${taps}
  lit /= ${offsets.length.toFixed(1)};
  return mix(uShadowInfo.x, 1.0, lit);
}
`;
}

/**
 * Where the PCF taps sit, in texels.
 *
 * Four is a rotated square rather than an axis-aligned one: the shadow of a
 * fence runs along an axis more often than not, and four taps in a diamond
 * soften it in the direction it actually needs.
 */
export function shadowTapOffsets(taps: 1 | 4 | 9): readonly (readonly [number, number])[] {
  if (taps === 1) {
    return [[0, 0]];
  }
  if (taps === 4) {
    return [
      [-0.5, -0.5],
      [0.5, -0.5],
      [-0.5, 0.5],
      [0.5, 0.5],
    ];
  }
  return [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [0, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ];
}
