import { describe, expect, it } from 'vitest';
import type { EntityDefinition, PrefabDefinition } from '@wov/world-schema';
import { footprintOf, footprintsOf } from './footprint.js';

const house: PrefabDefinition = {
  id: 'environment-house',
  name: 'House',
  asset: 'environment/house.glb',
  visibility: 'private',
  category: 'environment',
  bounds: { min: [-2, 0, -1], max: [2, 5, 1] },
};

const plank: PrefabDefinition = {
  ...house,
  id: 'environment-path-wood-plank-03',
  name: 'Plank',
  bounds: { min: [-1, 0, -1], max: [1, 0.1, 1] },
};

const boundless: PrefabDefinition = { ...house, id: 'environment-nothing', bounds: undefined };

const at = (prefab: string, overrides: Partial<EntityDefinition> = {}): EntityDefinition => ({
  id: `${prefab}_001`,
  prefab,
  position: [0, 0, 0],
  ...overrides,
});

const round4 = (rect: readonly number[]): number[] => rect.map((value) => Number(value.toFixed(4)));

describe('footprintOf', () => {
  it('is the hull box around the entity when nothing is turned or scaled', () => {
    expect(footprintOf(at('environment-house', { position: [10, 3, 20] }), house)).toEqual([
      8, 19, 12, 21,
    ]);
  });

  it('grows with the entity scale', () => {
    const entity = at('environment-house', { position: [0, 0, 0], scale: [2, 1, 3] });
    expect(footprintOf(entity, house)).toEqual([-4, -3, 4, 3]);
  });

  it('turns with a quarter turn of yaw, swapping the sides', () => {
    const entity = at('environment-house', { rotation: [0, Math.PI / 2, 0] });
    expect(round4(footprintOf(entity, house) ?? [])).toEqual([-1, -2, 1, 2]);
  });

  it('covers the diagonal of a house turned 45°', () => {
    const entity = at('environment-house', { rotation: [0, Math.PI / 4, 0] });
    // Half extents 2 and 1 turned 45°: 2·cos45 + 1·sin45, wider than either.
    const rect = footprintOf(entity, house) ?? [0, 0, 0, 0];
    expect(rect[2]).toBeCloseTo(3 * Math.SQRT1_2, 4);
    expect(rect[2]).toBeGreaterThan(2);
  });

  it('adds the margin on every side', () => {
    expect(footprintOf(at('environment-house'), house, { margin: 0.5 })).toEqual([
      -2.5, -1.5, 2.5, 1.5,
    ]);
  });

  it('has no answer for a prefab the catalogue never measured', () => {
    expect(footprintOf(at('environment-nothing'), boundless)).toBeUndefined();
  });
});

describe('footprintsOf', () => {
  const prefabs = new Map([
    [house.id, house],
    [plank.id, plank],
    [boundless.id, boundless],
  ]);
  const entities = [
    at('environment-house', { position: [0, 0, 0] }),
    at('environment-path-wood-plank-03', { position: [20, 0, 0] }),
    at('environment-nothing', { position: [40, 0, 0] }),
    at('vegetation-tree-1a3', { position: [60, 0, 0] }),
  ];

  it('takes only the entities a pattern matches', () => {
    expect(footprintsOf(entities, prefabs, ['-house'])).toEqual([[-2, -1, 2, 1]]);
  });

  it('takes a whole family with one pattern', () => {
    expect(footprintsOf(entities, prefabs, ['path-wood-plank'])).toHaveLength(1);
    expect(footprintsOf(entities, prefabs, ['-house', 'path-wood-plank'])).toHaveLength(2);
  });

  it('is empty without patterns rather than keeping out of everything', () => {
    expect(footprintsOf(entities, prefabs, [])).toEqual([]);
  });

  it('skips an entity whose prefab is unknown or unmeasured', () => {
    expect(footprintsOf(entities, prefabs, ['nothing'])).toEqual([]);
    expect(footprintsOf(entities, prefabs, ['tree-1a3'])).toEqual([]);
  });
});
