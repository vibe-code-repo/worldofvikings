import type { Vec3 } from './vector.js';

/**
 * Everything the movement system needs to know about the world below an entity.
 *
 * Keeping ground adhesion behind this one method is what lets `@wov/gameplay`
 * stay renderer-free: Phase 1 answers it from a flat plane, a later phase from
 * a Havok raycast (spec §29), a test from a lookup table — the system does not
 * change.
 */
export interface GroundQuery {
  /**
   * World-space height of the ground at `(x, z)`, or `null` where there is
   * none — a gap, a ledge, the space outside the level.
   */
  heightAt(x: number, z: number): number | null;
}

/** A perfectly flat plane, the Phase 1 stand-in for real terrain. */
export function flatGround(height = 0): GroundQuery {
  return { heightAt: () => height };
}

/** No ground anywhere. Entities keep their height and count as airborne. */
export const NO_GROUND: GroundQuery = Object.freeze({ heightAt: () => null });

/** Reads a ground height for a position, ignoring its `y`. */
export function groundUnder(ground: GroundQuery, position: Vec3): number | null {
  return ground.heightAt(position.x, position.z);
}
