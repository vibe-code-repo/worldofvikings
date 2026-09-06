import { describe, expect, it } from 'vitest';
import { readGlb, worldBounds, writeGlb } from './glb.js';
import {
  buildHeightFieldGlb,
  gridBounds,
  gridIndices,
  gridNormals,
  gridPositions,
  gridSize,
  gridUvs,
  heightAt,
  readHeightGrid,
  thinGrid,
  type HeightGrid,
} from './height-field.js';

/** A grid whose height is a known function of the cell, for exact assertions. */
function grid(columns: number, rows: number, height: (c: number, r: number) => number): HeightGrid {
  const heights = new Float32Array(columns * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      heights[row * columns + column] = height(column, row);
    }
  }
  return { columns, rows, originX: 0, originZ: 0, stepX: 1, stepZ: 1, heights };
}

describe('gridBounds / gridSize', () => {
  it('measures the tile from its own step and extent, not from an assumption', () => {
    const tile: HeightGrid = {
      ...grid(5, 3, (c) => c),
      originX: 10,
      originZ: -4,
      stepX: 2,
      stepZ: 0.5,
    };
    expect(gridSize(tile)).toEqual([8, 1]);
    expect(gridBounds(tile)).toEqual({ min: [10, 0, -4], max: [18, 4, -3] });
  });
});

describe('thinGrid', () => {
  it('turns 513 columns into 257 and keeps both edges', () => {
    const thinned = thinGrid(
      grid(513, 513, (c) => c),
      2,
    );
    expect(thinned.columns).toBe(257);
    expect(thinned.rows).toBe(257);
    expect(thinned.stepX).toBe(2);
    // The last kept column is the source's last column, not one short of it.
    expect(thinned.heights[256]).toBe(512);
  });

  it('samples the source heights instead of averaging them', () => {
    const thinned = thinGrid(
      grid(5, 5, (c, r) => c * 10 + r),
      2,
    );
    expect([...thinned.heights.slice(0, 3)]).toEqual([0, 20, 40]);
  });

  it('refuses a factor that would drop the far edge', () => {
    expect(() =>
      thinGrid(
        grid(6, 6, () => 0),
        2,
      ),
    ).toThrow(/far edge/);
  });

  it('refuses a factor that is not a positive integer', () => {
    expect(() =>
      thinGrid(
        grid(5, 5, () => 0),
        0,
      ),
    ).toThrow(/positive integer/);
    expect(() =>
      thinGrid(
        grid(5, 5, () => 0),
        1.5,
      ),
    ).toThrow(/positive integer/);
  });

  it('returns the grid unchanged at factor 1', () => {
    const flat = grid(5, 5, () => 3);
    expect(thinGrid(flat, 1)).toBe(flat);
  });
});

describe('gridNormals', () => {
  it('points straight up on flat ground', () => {
    const normals = gridNormals(grid(4, 4, () => 7));
    for (let index = 0; index < normals.length; index += 3) {
      expect(normals[index]).toBeCloseTo(0, 6);
      expect(normals[index + 1]).toBeCloseTo(1, 6);
      expect(normals[index + 2]).toBeCloseTo(0, 6);
    }
  });

  it('tilts away from the rise on a constant slope, with unit length', () => {
    // Height rises 1 m per metre of x: the normal is (-1, 1, 0) normalised.
    const normals = gridNormals(grid(4, 4, (c) => c));
    const middle = (1 * 4 + 1) * 3;
    const [x = 0, y = 0, z = 0] = [
      normals[middle] ?? 0,
      normals[middle + 1] ?? 0,
      normals[middle + 2] ?? 0,
    ];
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
    expect(x).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(y).toBeCloseTo(Math.SQRT1_2, 6);
    expect(z).toBeCloseTo(0, 6);
  });
});

describe('gridIndices', () => {
  it('emits two triangles per cell', () => {
    expect(gridIndices(grid(3, 3, () => 0)).length).toBe(2 * 2 * 6);
  });

  it('winds every triangle so its face normal points up, matching gridNormals', () => {
    const tile = grid(4, 4, (c, r) => c * 0.3 + r * 0.1);
    const positions = gridPositions(tile);
    const indices = gridIndices(tile);
    const point = (index: number): [number, number, number] => [
      positions[index * 3] ?? 0,
      positions[index * 3 + 1] ?? 0,
      positions[index * 3 + 2] ?? 0,
    ];

    for (let triangle = 0; triangle < indices.length; triangle += 3) {
      const [ax, , az] = point(indices[triangle] ?? 0);
      const [bx, , bz] = point(indices[triangle + 1] ?? 0);
      const [cx, , cz] = point(indices[triangle + 2] ?? 0);
      // The y component of the edge cross product, in the file's right-handed
      // space: positive means the front face looks up.
      expect((bz - az) * (cx - ax) - (bx - ax) * (cz - az)).toBeGreaterThan(0);
    }
  });
});

describe('gridUvs', () => {
  it('spans the tile exactly once, so tiling stays the world file’s business', () => {
    const uvs = gridUvs(grid(3, 3, () => 0));
    expect([...uvs.slice(0, 2)]).toEqual([0, 0]);
    expect([...uvs.slice(-2)]).toEqual([1, 1]);
  });
});

describe('buildHeightFieldGlb / readHeightGrid', () => {
  const source = grid(5, 5, (c, r) => c + r * 0.5);

  it('writes a GLB that reads back as the same grid', () => {
    const bytes = writeGlb(buildHeightFieldGlb('tile', source));
    const back = readHeightGrid(readGlb(bytes), 'tile');
    expect(back.columns).toBe(5);
    expect(back.rows).toBe(5);
    expect(back.stepX).toBeCloseTo(1, 6);
    expect([...back.heights]).toEqual([...source.heights]);
  });

  it('is deterministic: the same grid produces the same bytes', () => {
    const first = writeGlb(buildHeightFieldGlb('tile', source));
    const second = writeGlb(buildHeightFieldGlb('tile', source));
    expect(first.equals(second)).toBe(true);
  });

  it('records a hull the container reader agrees with', () => {
    const glb = buildHeightFieldGlb('tile', source);
    expect(worldBounds(glb.json, 'tile')).toEqual({ min: [0, 0, 0], max: [4, 6, 4] });
  });

  it('keeps the tile where the export put it instead of centring it', () => {
    const offset: HeightGrid = { ...source, originX: 0, originZ: 0 };
    const glb = buildHeightFieldGlb('tile', offset);
    expect(glb.json.nodes?.[0]?.translation).toBeUndefined();
    expect(glb.json.accessors?.[0]?.min?.[0]).toBe(0);
  });

  it('refuses a model whose vertices are not a full grid', () => {
    const glb = buildHeightFieldGlb('tile', source);
    // Claim one vertex fewer than the file holds: the grid no longer adds up.
    const accessor = glb.json.accessors?.[0];
    if (accessor) {
      accessor.count -= 1;
    }
    expect(() => readHeightGrid(readGlb(writeGlb(glb)), 'tile')).toThrow(/not a 5 x 5 grid/);
  });
});

describe('heightAt', () => {
  /** A 3 x 2 grid, 2 m apart, whose height is simply `x`. */
  const ramp: HeightGrid = {
    columns: 3,
    rows: 2,
    originX: 10,
    originZ: 100,
    stepX: 2,
    stepZ: 2,
    heights: Float32Array.from([10, 12, 14, 10, 12, 14]),
  };

  it('returns the vertex height at a vertex', () => {
    expect(heightAt(ramp, 10, 100)).toBeCloseTo(10, 6);
    expect(heightAt(ramp, 14, 102)).toBeCloseTo(14, 6);
  });

  it('interpolates inside a cell instead of snapping to a vertex', () => {
    expect(heightAt(ramp, 11, 100)).toBeCloseTo(11, 6);
    expect(heightAt(ramp, 13.5, 101)).toBeCloseTo(13.5, 6);
  });

  it('interpolates across both axes', () => {
    const saddle: HeightGrid = { ...ramp, heights: Float32Array.from([0, 0, 0, 4, 4, 4]) };
    expect(heightAt(saddle, 11, 101)).toBeCloseTo(2, 6);
  });

  it('clamps to the edge rather than refusing a point off the tile', () => {
    expect(heightAt(ramp, -100, 100)).toBeCloseTo(10, 6);
    expect(heightAt(ramp, 1000, 100)).toBeCloseTo(14, 6);
  });

  it('answers the origin height for a value that is not a number', () => {
    expect(heightAt(ramp, Number.NaN, 100)).toBeCloseTo(10, 6);
  });
});
