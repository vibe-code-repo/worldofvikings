import { describe, expect, it } from 'vitest';
import { NEUTRAL_INPUT, createInputState, inputEquals } from './input.js';

describe('createInputState', () => {
  it('defaults to no movement and no action', () => {
    expect(createInputState()).toEqual(NEUTRAL_INPUT);
  });

  it('keeps the axes and actions it is given', () => {
    const input = createInputState({ moveX: -0.5, moveZ: 1, sprint: true, attack: true });

    expect(input.moveX).toBe(-0.5);
    expect(input.moveZ).toBe(1);
    expect(input.sprint).toBe(true);
    expect(input.attack).toBe(true);
    expect(input.block).toBe(false);
  });

  it('clamps axes into [-1, 1] so a stuck device cannot outrun the tuning', () => {
    const input = createInputState({ moveX: 7, moveZ: -7 });

    expect(input.moveX).toBe(1);
    expect(input.moveZ).toBe(-1);
  });

  it('rejects a non-finite axis instead of poisoning the simulation', () => {
    expect(() => createInputState({ moveX: Number.NaN })).toThrow(RangeError);
    expect(() => createInputState({ moveZ: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });

  it('compares by value, not by identity', () => {
    expect(inputEquals(createInputState(), NEUTRAL_INPUT)).toBe(true);
    expect(inputEquals(createInputState({ block: true }), NEUTRAL_INPUT)).toBe(false);
    expect(inputEquals(createInputState({ moveX: 0.25 }), createInputState({ moveX: 0.25 }))).toBe(
      true,
    );
  });

  it('covers every action of spec §27 that Phase 1 reads', () => {
    expect(Object.keys(NEUTRAL_INPUT).sort()).toEqual([
      'attack',
      'block',
      'dodge',
      'interact',
      'moveX',
      'moveZ',
      'sprint',
    ]);
  });
});
