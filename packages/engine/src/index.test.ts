import { describe, expect, it } from 'vitest';
import { defaultRenderConfig, resolveRenderConfig } from './index.js';

describe('resolveRenderConfig', () => {
  it('returns the defaults for an empty override', () => {
    expect(resolveRenderConfig()).toEqual(defaultRenderConfig);
  });

  it('clamps the resolution scale into a usable range', () => {
    expect(resolveRenderConfig({ resolutionScale: 8 }).resolutionScale).toBe(2);
    expect(resolveRenderConfig({ resolutionScale: 0 }).resolutionScale).toBe(0.25);
  });
});
