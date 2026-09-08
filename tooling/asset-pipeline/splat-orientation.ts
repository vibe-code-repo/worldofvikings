/**
 * The check that would have caught a control map lying on the ground the wrong
 * way round (ADR-0043).
 *
 * A splat map and a height field are both square, both 512-ish, and neither
 * says which way up it is. Turned wrongly, the paint still follows *something*
 * — it is the same landscape, mirrored — so nothing looks broken and nothing
 * fails. ADR-0020 measured the right turn and the pipeline shipped one that was
 * a vertical flip short of it, and that survived two ADRs and a release of the
 * village.
 *
 * What separates the eight placements is not the picture but the correlation
 * between the *rarest* channel and the terrain's own steepness. A channel that
 * covers a seventh of a percent of a tile and sits at 73° mean slope can only be
 * a cliff face; if the map is on the ground correctly it lands on the cliffs,
 * and if it is not it lands on ground of ordinary steepness. So:
 *
 * > the weighted mean gradient under the cliff channel must exceed the tile's
 * > own 95th percentile.
 *
 * On the village tile that is 4.28 against 3.93 for the map the store ships and
 * 0.96 against 3.93 for the map it shipped before — a margin wide enough that
 * the assertion is a statement about the world and not about a threshold.
 *
 * Free of file access on purpose: `validate-assets.ts` reads the bytes,
 * `splat-orientation.test.ts` builds a ridge and paints it by hand, and both ask
 * the same function.
 */
import type { HeightGrid } from './height-field.js';
import type { RawImage } from './png.js';

/**
 * The share of the tile the cliff channel has to stand above.
 *
 * The 95th percentile rather than the 99th: the 99th is where the answer
 * actually sits, and a check should have room between "correct" and "failing"
 * so that a re-import of a slightly different height field does not turn red
 * for a rounding difference.
 */
export const CLIFF_GRADIENT_PERCENTILE = 0.95;

/** What {@link measureChannelSlope} found. */
export interface ChannelSlope {
  /** Mean terrain gradient under the channel, weighted by its own weight. */
  readonly channelGradient: number;
  /** Mean gradient over the whole tile, for scale. */
  readonly tileGradient: number;
  /** The tile's gradient at {@link CLIFF_GRADIENT_PERCENTILE}. */
  readonly tilePercentile: number;
  /** Share of the tile's texels the channel carries any weight on. */
  readonly coverage: number;
}

/** Gradient (rise over run, not degrees) of the steeper triangle of one cell. */
function cellGradient(grid: HeightGrid, column: number, row: number): number {
  const c = Math.min(Math.max(column, 0), grid.columns - 2);
  const r = Math.min(Math.max(row, 0), grid.rows - 2);
  const at = (cc: number, rr: number): number => grid.heights[rr * grid.columns + cc] ?? 0;
  const h00 = at(c, r);
  const h10 = at(c + 1, r);
  const h01 = at(c, r + 1);
  const h11 = at(c + 1, r + 1);
  const first = Math.hypot((h10 - h00) / grid.stepX, (h01 - h00) / grid.stepZ);
  const second = Math.hypot((h11 - h01) / grid.stepX, (h11 - h10) / grid.stepZ);
  return Math.max(first, second);
}

/**
 * How steep the ground is under one channel of a control map, against the tile.
 *
 * The map is read the way the renderer reads it: texel column to the tile's u,
 * texel row to its v, and the tile's UV is its own x and z
 * (`gridUvs` in `height-field.ts`, `createTerrainMaterial` binding the map with
 * `invertY = false`). So a map that passes here is a map the shader samples
 * correctly — the check and the renderer share one convention, which is the
 * whole point of checking the stored bytes rather than a flag somewhere.
 *
 * @throws when the channel is not in the image.
 */
export function measureChannelSlope(
  grid: HeightGrid,
  map: RawImage,
  channel: number,
): ChannelSlope {
  if (!Number.isInteger(channel) || channel < 0 || channel >= map.channels) {
    throw new Error(
      `splat orientation: channel ${String(channel)} is not in a ${String(map.channels)}-channel map`,
    );
  }

  const gradients: number[] = [];
  let weightSum = 0;
  let weightedGradient = 0;
  let painted = 0;

  for (let row = 0; row < map.height; row += 1) {
    const gridRow = Math.round((row / (map.height - 1)) * (grid.rows - 1));
    for (let column = 0; column < map.width; column += 1) {
      const gridColumn = Math.round((column / (map.width - 1)) * (grid.columns - 1));
      const gradient = cellGradient(grid, gridColumn, gridRow);
      gradients.push(gradient);
      const weight = (map.data[(row * map.width + column) * map.channels + channel] ?? 0) / 255;
      if (weight <= 0) {
        continue;
      }
      painted += 1;
      weightSum += weight;
      weightedGradient += weight * gradient;
    }
  }

  gradients.sort((a, b) => a - b);
  const index = Math.min(
    gradients.length - 1,
    Math.floor(gradients.length * CLIFF_GRADIENT_PERCENTILE),
  );
  return {
    channelGradient: weightSum === 0 ? 0 : weightedGradient / weightSum,
    tileGradient: gradients.reduce((sum, value) => sum + value, 0) / gradients.length,
    tilePercentile: gradients[index] ?? 0,
    coverage: painted / gradients.length,
  };
}

/** True when the cliff channel is on the cliffs, i.e. the map is turned right. */
export function isSplatOrientationCorrect(measured: ChannelSlope): boolean {
  return measured.channelGradient > measured.tilePercentile;
}
