import { describe, expect, it } from 'vitest';
import { type MovementTuning, createMovement, createTransform } from './components.js';
import { type EntityId, toEntityId } from './entity.js';
import { advance, createStepAccumulator } from './fixed-step.js';
import { NO_GROUND, flatGround } from './ground.js';
import { NO_OBSTACLES, type ObstacleQuery } from './obstacles.js';
import { horizontalLength, type Vec3 } from './vector.js';
import { type InputState, NEUTRAL_INPUT, createInputState } from './input.js';
import { MovementSystem } from './movement-system.js';
import { type WorldState, createWorldState, getInput, getMovement, getTransform } from './world.js';

/** Tuning with round numbers so the expected distance can be derived by hand. */
const TEST_TUNING: MovementTuning = {
  acceleration: 20,
  deceleration: 30,
  maxSpeed: 5,
  sprintMultiplier: 1.6,
  radius: 0.4,
};

const DT = 1 / 60;
const PLAYER = toEntityId('player');
const GROUND = flatGround(0);

function world(tuning: MovementTuning = TEST_TUNING): WorldState {
  return createWorldState([
    {
      id: 'player',
      transform: createTransform(),
      movement: createMovement(tuning),
      input: NEUTRAL_INPUT,
    },
  ]);
}

function run(state: WorldState, input: InputState, steps: number, dt = DT): WorldState {
  let next = state;
  for (let step = 0; step < steps; step += 1) {
    next = MovementSystem.update(next, input, dt, GROUND);
  }
  return next;
}

function positionOf(state: WorldState, id: EntityId = PLAYER) {
  const transform = getTransform(state, id);
  if (transform === undefined) {
    throw new Error(`no transform for ${id}`);
  }
  return transform.position;
}

function velocityOf(state: WorldState, id: EntityId = PLAYER) {
  const movement = getMovement(state, id);
  if (movement === undefined) {
    throw new Error(`no movement for ${id}`);
  }
  return movement.velocity;
}

function horizontalSpeed(state: WorldState, id: EntityId = PLAYER): number {
  const velocity = velocityOf(state, id);
  return Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
}

describe('MovementSystem.update — no input', () => {
  it('leaves a standing entity exactly where it is', () => {
    const after = run(world(), NEUTRAL_INPUT, 60);

    expect(positionOf(after)).toEqual({ x: 0, y: 0, z: 0 });
    expect(velocityOf(after)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('returns the very same state object when nothing changed', () => {
    // The first step still changes something: it discovers the ground under a
    // freshly spawned entity. From the second step on the state is identical,
    // which lets a caller skip work with a reference check.
    const settled = MovementSystem.update(world(), NEUTRAL_INPUT, DT, GROUND);

    expect(MovementSystem.update(settled, NEUTRAL_INPUT, DT, GROUND)).toBe(settled);
  });

  it('brakes a moving entity to a full stop at the deceleration rate', () => {
    const moving = run(world(), createInputState({ moveZ: 1 }), 60);
    expect(horizontalSpeed(moving)).toBeCloseTo(5, 12);

    // 5 m/s at 30 m/s² needs 1/6 s, i.e. 10 steps; 12 steps must be standing still.
    const stopped = run(moving, NEUTRAL_INPUT, 12);
    expect(velocityOf(stopped)).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('MovementSystem.update — walking', () => {
  it('covers the distance the acceleration ramp predicts in one second', () => {
    const after = run(world(), createInputState({ moveZ: 1 }), 60);

    // Velocity after step n is min(5, n/3) m/s, position adds v * dt per step:
    // steps 1..15 sum to 40, steps 16..60 add 45 * 5 = 225 → 265 / 60 m.
    expect(positionOf(after).z).toBeCloseTo(265 / 60, 9);
    expect(positionOf(after).x).toBe(0);
    expect(horizontalSpeed(after)).toBeCloseTo(TEST_TUNING.maxSpeed, 12);
  });

  it('never exceeds the maximum speed', () => {
    const after = run(world(), createInputState({ moveZ: 1 }), 600);

    expect(horizontalSpeed(after)).toBeLessThanOrEqual(TEST_TUNING.maxSpeed + 1e-12);
  });

  it('keeps a partially deflected axis slow instead of snapping to full speed', () => {
    const after = run(world(), createInputState({ moveZ: 0.5 }), 120);

    expect(horizontalSpeed(after)).toBeCloseTo(TEST_TUNING.maxSpeed * 0.5, 12);
  });
});

describe('MovementSystem.update — sprint', () => {
  it('scales the top speed by the sprint factor', () => {
    const walk = run(world(), createInputState({ moveZ: 1 }), 120);
    const sprint = run(world(), createInputState({ moveZ: 1, sprint: true }), 120);

    expect(horizontalSpeed(walk)).toBeCloseTo(5, 12);
    expect(horizontalSpeed(sprint)).toBeCloseTo(5 * TEST_TUNING.sprintMultiplier, 12);
    expect(positionOf(sprint).z).toBeGreaterThan(positionOf(walk).z);
  });
});

describe('MovementSystem.update — diagonal', () => {
  it('normalises a diagonal so it is not faster than a straight line', () => {
    const straight = run(world(), createInputState({ moveZ: 1 }), 120);
    const diagonal = run(world(), createInputState({ moveX: 1, moveZ: 1 }), 120);

    expect(horizontalSpeed(diagonal)).toBeCloseTo(horizontalSpeed(straight), 12);
    expect(horizontalSpeed(diagonal)).toBeCloseTo(TEST_TUNING.maxSpeed, 12);
  });

  it('splits the speed evenly over both axes', () => {
    const diagonal = run(world(), createInputState({ moveX: 1, moveZ: 1 }), 120);
    const velocity = velocityOf(diagonal);

    expect(velocity.x).toBeCloseTo(TEST_TUNING.maxSpeed / Math.SQRT2, 12);
    expect(velocity.x).toBeCloseTo(velocity.z, 12);
  });
});

describe('MovementSystem.update — ground', () => {
  it('sticks the entity to the ground the query reports', () => {
    const start = world();
    const after = MovementSystem.update(start, createInputState({ moveZ: 1 }), DT, flatGround(2.5));

    expect(positionOf(after).y).toBe(2.5);
    expect(getMovement(after, PLAYER)?.grounded).toBe(true);
  });

  it('keeps the height and reports airborne where there is no ground', () => {
    const start = createWorldState([
      {
        id: 'player',
        transform: createTransform({ x: 0, y: 7, z: 0 }),
        movement: createMovement(TEST_TUNING),
        input: NEUTRAL_INPUT,
      },
    ]);
    const after = MovementSystem.update(start, createInputState({ moveZ: 1 }), DT, NO_GROUND);

    expect(positionOf(after).y).toBe(7);
    expect(getMovement(after, PLAYER)?.grounded).toBe(false);
  });
});

describe('MovementSystem.update — the Input component', () => {
  it('records the intent so later systems read it from the state', () => {
    const input = createInputState({ moveZ: 1, attack: true });
    const after = MovementSystem.update(world(), input, DT, GROUND);

    expect(getInput(after, PLAYER)).toEqual(input);
  });

  it('records an action that moves nothing, such as attacking while standing', () => {
    const settled = MovementSystem.update(world(), NEUTRAL_INPUT, DT, GROUND);
    const attacking = createInputState({ attack: true });
    const after = MovementSystem.update(settled, attacking, DT, GROUND);

    expect(getInput(after, PLAYER)?.attack).toBe(true);
    expect(positionOf(after)).toEqual(positionOf(settled));
  });

  it('leaves the state the caller passed in untouched', () => {
    const before = world();
    MovementSystem.update(before, createInputState({ moveZ: 1 }), DT, GROUND);

    expect(positionOf(before)).toEqual({ x: 0, y: 0, z: 0 });
    expect(getInput(before, PLAYER)).toEqual(NEUTRAL_INPUT);
  });
});

describe('MovementSystem.update — entities without an Input component', () => {
  it('does not steer them with the player input', () => {
    const state = createWorldState([
      { id: 'player', transform: createTransform(), movement: createMovement(TEST_TUNING) },
      { id: 'boulder', transform: createTransform(), movement: createMovement(TEST_TUNING) },
    ]);
    const after = MovementSystem.update(state, createInputState({ moveZ: 1 }), DT, GROUND);

    expect(velocityOf(after, toEntityId('boulder'))).toEqual({ x: 0, y: 0, z: 0 });
    expect(positionOf(after, toEntityId('boulder'))).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('MovementSystem.update — determinism', () => {
  it('produces bit-identical results for the same inputs', () => {
    const input = createInputState({ moveX: 0.3, moveZ: 1, sprint: true });
    const first = run(world(), input, 240);
    const second = run(world(), input, 240);

    expect(positionOf(first)).toEqual(positionOf(second));
    expect(velocityOf(first)).toEqual(velocityOf(second));
  });

  it('is independent of the frame rate when driven by the step accumulator', () => {
    const input = createInputState({ moveZ: 1, sprint: true });

    function simulate(frameDelta: number, frames: number): WorldState {
      let accumulator = createStepAccumulator();
      let state = world();
      for (let frame = 0; frame < frames; frame += 1) {
        const tick = advance(accumulator, frameDelta);
        accumulator = tick.accumulator;
        state = run(state, input, tick.steps, accumulator.fixedDelta);
      }
      return state;
    }

    const at60 = simulate(1 / 60, 60);
    const at30 = simulate(1 / 30, 30);

    expect(positionOf(at30)).toEqual(positionOf(at60));
    expect(velocityOf(at30)).toEqual(velocityOf(at60));
  });

  it('rejects a negative or non-finite delta instead of teleporting', () => {
    expect(() => MovementSystem.update(world(), NEUTRAL_INPUT, -DT, GROUND)).toThrow(RangeError);
    expect(() => MovementSystem.update(world(), NEUTRAL_INPUT, Number.NaN, GROUND)).toThrow(
      RangeError,
    );
  });

  it('treats a zero delta as no step at all', () => {
    // A paused game and the first frame after a tab regains focus both hand
    // over dt 0. Simulating it would still record the input and re-run the
    // ground query for nothing.
    const start = world();

    expect(MovementSystem.update(start, createInputState({ moveZ: 1 }), 0, GROUND)).toBe(start);
  });

  it('survives structuredClone, which is what a save game will do to it', () => {
    // ADR-0009 claims the state is plain data. A class instance, a closure or
    // a Babylon vector anywhere in the tree would throw here.
    const state = run(world(), createInputState({ moveX: 1, moveZ: 1, sprint: true }), 30);
    const clone = structuredClone(state) as WorldState;

    expect(positionOf(clone)).toEqual(positionOf(state));
    expect(velocityOf(clone)).toEqual(velocityOf(state));
    expect(getInput(clone, PLAYER)).toEqual(getInput(state, PLAYER));
  });

  it('continues a cloned state to the same place as the original', () => {
    // Saving, reloading and playing on must not fork the simulation — that is
    // the whole point of keeping the state serialisable.
    const input = createInputState({ moveZ: 1 });
    const saved = run(world(), input, 20);
    const loaded = structuredClone(saved) as WorldState;

    expect(positionOf(run(loaded, input, 40))).toEqual(positionOf(run(saved, input, 40)));
  });
});

/**
 * A wall: everything at or beyond `x = at` is solid, at every `z`.
 *
 * The query is written the way a real one behaves — it refuses the *destination*
 * of a move for a body of the given radius, and only when the move actually
 * approaches the face (ADR-0036) — so the tests below are about the movement
 * rules and not about how a ray meets a triangle.
 */
function wallAtX(at: number): ObstacleQuery {
  const facing: Vec3 = { x: -1, y: 0, z: 0 };
  return {
    firstHit: (from, to, radius) =>
      to.x > from.x && to.x + radius >= at
        ? { normal: facing, distance: Math.max(0, at - radius - from.x) }
        : null,
  };
}

describe('MovementSystem obstacles', () => {
  const forward = createInputState({ moveX: 1 });

  it('walks straight through nothing when no obstacle query is given', () => {
    const after = run(world(), forward, 60);
    expect(positionOf(after).x).toBeGreaterThan(1);
  });

  it('stops in front of a wall instead of walking into it', () => {
    let state = world();
    const wall = wallAtX(2);
    for (let step = 0; step < 240; step += 1) {
      state = MovementSystem.update(state, forward, DT, GROUND, wall);
    }
    const at = positionOf(state);
    expect(at.x).toBeGreaterThan(1);
    expect(at.x).toBeLessThanOrEqual(2 - TEST_TUNING.radius);
  });

  it('drops the speed it was pushing into the wall with', () => {
    let state = world();
    const wall = wallAtX(2);
    for (let step = 0; step < 240; step += 1) {
      state = MovementSystem.update(state, forward, DT, GROUND, wall);
    }
    expect(getMovement(state, PLAYER)?.velocity.x).toBe(0);
  });

  it('slides along the wall instead of sticking to it', () => {
    let state = world();
    const wall = wallAtX(2);
    const diagonal = createInputState({ moveX: 1, moveZ: 1 });
    for (let step = 0; step < 240; step += 1) {
      state = MovementSystem.update(state, diagonal, DT, GROUND, wall);
    }
    const at = positionOf(state);
    expect(at.x).toBeLessThanOrEqual(2 - TEST_TUNING.radius);
    // The component along the wall survives: this is the whole point.
    expect(at.z).toBeGreaterThan(5);
  });

  it('keeps the entity where it was when both axes are blocked', () => {
    // A face met head-on whichever way the body turns: there is never anything
    // along it to slide onto, so the solver has to give the move up entirely.
    const blocked: ObstacleQuery = {
      firstHit: (from, to) => {
        const length = horizontalLength(to.x - from.x, to.z - from.z) || 1;
        return {
          normal: { x: -(to.x - from.x) / length, y: 0, z: -(to.z - from.z) / length },
          distance: 0,
        };
      },
    };
    let state = world();
    for (let step = 0; step < 60; step += 1) {
      state = MovementSystem.update(state, forward, DT, GROUND, blocked);
    }
    expect(positionOf(state)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('is the same as no query at all when nothing is in the way', () => {
    const free = run(world(), forward, 60);
    let checked = world();
    for (let step = 0; step < 60; step += 1) {
      checked = MovementSystem.update(checked, forward, DT, GROUND, NO_OBSTACLES);
    }
    expect(positionOf(checked)).toEqual(positionOf(free));
  });
});
