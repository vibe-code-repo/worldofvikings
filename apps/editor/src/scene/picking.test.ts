import { describe, expect, it } from 'vitest';
import { rayToGroundPlane } from './picking.js';

describe('rayToGroundPlane', () => {
  it('finds the point a downward ray crosses y = 0', () => {
    expect(rayToGroundPlane([2, 10, -4], [0, -1, 0])).toEqual([2, 0, -4]);
  });

  it('follows the ray sideways as it descends', () => {
    const point = rayToGroundPlane([0, 10, 0], [1, -1, 0]);

    expect(point?.[0]).toBeCloseTo(10, 10);
    expect(point?.[1]).toBe(0);
  });

  it('refuses a ray pointing away from the plane instead of hitting it behind the camera', () => {
    expect(rayToGroundPlane([0, 10, 0], [0, 1, 0])).toBeNull();
  });

  it('refuses a ray running parallel to the plane', () => {
    expect(rayToGroundPlane([0, 10, 0], [1, 0, 0])).toBeNull();
  });

  it('answers the camera position itself when the camera is already on the plane', () => {
    expect(rayToGroundPlane([3, 0, 5], [0, -1, 0])).toEqual([3, 0, 5]);
  });
});
