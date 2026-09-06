import { describe, expect, it } from 'vitest';
import type { EntityDefinition } from '@wov/world-schema';
import { diffEntities, isEmptyDiff, sameTransform } from './entity-diff.js';

function entity(overrides: Partial<EntityDefinition> = {}): EntityDefinition {
  return { id: 'barrel_001', prefab: 'barrel_01', position: [0, 0, 0], ...overrides };
}

describe('diffEntities', () => {
  it('reports nothing when the list is unchanged', () => {
    const before = [entity(), entity({ id: 'barrel_002', position: [1, 0, 0] })];

    expect(isEmptyDiff(diffEntities(before, [...before]))).toBe(true);
  });

  it('finds an added and a removed entity', () => {
    const diff = diffEntities([entity()], [entity({ id: 'barrel_002' })]);

    expect(diff.added.map((each) => each.id)).toEqual(['barrel_002']);
    expect(diff.removed).toEqual(['barrel_001']);
  });

  it('separates a moved entity from a replaced one', () => {
    const diff = diffEntities(
      [entity(), entity({ id: 'tree_001', prefab: 'pine_01' })],
      [entity({ position: [4, 0, 0] }), entity({ id: 'tree_001', prefab: 'birch_01' })],
    );

    expect(diff.moved.map((each) => each.id)).toEqual(['barrel_001']);
    expect(diff.replaced.map((each) => each.id)).toEqual(['tree_001']);
    expect(diff.added).toEqual([]);
  });

  it('ignores the order entities are listed in', () => {
    const a = entity();
    const b = entity({ id: 'barrel_002', position: [1, 0, 0] });

    expect(isEmptyDiff(diffEntities([a, b], [b, a]))).toBe(true);
  });

  it('sees a rotation or a scale change, not only a position one', () => {
    expect(diffEntities([entity()], [entity({ rotation: [0, 1, 0] })]).moved).toHaveLength(1);
    expect(diffEntities([entity()], [entity({ scale: [2, 2, 2] })]).moved).toHaveLength(1);
  });
});

describe('sameTransform', () => {
  it('treats an absent rotation and scale as the defaults, not as a change', () => {
    expect(sameTransform(entity(), entity({ rotation: [0, 0, 0], scale: [1, 1, 1] }))).toBe(true);
    expect(sameTransform(entity({ scale: [1, 1, 1] }), entity({ scale: [1, 1, 1.5] }))).toBe(false);
  });
});
