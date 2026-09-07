import type { Vec3 } from './vector.js';

/**
 * The surface a move ran into (ADR-0038).
 *
 * The normal is what makes sliding possible at all: "the way is blocked" says
 * only that the player has to stop, "the way is blocked by a face pointing this
 * way" says which direction is still open. It points **out of** the surface,
 * the way a raycast reports it, so a wall somebody walks into has a normal
 * aimed back at them.
 */
export interface ObstacleHit {
  /**
   * Unit normal of the surface, pointing out of it.
   *
   * Only `x` and `z` decide anything today — the movement rules work in the
   * horizontal plane — but the whole vector is carried so a rule about slopes
   * does not have to change the contract to be written.
   */
  readonly normal: Vec3;
  /** Distance from the start of the move to the surface, in metres. */
  readonly distance: number;
}

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
 * Keeping it a *query* and not a solver is the point. The query says what a
 * straight move first meets; deciding what to do about it — stop, slide along
 * the face, give up — is gameplay, stays pure, and stays testable without a
 * physics backend (ADR-0038, `slideMove`).
 */
export interface ObstacleQuery {
  /**
   * The first surface a body of `radius` meets moving straight from `from` to
   * `to`, or `null` when the way is clear.
   *
   * Both points are at the entity's **feet**, the same place the transform is.
   * An implementation decides for itself how far up a wall has to reach before
   * it stops anybody — that is a property of the collision geometry, not of the
   * movement rules.
   *
   * A surface the move does not *approach* is not in the way. Standing against
   * a wall and walking away from it is a clear path, whatever a ray that
   * started inside that wall has to say about it — without that rule a body
   * wedged into a corner cannot even back out of it, which is the state this
   * contract was rewritten to end (ADR-0038).
   */
  firstHit(from: Vec3, to: Vec3, radius: number): ObstacleHit | null;
}

/** Nothing is in the way — the behaviour before entities had collision shapes. */
export const NO_OBSTACLES: ObstacleQuery = Object.freeze({ firstHit: () => null });
