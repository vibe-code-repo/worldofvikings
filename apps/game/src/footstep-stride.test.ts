import { describe, expect, it } from 'vitest';
import { advanceStride, initialStride, type StrideSettings } from './footstep-stride.js';

const settings: StrideSettings = { strideWalk: 1.1, strideSprint: 1.5, minInterval: 0.18 };

/** The speeds `DEFAULT_MOVEMENT_TUNING` actually moves the player at, in m/s. */
const JOG = 4.5;
const SPRINT = JOG * 1.6;

/**
 * Walks `metres` at the game's own speed, one 60 Hz tick at a time, and counts
 * the footsteps.
 *
 * At the game's speed and not at an arbitrary one, because that is the only way
 * the answer says anything: a rig that covers 30 m in two seconds is being
 * paced by `minInterval` rather than by the stride, and would report the same
 * number whatever the strides were set to.
 */
function walk(metres: number, options: { sprinting?: boolean; grounded?: boolean } = {}): number {
  const speed = options.sprinting === true ? SPRINT : JOG;
  const tick = 1 / 60;
  const steps = Math.round(metres / (speed * tick));
  const perStep = metres / steps;
  let state = initialStride;
  let footsteps = 0;
  for (let index = 0; index < steps; index += 1) {
    const result = advanceStride(
      state,
      {
        from: { x: index * perStep, y: 0, z: 0 },
        to: { x: (index + 1) * perStep, y: 0, z: 0 },
        grounded: options.grounded ?? true,
        sprinting: options.sprinting ?? false,
        deltaSeconds: tick,
      },
      settings,
    );
    state = result.state;
    if (result.step) {
      footsteps += 1;
    }
  }
  return footsteps;
}

describe('advanceStride', () => {
  it('makes a footstep every stride of ground covered', () => {
    // 30 m at a 1.1 m stride is 26 whole strides.
    expect(walk(30)).toBe(26);
  });

  it('makes fewer, longer strides at a sprint', () => {
    // The same ground at a 1.5 m stride: 20 steps, over 4.2 s rather than
    // 6.7 s — fewer footsteps, arriving faster.
    expect(walk(30, { sprinting: true })).toBe(19);
  });

  it('makes no footstep at all while standing still', () => {
    expect(walk(0)).toBe(0);
  });

  it('makes no footstep in the air', () => {
    expect(walk(30, { grounded: false })).toBe(0);
  });

  it('honours minInterval when the solver pushes the player along a wall', () => {
    // 20 m in five ticks — four metres per tick, five strides' worth — but only
    // 1/60 s apart, which is well inside the floor.
    let state = initialStride;
    let footsteps = 0;
    for (let index = 0; index < 5; index += 1) {
      const result = advanceStride(
        state,
        {
          from: { x: index * 4, y: 0, z: 0 },
          to: { x: (index + 1) * 4, y: 0, z: 0 },
          grounded: true,
          sprinting: false,
          deltaSeconds: 1 / 60,
        },
        settings,
      );
      state = result.state;
      if (result.step) {
        footsteps += 1;
      }
    }
    expect(footsteps).toBe(1);
  });

  it('drops the surplus rather than owing the player a burst of footsteps', () => {
    const jump = advanceStride(
      initialStride,
      {
        from: { x: 0, y: 0, z: 0 },
        to: { x: 300, y: 0, z: 0 },
        grounded: true,
        sprinting: false,
        deltaSeconds: 1 / 60,
      },
      settings,
    );
    expect(jump.step).toBe(true);
    expect(jump.state.distance).toBe(0);
  });

  it('ignores the vertical — falling is not walking', () => {
    const fall = advanceStride(
      initialStride,
      {
        from: { x: 0, y: 60, z: 0 },
        to: { x: 0, y: 0, z: 0 },
        grounded: true,
        sprinting: false,
        deltaSeconds: 1 / 60,
      },
      settings,
    );
    expect(fall.step).toBe(false);
  });

  it('does not swallow the first step of a walk on the interval floor', () => {
    // `initialStride` starts with its clock already run out, so the first full
    // stride sounds rather than waiting out a `minInterval` nothing has used.
    const first = advanceStride(
      initialStride,
      {
        from: { x: 0, y: 0, z: 0 },
        to: { x: 1.5, y: 0, z: 0 },
        grounded: true,
        sprinting: false,
        deltaSeconds: 1 / 60,
      },
      settings,
    );
    expect(first.step).toBe(true);
  });
});
