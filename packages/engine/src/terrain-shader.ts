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
 * The uniforms Babylon fills in by name, plus the ones the material binds.
 *
 * `world`, `worldViewProjection` and `cameraPosition` are Babylon's own
 * built-ins for a `ShaderMaterial`; the rest are set from the scene's lights and
 * fog when the material binds, so the tile is lit by the same sun as everything
 * else instead of by a second, hard-coded one.
 */
export function terrainUniformNames(layerCount: number): string[] {
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
export function terrainSamplerNames(layerCount: number, splatCount: number): string[] {
  const samplers: string[] = [];
  for (let map = 0; map < splatCount; map += 1) {
    samplers.push(`uSplat${String(map)}`);
  }
  for (let layer = 0; layer < layerCount; layer += 1) {
    samplers.push(`uLayer${String(layer)}`);
  }
  return samplers;
}

/** The vertex program: world position, world normal and the tile's own UV. */
export const TERRAIN_VERTEX_SOURCE = `precision highp float;

attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;

uniform mat4 world;
uniform mat4 worldViewProjection;

varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPositionW;

void main(void) {
  vec4 worldPosition = world * vec4(position, 1.0);
  vPositionW = worldPosition.xyz;
  // mat3(world) is enough here: a terrain tile is placed with a translation and
  // at most a mirror, never with a non-uniform scale, so the inverse transpose
  // would only differ by a length this normalises away anyway.
  vNormalW = normalize(mat3(world) * normal);
  vUv = uv;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

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
export function terrainFragmentSource(layerCount: number, splatCount: number): string {
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

vec3 albedo(void) {
${albedoBody(layerCount, splatCount)}
}

void main(void) {
  vec3 surface = albedo();
  vec3 n = normalize(vNormalW);

  // One hemispheric fill and one key light: the same two createBaseScene adds.
  vec3 ambient = mix(uAmbientGround, uAmbientSky, n.y * 0.5 + 0.5);
  float key = max(dot(n, -uSunDirection), 0.0);
  vec3 lit = surface * (ambient + uSunColor * key);

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
