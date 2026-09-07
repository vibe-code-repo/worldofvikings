import { describe, expect, it } from 'vitest';
import { compose, readGlb, writeGlb, type Matrix4 } from '@wov/content-build';
import { buildHeightFieldGlb, type HeightGrid } from './height-field.js';
import { modelPoints, readTriangleField, seatingOf, surfaceUnder, transform } from './seating.js';

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

/** A 4 m × 4 m tile that rises 1 m per metre along x, as a readable model. */
function rampGlb(): ReturnType<typeof readGlb> {
  return readGlb(
    writeGlb(
      buildHeightFieldGlb(
        'ramp',
        grid(5, 5, (column) => column),
      ),
    ),
  );
}

const IDENTITY: Matrix4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe('readTriangleField / surfaceUnder', () => {
  it('answers with the surface it was given, between the vertices as well as on them', () => {
    const field = readTriangleField(rampGlb(), 'ramp');
    expect(surfaceUnder(field, 0, 0)).toBeCloseTo(0, 6);
    expect(surfaceUnder(field, 2, 2)).toBeCloseTo(2, 6);
    expect(surfaceUnder(field, 3.5, 1.25)).toBeCloseTo(3.5, 6);
  });

  it('offsets the surface into world space, so a tile can stand anywhere', () => {
    const field = readTriangleField(rampGlb(), 'ramp', [100, 7, -20]);
    expect(surfaceUnder(field, 100, -20)).toBeCloseTo(7, 6);
    expect(surfaceUnder(field, 102, -18)).toBeCloseTo(9, 6);
    expect(surfaceUnder(field, 2, 2)).toBeUndefined();
  });

  it('has no ground beyond the tile rather than the rim height', () => {
    const field = readTriangleField(rampGlb(), 'ramp');
    expect(surfaceUnder(field, 4, 4)).toBeCloseTo(4, 6);
    expect(surfaceUnder(field, 4.5, 2)).toBeUndefined();
    expect(surfaceUnder(field, -0.5, 2)).toBeUndefined();
  });

  it('gives the same answer whatever the index cell is', () => {
    const coarse = readTriangleField(rampGlb(), 'ramp', [0, 0, 0], 10);
    const fine = readTriangleField(rampGlb(), 'ramp', [0, 0, 0], 0.25);
    expect(surfaceUnder(coarse, 1.3, 2.7)).toBeCloseTo(surfaceUnder(fine, 1.3, 2.7) ?? -1, 6);
  });

  it('refuses a model with no triangles to stand on', () => {
    const empty = readGlb(writeGlb({ json: { asset: { version: '2.0' } }, bin: Buffer.alloc(0) }));
    expect(() => readTriangleField(empty, 'nothing')).toThrow(/no indexed triangles/);
  });
});

describe('modelPoints', () => {
  it('mirrors x, because the loader root the game keeps does', () => {
    // The ramp runs x 0…4 in the file; the game draws it at x −4…0.
    const points = modelPoints(rampGlb(), 'ramp');
    let low = Infinity;
    let high = -Infinity;
    for (let index = 0; index < points.length; index += 3) {
      low = Math.min(low, points[index] ?? 0);
      high = Math.max(high, points[index] ?? 0);
    }
    expect(low).toBeCloseTo(-4, 6);
    expect(high).toBeCloseTo(0, 6);
  });

  it('leaves y and z alone', () => {
    const points = modelPoints(rampGlb(), 'ramp');
    let highestZ = -Infinity;
    let highestY = -Infinity;
    for (let index = 0; index < points.length; index += 3) {
      highestY = Math.max(highestY, points[index + 1] ?? 0);
      highestZ = Math.max(highestZ, points[index + 2] ?? 0);
    }
    expect(highestY).toBeCloseTo(4, 6);
    expect(highestZ).toBeCloseTo(4, 6);
  });
});

describe('seatingOf', () => {
  /** A one-metre square patch of points at `y`, spanning x/z 0…1. */
  function patch(y: number): Float32Array {
    return new Float32Array([0, y, 0, 1, y, 0, 0, y, 1, 1, y, 1]);
  }
  const flat = (): number => 10;

  it('is the smallest gap over the model, not the gap at its origin', () => {
    const slope = (x: number): number => x;
    // Points at y = 3 over ground that runs 0…1: the lowest point clears it by
    // 2 m, and that — not the 3 m at the origin — is what "floats" means.
    expect(seatingOf(patch(3), IDENTITY, slope).gap).toBeCloseTo(2, 6);
  });

  it('is negative for a model sunk into the ground', () => {
    expect(seatingOf(patch(4), IDENTITY, flat).gap).toBeCloseTo(-6, 6);
    expect(seatingOf(patch(4), IDENTITY, flat).visible).toBe(0);
  });

  it('reports how much of the model rises out of the ground', () => {
    const half = (_x: number, z: number): number => (z < 0.5 ? 20 : 0);
    const measured = seatingOf(patch(10), IDENTITY, half);
    expect(measured.gap).toBeCloseTo(-10, 6);
    expect(measured.relief).toBeCloseTo(10, 6);
    expect(measured.visible).toBeCloseTo(0.5, 6);
  });

  it('applies the entity transform before asking the ground', () => {
    const matrix = compose({ position: [0, 5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
    expect(seatingOf(patch(10), matrix, flat).gap).toBeCloseTo(5, 6);
  });

  it('counts points that hang off the edge instead of inventing ground for them', () => {
    const field = readTriangleField(rampGlb(), 'ramp');
    const half = new Float32Array([2, 9, 2, 9, 9, 2]);
    const measured = seatingOf(half, IDENTITY, (x, z) => surfaceUnder(field, x, z));
    expect(measured.offGround).toBe(1);
    expect(measured.gap).toBeCloseTo(7, 6);
  });

  it('measures nothing when every point is off the ground', () => {
    const field = readTriangleField(rampGlb(), 'ramp');
    const away = new Float32Array([50, 0, 50]);
    const measured = seatingOf(away, IDENTITY, (x, z) => surfaceUnder(field, x, z));
    expect(measured.offGround).toBe(1);
    expect(Number.isNaN(measured.gap)).toBe(true);
  });
});

describe('transform', () => {
  it('reads a column-major matrix the way the world file writes one', () => {
    const matrix = compose({
      position: [1, 2, 3],
      rotation: [0, Math.PI / 2, 0],
      scale: [2, 2, 2],
    });
    const [x, y, z] = transform(matrix, 1, 0, 0);
    expect(x).toBeCloseTo(1, 6);
    expect(y).toBeCloseTo(2, 6);
    expect(z).toBeCloseTo(1, 6);
  });
});
