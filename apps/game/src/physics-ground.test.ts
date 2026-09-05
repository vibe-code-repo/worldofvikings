import { describe, expect, it } from 'vitest';
import {
  MovementSystem,
  NEUTRAL_INPUT,
  createInputState,
  createMovement,
  createTransform,
  createWorldState,
  getTransform,
  toEntityId,
} from '@wov/gameplay';
import type { GroundHit, PhysicsWorld, Vec3 } from '@wov/physics';
import { GROUND_PROBE_HEIGHT, physicsGround } from './physics-ground.js';

/** Records every ray the adapter casts and answers from a height function. */
function fakePhysics(surface: (x: number, z: number) => number | null): {
  readonly world: PhysicsWorld;
  readonly origins: Vec3[];
} {
  const origins: Vec3[] = [];
  const world = {
    raycastGround(origin: Vec3): GroundHit | null {
      origins.push(origin);
      const height = surface(origin.x, origin.z);
      if (height === null) {
        return null;
      }
      return {
        point: { x: origin.x, y: height, z: origin.z },
        normal: { x: 0, y: 1, z: 0 },
        distance: origin.y - height,
      };
    },
  } as unknown as PhysicsWorld;
  return { world, origins };
}

describe('physicsGround', () => {
  it('answers the height the ray hit', () => {
    const { world } = fakePhysics(() => 1.25);
    expect(physicsGround(world, () => 0).heightAt(3, -4)).toBe(1.25);
  });

  it('reports no ground where the ray misses', () => {
    // A gap is a real answer, not a failure: the movement system reads it as
    // airborne and leaves the entity at its own height.
    const { world } = fakePhysics(() => null);
    expect(physicsGround(world, () => 0).heightAt(0, 0)).toBeNull();
  });

  it('casts from the queried column, above the entity', () => {
    const { world, origins } = fakePhysics(() => 0);
    physicsGround(world, () => 7).heightAt(2, -6);

    expect(origins).toEqual([{ x: 2, y: 7 + GROUND_PROBE_HEIGHT, z: -6 }]);
  });

  it('follows the entity rather than probing from a fixed height', () => {
    // The whole point of the getter. With a constant origin, a character on an
    // upper floor would be pulled down to the ground floor the moment a ray
    // started above the ceiling — so the probe has to move with the entity.
    let height = 0;
    const { world, origins } = fakePhysics(() => 0);
    const ground = physicsGround(world, () => height);

    ground.heightAt(0, 0);
    height = 12;
    ground.heightAt(0, 0);

    expect(origins.map((origin) => origin.y)).toEqual([
      GROUND_PROBE_HEIGHT,
      12 + GROUND_PROBE_HEIGHT,
    ]);
  });

  it('sticks a walking entity to a sloped surface', () => {
    // The seam the adapter exists for: MovementSystem does not know a raycast
    // is behind `heightAt`, and the surface is no longer flat. With the old
    // hard-coded `flatGround(0)` this test's expectation would be y === 0.
    const { world } = fakePhysics((x) => x * 0.5);
    const ground = physicsGround(world, () => 0);

    const walkerId = toEntityId('walker');
    let state = createWorldState([
      {
        id: walkerId,
        transform: createTransform({ x: 0, y: 0, z: 0 }),
        movement: createMovement(),
        input: NEUTRAL_INPUT,
      },
    ]);

    // Straight along +x at full tilt, for long enough to leave the origin.
    const walking = createInputState({ moveX: 1 });
    for (let step = 0; step < 60; step += 1) {
      state = MovementSystem.update(state, walking, 1 / 60, ground);
    }

    const walker = getTransform(state, walkerId);
    expect(walker).toBeDefined();
    expect(walker?.position.x).toBeGreaterThan(1);
    expect(walker?.position.y).toBeCloseTo((walker?.position.x ?? 0) * 0.5, 6);
  });
});
