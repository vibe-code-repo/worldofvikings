/**
 * The seam between the physics world and the movement system.
 *
 * `@wov/gameplay` adheres entities to a `GroundQuery` — one method,
 * `heightAt(x, z)` — and knows nothing about how it is answered (ADR-0009).
 * `@wov/physics` casts rays and knows nothing about gameplay (ADR-0013).
 * Neither package may import the other, so the adapter that joins them lives
 * here, in the app that owns both.
 *
 * Until this existed the game walked on `flatGround(0)`: a hard-coded plane
 * that agrees with the placeholder ground by coincidence and would keep
 * agreeing after the ground stopped being flat.
 */
import type { GroundQuery } from '@wov/gameplay';
import type { PhysicsWorld } from '@wov/physics';
import { STEP_HEIGHT } from './physics-obstacles.js';

/**
 * How far above the entity the downward ray starts, in metres.
 *
 * Not zero: a ray that starts exactly on the surface can miss it, and a step up
 * would be invisible to a ray starting below its edge. Not head height either,
 * which is where it used to be: since the world's entities became collision
 * geometry (ADR-0026) a ray that starts above a low roof reports that roof as
 * the floor and teleports the player onto it.
 *
 * So it starts exactly one step above the feet. Everything the player can walk
 * up is inside that reach and everything higher is unreachable by definition —
 * which is the same rule `physics-obstacles.ts` enforces from the side, and the
 * reason the two share the number.
 */
export const GROUND_PROBE_HEIGHT = STEP_HEIGHT;

/**
 * A {@link GroundQuery} answered by casting down through collision geometry.
 *
 * `heightAt` carries no `y`, so the ray needs one from somewhere: `probeFrom`
 * supplies the height the entity is currently at, read fresh on every call. A
 * fixed world-space height would work on the Phase 1 plane and break on the
 * first bridge.
 *
 * `null` — no ground — is a real answer, not an error: it is what a gap, a
 * ledge or the space past the level's edge looks like, and the movement system
 * treats it as airborne.
 */
export function physicsGround(physics: PhysicsWorld, probeFrom: () => number): GroundQuery {
  return {
    heightAt(x: number, z: number): number | null {
      const hit = physics.raycastGround({ x, y: probeFrom() + GROUND_PROBE_HEIGHT, z });
      return hit ? hit.point.y : null;
    },
  };
}
