import { describe, expect, it } from 'vitest';
import { DEFAULT_FIXED_DELTA, advance, createStepAccumulator } from './fixed-step.js';

describe('createStepAccumulator', () => {
  it('defaults to 60 simulation steps per second', () => {
    const accumulator = createStepAccumulator();

    expect(accumulator.fixedDelta).toBe(DEFAULT_FIXED_DELTA);
    expect(DEFAULT_FIXED_DELTA).toBe(1 / 60);
    expect(accumulator.remainder).toBe(0);
  });

  it('rejects a non-positive step length', () => {
    expect(() => createStepAccumulator({ fixedDelta: 0 })).toThrow(RangeError);
    expect(() => createStepAccumulator({ maxStepsPerFrame: 0 })).toThrow(RangeError);
  });
});

describe('advance', () => {
  it('runs no step while less than one step of time has passed', () => {
    const result = advance(createStepAccumulator(), 1 / 120);

    expect(result.steps).toBe(0);
    expect(result.accumulator.remainder).toBeCloseTo(1 / 120, 12);
    expect(result.alpha).toBeCloseTo(0.5, 12);
  });

  it('carries the remainder into the next frame', () => {
    const first = advance(createStepAccumulator(), 1 / 120);
    const second = advance(first.accumulator, 1 / 120);

    expect(second.steps).toBe(1);
    expect(second.accumulator.remainder).toBeCloseTo(0, 12);
  });

  it('splits one long frame into several fixed steps', () => {
    const result = advance(createStepAccumulator(), 1 / 15);

    expect(result.steps).toBe(4);
    expect(result.accumulator.remainder).toBeCloseTo(0, 12);
  });

  it('caps the steps of a stalled frame and reports the dropped time', () => {
    const result = advance(createStepAccumulator({ maxStepsPerFrame: 5 }), 1);

    expect(result.steps).toBe(5);
    expect(result.accumulator.remainder).toBe(0);
    expect(result.dropped).toBeCloseTo(1 - 5 / 60, 12);
  });

  it('leaves the accumulator it was given untouched', () => {
    const accumulator = createStepAccumulator();
    advance(accumulator, 1);

    expect(accumulator.remainder).toBe(0);
  });

  it('rejects a negative or non-finite frame delta', () => {
    expect(() => advance(createStepAccumulator(), -0.1)).toThrow(RangeError);
    expect(() => advance(createStepAccumulator(), Number.NaN)).toThrow(RangeError);
  });
});
