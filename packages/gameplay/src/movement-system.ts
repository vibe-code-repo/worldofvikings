import type { Movement, Transform } from './components.js';
import type { EntityId } from './entity.js';
import { flatGround, type GroundQuery } from './ground.js';
import { NEUTRAL_INPUT, inputEquals, type InputState } from './input.js';
import { horizontalLength, type Vec3 } from './vector.js';
import type { WorldState } from './world.js';

/** Ground used when a caller does not pass one — the Phase 1 flat plane. */
const DEFAULT_GROUND: GroundQuery = flatGround(0);

interface StepResult {
  readonly transform: Transform;
  readonly movement: Movement;
  readonly changed: boolean;
}

/**
 * Intended horizontal velocity for one entity.
 *
 * A diagonal is normalised so `W`+`D` is not 41 % faster than `W` alone, but a
 * partly deflected stick keeps its magnitude: only lengths above 1 are scaled
 * down.
 */
function intendedVelocity(input: InputState, movement: Movement): { x: number; z: number } {
  const length = horizontalLength(input.moveX, input.moveZ);
  if (length === 0) {
    return { x: 0, z: 0 };
  }

  const scale = length > 1 ? 1 / length : 1;
  const { tuning } = movement;
  const speed = tuning.maxSpeed * (input.sprint ? tuning.sprintMultiplier : 1);
  return { x: input.moveX * scale * speed, z: input.moveZ * scale * speed };
}

function stepEntity(
  transform: Transform,
  movement: Movement,
  input: InputState,
  dt: number,
  ground: GroundQuery,
): StepResult {
  const target = intendedVelocity(input, movement);
  const velocity = movement.velocity;

  // Approach the intended velocity at a constant rate. One rate for pushing,
  // a second for braking, so letting go feels crisper than starting off.
  const hasIntent = target.x !== 0 || target.z !== 0;
  const rate = hasIntent ? movement.tuning.acceleration : movement.tuning.deceleration;
  const deltaX = target.x - velocity.x;
  const deltaZ = target.z - velocity.z;
  const deltaLength = horizontalLength(deltaX, deltaZ);
  const maxChange = rate * dt;

  let nextVx: number;
  let nextVz: number;
  if (deltaLength === 0 || deltaLength <= maxChange) {
    nextVx = target.x;
    nextVz = target.z;
  } else {
    nextVx = velocity.x + (deltaX / deltaLength) * maxChange;
    nextVz = velocity.z + (deltaZ / deltaLength) * maxChange;
  }

  // Semi-implicit Euler: the new velocity moves the entity in the same step.
  // Fixing this order is half of what makes the simulation reproducible.
  const nextX = transform.position.x + nextVx * dt;
  const nextZ = transform.position.z + nextVz * dt;

  const groundHeight = ground.heightAt(nextX, nextZ);
  const grounded = groundHeight !== null;
  const nextY = grounded ? groundHeight : transform.position.y;

  const moved =
    nextX !== transform.position.x ||
    nextY !== transform.position.y ||
    nextZ !== transform.position.z;
  const velocityChanged = nextVx !== velocity.x || nextVz !== velocity.z;
  const groundChanged = grounded !== movement.grounded;

  if (!moved && !velocityChanged && !groundChanged) {
    return { transform, movement, changed: false };
  }

  const position: Vec3 = moved ? { x: nextX, y: nextY, z: nextZ } : transform.position;
  const nextVelocity: Vec3 = velocityChanged ? { x: nextVx, y: velocity.y, z: nextVz } : velocity;

  return {
    transform: moved ? { position, yaw: transform.yaw } : transform,
    movement:
      velocityChanged || groundChanged
        ? { velocity: nextVelocity, grounded, tuning: movement.tuning }
        : movement,
    changed: true,
  };
}

/**
 * Turns intent into position.
 *
 * `update` is a pure function of `(state, input, dt, ground)`: it reads no
 * clock, no random source and no module-level state, it never mutates the
 * state it is given, and it returns the same numbers for the same arguments on
 * every machine (ADR-0009). Run it once per fixed step of
 * {@link advance | the step accumulator} and it is reproducible.
 *
 * `input` is the intent of this tick for every entity that carries an Input
 * component — in Phase 1 exactly the player. Entities with a Movement but no
 * Input component (scenery, later NPCs before their AI system exists) coast to
 * a stop instead of following the player's keys.
 */
export const MovementSystem = {
  update(
    state: WorldState,
    input: InputState,
    dt: number,
    ground: GroundQuery = DEFAULT_GROUND,
  ): WorldState {
    if (!Number.isFinite(dt) || dt < 0) {
      throw new RangeError(`MovementSystem.update: dt must be finite and >= 0, got ${dt}`);
    }
    if (dt === 0) {
      return state;
    }

    // Record the intent in the Input component first: a system that runs after
    // this one (animation, combat) reads intent from the state, not from the
    // caller. Attacking while standing still must survive too, so this happens
    // whether or not anybody moved.
    let inputs: Map<EntityId, InputState> | undefined;
    for (const [id, stored] of state.inputs) {
      if (!inputEquals(stored, input)) {
        inputs ??= new Map(state.inputs);
        inputs.set(id, input);
      }
    }

    let transforms: Map<EntityId, Transform> | undefined;
    let movements: Map<EntityId, Movement> | undefined;

    for (const id of state.entities) {
      const transform = state.transforms.get(id);
      const movement = state.movements.get(id);
      if (transform === undefined || movement === undefined) {
        continue;
      }

      const entityInput = state.inputs.has(id) ? input : NEUTRAL_INPUT;
      const stepped = stepEntity(transform, movement, entityInput, dt, ground);
      if (!stepped.changed) {
        continue;
      }

      transforms ??= new Map(state.transforms);
      movements ??= new Map(state.movements);
      transforms.set(id, stepped.transform);
      movements.set(id, stepped.movement);
    }

    // Nothing changed: hand back the identical object so callers can skip work
    // with a reference check instead of a deep comparison.
    if (transforms === undefined && inputs === undefined) {
      return state;
    }

    return {
      entities: state.entities,
      transforms: transforms ?? state.transforms,
      movements: movements ?? state.movements,
      inputs: inputs ?? state.inputs,
    };
  },
} as const;
