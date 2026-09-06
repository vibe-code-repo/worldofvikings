import { describe, expect, it } from 'vitest';
import type { GroundHit, PhysicsWorld, Vec3 } from '@wov/physics';
import { PROBE_HEIGHTS, STEP_HEIGHT, physicsObstacles } from './physics-obstacles.js';
import { GROUND_PROBE_HEIGHT } from './physics-ground.js';

/**
 * A world whose only solid thing is the half-space `x >= wallX`, but only
 * between `wallBottom` and `wallTop`. That is enough to tell "a wall", "a kerb"
 * and "a beam overhead" apart, which is what the probe heights are for.
 */
function fakeWorld(
  wallX: number,
  wallBottom = -Infinity,
  wallTop = Infinity,
): { readonly world: PhysicsWorld; readonly casts: { from: Vec3; to: Vec3 }[] } {
  const casts: { from: Vec3; to: Vec3 }[] = [];
  const world = {
    raycast(from: Vec3, to: Vec3): GroundHit | null {
      casts.push({ from, to });
      const heightHits = from.y >= wallBottom && from.y <= wallTop;
      const crosses = Math.max(from.x, to.x) >= wallX;
      return heightHits && crosses
        ? { point: { x: wallX, y: from.y, z: from.z }, normal: { x: -1, y: 0, z: 0 }, distance: 0 }
        : null;
    },
  } as unknown as PhysicsWorld;
  return { world, casts };
}

const FEET = { x: 0, y: 0, z: 0 };

describe('physicsObstacles', () => {
  it('lets a move through when nothing is in the way', () => {
    const { world } = fakeWorld(100);
    expect(physicsObstacles(world).isFree(FEET, { x: 1, y: 0, z: 0 }, 0.4)).toBe(true);
  });

  it('refuses a move into a wall', () => {
    const { world } = fakeWorld(1);
    expect(physicsObstacles(world).isFree(FEET, { x: 1, y: 0, z: 0 }, 0.4)).toBe(false);
  });

  it('stops one radius short, so the body never ends up inside the wall', () => {
    const { world } = fakeWorld(1.3);
    // The destination is 0.4 m short of the wall, but a 0.4 m body reaches it.
    expect(physicsObstacles(world).isFree(FEET, { x: 0.9, y: 0, z: 0 }, 0.4)).toBe(false);
    expect(physicsObstacles(world).isFree(FEET, { x: 0.5, y: 0, z: 0 }, 0.4)).toBe(true);
  });

  it('probes along both shoulders, not only down the middle', () => {
    const { world, casts } = fakeWorld(100);
    physicsObstacles(world).isFree(FEET, { x: 1, y: 0, z: 0 }, 0.4);

    const sideways = new Set(casts.map((cast) => cast.from.z.toFixed(3)));
    expect([...sideways].sort()).toEqual(['-0.400', '0.000', '0.400']);
    expect(casts).toHaveLength(PROBE_HEIGHTS.length * 3);
  });

  it('walks over a kerb lower than the step height', () => {
    const { world } = fakeWorld(1, -Infinity, STEP_HEIGHT);
    expect(physicsObstacles(world).isFree(FEET, { x: 1, y: 0, z: 0 }, 0.4)).toBe(true);
  });

  it('is stopped by a wall that reaches just above the step height', () => {
    const { world } = fakeWorld(1, -Infinity, STEP_HEIGHT + 0.2);
    expect(physicsObstacles(world).isFree(FEET, { x: 1, y: 0, z: 0 }, 0.4)).toBe(false);
  });

  it('is stopped by something at chest height whose foot is not in the way', () => {
    // A rail across a gap: nothing at the knee, a bar at 1.4 m.
    const { world } = fakeWorld(1, 1.2, 1.6);
    expect(physicsObstacles(world).isFree(FEET, { x: 1, y: 0, z: 0 }, 0.4)).toBe(false);
  });

  it('casts along the slope, so a hill is not a wall', () => {
    const { world, casts } = fakeWorld(100);
    physicsObstacles(world).isFree(FEET, { x: 1, y: 0.2, z: 0 }, 0.4);
    for (const cast of casts) {
      expect(cast.to.y - cast.from.y).toBeCloseTo(0.2, 6);
    }
  });

  it('asks nothing when the entity does not move', () => {
    const { world, casts } = fakeWorld(0);
    expect(physicsObstacles(world).isFree(FEET, { x: 0, y: 5, z: 0 }, 0.4)).toBe(true);
    expect(casts).toHaveLength(0);
  });

  it('agrees with the ground probe about what a step is', () => {
    // The two rules have to be one rule: anything the ground probe can pull the
    // player up onto must be below the lowest obstacle ray, or the player is
    // stopped by a kerb they are standing on.
    expect(GROUND_PROBE_HEIGHT).toBe(STEP_HEIGHT);
    expect(Math.min(...PROBE_HEIGHTS)).toBeGreaterThan(STEP_HEIGHT);
  });
});
