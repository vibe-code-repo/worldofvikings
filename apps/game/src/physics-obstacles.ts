/**
 * The seam between the physics world and the movement system, for what is
 * *beside* an entity (ADR-0026).
 *
 * The sibling of `physics-ground.ts` and built the same way: `@wov/gameplay`
 * asks an `ObstacleQuery` whether a straight move is free, `@wov/physics` casts
 * rays and knows nothing about movement, and the adapter that joins them lives
 * here because this app owns both.
 *
 * **Why rays and not a capsule sweep.** A shape cast cannot be filtered by
 * collision layer in the backend, so a swept capsule would catch the terrain
 * under the player's feet on every slope and stop them walking uphill. Six rays
 * can be aimed exactly where a wall would be and nowhere else, they cost about
 * as much, and — the part that matters — the heights they are cast at *are* the
 * rule: a surface below {@link STEP_HEIGHT} is a step to walk up, a surface
 * above it is a wall to stop at. That is the same number `physics-ground.ts`
 * uses to decide what may become the floor, and the two have to agree or the
 * player will be stopped by a kerb they are standing on.
 */
import type { ObstacleQuery, Vec3 } from '@wov/gameplay';
import type { PhysicsWorld } from '@wov/physics';

/**
 * How high a surface may be before it stops being a step and starts being a
 * wall, in metres.
 *
 * Shared with `physics-ground.ts`, which will not let anything higher than this
 * become the floor. Chosen at 0.45 m: the export's plank paths and dock edges
 * are below it, its house walls and its stone walls are far above it.
 */
export const STEP_HEIGHT = 0.45;

/**
 * The heights above the feet the obstacle rays are cast at, in metres.
 *
 * Two of them, and both are needed. The low one just clears the step height, so
 * a knee-high wall stops the player and a kerb does not. The high one is at
 * chest height, so a wall whose foot happens to be hidden — a fence on a ledge,
 * a beam across a doorway — is not walked through at the waist.
 */
export const PROBE_HEIGHTS: readonly number[] = [STEP_HEIGHT + 0.05, 1.4];

/**
 * An {@link ObstacleQuery} answered by casting rays through collision geometry.
 *
 * For each probe height the move is tested three times: down the middle and
 * once along each side of the body, so a corner is met by the shoulder that
 * would actually hit it rather than by a line through the middle. Each ray runs
 * one radius past the destination, so the player stops in front of a wall
 * instead of inside it.
 */
export function physicsObstacles(physics: PhysicsWorld): ObstacleQuery {
  return {
    isFree(from: Vec3, to: Vec3, radius: number): boolean {
      const deltaX = to.x - from.x;
      const deltaZ = to.z - from.z;
      const distance = Math.hypot(deltaX, deltaZ);
      if (distance === 0) {
        return true;
      }

      // Forward, and the direction across the body: the two offsets the side
      // rays are moved by.
      const forwardX = deltaX / distance;
      const forwardZ = deltaZ / distance;
      const sideX = -forwardZ;
      const sideZ = forwardX;
      const reachX = to.x + forwardX * radius;
      const reachZ = to.z + forwardZ * radius;

      for (const height of PROBE_HEIGHTS) {
        for (const offset of [-radius, 0, radius]) {
          const hit = physics.raycast(
            { x: from.x + sideX * offset, y: from.y + height, z: from.z + sideZ * offset },
            { x: reachX + sideX * offset, y: to.y + height, z: reachZ + sideZ * offset },
          );
          if (hit !== null) {
            return false;
          }
        }
      }
      return true;
    },
  };
}
