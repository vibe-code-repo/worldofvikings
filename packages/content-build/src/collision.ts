/**
 * Measuring the collision box of a thing whose hull is the wrong box.
 *
 * There is exactly one such thing so far and it is the reason this module
 * exists: a tree. A pine's hull is 6.8 m across because its crown is, and a
 * wood of hull boxes is a wall the player cannot walk into. What stops the
 * player is the **trunk**, which on the same model is 1.0 m across — measured,
 * not guessed, because the ratio between the two is different for every tree
 * (ADR-0026).
 *
 * Pure arithmetic over a flat `x, y, z` list on purpose: the numbers it
 * produces end up committed in `content/prefabs/imported.json`, so they have to
 * be reproducible from the same file on any machine, and they have to be
 * testable without a GLB.
 */
import type { Bounds } from './glb.js';

export interface TrunkOptions {
  /**
   * How much of the model's height counts as "at the foot", as a fraction.
   *
   * Small enough that the lowest branches of a spruce are above it, large
   * enough that a model whose foot is one ring of vertices still has a band to
   * measure. Both are properties of the models, not of trees in general, which
   * is why the number is here and not in a formula.
   */
  readonly bandFraction?: number;
  /** Lower bound for that band in metres, for a short or a squashed model. */
  readonly minimumBand?: number;
  /**
   * The share of the band's vertices the box must cover, per axis.
   *
   * Not all of them: a root flare or a single stray leaf card at ankle height
   * would otherwise set the width of the whole trunk. Missing the outermost
   * few per cent of a root costs nothing — the player walks over roots.
   */
  readonly coverage?: number;
  /** Never report a trunk thinner than this half-width, in metres. */
  readonly minimumRadius?: number;
}

const DEFAULTS = {
  bandFraction: 0.06,
  minimumBand: 0.3,
  coverage: 0.9,
  minimumRadius: 0.05,
} as const;

/**
 * The narrow, upright box a tree is collided against.
 *
 * The box spans the model's full height and the trunk's measured width. Full
 * height because a trunk that stops at head height is a thing the camera flies
 * through, and because a box costs the same whatever its height.
 *
 * @param positions flat `x, y, z` world-space vertices of the model.
 * @returns the box in the model file's own space, or `undefined` when there is
 * nothing to measure — a caller then falls back to a shape it can justify
 * rather than to a box of size zero.
 */
export function measureTrunkBox(
  positions: Float32Array | readonly number[],
  options: TrunkOptions = {},
): Bounds | undefined {
  const bandFraction = options.bandFraction ?? DEFAULTS.bandFraction;
  const minimumBand = options.minimumBand ?? DEFAULTS.minimumBand;
  const coverage = options.coverage ?? DEFAULTS.coverage;
  const minimumRadius = options.minimumRadius ?? DEFAULTS.minimumRadius;

  const count = Math.floor(positions.length / 3);
  if (count === 0) {
    return undefined;
  }

  let lowest = Infinity;
  let highest = -Infinity;
  for (let index = 0; index < count; index += 1) {
    const y = positions[index * 3 + 1] ?? 0;
    lowest = Math.min(lowest, y);
    highest = Math.max(highest, y);
  }
  if (!Number.isFinite(lowest) || !Number.isFinite(highest)) {
    return undefined;
  }

  const bandTop = lowest + Math.max(minimumBand, (highest - lowest) * bandFraction);
  const xs: number[] = [];
  const zs: number[] = [];
  for (let index = 0; index < count; index += 1) {
    if ((positions[index * 3 + 1] ?? 0) <= bandTop) {
      xs.push(positions[index * 3] ?? 0);
      zs.push(positions[index * 3 + 2] ?? 0);
    }
  }
  if (xs.length === 0) {
    return undefined;
  }

  // Per axis, not as a radius around a centre: the result is a *box*, and the
  // circle through the corners of a square trunk is 41 % wider than the trunk.
  const [minX, maxX] = spanOf(xs, coverage, minimumRadius);
  const [minZ, maxZ] = spanOf(zs, coverage, minimumRadius);

  return { min: [minX, lowest, minZ], max: [maxX, highest, maxZ] };
}

/**
 * The half-width of one axis of the trunk, around the middle of the band.
 *
 * The middle is the midpoint between the 10th and the 90th percentile rather
 * than the mean or the extent: a leaning tree's foot is where its foot is, and
 * one root reaching out on one side must not drag the whole trunk sideways.
 */
function spanOf(
  values: readonly number[],
  coverage: number,
  minimumHalfWidth: number,
): [number, number] {
  const center = (quantile(values, 0.1) + quantile(values, 0.9)) / 2;
  const halfWidth = Math.max(
    minimumHalfWidth,
    quantile(
      values.map((value) => Math.abs(value - center)),
      coverage,
    ),
  );
  return [center - halfWidth, center + halfWidth];
}

/** Rounds a measured box to millimetres, so a regenerated file is stable. */
export function roundBounds(bounds: Bounds, digits = 4): Bounds {
  const round = (value: number): number => Number(value.toFixed(digits));
  return {
    min: [round(bounds.min[0]), round(bounds.min[1]), round(bounds.min[2])],
    max: [round(bounds.max[0]), round(bounds.max[1]), round(bounds.max[2])],
  };
}

/**
 * The value at `fraction` of the sorted list, by nearest rank.
 *
 * Nearest rank rather than interpolation: the result is committed data, and a
 * value that is one of the model's own coordinates is one a contributor can
 * find in the file again.
 */
function quantile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor(fraction * (sorted.length - 1)));
  return sorted[index] ?? 0;
}
