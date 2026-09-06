import { ZERO_VEC3, type Vec3 } from './vector.js';

/**
 * Where an entity is. Plain data — the renderer reads it, never owns it
 * (spec §25).
 */
export interface Transform {
  readonly position: Vec3;
  /** Facing around the Y axis in radians. No system writes it in Phase 1. */
  readonly yaw: number;
}

/**
 * How an entity accelerates. Per entity, not per system, so a housecarl and a
 * wolf differ by data instead of by code (agent rule 6, spec §30).
 *
 * All values are in metres and seconds.
 */
export interface MovementTuning {
  /** How fast the entity approaches the intended velocity, in m/s². */
  readonly acceleration: number;
  /** How fast it brakes when there is no intent, in m/s². */
  readonly deceleration: number;
  /** Walking speed cap, in m/s. */
  readonly maxSpeed: number;
  /** Factor applied to {@link maxSpeed} while sprint is held. */
  readonly sprintMultiplier: number;
  /**
   * How wide the entity is, in metres, for the obstacle query (ADR-0026).
   *
   * Per entity for the same reason the speeds are: a wolf squeezes through a
   * gap a housecarl does not. It is a radius, not a diameter, and it matches
   * the physics capsule the character will eventually get.
   */
  readonly radius: number;
}

/**
 * Placeholder tuning for the Phase 1 player.
 *
 * Human walking is roughly 1.4 m/s and running roughly 5 m/s, but a
 * third-person action game reads sluggish at those numbers, so the base speed
 * sits at a brisk jog and sprint adds 60 %. Real values belong in `content/`
 * once the character exists (agent rule 9).
 */
export const DEFAULT_MOVEMENT_TUNING: MovementTuning = Object.freeze({
  acceleration: 30,
  deceleration: 45,
  maxSpeed: 4.5,
  sprintMultiplier: 1.6,
  radius: 0.4,
});

/** Velocity and ground contact of a moving entity. */
export interface Movement {
  /** World-space velocity in m/s. `y` stays 0 until physics owns gravity. */
  readonly velocity: Vec3;
  /** Whether the last ground query found ground under the entity. */
  readonly grounded: boolean;
  readonly tuning: MovementTuning;
}

/** Builds a {@link Transform}. */
export function createTransform(position: Vec3 = ZERO_VEC3, yaw = 0): Transform {
  return { position, yaw };
}

/** Builds a {@link Movement} at rest. */
export function createMovement(tuning: MovementTuning = DEFAULT_MOVEMENT_TUNING): Movement {
  return { velocity: ZERO_VEC3, grounded: false, tuning };
}
