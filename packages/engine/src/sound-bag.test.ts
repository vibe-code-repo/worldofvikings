import { describe, expect, it } from 'vitest';
import { createClipBag, intervalIn, jitteredRate, seededRandom } from './sound-bag.js';

describe('seededRandom', () => {
  it('gives the same sequence for the same seed', () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('stays inside [0, 1)', () => {
    const random = seededRandom(12345);
    for (let index = 0; index < 500; index += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('createClipBag', () => {
  const clips = ['a', 'b', 'c', 'd'];

  it('never plays the same clip twice running, over a long walk', () => {
    const bag = createClipBag(clips, seededRandom(99));
    let previous = bag.next();
    for (let step = 0; step < 400; step += 1) {
      const next = bag.next();
      expect(next).not.toBe(previous);
      previous = next;
    }
  });

  it('deals every clip once before repeating any', () => {
    const bag = createClipBag(clips, seededRandom(1));
    const deal = [bag.next(), bag.next(), bag.next(), bag.next()];
    expect([...deal].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('survives a bank of one, which cannot avoid repeating', () => {
    const bag = createClipBag(['only'], seededRandom(1));
    expect([bag.next(), bag.next()]).toEqual(['only', 'only']);
  });

  it('refuses an empty bank rather than turning it into silence', () => {
    expect(() => createClipBag([])).toThrow(/at least one clip/);
  });
});

describe('jitteredRate', () => {
  it('stays within ±jitter of 1', () => {
    const random = seededRandom(4);
    for (let index = 0; index < 200; index += 1) {
      const rate = jitteredRate(0.06, random);
      expect(rate).toBeGreaterThanOrEqual(0.94);
      expect(rate).toBeLessThanOrEqual(1.06);
    }
  });

  it('is exactly 1 when nothing is jittered', () => {
    expect(jitteredRate(0, seededRandom(4))).toBe(1);
  });
});

describe('intervalIn', () => {
  it('stays inside the range', () => {
    const random = seededRandom(2);
    for (let index = 0; index < 200; index += 1) {
      const seconds = intervalIn([18, 55], random);
      expect(seconds).toBeGreaterThanOrEqual(18);
      expect(seconds).toBeLessThanOrEqual(55);
    }
  });
});
