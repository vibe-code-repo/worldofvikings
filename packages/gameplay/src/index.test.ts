import { describe, expect, it } from 'vitest';
import * as gameplay from './index.js';
import { toEntityId } from './index.js';

describe('toEntityId', () => {
  it('passes the raw string through', () => {
    expect(toEntityId('player')).toBe('player');
  });

  it('rejects an empty id', () => {
    expect(() => toEntityId('')).toThrow();
  });
});

describe('the public surface', () => {
  it('exports the whole Phase 1 gameplay core', () => {
    // `index.ts` is a hand-written re-export list, so a new module is easy to
    // add and easy to forget. `apps/game` only ever imports the package root,
    // so anything missing here is invisible until the game fails to build.
    expect(Object.keys(gameplay).sort()).toEqual([
      'DEFAULT_FIXED_DELTA',
      'DEFAULT_MAX_STEPS_PER_FRAME',
      'DEFAULT_MOVEMENT_TUNING',
      'MAX_SLIDE_ATTEMPTS',
      'MovementSystem',
      'NEUTRAL_INPUT',
      'NO_GROUND',
      'NO_OBSTACLES',
      'QUICK_SLOT_COUNT',
      'ZERO_VEC3',
      'addEntity',
      'advance',
      'createInputState',
      'createMovement',
      'createStepAccumulator',
      'createTransform',
      'createWorldState',
      'flatGround',
      'getInput',
      'getMovement',
      'getTransform',
      'groundUnder',
      'horizontalLength',
      'inputEquals',
      'slideMove',
      'toEntityId',
      'vec3',
    ]);
  });
});
