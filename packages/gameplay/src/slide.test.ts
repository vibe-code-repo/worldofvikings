import { describe, expect, it } from 'vitest';
import { flatGround, type GroundQuery } from './ground.js';
import type { ObstacleHit, ObstacleQuery } from './obstacles.js';
import { MAX_SLIDE_ATTEMPTS, slideMove } from './slide.js';
import { horizontalLength, vec3, type Vec3 } from './vector.js';

const GROUND: GroundQuery = flatGround(0);
const RADIUS = 0.4;
const ORIGIN = vec3(0, 0, 0);

/**
 * A wall as a half-space, written the way collision geometry behaves.
 *
 * The face's outside points along `normal`; everything on the other side of the
 * plane `depth` metres out from the origin is solid. A move is refused when its
 * destination — plus the body's radius, the way a real probe reaches past the
 * destination — would end up behind the face **and** the move actually
 * approaches it. That last clause is the rule the game's own query follows
 * (ADR-0036): a body already touching a wall must still be able to walk away
 * from it, whatever a probe that started inside the wall reports.
 */
function wall(normal: Vec3, depth: number): ObstacleQuery {
  const length = horizontalLength(normal.x, normal.z);
  const unit = vec3(normal.x / length, 0, normal.z / length);
  return {
    firstHit(from, to, radius): ObstacleHit | null {
      const approach = (to.x - from.x) * unit.x + (to.z - from.z) * unit.z;
      if (approach >= 0) {
        return null;
      }
      const reach = to.x * unit.x + to.z * unit.z - radius;
      return reach < depth ? { normal: unit, distance: 0 } : null;
    },
  };
}

/** Two half-spaces at once: the first one that refuses the move answers. */
function corner(first: ObstacleQuery, second: ObstacleQuery): ObstacleQuery {
  return {
    firstHit: (from, to, radius) =>
      first.firstHit(from, to, radius) ?? second.firstHit(from, to, radius),
  };
}

/** A wall facing west, so everything at `x >= at` is solid. */
function wallEastOf(at: number): ObstacleQuery {
  return wall(vec3(-1, 0, 0), -at);
}

/** A wall facing south, so everything at `z >= at` is solid. */
function wallNorthOf(at: number): ObstacleQuery {
  return wall(vec3(0, 0, -1), -at);
}

describe('slideMove', () => {
  const ask = (
    toX: number,
    toZ: number,
    obstacles: ObstacleQuery,
    from: Vec3 = ORIGIN,
  ): ReturnType<typeof slideMove> =>
    slideMove({ from, toX, toZ, radius: RADIUS, ground: GROUND, obstacles });

  it('lets a move through untouched when nothing is in the way', () => {
    const outcome = ask(1, 2, { firstHit: () => null });
    expect(outcome).toMatchObject({ x: 1, z: 2, blocked: false });
    expect(outcome.normals).toEqual([]);
  });

  it('stops dead against a wall walked into head-on', () => {
    const outcome = ask(0.5, 0, wallEastOf(0.5));
    expect(outcome.blocked).toBe(true);
    expect({ x: outcome.x, z: outcome.z }).toEqual({ x: 0, z: 0 });
    expect(outcome.normals[0]).toEqual(vec3(-1, 0, 0));
  });

  it('never puts the body past the face it was stopped by', () => {
    const east = wallEastOf(1);
    let at = ORIGIN;
    for (let step = 0; step < 200; step += 1) {
      const outcome = ask(at.x + 0.1, at.z, east, at);
      at = vec3(outcome.x, 0, outcome.z);
    }
    expect(at.x).toBeLessThanOrEqual(1 - RADIUS);
  });

  it('keeps the along-wall part of a move that meets the wall at 30 degrees', () => {
    // 30° to the *wall*: mostly along it, a little into it.
    const angle = (30 * Math.PI) / 180;
    const outcome = ask(Math.sin(angle), Math.cos(angle), wallEastOf(0.5));
    expect(outcome.blocked).toBe(false);
    // The whole component into the wall is gone, the one along it is untouched.
    expect(outcome.x).toBeCloseTo(0, 10);
    expect(outcome.z).toBeCloseTo(Math.cos(angle), 10);
  });

  it('keeps the along-wall part of a move that meets the wall at 60 degrees', () => {
    const angle = (60 * Math.PI) / 180;
    const outcome = ask(Math.sin(angle), Math.cos(angle), wallEastOf(0.5));
    expect(outcome.blocked).toBe(false);
    expect(outcome.x).toBeCloseTo(0, 10);
    expect(outcome.z).toBeCloseTo(Math.cos(angle), 10);
  });

  it('slides along a second face when the first one deflects into it', () => {
    // East of x = 0.5 is solid, and so is everything past a diagonal face that
    // the deflected move runs into. Sliding twice leaves a direction that is
    // free of both, which one deflection alone would not have found.
    const diagonal = wall(vec3(-1, 0, -1), -0.5);
    const outcome = ask(1, 0.5, corner(wallEastOf(0.5), diagonal));
    expect(outcome.blocked).toBe(false);
    expect(outcome.normals).toHaveLength(2);
    expect(outcome.x).toBeCloseTo(-0.25, 10);
    expect(outcome.z).toBeCloseTo(0.25, 10);
  });

  it('stops in a corner instead of grinding through one of its walls', () => {
    const outcome = ask(1, 1, corner(wallEastOf(1), wallNorthOf(1)));
    expect(outcome.blocked).toBe(true);
    expect({ x: outcome.x, z: outcome.z }).toEqual({ x: 0, z: 0 });
    expect(outcome.normals.length).toBeGreaterThanOrEqual(2);
  });

  it('always lets a body pressed against a wall back away from it', () => {
    const against = vec3(1 - RADIUS, 0, 0);
    const outcome = ask(against.x - 0.1, 0, wallEastOf(1), against);
    expect(outcome.blocked).toBe(false);
    expect(outcome.x).toBeCloseTo(against.x - 0.1, 10);
  });

  it('backs out of a corner it cannot slide out of', () => {
    const wedged = vec3(1 - RADIUS, 0, 1 - RADIUS);
    const outcome = ask(
      wedged.x - 0.1,
      wedged.z - 0.1,
      corner(wallEastOf(1), wallNorthOf(1)),
      wedged,
    );
    expect(outcome.blocked).toBe(false);
    expect(outcome.x).toBeCloseTo(wedged.x - 0.1, 10);
    expect(outcome.z).toBeCloseTo(wedged.z - 0.1, 10);
  });

  it('asks the obstacle query one more time than it may slide, and no more', () => {
    let asked = 0;
    // A face angled 45° against whatever is asked for: always in the way, and
    // always leaving something to slide along, so the solver can only ever be
    // stopped by its own budget.
    const endless: ObstacleQuery = {
      firstHit: (from, to): ObstacleHit => {
        asked += 1;
        const dx = to.x - from.x;
        const dz = to.z - from.z;
        const length = horizontalLength(dx, dz) || 1;
        const backX = -dx / length;
        const backZ = -dz / length;
        const quarter = Math.SQRT1_2;
        return {
          normal: vec3(backX * quarter - backZ * quarter, 0, backX * quarter + backZ * quarter),
          distance: 0,
        };
      },
    };
    ask(1, 1, endless);
    expect(asked).toBe(MAX_SLIDE_ATTEMPTS + 1);
  });

  it('asks nothing at all when the move is zero', () => {
    let asked = 0;
    const outcome = slideMove({
      from: ORIGIN,
      toX: 0,
      toZ: 0,
      radius: RADIUS,
      ground: GROUND,
      obstacles: {
        firstHit: () => {
          asked += 1;
          return null;
        },
      },
    });
    expect(asked).toBe(0);
    expect(outcome).toMatchObject({ x: 0, z: 0, blocked: false });
  });

  it('probes along the ground, so the obstacle query sees the slope', () => {
    const seen: Vec3[] = [];
    slideMove({
      from: ORIGIN,
      toX: 2,
      toZ: 0,
      radius: RADIUS,
      ground: { heightAt: (x) => x * 0.25 },
      obstacles: {
        firstHit: (_from, to) => {
          seen.push(to);
          return null;
        },
      },
    });
    expect(seen[0]?.y).toBeCloseTo(0.5, 10);
  });

  it('keeps the body at its own height where the ground query has no answer', () => {
    const seen: Vec3[] = [];
    slideMove({
      from: vec3(0, 7, 0),
      toX: 1,
      toZ: 0,
      radius: RADIUS,
      ground: { heightAt: () => null },
      obstacles: {
        firstHit: (_from, to) => {
          seen.push(to);
          return null;
        },
      },
    });
    expect(seen[0]?.y).toBe(7);
  });
});
