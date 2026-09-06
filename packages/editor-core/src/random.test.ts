import { describe, expect, it } from 'vitest';
import { createRandom } from './random.js';

describe('createRandom', () => {
  it('gives the same sequence for the same seed, on any machine', () => {
    const first = createRandom(7);
    const second = createRandom(7);
    const drawn = Array.from({ length: 5 }, () => first.next());
    expect(drawn).toEqual(Array.from({ length: 5 }, () => second.next()));
    // Pinned, so a change to the generator shows up as a failing test rather
    // than as a silently different world file.
    expect(drawn.map((value) => Number(value.toFixed(6)))).toEqual([
      0.011705, 0.061958, 0.976908, 0.699029, 0.521445,
    ]);
  });

  it('gives different seeds different sequences', () => {
    expect(createRandom(7).next()).not.toBe(createRandom(8).next());
  });

  it('stays inside the unit interval', () => {
    const random = createRandom(1234);
    for (let draw = 0; draw < 1000; draw += 1) {
      const value = random.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('accepts a negative or huge seed instead of refusing it', () => {
    expect(Number.isFinite(createRandom(-42).next())).toBe(true);
    expect(Number.isFinite(createRandom(2 ** 53).next())).toBe(true);
  });

  it('spreads between() over the range and collapses an empty one', () => {
    const random = createRandom(3);
    for (let draw = 0; draw < 200; draw += 1) {
      const value = random.between(2, 5);
      expect(value).toBeGreaterThanOrEqual(2);
      expect(value).toBeLessThan(5);
    }
    expect(random.between(4, 4)).toBe(4);
    expect(random.between(4, 1)).toBe(4);
  });

  it('picks weighted entries roughly in proportion to their weight', () => {
    const random = createRandom(11);
    const counts = [0, 0];
    for (let draw = 0; draw < 4000; draw += 1) {
      const picked = random.weighted([3, 1]);
      counts[picked] = (counts[picked] ?? 0) + 1;
    }
    expect((counts[0] ?? 0) / 4000).toBeGreaterThan(0.72);
    expect((counts[0] ?? 0) / 4000).toBeLessThan(0.78);
  });

  it('never picks an entry of weight zero', () => {
    const random = createRandom(5);
    for (let draw = 0; draw < 500; draw += 1) {
      expect(random.weighted([1, 0])).toBe(0);
    }
  });

  it('answers 0 for no weights at all rather than NaN', () => {
    expect(createRandom(5).weighted([])).toBe(0);
    expect(createRandom(5).weighted([0, 0])).toBe(0);
  });
});
