import { describe, expect, it } from 'vitest';
import type { GroundHit, PhysicsWorld, Vec3 } from '@wov/physics';
import { PROBE_HEIGHTS, STEP_HEIGHT, isWall, physicsObstacles } from './physics-obstacles.js';
import { GROUND_PROBE_HEIGHT } from './physics-ground.js';

/**
 * A world whose only solid thing is the half-space `x >= wallX`, but only
 * between `wallBottom` and `wallTop`. That is enough to tell "a wall", "a kerb"
 * and "a beam overhead" apart, which is what the probe heights are for.
 *
 * Its face points west, back at anybody walking east into it — the way a
 * raycast reports the surface it met.
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
        ? {
            point: { x: wallX, y: from.y, z: from.z },
            normal: { x: -1, y: 0, z: 0 },
            distance: Math.max(0, wallX - from.x),
          }
        : null;
    },
  } as unknown as PhysicsWorld;
  return { world, casts };
}

/** A world that is solid in every direction, with the face pointing west. */
function solidWorld(normal: Vec3 = { x: -1, y: 0, z: 0 }): PhysicsWorld {
  return {
    raycast: (): GroundHit => ({ point: { x: 0, y: 0, z: 0 }, normal, distance: 0 }),
  } as unknown as PhysicsWorld;
}

const FEET = { x: 0, y: 0, z: 0 };

describe('physicsObstacles', () => {
  it('lets a move through when nothing is in the way', () => {
    const { world } = fakeWorld(100);
    expect(physicsObstacles(world).firstHit(FEET, { x: 1, y: 0, z: 0 }, 0.4)).toBeNull();
  });

  it('reports the face a move into a wall runs into', () => {
    const { world } = fakeWorld(1);
    const hit = physicsObstacles(world).firstHit(FEET, { x: 1, y: 0, z: 0 }, 0.4);
    expect(hit?.normal).toEqual({ x: -1, y: 0, z: 0 });
  });

  it('reports the nearest of the six probes, not the first one cast', () => {
    let cast = 0;
    // Every probe hits, each one nearer than the last.
    const world = {
      raycast(): GroundHit {
        cast += 1;
        return {
          point: { x: 0, y: 0, z: 0 },
          normal: { x: -1, y: 0, z: 0 },
          distance: 10 - cast,
        };
      },
    } as unknown as PhysicsWorld;
    const hit = physicsObstacles(world).firstHit(FEET, { x: 1, y: 0, z: 0 }, 0.4);
    expect(hit?.distance).toBe(10 - PROBE_HEIGHTS.length * 3);
  });

  it('stops one radius short, so the body never ends up inside the wall', () => {
    const { world } = fakeWorld(1.3);
    // The destination is 0.4 m short of the wall, but a 0.4 m body reaches it.
    expect(physicsObstacles(world).firstHit(FEET, { x: 0.9, y: 0, z: 0 }, 0.4)).not.toBeNull();
    expect(physicsObstacles(world).firstHit(FEET, { x: 0.5, y: 0, z: 0 }, 0.4)).toBeNull();
  });

  it('probes along both shoulders, not only down the middle', () => {
    const { world, casts } = fakeWorld(100);
    physicsObstacles(world).firstHit(FEET, { x: 1, y: 0, z: 0 }, 0.4);

    const sideways = new Set(casts.map((cast) => cast.from.z.toFixed(3)));
    expect([...sideways].sort()).toEqual(['-0.400', '0.000', '0.400']);
    expect(casts).toHaveLength(PROBE_HEIGHTS.length * 3);
  });

  it('walks over a kerb lower than the step height', () => {
    const { world } = fakeWorld(1, -Infinity, STEP_HEIGHT);
    expect(physicsObstacles(world).firstHit(FEET, { x: 1, y: 0, z: 0 }, 0.4)).toBeNull();
  });

  it('is stopped by a wall that reaches just above the step height', () => {
    const { world } = fakeWorld(1, -Infinity, STEP_HEIGHT + 0.2);
    expect(physicsObstacles(world).firstHit(FEET, { x: 1, y: 0, z: 0 }, 0.4)).not.toBeNull();
  });

  it('is stopped by something at chest height whose foot is not in the way', () => {
    // A rail across a gap: nothing at the knee, a bar at 1.4 m.
    const { world } = fakeWorld(1, 1.2, 1.6);
    expect(physicsObstacles(world).firstHit(FEET, { x: 1, y: 0, z: 0 }, 0.4)).not.toBeNull();
  });

  it('lets a body pressed against a wall walk away from it', () => {
    // Every ray hits, because they all start inside the wall — which is what a
    // ray does once the body is touching one. Walking away is still free
    // (ADR-0036): the move does not close on that face.
    const solid = solidWorld();
    expect(physicsObstacles(solid).firstHit(FEET, { x: -1, y: 0, z: 0 }, 0.4)).toBeNull();
    expect(physicsObstacles(solid).firstHit(FEET, { x: 1, y: 0, z: 0 }, 0.4)).not.toBeNull();
  });

  it('lets a move that runs along a wall past it', () => {
    expect(physicsObstacles(solidWorld()).firstHit(FEET, { x: 0, y: 0, z: 1 }, 0.4)).toBeNull();
  });

  it('ignores a floor or a ceiling, which a horizontal move cannot run into', () => {
    const flat = solidWorld({ x: 0, y: 1, z: 0 });
    expect(physicsObstacles(flat).firstHit(FEET, { x: 1, y: 0, z: 0 }, 0.4)).toBeNull();
  });

  it('walks up a slope gentle enough for the ground query, and stops at a steep one', () => {
    // Both faces lean the same way; only their steepness differs. The gentle
    // one rises less than a step across the body, the steep one more.
    const gentle = Math.atan(STEP_HEIGHT / 0.4) - 0.05;
    const steep = Math.atan(STEP_HEIGHT / 0.4) + 0.05;
    const hillside = (angle: number): Vec3 => ({
      x: -Math.sin(angle),
      y: Math.cos(angle),
      z: 0,
    });
    expect(isWall(hillside(gentle), 0.4)).toBe(false);
    expect(isWall(hillside(steep), 0.4)).toBe(true);
    expect(
      physicsObstacles(solidWorld(hillside(gentle))).firstHit(FEET, { x: 1, y: 0, z: 0 }, 0.4),
    ).toBeNull();
    expect(
      physicsObstacles(solidWorld(hillside(steep))).firstHit(FEET, { x: 1, y: 0, z: 0 }, 0.4),
    ).not.toBeNull();
  });

  it('reports the surface as the raycast saw it, leaning normal and all', () => {
    // The movement rules take the part they work in for themselves; flattening
    // it here would stop the dev bridge telling a hillside from a house wall.
    const face = { x: -0.8, y: -0.6, z: 0 };
    const hit = physicsObstacles(solidWorld(face)).firstHit(FEET, { x: 1, y: 0, z: 0 }, 0.4);
    expect(hit?.normal).toEqual(face);
  });

  it('casts along the slope, so a hill is not a wall', () => {
    const { world, casts } = fakeWorld(100);
    physicsObstacles(world).firstHit(FEET, { x: 1, y: 0.2, z: 0 }, 0.4);
    for (const cast of casts) {
      expect(cast.to.y - cast.from.y).toBeCloseTo(0.2, 6);
    }
  });

  it('asks nothing when the entity does not move', () => {
    const { world, casts } = fakeWorld(0);
    expect(physicsObstacles(world).firstHit(FEET, { x: 0, y: 5, z: 0 }, 0.4)).toBeNull();
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
