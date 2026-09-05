import { describe, expect, it } from 'vitest';
import { assetUrl } from './index.js';

describe('assetUrl', () => {
  it('joins base and path with exactly one slash', () => {
    expect(assetUrl({ baseUrl: 'http://localhost:9000/' }, '/environment/tree.glb')).toBe(
      'http://localhost:9000/environment/tree.glb',
    );
  });

  it('rejects empty paths', () => {
    expect(() => assetUrl({ baseUrl: 'http://x' }, '')).toThrow();
  });

  it('rejects traversal', () => {
    expect(() => assetUrl({ baseUrl: 'http://x' }, '../secret')).toThrow();
  });
});
