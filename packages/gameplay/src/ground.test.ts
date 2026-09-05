import { describe, expect, it } from 'vitest';
import { NO_GROUND, flatGround, groundUnder, type GroundQuery } from './ground.js';
import { vec3 } from './vector.js';

describe('flatGround', () => {
  it('reports the same height everywhere', () => {
    const ground = flatGround(2.5);

    expect(ground.heightAt(0, 0)).toBe(2.5);
    expect(ground.heightAt(-900, 900)).toBe(2.5);
  });

  it('defaults to height 0', () => {
    expect(flatGround().heightAt(1, 1)).toBe(0);
  });
});

describe('NO_GROUND', () => {
  it('answers null everywhere, which is how an entity counts as airborne', () => {
    expect(NO_GROUND.heightAt(0, 0)).toBeNull();
    expect(NO_GROUND.heightAt(12, -4)).toBeNull();
  });
});

describe('groundUnder', () => {
  it('asks the query with x and z and ignores the entity height', () => {
    const seen: Array<readonly [number, number]> = [];
    const spy: GroundQuery = {
      heightAt(x, z) {
        seen.push([x, z]);
        return x + z;
      },
    };

    expect(groundUnder(spy, vec3(2, 999, 3))).toBe(5);
    expect(seen).toEqual([[2, 3]]);
  });

  it('passes a missing ground through as null instead of inventing a height', () => {
    expect(groundUnder(NO_GROUND, vec3(0, 5, 0))).toBeNull();
  });

  it('keeps a ground height of 0 distinguishable from no ground at all', () => {
    // `0` is falsy — a `heightAt(...) || fallback` anywhere in this seam would
    // silently turn standing on the sea-level plane into falling.
    expect(groundUnder(flatGround(0), vec3(0, 0, 0))).toBe(0);
  });
});
