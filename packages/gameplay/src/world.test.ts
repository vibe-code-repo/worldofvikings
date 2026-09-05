import { describe, expect, it } from 'vitest';
import { createMovement, createTransform } from './components.js';
import { toEntityId } from './entity.js';
import { NEUTRAL_INPUT } from './input.js';
import { addEntity, createWorldState, getInput, getMovement, getTransform } from './world.js';

describe('createWorldState', () => {
  it('starts empty', () => {
    const state = createWorldState();

    expect(state.entities).toEqual([]);
    expect(state.transforms.size).toBe(0);
    expect(state.movements.size).toBe(0);
    expect(state.inputs.size).toBe(0);
  });

  it('stores components in separate maps keyed by entity id', () => {
    const state = createWorldState([
      { id: 'player', transform: createTransform({ x: 1, y: 2, z: 3 }), input: NEUTRAL_INPUT },
      { id: 'rock', transform: createTransform() },
    ]);

    expect(state.entities).toEqual(['player', 'rock']);
    expect(getTransform(state, toEntityId('player'))?.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(getInput(state, toEntityId('player'))).toEqual(NEUTRAL_INPUT);
    expect(getInput(state, toEntityId('rock'))).toBeUndefined();
    expect(getMovement(state, toEntityId('rock'))).toBeUndefined();
  });
});

describe('addEntity', () => {
  it('returns a new state and leaves the previous one untouched', () => {
    const before = createWorldState();
    const after = addEntity(before, { id: 'player', movement: createMovement() });

    expect(before.entities).toEqual([]);
    expect(after.entities).toEqual(['player']);
    expect(getMovement(after, toEntityId('player'))?.velocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('rejects a duplicate id', () => {
    const state = addEntity(createWorldState(), { id: 'player' });

    expect(() => addEntity(state, { id: 'player' })).toThrow(/player/);
  });
});
