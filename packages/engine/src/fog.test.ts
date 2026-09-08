import { describe, expect, it } from 'vitest';
import {
  BABYLON_FOGMODE,
  FOG_ENCODE_POWER,
  MAX_BACKDROP_HAZE,
  backdropTakesFog,
  fogVisibility,
  hazeAt,
  rawFogFactor,
  sceneFogCurve,
  type FogCurve,
} from './fog.js';

const linear = (start: number, end: number): FogCurve => ({
  mode: 'linear',
  start,
  end,
  density: 0,
});
const exp = (density: number): FogCurve => ({ mode: 'exp', start: 0, end: 0, density });

describe('rawFogFactor', () => {
  it('is Babylon’s linear ramp between start and end', () => {
    const fog = linear(100, 300);
    expect(rawFogFactor(fog, 50)).toBe(1);
    expect(rawFogFactor(fog, 100)).toBe(1);
    expect(rawFogFactor(fog, 200)).toBeCloseTo(0.5, 12);
    expect(rawFogFactor(fog, 300)).toBe(0);
    expect(rawFogFactor(fog, 900)).toBe(0);
  });

  it('is exp(-density * distance) on the exponential curve', () => {
    expect(rawFogFactor(exp(0.0005), 0)).toBe(1);
    expect(rawFogFactor(exp(0.0005), 1000)).toBeCloseTo(Math.exp(-0.5), 12);
  });

  it('leaves everything alone when there is no fog', () => {
    expect(rawFogFactor({ mode: 'none', start: 1, end: 2, density: 1 }, 5000)).toBe(1);
  });

  it('does not divide by a zero span', () => {
    const degenerate = linear(300, 300);
    expect(Number.isFinite(rawFogFactor(degenerate, 200))).toBe(true);
    expect(rawFogFactor(degenerate, 200)).toBe(1);
    expect(rawFogFactor(degenerate, 300)).toBe(0);
  });
});

/**
 * The 2.2 encode is the fact ADR-0041 turns on: Babylon's `fogFragment` applies
 * `toLinearSpace` to the fog factor under `#ifdef PBR`, every GLB in this
 * project is a PBR material, and the terrain shader did not. Half the haze on
 * the one surface that carries the depth cue.
 */
describe('fogVisibility and hazeAt', () => {
  it('applies the same encode Babylon applies to a PBR material', () => {
    expect(FOG_ENCODE_POWER).toBe(2.2);
    const fog = linear(80, 1700);
    const raw = rawFogFactor(fog, 300);
    expect(raw).toBeCloseTo(0.8642, 4);
    expect(fogVisibility(fog, 300)).toBeCloseTo(Math.pow(raw, 2.2), 12);
    // The number the diagnosis measured: 13.6 % haze before, 27.5 % after.
    expect(1 - raw).toBeCloseTo(0.1358, 4);
    expect(hazeAt(fog, 300)).toBeCloseTo(0.2746, 4);
  });

  /**
   * The table in ADR-0041. `village1` runs the exponential curve at a density of
   * 0.0005 per metre, which the encode turns into an effective extinction of
   * 0.0011 — 10 % haze at 100 m, where the linear ramp it replaces had 1.2 %.
   */
  it.each([
    [100, 0.1042],
    [200, 0.1975],
    [400, 0.356],
    [800, 0.5852],
    [1700, 0.8459],
  ])('hazes %d m of village air by the ADR table', (distance, haze) => {
    expect(hazeAt(exp(0.0005), distance)).toBeCloseTo(haze, 4);
  });

  it('never quite reaches total, which is what leaves a range its own colour', () => {
    // 5 km, three times past the farthest thing this world draws.
    expect(hazeAt(exp(0.0005), 5000)).toBeLessThan(1);
    expect(hazeAt(exp(0.0005), 5000)).toBeGreaterThan(0.99);
    expect(hazeAt(linear(80, 1700), 1700)).toBe(1);
  });
});

/**
 * Whether the painted distance takes the world's fog.
 *
 * The rule is self-guarding, which is the whole point of it (ADR-0034): a
 * backdrop is only fogged while it keeps enough of its own colour, so a world
 * can never haze its horizon into a flat band. ADR-0041 restated the test —
 * `fog.end > reach` has no meaning on a curve with no end — and these are
 * ADR-0034's own five cases, which must keep their answers.
 */
describe('backdropTakesFog', () => {
  const village = (end: number): FogCurve => linear(80, end);

  it('says no when there is no fog', () => {
    expect(backdropTakesFog({ mode: 'none', start: 80, end: 4000, density: 0 }, 806)).toBe(false);
  });

  it('says no when the fog ends before the shell, which would erase it', () => {
    // The village's own numbers before this rule existed: fog to 420 m and an
    // outer shell reaching 806 m is a horizon painted flat in fog colour.
    expect(backdropTakesFog(village(420), 806)).toBe(false);
  });

  it('says yes when the fog reaches past the shell', () => {
    expect(backdropTakesFog(village(1100), 806)).toBe(true);
  });

  it('is decided per mesh, so near clouds haze while a far shell does not', () => {
    expect(backdropTakesFog(village(900), 250)).toBe(true);
    expect(backdropTakesFog(village(900), 1200)).toBe(false);
  });

  it('refuses the exact boundary rather than fogging a shell to its own end', () => {
    expect(backdropTakesFog(village(806), 806)).toBe(false);
  });

  it('hazes both shells under the village’s exponential curve', () => {
    // ADR-0034 measured the two painted shells at 674 m and 1601 m of reach.
    expect(backdropTakesFog(exp(0.0005), 674)).toBe(true);
    expect(backdropTakesFog(exp(0.0005), 1601)).toBe(true);
    expect(hazeAt(exp(0.0005), 1601)).toBeCloseTo(0.8281, 4);
  });

  it('still refuses a density that would erase the range into a band', () => {
    // Far past anything this project draws, but the guard has to have a "no"
    // under exp as well, or it is a rule that cannot fail.
    expect(hazeAt(exp(0.01), 1601)).toBeGreaterThan(MAX_BACKDROP_HAZE);
    expect(backdropTakesFog(exp(0.01), 1601)).toBe(false);
  });
});

describe('sceneFogCurve', () => {
  const scene = (fogMode: number, fogEnabled = true) => ({
    fogEnabled,
    fogMode,
    fogStart: 80,
    fogEnd: 1700,
    fogDensity: 0.0005,
  });

  it('reads Babylon’s own fields rather than a second copy of them', () => {
    expect(sceneFogCurve(scene(BABYLON_FOGMODE.linear))).toEqual({
      mode: 'linear',
      start: 80,
      end: 1700,
      density: 0.0005,
    });
    expect(sceneFogCurve(scene(BABYLON_FOGMODE.exp)).mode).toBe('exp');
    expect(sceneFogCurve(scene(BABYLON_FOGMODE.none)).mode).toBe('none');
  });

  it('reports a disabled fog as none whatever the mode still says', () => {
    expect(sceneFogCurve(scene(BABYLON_FOGMODE.linear, false)).mode).toBe('none');
  });

  it('reports exp2 as exp rather than unfogging the ground', () => {
    expect(sceneFogCurve(scene(BABYLON_FOGMODE.exp2)).mode).toBe('exp');
  });
});
