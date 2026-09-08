import { describe, expect, it } from 'vitest';
import {
  AUDIBLE_GAIN_THRESHOLD,
  audibleRadius,
  defaultAudioFalloff,
  distanceGain,
  resolveAudioFalloff,
} from './audio-falloff.js';
import type { AudioFalloff } from './audio-falloff.js';

/** A brazier: full inside the flame, gone by the far side of the square. */
const brazier: AudioFalloff = {
  distanceModel: 'inverse',
  minDistance: 1.5,
  maxDistance: 25,
  rolloffFactor: 1.6,
};

/** The forge, which carries further on purpose. */
const forge: AudioFalloff = {
  distanceModel: 'inverse',
  minDistance: 3,
  maxDistance: 60,
  rolloffFactor: 1.2,
};

describe('distanceGain', () => {
  it('is full volume inside minDistance, and never louder', () => {
    // The value that keeps a source from blowing up as the camera walks into it.
    expect(distanceGain(brazier, 0)).toBe(1);
    expect(distanceGain(brazier, 1.5)).toBe(1);
    expect(distanceGain(brazier, 1.4999)).toBe(1);
  });

  it('follows the inverse curve the Web Audio specification defines', () => {
    // 1.5 / (1.5 + 1.6 * (12 - 1.5))
    expect(distanceGain(brazier, 12)).toBeCloseTo(0.082, 3);
    expect(distanceGain(brazier, 25)).toBeCloseTo(0.0384, 4);
  });

  it('makes a louder rolloff quieter at the same distance, not the other way round', () => {
    const gentle = distanceGain({ ...brazier, rolloffFactor: 0.8 }, 12);
    const steep = distanceGain({ ...brazier, rolloffFactor: 3.2 }, 12);
    expect(gentle).toBeGreaterThan(distanceGain(brazier, 12));
    expect(steep).toBeLessThan(distanceGain(brazier, 12));
  });

  it('carries the forge further than the brazier, which is why it has its own numbers', () => {
    expect(distanceGain(forge, 12)).toBeGreaterThan(distanceGain(brazier, 12));
    expect(distanceGain(forge, 30)).toBeGreaterThan(distanceGain(brazier, 30));
  });

  it('never fades at all with a rolloff of zero', () => {
    expect(distanceGain({ ...brazier, rolloffFactor: 0 }, 1000)).toBe(1);
  });

  it('reaches silence only under the linear model, and only past its edge', () => {
    const linear: AudioFalloff = {
      distanceModel: 'linear',
      minDistance: 2,
      maxDistance: 12,
      rolloffFactor: 1,
    };
    expect(distanceGain(linear, 2)).toBe(1);
    expect(distanceGain(linear, 7)).toBeCloseTo(0.5, 6);
    expect(distanceGain(linear, 12)).toBe(0);
    // maxDistance is where it stops getting quieter, not where it stops.
    expect(distanceGain(linear, 400)).toBe(0);
  });

  it('leaves a floor of 1 - rolloffFactor when a linear rolloff is below one', () => {
    const linear: AudioFalloff = {
      distanceModel: 'linear',
      minDistance: 2,
      maxDistance: 12,
      rolloffFactor: 0.4,
    };
    expect(distanceGain(linear, 400)).toBeCloseTo(0.6, 6);
  });

  it('follows the exponential curve, which is the steepest of the three', () => {
    const exponential: AudioFalloff = { ...brazier, distanceModel: 'exponential' };
    // (12 / 1.5) ** -1.6
    expect(distanceGain(exponential, 12)).toBeCloseTo(0.0359, 4);
    expect(distanceGain(exponential, 12)).toBeLessThan(distanceGain(brazier, 12));
  });

  it('stays inside 0…1 for anything a world file could contain', () => {
    for (const model of ['linear', 'inverse', 'exponential'] as const) {
      for (const distance of [-5, 0, 0.001, 1, 50, 1e9, Number.POSITIVE_INFINITY]) {
        const gain = distanceGain({ ...brazier, distanceModel: model }, distance);
        expect(gain).toBeGreaterThanOrEqual(0);
        expect(gain).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('resolveAudioFalloff', () => {
  it('answers the Web Audio defaults when asked nothing', () => {
    expect(resolveAudioFalloff()).toEqual(defaultAudioFalloff);
  });

  it('refuses a minDistance of zero rather than dividing by it', () => {
    // Zero is silence under `inverse` and a division by zero under
    // `exponential` — both read on screen as "the emitter is broken", a long
    // way from the world file that caused it.
    const resolved = resolveAudioFalloff({ minDistance: 0 });
    expect(resolved.minDistance).toBeGreaterThan(0);
    expect(distanceGain(resolved, 5)).toBeGreaterThan(0);
  });

  it('never lets maxDistance sit below minDistance', () => {
    expect(resolveAudioFalloff({ minDistance: 10, maxDistance: 2 }).maxDistance).toBe(10);
  });

  it('clamps a negative rolloff instead of making distance louder', () => {
    expect(resolveAudioFalloff({ rolloffFactor: -3 }).rolloffFactor).toBe(0);
  });
});

describe('audibleRadius', () => {
  it('agrees with the curve it was solved from', () => {
    for (const falloff of [brazier, forge, { ...brazier, distanceModel: 'exponential' } as const]) {
      const radius = audibleRadius(falloff);
      expect(distanceGain(falloff, radius)).toBeCloseTo(AUDIBLE_GAIN_THRESHOLD, 6);
      // Just inside it is louder, just outside it is quieter: the point of a cull.
      expect(distanceGain(falloff, radius * 0.9)).toBeGreaterThan(AUDIBLE_GAIN_THRESHOLD);
      expect(distanceGain(falloff, radius * 1.1)).toBeLessThan(AUDIBLE_GAIN_THRESHOLD);
    }
  });

  it('puts the brazier inside the square and the forge outside it', () => {
    expect(audibleRadius(brazier)).toBeCloseTo(47.4, 1);
    expect(audibleRadius(forge)).toBeCloseTo(125.5, 1);
  });

  it('is infinite when the curve never gets that quiet', () => {
    expect(audibleRadius({ ...brazier, rolloffFactor: 0 })).toBe(Number.POSITIVE_INFINITY);
    // A linear rolloff below one has a floor, and 0.6 is well above the threshold.
    expect(
      audibleRadius({
        distanceModel: 'linear',
        minDistance: 2,
        maxDistance: 12,
        rolloffFactor: 0.4,
      }),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it('is finite for a linear curve that does reach silence', () => {
    const linear: AudioFalloff = {
      distanceModel: 'linear',
      minDistance: 2,
      maxDistance: 12,
      rolloffFactor: 1,
    };
    expect(audibleRadius(linear)).toBeCloseTo(11.8, 1);
  });

  it('shrinks when the threshold is raised', () => {
    expect(audibleRadius(brazier, 0.1)).toBeLessThan(audibleRadius(brazier, 0.02));
  });
});
