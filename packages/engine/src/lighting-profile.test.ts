import { describe, expect, it } from 'vitest';
import { defaultLightingProfile, resolveLightingProfile } from './lighting-profile.js';

describe('resolveLightingProfile', () => {
  it('resolves to the defaults when it is given nothing', () => {
    expect(resolveLightingProfile()).toEqual(defaultLightingProfile);
    expect(resolveLightingProfile(undefined, undefined)).toEqual(defaultLightingProfile);
  });

  it('changes one field and leaves its group alone', () => {
    const profile = resolveLightingProfile({ fog: { end: 180 } });
    expect(profile.fog.end).toBe(180);
    expect(profile.fog.start).toBe(defaultLightingProfile.fog.start);
    expect(profile.sun).toEqual(defaultLightingProfile.sun);
  });

  it('lets a later profile beat an earlier one, field by field', () => {
    const profile = resolveLightingProfile(
      { sun: { intensity: 2, color: '#ff0000' } },
      { sun: { intensity: 0.5 } },
    );
    expect(profile.sun.intensity).toBe(0.5);
    expect(profile.sun.color).toBe('#ff0000');
  });

  it('ignores an explicitly undefined field instead of erasing the default', () => {
    const profile = resolveLightingProfile({ sun: { intensity: undefined } });
    expect(profile.sun.intensity).toBe(defaultLightingProfile.sun.intensity);
  });

  it('follows the sky with the fog colour unless the fog states one', () => {
    const followed = resolveLightingProfile({ sky: { horizonColor: '#112233' } });
    expect(followed.fog.color).toBe('#112233');

    const stated = resolveLightingProfile({
      sky: { horizonColor: '#112233' },
      fog: { color: '#445566' },
    });
    expect(stated.fog.color).toBe('#445566');
  });

  it('merges nested post-processing groups without dropping their siblings', () => {
    const profile = resolveLightingProfile({ postProcessing: { bloom: { weight: 0.9 } } });
    expect(profile.postProcessing.bloom.weight).toBe(0.9);
    expect(profile.postProcessing.bloom.threshold).toBe(
      defaultLightingProfile.postProcessing.bloom.threshold,
    );
    expect(profile.postProcessing.vignette).toEqual(defaultLightingProfile.postProcessing.vignette);
    expect(profile.postProcessing.toneMapping).toBe(
      defaultLightingProfile.postProcessing.toneMapping,
    );
  });

  it('leaves colour alone by default, so an old world file grades as it did', () => {
    expect(defaultLightingProfile.postProcessing.saturation).toBe(1);
    expect(resolveLightingProfile({}).postProcessing.saturation).toBe(1);
    expect(
      resolveLightingProfile({ postProcessing: { contrast: 1.1 } }).postProcessing.saturation,
    ).toBe(1);
  });

  it('carries a stated saturation through the flat post-processing merge', () => {
    // The merge lists its flat keys by hand: a field added to the interface but
    // forgotten there would validate, show up in the editor and do nothing.
    const profile = resolveLightingProfile({ postProcessing: { saturation: 0.7 } });
    expect(profile.postProcessing.saturation).toBe(0.7);
    expect(profile.postProcessing.contrast).toBe(defaultLightingProfile.postProcessing.contrast);

    const zoneWins = resolveLightingProfile(
      { postProcessing: { saturation: 0.7 } },
      { postProcessing: { saturation: 0.4 } },
    );
    expect(zoneWins.postProcessing.saturation).toBe(0.4);
  });

  it('rejects a negative saturation', () => {
    expect(() => resolveLightingProfile({ postProcessing: { saturation: -0.2 } })).toThrow(
      /postProcessing.saturation must be zero or more/,
    );
  });

  it('rejects a malformed colour rather than resolving it to black', () => {
    expect(() => resolveLightingProfile({ sun: { color: 'orange' } })).toThrow(
      /sun.color must be a #rrggbb colour/,
    );
  });

  it('rejects a sun that points nowhere', () => {
    expect(() => resolveLightingProfile({ sun: { direction: [0, 0, 0] } })).toThrow(
      /must not be the zero vector/,
    );
    expect(() => resolveLightingProfile({ sun: { direction: [0, Number.NaN, 1] } })).toThrow(
      /must be finite/,
    );
  });

  /**
   * Additive and inert: a world file that says nothing about the curve keeps
   * the one it was tuned against, and `density` is carried even while it is
   * unused so switching a world to `exp` does not switch its fog off (ADR-0041).
   */
  it('defaults the fog curve to linear and carries a density through the merge', () => {
    expect(defaultLightingProfile.fog.mode).toBe('linear');
    expect(defaultLightingProfile.fog.density).toBeGreaterThan(0);
    expect(resolveLightingProfile({ fog: { end: 180 } }).fog.mode).toBe('linear');
    const exponential = resolveLightingProfile({ fog: { mode: 'exp', density: 0.0005 } });
    expect(exponential.fog.mode).toBe('exp');
    expect(exponential.fog.density).toBe(0.0005);
    // The linear numbers survive the switch, so a world can be moved back.
    expect(exponential.fog.end).toBe(defaultLightingProfile.fog.end);
  });

  it('rejects fog that ends before it starts', () => {
    expect(() => resolveLightingProfile({ fog: { start: 200, end: 100 } })).toThrow(
      /fog.end \(100\) must be greater than fog.start \(200\)/,
    );
  });

  it('rejects a negative intensity and a zero shadow distance', () => {
    expect(() => resolveLightingProfile({ sun: { intensity: -1 } })).toThrow(/zero or more/);
    expect(() => resolveLightingProfile({ shadows: { distance: 0 } })).toThrow(/positive number/);
  });

  it('clamps a fraction instead of failing on it', () => {
    expect(resolveLightingProfile({ shadows: { darkness: 5 } }).shadows.darkness).toBe(1);
    expect(resolveLightingProfile({ sky: { sunSpread: -2 } }).sky.sunSpread).toBe(0);
  });

  it('describes an evening: a low sun, a dark fill and shadows that reach', () => {
    // The three numbers the reference picture is actually about, pinned so that
    // a later tweak to "make it a bit brighter" is a decision and not a drift.
    const { sun, ambient, shadows } = defaultLightingProfile;
    const elevation = Math.abs(sun.direction[1]) / Math.hypot(...sun.direction);
    expect(Math.asin(elevation) * (180 / Math.PI)).toBeLessThan(30);
    expect(ambient.intensity).toBeLessThan(sun.intensity / 2);
    expect(shadows.enabled).toBe(true);
  });
});
