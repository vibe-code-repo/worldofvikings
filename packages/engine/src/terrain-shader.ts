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
  ];
  if (shadows) {
    uniforms.push('uShadowMatrix', 'uShadowDepthValues', 'uShadowInfo');
  }
  for (let layer = 0; layer < layerCount; layer += 1) {
    uniforms.push(`uLayerScale${String(layer)}`);
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
): string[] {
  const samplers: string[] = [];
  for (let map = 0; map < splatCount; map += 1) {
    samplers.push(`uSplat${String(map)}`);
  }
  for (let layer = 0; layer < layerCount; layer += 1) {
    samplers.push(`uLayer${String(layer)}`);
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

  if (shadows !== undefined && ![1, 4, 9].includes(shadows.taps)) {
    throw new Error(`terrain: shadow taps must be 1, 4 or 9, got ${String(shadows.taps)}`);
  }
  if (shadows !== undefined && (!Number.isFinite(shadows.mapSize) || shadows.mapSize <= 0)) {
    throw new Error(`terrain: shadow mapSize must be positive, got ${String(shadows.mapSize)}`);
  }

  const declarations: string[] = [];
  for (let map = 0; map < splatCount; map += 1) {
    declarations.push(`uniform sampler2D uSplat${String(map)};`);
  }
  for (let layer = 0; layer < layerCount; layer += 1) {
    declarations.push(`uniform sampler2D uLayer${String(layer)};`);
    declarations.push(`uniform vec2 uLayerScale${String(layer)};`);
  }

  return `precision highp float;

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
${declarations.join('\n')}
${shadowDeclarations(shadows)}
vec3 albedo(void) {
${albedoBody(layerCount, splatCount)}
}
${shadowFunction(shadows)}
void main(void) {
  vec3 surface = albedo();
  vec3 n = normalize(vNormalW);

  // One hemispheric fill and one key light: the same two createBaseScene adds.
  vec3 ambient = mix(uAmbientGround, uAmbientSky, n.y * 0.5 + 0.5);
  float key = max(dot(n, -uSunDirection), 0.0);
  vec3 lit = surface * (ambient + uSunColor * key * shadowFactor());

  float distanceToCamera = length(cameraPosition - vPositionW);
  float fog = clamp((uFogRange.y - distanceToCamera) / (uFogRange.y - uFogRange.x), 0.0, 1.0);
  fog = mix(1.0, fog, uFogRange.z);
  gl_FragColor = vec4(mix(uFogColor, lit, fog), 1.0);
}
`;
}

function albedoBody(layerCount: number, splatCount: number): string {
  if (layerCount === 0) {
    return '  return uBaseColor;';
  }
  if (splatCount === 0) {
    return '  return texture2D(uLayer0, vUv * uLayerScale0).rgb;';
  }

  const lines: string[] = [];
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
  lines.push('  vec3 blended = vec3(0.0);');
  for (let layer = 0; layer < layerCount; layer += 1) {
    lines.push(
      `  blended += ${weightOf(layer)} * ` +
        `texture2D(uLayer${String(layer)}, vUv * uLayerScale${String(layer)}).rgb;`,
    );
  }
  // Unpainted ground falls back to the first layer instead of going black.
  lines.push('  if (total < 0.0001) {');
  lines.push('    return texture2D(uLayer0, vUv * uLayerScale0).rgb;');
  lines.push('  }');
  lines.push('  return blended / total;');
  return lines.join('\n');
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
