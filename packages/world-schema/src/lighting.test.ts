import { describe, expect, it } from 'vitest';
import { LightingProfileSchema } from './lighting.js';
import { CURRENT_WORLD_SCHEMA_VERSION, parseWorldDefinition } from './world.js';

const world = {
  schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
  id: 'main',
  name: 'Main World',
  zones: [{ id: 'village', name: 'Village', entities: [] }],
};

describe('LightingProfileSchema', () => {
  it('accepts an empty profile: saying nothing is a legal thing to say', () => {
    expect(LightingProfileSchema.safeParse({}).success).toBe(true);
  });

  it('accepts one group on its own', () => {
    expect(LightingProfileSchema.safeParse({ fog: { end: 180 } }).success).toBe(true);
  });

  it('rejects a colour that is not #rrggbb, instead of rendering it black', () => {
    expect(LightingProfileSchema.safeParse({ sun: { color: 'orange' } }).success).toBe(false);
    expect(LightingProfileSchema.safeParse({ sun: { color: '#fff' } }).success).toBe(false);
    expect(LightingProfileSchema.safeParse({ sun: { color: '#ffd9a0' } }).success).toBe(true);
  });

  it('takes a saturation between greyscale and twice as colourful, and nothing outside', () => {
    expect(LightingProfileSchema.safeParse({ postProcessing: { saturation: 0.7 } }).success).toBe(
      true,
    );
    expect(LightingProfileSchema.safeParse({ postProcessing: { saturation: 0 } }).success).toBe(
      true,
    );
    expect(LightingProfileSchema.safeParse({ postProcessing: { saturation: -1 } }).success).toBe(
      false,
    );
    expect(LightingProfileSchema.safeParse({ postProcessing: { saturation: 3 } }).success).toBe(
      false,
    );
  });

  it('rejects a negative light intensity', () => {
    expect(LightingProfileSchema.safeParse({ sun: { intensity: -1 } }).success).toBe(false);
  });

  it('rejects a shadow map that is not a power of two', () => {
    expect(LightingProfileSchema.safeParse({ shadows: { mapSize: 2048 } }).success).toBe(true);
    expect(LightingProfileSchema.safeParse({ shadows: { mapSize: 1500 } }).success).toBe(false);
    expect(LightingProfileSchema.safeParse({ shadows: { mapSize: 8192 } }).success).toBe(false);
  });

  it('takes a fog mode from its two curves and refuses anything else', () => {
    expect(LightingProfileSchema.safeParse({ fog: { mode: 'linear' } }).success).toBe(true);
    expect(LightingProfileSchema.safeParse({ fog: { mode: 'exp' } }).success).toBe(true);
    expect(LightingProfileSchema.safeParse({ fog: { mode: 'exp2' } }).success).toBe(false);
  });

  /**
   * The bound is what makes the editor draw a slider a person can aim with: the
   * whole working range of a per-metre extinction is a few thousandths, and an
   * unbounded number would get a text box instead (ADR-0033, ADR-0041).
   */
  it('bounds the fog density to the range aerial perspective lives in', () => {
    expect(LightingProfileSchema.safeParse({ fog: { density: 0.0005 } }).success).toBe(true);
    expect(LightingProfileSchema.safeParse({ fog: { density: 0 } }).success).toBe(true);
    expect(LightingProfileSchema.safeParse({ fog: { density: -0.001 } }).success).toBe(false);
    expect(LightingProfileSchema.safeParse({ fog: { density: 0.02 } }).success).toBe(false);
  });

  it('rejects a fog end of zero, which would divide the fade by nothing', () => {
    expect(LightingProfileSchema.safeParse({ fog: { end: 0 } }).success).toBe(false);
  });

  it('rejects an unknown tone-mapping curve by name', () => {
    expect(
      LightingProfileSchema.safeParse({ postProcessing: { toneMapping: 'filmic' } }).success,
    ).toBe(false);
    expect(
      LightingProfileSchema.safeParse({ postProcessing: { toneMapping: 'aces' } }).success,
    ).toBe(true);
  });

  it('rejects a misspelt field rather than ignoring it', () => {
    expect(LightingProfileSchema.safeParse({ sun: { colour: '#ffffff' } }).success).toBe(false);
    expect(LightingProfileSchema.safeParse({ shadow: { enabled: true } }).success).toBe(false);
  });
});

describe('lighting in a world file', () => {
  it('is optional on the world and on a zone', () => {
    expect(parseWorldDefinition(world).ok).toBe(true);
  });

  it('is accepted on the world', () => {
    const result = parseWorldDefinition({
      ...world,
      lighting: { sun: { direction: [0.6, -0.35, 0.7], color: '#ffd9a0', intensity: 2.4 } },
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.world.lighting?.sun?.intensity).toBe(2.4);
  });

  it('is accepted on a zone, so an interior can be dark under a bright world', () => {
    const result = parseWorldDefinition({
      ...world,
      lighting: { fog: { end: 300 } },
      zones: [{ id: 'village', name: 'Village', entities: [], lighting: { fog: { end: 40 } } }],
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.world.zones[0]?.lighting?.fog?.end).toBe(40);
  });

  it('carries a version 2 file forward with no lighting at all', () => {
    const result = parseWorldDefinition({ ...world, schemaVersion: 2 });
    expect(result.ok && result.migratedFrom).toBe(2);
    expect(result.ok && result.world.lighting).toBeUndefined();
  });
});
