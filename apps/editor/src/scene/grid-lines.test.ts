import { describe, expect, it } from 'vitest';
import { gridGeometry } from './grid-lines.js';

describe('gridGeometry', () => {
  it('draws both directions for every line but the centre', () => {
    const grid = gridGeometry({ extent: 3, step: 1, majorEvery: 10 });

    // 3 steps either side, centre excluded → 6 offsets, two lines each.
    expect(grid.minor).toHaveLength(12);
    expect(grid.major).toHaveLength(0);
  });

  it('promotes every n-th line to a major line and keeps the axes separate', () => {
    const grid = gridGeometry({ extent: 10, step: 1, majorEvery: 5 });

    // ±5 and ±10 are major: four offsets, two lines each.
    expect(grid.major).toHaveLength(8);
    expect(grid.minor).toHaveLength(2 * (20 - 4));
    expect(grid.axes[0]).toEqual([
      [-10, 0, 0],
      [10, 0, 0],
    ]);
    expect(grid.axes[1]).toEqual([
      [0, 0, -10],
      [0, 0, 10],
    ]);
  });

  it('stays symmetric when the extent is not a multiple of the step', () => {
    const grid = gridGeometry({ extent: 2.5, step: 1, majorEvery: 10 });

    // Reach is clipped to the last whole step, so the grid stays square and
    // centred rather than growing a lopsided fringe on one side.
    const coordinates = [...grid.minor, ...grid.axes].flatMap(([start, end]) => [
      start[0],
      start[2],
      end[0],
      end[2],
    ]);
    expect(Math.max(...coordinates)).toBe(2);
    expect(Math.min(...coordinates)).toBe(-2);
  });

  it('never puts a line at the origin, which the axes already cover', () => {
    const grid = gridGeometry({ extent: 4, step: 1, majorEvery: 2 });

    for (const [start] of [...grid.minor, ...grid.major]) {
      expect(start[0] === 0 && start[2] === 0).toBe(false);
    }
  });

  it('refuses a step or extent that would produce no grid', () => {
    expect(() => gridGeometry({ step: 0 })).toThrow(/step/);
    expect(() => gridGeometry({ extent: 0 })).toThrow(/extent/);
    expect(() => gridGeometry({ majorEvery: 0 })).toThrow(/majorEvery/);
  });
});
