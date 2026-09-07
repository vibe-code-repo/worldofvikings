/**
 * The seam between the physics world and the movement system, for what is
 * *beside* an entity (ADR-0026).
 *
 * The sibling of `physics-ground.ts` and built the same way: `@wov/gameplay`
 * asks an `ObstacleQuery` what a straight move first meets, `@wov/physics` casts
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
 *
 * **Why it reports a surface and not a verdict (ADR-0038).** A boolean can only
 * cancel a move. A normal can turn it: the movement system drops the move onto
 * the face and keeps whatever ran along it, which is how walking at a house
 * becomes walking along a house. The nearest of the six hits wins, because that
 * is the surface the body reaches first.
 */
import type { ObstacleHit, ObstacleQuery, Vec3 } from '@wov/gameplay';
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
 * How far a move has to close on a surface before that surface is in its way,
 * in metres.
 *
 * Not zero, and for a reason that is about the shape of the query rather than
 * about tolerating error. Six rays are cast from around the body, so as soon as
 * the body is against a wall some of them start inside it — and a ray that
 * starts inside geometry reports a hit whichever way it is aimed, including
 * straight back out. Judging a hit by whether the *move* closes on the face,
 * instead of by whether some ray met one, is what keeps a player standing
 * against a house able to walk away from it, and what lets a move that has
 * already been dropped onto a face — and is therefore exactly parallel to it —
 * through.
 *
 * A micrometre a step is 60 µm a second at the fixed rate: below anything the
 * collision geometry itself resolves, and far below the radius of clearance the
 * probes already keep in front of a wall.
 */
const MIN_APPROACH_METRES = 1e-6;

/**
 * Whether a surface is steep enough to be a wall rather than ground.
 *
 * The same rule the probe heights encode, written for a slope instead of for a
 * step: a surface is a wall when it would rise more than {@link STEP_HEIGHT}
 * across the width of the body walking at it. Anything gentler is ground, and
 * the ground query walks the player up it a step at a time.
 *
 * It is needed because the terrain is collision geometry too, and a ray cast
 * along a slope grazes it constantly — every dip, every path edge, every one of
 * the tile's quarter-metre triangles. Judged only by "a ray met something", a
 * hillside is a wall in every direction and the player is walled in by the
 * ground they are standing on. Judged by its normal, a hillside is a hillside
 * and a house wall is still a house wall.
 *
 * `normal` is expected to be a unit vector, the way a raycast reports it.
 */
export function isWall(normal: Vec3, radius: number): boolean {
  const flat = Math.hypot(normal.x, normal.z);
  return flat * radius > STEP_HEIGHT * Math.abs(normal.y);
}

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
    firstHit(from: Vec3, to: Vec3, radius: number): ObstacleHit | null {
      const deltaX = to.x - from.x;
      const deltaZ = to.z - from.z;
      const distance = Math.hypot(deltaX, deltaZ);
      if (distance === 0) {
        return null;
      }

      // Forward, and the direction across the body: the two offsets the side
      // rays are moved by.
      const forwardX = deltaX / distance;
      const forwardZ = deltaZ / distance;
      const sideX = -forwardZ;
      const sideZ = forwardX;
      const reachX = to.x + forwardX * radius;
      const reachZ = to.z + forwardZ * radius;

      let nearest: ObstacleHit | null = null;
      for (const height of PROBE_HEIGHTS) {
        for (const offset of [-radius, 0, radius]) {
          const hit = physics.raycast(
            { x: from.x + sideX * offset, y: from.y + height, z: from.z + sideZ * offset },
            { x: reachX + sideX * offset, y: to.y + height, z: reachZ + sideZ * offset },
          );
          if (hit === null || !isWall(hit.normal, radius)) {
            continue;
          }
          // How far the move closes on the face, in metres. Measured against
          // the face's own direction in the ground plane, so the number the
          // threshold is compared with is a distance and not a cosine.
          const flat = Math.hypot(hit.normal.x, hit.normal.z);
          const approach = (deltaX * hit.normal.x + deltaZ * hit.normal.z) / flat;
          if (approach > -MIN_APPROACH_METRES) {
            continue;
          }
          if (nearest === null || hit.distance < nearest.distance) {
            // The surface as the raycast reported it, not flattened: the
            // movement rules take the part they work in for themselves, and a
            // flattened normal would tell the dev bridge a hillside and a house
            // wall apart no longer.
            nearest = { normal: hit.normal, distance: hit.distance };
          }
        }
      }
      return nearest;
    },
  };
}
