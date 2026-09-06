/**
 * @wov/gameplay — gameplay state and systems.
 *
 * Hard rule (spec §25, agent rule 7): gameplay state never lives inside a
 * Babylon.js mesh, and this package never imports a renderer. The state is
 * plain data, the systems are pure functions over it (ADR-0009).
 */

export { toEntityId, type EntityId } from './entity.js';
export { ZERO_VEC3, horizontalLength, vec3, type Vec3 } from './vector.js';
export {
  DEFAULT_MOVEMENT_TUNING,
  createMovement,
  createTransform,
  type Movement,
  type MovementTuning,
  type Transform,
} from './components.js';
export {
  NEUTRAL_INPUT,
  QUICK_SLOT_COUNT,
  createInputState,
  inputEquals,
  type InputState,
} from './input.js';
export { NO_GROUND, flatGround, groundUnder, type GroundQuery } from './ground.js';
export { NO_OBSTACLES, type ObstacleQuery } from './obstacles.js';
export {
  addEntity,
  createWorldState,
  getInput,
  getMovement,
  getTransform,
  type EntitySpec,
  type WorldState,
} from './world.js';
export {
  DEFAULT_FIXED_DELTA,
  DEFAULT_MAX_STEPS_PER_FRAME,
  advance,
  createStepAccumulator,
  type FixedStepAccumulator,
  type FixedStepResult,
  type StepAccumulatorOptions,
} from './fixed-step.js';
export { MovementSystem } from './movement-system.js';
