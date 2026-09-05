import { describe, expect, it } from 'vitest';
import { NEUTRAL_INPUT, QUICK_SLOT_COUNT, createInputState, inputEquals } from './input.js';

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
      'slot',
      'sprint',
    ]);
  });
});

describe('quick slots', () => {
  it('is 0 by default — 0 means "no slot", not "slot zero"', () => {
    expect(NEUTRAL_INPUT.slot).toBe(0);
    expect(createInputState().slot).toBe(0);
  });

  it('accepts every slot spec §27 binds to the number row', () => {
    expect(QUICK_SLOT_COUNT).toBe(5);
    for (let slot = 1; slot <= QUICK_SLOT_COUNT; slot += 1) {
      expect(createInputState({ slot }).slot).toBe(slot);
    }
  });

  it('rejects a slot outside the bound range instead of clamping it', () => {
    // Clamping would silently fire slot 5 when a rebinding table names slot 9.
    // A skill firing is not a thing to guess at, so this throws.
    expect(() => createInputState({ slot: 6 })).toThrow(RangeError);
    expect(() => createInputState({ slot: -1 })).toThrow(RangeError);
    expect(() => createInputState({ slot: 1.5 })).toThrow(RangeError);
    expect(() => createInputState({ slot: Number.NaN })).toThrow(RangeError);
  });

  it('takes part in the value comparison', () => {
    expect(inputEquals(createInputState({ slot: 3 }), createInputState({ slot: 3 }))).toBe(true);
    expect(inputEquals(createInputState({ slot: 3 }), createInputState({ slot: 4 }))).toBe(false);
    expect(inputEquals(createInputState({ slot: 1 }), NEUTRAL_INPUT)).toBe(false);
  });
});
