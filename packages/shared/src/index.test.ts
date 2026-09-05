import { describe, expect, it } from 'vitest';
import { assertNever, clamp } from './index.js';

describe('clamp', () => {
  it('returns the value when it is inside the range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps to the bounds', () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it('rejects an inverted range', () => {
    expect(() => clamp(1, 10, 0)).toThrow(RangeError);
  });
});

describe('assertNever', () => {
  it('always throws', () => {
    expect(() => assertNever('x' as never)).toThrow(/Unexpected value/);
  });
});
