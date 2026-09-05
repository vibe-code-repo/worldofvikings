import { describe, expect, it } from 'vitest';
import { ZERO_VEC3, horizontalLength, vec3 } from './vector.js';

describe('vec3', () => {
  it('builds a plain record, not a class instance', () => {
    const v = vec3(1, 2, 3);

    expect(v).toEqual({ x: 1, y: 2, z: 3 });
    expect(Object.getPrototypeOf(v)).toBe(Object.prototype);
  });
});

describe('ZERO_VEC3', () => {
  it('is the origin', () => {
    expect(ZERO_VEC3).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('is frozen, because every resting entity shares this one object', () => {
    expect(Object.isFrozen(ZERO_VEC3)).toBe(true);
  });
});

describe('horizontalLength', () => {
  it('ignores the vertical axis by only taking x and z', () => {
    expect(horizontalLength(3, 4)).toBe(5);
    expect(horizontalLength(0, 0)).toBe(0);
    expect(horizontalLength(-3, -4)).toBe(5);
  });

  it('matches Math.sqrt exactly, so the simulation stays engine-independent', () => {
    // Math.hypot is allowed to differ between engines by an ulp; the ADR-0009
    // rule is that the simulation path uses Math.sqrt only. Pinning the exact
    // bits here is what makes that rule a test instead of a comment.
    for (const [x, z] of [
      [0.3, 1],
      [1, 1],
      [0.7071067811865476, 0.7071067811865476],
      [1e-8, 1e-8],
    ] as const) {
      expect(horizontalLength(x, z)).toBe(Math.sqrt(x * x + z * z));
    }
  });

  it('is exactly 1 for a unit axis, so a full stick is not scaled down', () => {
    expect(horizontalLength(1, 0)).toBe(1);
    expect(horizontalLength(0, -1)).toBe(1);
  });
});
