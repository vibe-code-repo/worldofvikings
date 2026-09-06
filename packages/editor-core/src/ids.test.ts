import { describe, expect, it } from 'vitest';
import { entityIdBase, nextEntityId, nextEntityIds } from './ids.js';

describe('entityIdBase', () => {
  it('keeps a prefab id that is already an identifier', () => {
    expect(entityIdBase('barrel-01')).toBe('barrel-01');
  });

  it('folds anything else into one', () => {
    expect(entityIdBase('Barrel 01')).toBe('barrel-01');
    expect(entityIdBase('-01')).toBe('e-01');
    expect(entityIdBase('')).toBe('entity');
  });
});

describe('nextEntityId', () => {
  it('numbers from one, zero padded, with no randomness', () => {
    expect(nextEntityId([], 'barrel-01')).toBe('barrel-01_001');
    expect(nextEntityId(['barrel-01_001'], 'barrel-01')).toBe('barrel-01_002');
  });

  it('fills the first free number instead of counting past the end', () => {
    expect(nextEntityId(['barrel-01_001', 'barrel-01_003'], 'barrel-01')).toBe('barrel-01_002');
  });

  it('ignores ids belonging to another prefab', () => {
    expect(nextEntityId(['rock-01_001'], 'barrel-01')).toBe('barrel-01_001');
  });

  it('keeps counting past three digits', () => {
    const used = Array.from(
      { length: 999 },
      (_, index) => `barrel-01_${String(index + 1).padStart(3, '0')}`,
    );
    expect(nextEntityId(used, 'barrel-01')).toBe('barrel-01_1000');
  });
});

describe('nextEntityIds', () => {
  it('reserves each id it hands out, so a batch has no collisions', () => {
    expect(nextEntityIds(['barrel-01_001'], ['barrel-01', 'barrel-01', 'rock-01'])).toEqual([
      'barrel-01_002',
      'barrel-01_003',
      'rock-01_001',
    ]);
  });
});
