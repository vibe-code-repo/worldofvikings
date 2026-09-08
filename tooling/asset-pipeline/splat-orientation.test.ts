import { describe, expect, it } from 'vitest';
import type { HeightGrid } from './height-field.js';
import { rotateQuarterTurn, type RawImage } from './png.js';
import {
  isSplatOrientationCorrect,
  measureChannelSlope,
  CLIFF_GRADIENT_PERCENTILE,
} from './splat-orientation.js';

/**
 * A tile whose steepness grows with the row and does not depend on the column.
 *
 * A cubic ramp rather than a wall: the check compares one channel against the
 * tile's own 95th percentile, so the fixture needs a *distribution* of
 * steepness with a small very steep part at one end — which is what a landscape
 * with a few cliffs in it has. Flat in the columns so that a quarter turn moves
 * the paint from the steep end onto ground of every steepness, which is exactly
 * what the wrong turn did to the village.
 */
function ramp(size: number): HeightGrid {
  const heights = new Float32Array(size * size);
  for (let row = 0; row < size; row += 1) {
    const height = (row / (size - 1)) ** 3 * 100;
    for (let column = 0; column < size; column += 1) {
      heights[row * size + column] = height;
    }
  }
  return { columns: size, rows: size, originX: 0, originZ: 0, stepX: 1, stepZ: 1, heights };
}

/** A one-channel control map with `weight` painted on the rows given. */
function paint(size: number, rows: readonly number[], weight = 255): RawImage {
  const data = Buffer.alloc(size * size);
  for (const row of rows) {
    data.fill(weight, row * size, (row + 1) * size);
  }
  return { width: size, height: size, channels: 1, data };
}

describe('measureChannelSlope', () => {
  it('finds the cliff when the channel is painted on it', () => {
    const grid = ramp(64);
    // The last row is the steepest ground the tile has, and only 1.6 % of it.
    const measured = measureChannelSlope(grid, paint(64, [63]), 0);

    expect(measured.channelGradient).toBeGreaterThan(measured.tilePercentile);
    expect(isSplatOrientationCorrect(measured)).toBe(true);
  });

  it('does not find it when the map is turned the wrong way', () => {
    const grid = ramp(64);
    // A quarter turn takes that row to a column, which crosses every steepness
    // the tile has — so the channel lands on average ground, not on the cliff.
    const measured = measureChannelSlope(grid, rotateQuarterTurn(paint(64, [63])), 0);

    expect(measured.channelGradient).toBeLessThan(measured.tilePercentile);
    expect(isSplatOrientationCorrect(measured)).toBe(false);
  });

  it('reports the tile as well as the channel, so a failure can be read', () => {
    const grid = ramp(16);
    const measured = measureChannelSlope(grid, paint(16, [14, 15]), 0);

    expect(measured.tileGradient).toBeGreaterThan(0);
    expect(measured.coverage).toBeCloseTo(2 / 16, 5);
    expect(CLIFF_GRADIENT_PERCENTILE).toBeGreaterThan(0.5);
  });

  it('answers 0 for a channel nobody painted rather than dividing by nothing', () => {
    const measured = measureChannelSlope(ramp(8), paint(8, []), 0);
    expect(measured.channelGradient).toBe(0);
  });

  it('refuses a channel the map does not have', () => {
    expect(() => measureChannelSlope(ramp(8), paint(8, [3]), 2)).toThrow(/channel 2/);
  });
});
