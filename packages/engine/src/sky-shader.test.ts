import { describe, expect, it } from 'vitest';
import {
  SKY_ATTRIBUTES,
  SKY_FRAGMENT_SOURCE,
  SKY_GRADIENT_FUNCTION,
  SKY_UNIFORMS,
  SKY_VERTEX_SOURCE,
} from './sky-shader.js';

describe('the sky program', () => {
  it('declares every uniform the material binds, and nothing it does not', () => {
    const source = `${SKY_VERTEX_SOURCE}\n${SKY_FRAGMENT_SOURCE}`;
    for (const uniform of SKY_UNIFORMS) {
      expect(source).toMatch(new RegExp(`uniform \\w+ ${uniform}\\b`));
    }
    const declared = [...source.matchAll(/uniform \w+ (\w+)/g)].map((match) => match[1]);
    expect([...new Set(declared)].sort()).toEqual([...SKY_UNIFORMS].sort());
  });

  it('reads only the attribute the box provides', () => {
    const attributes = [...SKY_VERTEX_SOURCE.matchAll(/attribute \w+ (\w+)/g)].map((m) => m[1]);
    expect(attributes).toEqual([...SKY_ATTRIBUTES]);
  });

  it('passes the view direction from the vertex stage to the fragment stage', () => {
    expect(SKY_VERTEX_SOURCE).toContain('varying vec3 vDirection');
    expect(SKY_FRAGMENT_SOURCE).toContain('varying vec3 vDirection');
  });

  it('darkens below the horizon instead of continuing the warm band', () => {
    // Past the edge of a terrain tile the lower half of the dome is what the
    // camera sees. A horizon colour continued downwards reads as a beach.
    expect(SKY_GRADIENT_FUNCTION).toContain('horizonColor * 0.16');
    expect(SKY_GRADIENT_FUNCTION).toContain('clamp(-direction.y * 8.0, 0.0, 1.0)');
  });

  it('puts the glow where the sun is, not where its light goes', () => {
    // The sun sits opposite its travel direction; a missing minus here is a
    // sky that glows on the shadow side, which reads as "wrong" and nothing
    // else.
    expect(SKY_GRADIENT_FUNCTION).toContain('dot(direction, -sunDirection)');
  });

  it('is the same gradient the ground reflects, pasted from one place', () => {
    // The dome and the terrain shader both include SKY_GRADIENT_FUNCTION
    // (ADR-0032). A second copy of the formula would put the horizon at one
    // height in the sky and at another in the ground reflecting it.
    expect(SKY_FRAGMENT_SOURCE).toContain(SKY_GRADIENT_FUNCTION);
    expect(SKY_FRAGMENT_SOURCE).toContain('wovSkyColor(');
  });
});
