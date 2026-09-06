import type { Vec3 } from './vector.js';

/**
 * Everything the movement system needs to know about the world *beside* an
 * entity, as opposed to below it (ADR-0026).
 *
 * It is the sibling of {@link GroundQuery} and deliberately shaped like it: one
 * method, no renderer, no physics engine. Phase 1 answers it with "nothing is
 * in the way", the game answers it by casting against collision geometry, a
 * test answers it from a rectangle on paper — and `MovementSystem` does not
 * change (ADR-0009, ADR-0014).
 *
 * Keeping it a *query* and not a solver is the point. The query says whether a
 * straight move is free; deciding what to do when it is not — stop, slide along
 * the wall, take the other axis — is gameplay, stays pure, and stays testable
 * without a physics backend.
 */
export interface ObstacleQuery {
  /**
   * Whether a body of `radius` can move straight from `from` to `to`.
   *
   * Both points are at the entity's **feet**, the same place the transform is.
   * An implementation decides for itself how far up a wall has to reach before
   * it stops anybody — that is a property of the collision geometry, not of the
   * movement rules.
   */
  isFree(from: Vec3, to: Vec3, radius: number): boolean;
}

/** Nothing is in the way — the behaviour before entities had collision shapes. */
export const NO_OBSTACLES: ObstacleQuery = Object.freeze({ isFree: () => true });
