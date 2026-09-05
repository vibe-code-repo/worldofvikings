/**
 * Physics tuning values — data, not logic.
 *
 * This module contains no code paths on purpose. Every number a system would
 * otherwise hard-code lives here as a frozen record and can be overridden per
 * call, so a designer changes one place and a test can pin the value.
 *
 * These are engine tuning constants, not world data: authored world content
 * belongs in `content/` and is validated by `@wov/world-schema` (ADR-0004).
 */
import type { CapsuleShape, Vec3 } from './contract.js';

/** Earth gravity, straight down (m/s²). */
export const defaultGravity: Vec3 = Object.freeze({ x: 0, y: -9.81, z: 0 });

/** The player/NPC capsule and everything derived from it (spec §29). */
export const characterPhysics = Object.freeze({
  /** Radius 0.4 m, total height 1.8 m — a human-sized viking. */
  capsule: Object.freeze<CapsuleShape>({ radius: 0.4, height: 1.8 }),
  /** Body mass in kilograms. */
  mass: 80,
  /** Friction against world geometry; low enough not to stick to walls. */
  friction: 0.6,
  /** No bounce: a character must not rebound off the floor. */
  restitution: 0,
  /** Extra distance below the feet that still counts as standing on ground. */
  groundProbeDistance: 0.15,
  /** Default reach of `raycastGround` when no distance is given, in metres. */
  groundRayLength: 100,
});

/**
 * How a frame's elapsed time is turned into simulation steps.
 *
 * One huge integration step is what makes a character tunnel through a floor or
 * jitter after a stall, so `PhysicsWorld.step` splits the frame into substeps of
 * at most `maxSubStepSeconds`. `maxSubSteps` bounds the work per frame: after a
 * very long stall the simulation deliberately drops the surplus time instead of
 * spending ever more time catching up — a slow frame must not make the next one
 * slower still (spec §38).
 */
export const simulationStep = Object.freeze({
  /** Longest slice of time a single substep may cover — 60 Hz. */
  maxSubStepSeconds: 1 / 60,
  /** Most substeps one `step` call may run: about half a second of catch-up. */
  maxSubSteps: 32,
});
