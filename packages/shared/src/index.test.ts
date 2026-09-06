import { describe, expect, it } from 'vitest';
import { assertNever, clamp, isDebugRequested, resolveServiceUrl } from './index.js';

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

describe('resolveServiceUrl', () => {
  it('falls back to the local default when nothing is configured', () => {
    expect(resolveServiceUrl(undefined, 'http://localhost:3000', 'VITE_API_URL')).toBe(
      'http://localhost:3000',
    );
    expect(resolveServiceUrl('   ', 'http://localhost:3000', 'VITE_API_URL')).toBe(
      'http://localhost:3000',
    );
  });

  it('strips trailing slashes so a path can simply be appended', () => {
    expect(resolveServiceUrl('https://api.example.com//', 'http://x', 'VITE_API_URL')).toBe(
      'https://api.example.com',
    );
  });

  it('names the variable when the value is not an absolute http(s) URL', () => {
    expect(() => resolveServiceUrl('localhost:3000', 'http://x', 'VITE_API_URL')).toThrow(
      /VITE_API_URL must be an absolute http\(s\) URL/,
    );
  });
});

describe('isDebugRequested', () => {
  it('is off without the parameter', () => {
    expect(isDebugRequested('')).toBe(false);
    expect(isDebugRequested('?world=village1')).toBe(false);
    expect(isDebugRequested('?debug=0')).toBe(false);
  });

  it('is on next to the other parameters the client already reads', () => {
    expect(isDebugRequested('?world=village1&spawn=166,150&debug=1')).toBe(true);
  });
});
