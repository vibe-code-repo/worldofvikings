/**
 * Which ground layer is under a point — the splat map, asked on the CPU
 * (ADR-0053).
 *
 * A footstep has to know what it landed on, and the answer already exists: the
 * terrain shader decides it per pixel, sixty times a second, out of the splat
 * maps. This module asks the same maps the same question in the same terms, so
 * that what the player hears and what the player sees are one decision rather
 * than two that agree by accident.
 *
 * **Why not a second ray.** ADR-0014 allows the client exactly one ground
 * query. A second raycast to find the surface would be a second ground query
 * with a second set of answers, and the physics hit does not know about splat
 * weights anyway.
 *
 * **Why not `Texture.readPixels()`.** That is a GPU readback: it stalls the
 * pipeline and hands back a promise per call. The splat maps are ordinary PNGs
 * the material has already downloaded, so fetching them again is an HTTP-cache
 * hit and the cost is a decode — about a millisecond for 1024² — paid once,
 * after the models, on a worker-free but idle path.
 *
 * **Why the uv fit is measured and not assumed.** The shader samples
 * `texture2D(uSplat0, vUv)` with the height field's **own** `uv` attribute, and
 * this project does not assume a model's coordinates. So the probe reads the
 * mesh's `uv` and `position` buffers, fits `u = a + b·x` and `v = c + d·z` by
 * least squares, and then checks the fit against the vertices it came from. A
 * fit that does not hold is reported as `unmapped` and footsteps fall back to
 * the profile's default surface: a plain footstep is better than a confidently
 * wrong one.
 */

/** How many layers one splat map weights: one per colour channel. */
export const CHANNELS_PER_SPLAT_MAP = 4;

/**
 * Below this total weight the shader falls back to layer 0, and so does this.
 *
 * The same constant, for the same reason, in the same place in the arithmetic:
 * `blendFunction` in `terrain-shader.ts` compiles `if (total < 0.0001)` into
 * the GLSL, and `terrain-surface.test.ts` pins this against that generated
 * source so the two cannot drift apart silently.
 */
export const UNPAINTED_WEIGHT_TOTAL = 0.0001;

/**
 * Which layer dominates a set of splat weights.
 *
 * The shader blends all of them; a footstep cannot play 43 % gravel, so it
 * plays the loudest. Ties go to the lower layer, which is arbitrary but has to
 * be *stated* arbitrary: an unstable answer at a 50/50 boundary would flicker
 * between two banks every step.
 *
 * Unpainted ground answers layer 0, exactly as the shader draws it.
 */
export function dominantLayer(weights: readonly number[]): number {
  let total = 0;
  for (const weight of weights) {
    total += weight;
  }
  if (!(total >= UNPAINTED_WEIGHT_TOTAL)) {
    return 0;
  }
  let best = 0;
  let bestWeight = -1;
  for (const [layer, weight] of weights.entries()) {
    if (weight > bestWeight) {
      best = layer;
      bestWeight = weight;
    }
  }
  return best;
}

/** A straight line through a set of points: `output = offset + scale · input`. */
export interface AxisFit {
  readonly offset: number;
  readonly scale: number;
  /** The largest absolute error over the points it was fitted to. */
  readonly residual: number;
}

/**
 * Fits `output = offset + scale · input` by least squares, and measures how
 * badly it holds.
 *
 * The residual is the *maximum* error and not the mean, deliberately: a tile
 * whose uv is affine everywhere except along one seam has a fine mean and a
 * footstep that is wrong along that seam.
 *
 * An input that never varies — every vertex at the same x — has no line through
 * it; the fit is then the mean output with a scale of zero and an infinite
 * residual, so a caller checking the residual rejects it rather than dividing
 * by zero.
 */
export function fitAxis(inputs: readonly number[], outputs: readonly number[]): AxisFit {
  const count = Math.min(inputs.length, outputs.length);
  if (count < 2) {
    return { offset: outputs[0] ?? 0, scale: 0, residual: Number.POSITIVE_INFINITY };
  }
  let sumIn = 0;
  let sumOut = 0;
  for (let index = 0; index < count; index += 1) {
    sumIn += inputs[index] as number;
    sumOut += outputs[index] as number;
  }
  const meanIn = sumIn / count;
  const meanOut = sumOut / count;

  let covariance = 0;
  let variance = 0;
  for (let index = 0; index < count; index += 1) {
    const dx = (inputs[index] as number) - meanIn;
    covariance += dx * ((outputs[index] as number) - meanOut);
    variance += dx * dx;
  }
  if (variance <= 0) {
    return { offset: meanOut, scale: 0, residual: Number.POSITIVE_INFINITY };
  }
  const scale = covariance / variance;
  const offset = meanOut - scale * meanIn;

  let residual = 0;
  for (let index = 0; index < count; index += 1) {
    const error = Math.abs(offset + scale * (inputs[index] as number) - (outputs[index] as number));
    residual = Math.max(residual, error);
  }
  return { offset, scale, residual };
}

/** How far a fitted uv may be off before the probe refuses to answer. */
export const UV_FIT_TOLERANCE = 0.01;

/** The two fits that turn a local `(x, z)` into the tile's own `uv`. */
export interface TileUvFit {
  readonly u: AxisFit;
  readonly v: AxisFit;
  /** Whether both fits hold to within {@link UV_FIT_TOLERANCE}. */
  readonly usable: boolean;
}

/**
 * Fits the height field's uv attribute against its own positions.
 *
 * @param positions flat `x, y, z` triples in the mesh's local space.
 * @param uvs flat `u, v` pairs, one per vertex.
 * @param tolerance the largest error either fit may have and still be used.
 */
export function fitTileUv(
  positions: ArrayLike<number>,
  uvs: ArrayLike<number>,
  tolerance: number = UV_FIT_TOLERANCE,
): TileUvFit {
  const count = Math.min(Math.floor(positions.length / 3), Math.floor(uvs.length / 2));
  const xs: number[] = [];
  const zs: number[] = [];
  const us: number[] = [];
  const vs: number[] = [];
  for (let vertex = 0; vertex < count; vertex += 1) {
    xs.push(positions[vertex * 3] as number);
    zs.push(positions[vertex * 3 + 2] as number);
    us.push(uvs[vertex * 2] as number);
    vs.push(uvs[vertex * 2 + 1] as number);
  }
  const u = fitAxis(xs, us);
  const v = fitAxis(zs, vs);
  return { u, v, usable: u.residual <= tolerance && v.residual <= tolerance };
}

/** One decoded splat map: its pixels and how large it is. */
export interface SplatImage {
  readonly width: number;
  readonly height: number;
  /** RGBA bytes, row-major from the top, exactly as `getImageData` gives them. */
  readonly data: Uint8ClampedArray | Uint8Array;
}

/**
 * The weights of every layer at one `uv`, in the shader's own channel order.
 *
 * Nearest-texel, not bilinear: this feeds an argmax, and interpolating four
 * texels before taking the largest of six sums changes nothing a footstep can
 * hear while costing four times the reads.
 *
 * `v` is flipped, because a texture's `v` runs up from the bottom and image
 * rows run down from the top — the one conversion between "how the GPU reads
 * this image" and "how `getImageData` hands it over".
 */
export function splatWeightsAt(
  maps: readonly SplatImage[],
  u: number,
  v: number,
  layerCount: number,
): number[] {
  const weights: number[] = [];
  for (let layer = 0; layer < layerCount; layer += 1) {
    const mapIndex = Math.floor(layer / CHANNELS_PER_SPLAT_MAP);
    const map = maps[mapIndex];
    if (map === undefined) {
      weights.push(0);
      continue;
    }
    const x = clampTexel(u, map.width);
    const y = clampTexel(1 - v, map.height);
    const offset = (y * map.width + x) * 4 + (layer % CHANNELS_PER_SPLAT_MAP);
    weights.push((map.data[offset] ?? 0) / 255);
  }
  return weights;
}

function clampTexel(coordinate: number, size: number): number {
  const wrapped = coordinate - Math.floor(coordinate);
  const texel = Math.floor(wrapped * size);
  return texel < 0 ? 0 : texel >= size ? size - 1 : texel;
}

/** How a probe turns a world point into a local one. */
export type WorldToLocal = (x: number, z: number) => readonly [number, number];

/** What a {@link createTerrainSurfaceProbe} answers. */
export interface TerrainSurfaceProbe {
  /** Whether the probe can answer at all. */
  readonly usable: boolean;
  /** One line saying why, for the readout. */
  readonly status: string;
  /** The dominant layer under a world `(x, z)`, or `null` if it cannot say. */
  layerAt(x: number, z: number): number | null;
}

/** Everything {@link createTerrainSurfaceProbe} needs, with no Babylon in it. */
export interface TerrainSurfaceProbeOptions {
  readonly maps: readonly SplatImage[];
  readonly fit: TileUvFit;
  readonly layerCount: number;
  /** Maps world `(x, z)` onto the mesh's local `(x, z)`. */
  readonly worldToLocal: WorldToLocal;
}

/** Ties a fitted tile and its decoded splat maps into one question. */
export function createTerrainSurfaceProbe(
  options: TerrainSurfaceProbeOptions,
): TerrainSurfaceProbe {
  const { maps, fit, layerCount, worldToLocal } = options;
  const usable = fit.usable && maps.length > 0 && layerCount > 0;
  const status = usable
    ? `${String(layerCount)} layers from ${String(maps.length)} splat map(s), ` +
      `uv fit ±${fit.u.residual.toExponential(1)}`
    : maps.length === 0
      ? 'unmapped — no splat map decoded'
      : `unmapped — uv fit off by ${Math.max(fit.u.residual, fit.v.residual).toFixed(3)}`;

  return {
    usable,
    status,
    layerAt(x, z) {
      if (!usable) {
        return null;
      }
      const [localX, localZ] = worldToLocal(x, z);
      const u = fit.u.offset + fit.u.scale * localX;
      const v = fit.v.offset + fit.v.scale * localZ;
      if (u < 0 || u > 1 || v < 0 || v > 1) {
        // Off the tile. Not an error — a player can stand beside the ground the
        // splat describes — but not something to answer with a wrapped texel.
        return null;
      }
      return dominantLayer(splatWeightsAt(maps, u, v, layerCount));
    },
  };
}

/**
 * Downloads and decodes one splat map into pixels a probe can read.
 *
 * The same URL the terrain material already loaded, so this is normally an
 * HTTP-cache hit. `OffscreenCanvas` where there is one, a detached `<canvas>`
 * where there is not; a browser with neither has no probe and says so rather
 * than throwing into the loading path.
 */
export async function decodeSplatImage(url: string): Promise<SplatImage> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`splat map ${url} answered ${String(response.status)}`);
  }
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const context = surfaceContext(bitmap.width, bitmap.height);
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width: pixels.width, height: pixels.height, data: pixels.data };
  } finally {
    bitmap.close();
  }
}

function surfaceContext(width: number, height: number): CanvasRenderingContext2D {
  if (typeof OffscreenCanvas === 'function') {
    const context = new OffscreenCanvas(width, height).getContext('2d');
    if (context !== null) {
      return context as unknown as CanvasRenderingContext2D;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('splat probe: this browser gave no 2d canvas to decode into');
  }
  return context;
}
