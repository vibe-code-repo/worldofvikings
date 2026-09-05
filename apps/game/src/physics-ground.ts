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

/**
 * How far above the entity the downward ray starts, in metres.
 *
 * Not zero: a ray that starts exactly on the surface can miss it, and a step up
 * would be invisible to a ray starting below its edge. Not "very high" either —
 * the ray must not start above a ceiling, or standing in a house would report
 * the roof as the floor. Head height plus a little is the honest compromise
 * while the character is a capsule.
 */
export const GROUND_PROBE_HEIGHT = 2.5;

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
