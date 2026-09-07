import { describe, expect, it } from 'vitest';
import { SCENE_ENTITY_ID_DIGITS, isSceneEntityId, sceneEntityId } from './entity-ids.js';

describe('sceneEntityId', () => {
  it('pads to the width the reserved namespace is defined by', () => {
    expect(sceneEntityId('environment-floor', 1)).toBe('environment-floor_0001');
    expect(sceneEntityId('environment-floor', 1241)).toBe('environment-floor_1241');
    expect(SCENE_ENTITY_ID_DIGITS).toBe(4);
  });

  it('keeps its shape past the padding width', () => {
    const id = sceneEntityId('bush-1a1', 12_345);
    expect(id).toBe('bush-1a1_12345');
    expect(isSceneEntityId(id, 'bush-1a1')).toBe(true);
  });

  it('mints ids this module recognises again', () => {
    for (const instance of [1, 9, 10, 999, 1000, 9999, 10_000]) {
      expect(isSceneEntityId(sceneEntityId('barrel-01', instance), 'barrel-01')).toBe(true);
    }
  });
});

describe('isSceneEntityId', () => {
  it('leaves the editor its three-digit numbers', () => {
    expect(isSceneEntityId('barrel-01_001', 'barrel-01')).toBe(false);
    expect(isSceneEntityId('barrel-01_999', 'barrel-01')).toBe(false);
  });

  it('leaves a scatter run its seeded ids', () => {
    expect(isSceneEntityId('grass-short-clump-1_s7_0001', 'grass-short-clump-1')).toBe(false);
    expect(isSceneEntityId('bush-1a1_s11_0123', 'bush-1a1')).toBe(false);
  });

  it('reads the number against the entity own prefab, not against any prefix', () => {
    // The prefab already ends in digits; the number is what follows *its* name.
    expect(isSceneEntityId('sm-env-stonewall-01_0007', 'sm-env-stonewall-01')).toBe(true);
    // Same id, a different prefab: not this prefab's number, so not a scene id.
    expect(isSceneEntityId('sm-env-stonewall-01_0007', 'sm-env-stonewall')).toBe(false);
  });

  it('refuses anything that is not only digits', () => {
    expect(isSceneEntityId('barrel-01_00a1', 'barrel-01')).toBe(false);
    expect(isSceneEntityId('barrel-01_h1000', 'barrel-01')).toBe(false);
    expect(isSceneEntityId('barrel-01_', 'barrel-01')).toBe(false);
    expect(isSceneEntityId('barrel-01', 'barrel-01')).toBe(false);
  });
});
