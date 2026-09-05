import { createTransform, vec3 } from '@wov/gameplay';
import { describe, expect, it } from 'vitest';
import { interpolatePosition } from './interpolate.js';

const from = createTransform(vec3(0, 1, 10));
const to = createTransform(vec3(4, 3, 20));

describe('interpolatePosition', () => {
  it('shows the previous step at alpha 0 and the current one at alpha 1', () => {
    expect(interpolatePosition(from, to, 0)).toEqual({ x: 0, y: 1, z: 10 });
    expect(interpolatePosition(from, to, 1)).toEqual({ x: 4, y: 3, z: 20 });
  });

  it('sits in between for an alpha in between', () => {
    expect(interpolatePosition(from, to, 0.25)).toEqual({ x: 1, y: 1.5, z: 12.5 });
  });

  it('never extrapolates past the simulated state', () => {
    // The loop promises alpha in [0, 1), but a mis-wired caller must not be
    // able to fling the mesh ahead of the state the simulation actually holds.
    expect(interpolatePosition(from, to, 2)).toEqual({ x: 4, y: 3, z: 20 });
    expect(interpolatePosition(from, to, -1)).toEqual({ x: 0, y: 1, z: 10 });
    expect(interpolatePosition(from, to, Number.NaN)).toEqual({ x: 4, y: 3, z: 20 });
  });

  it('returns the position itself when nothing moved', () => {
    expect(interpolatePosition(to, to, 0.5)).toEqual({ x: 4, y: 3, z: 20 });
  });
});
