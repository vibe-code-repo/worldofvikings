import { describe, expect, it } from 'vitest';
import { resolveSoundProfile } from './sound-profile.js';
import { distanceBetween, planEmitters, type PlacedEntity } from './sound-placement.js';

const entities: readonly PlacedEntity[] = [
  { id: 'village-e0001', prefab: 'brazier', position: [10, 0, 10] },
  { id: 'village-e0002', prefab: 'brazier', position: [20, 0, 10] },
  { id: 'village-e0003', prefab: 'anvil', position: [30, 1, 10] },
];

function emitters(...inputs: Parameters<typeof resolveSoundProfile>[0][]) {
  return resolveSoundProfile(...inputs).emitters;
}

describe('planEmitters', () => {
  it('expands a prefab rule to every entity placed from it', () => {
    const plan = planEmitters(
      emitters({ emitters: [{ id: 'fire', prefab: 'brazier', clip: 'audio/fire.ogg' }] }),
      entities,
    );
    expect(plan.placements.map((placement) => placement.entity)).toEqual([
      'village-e0001',
      'village-e0002',
    ]);
    expect(plan.placements[1]?.position).toEqual([20, 0, 10]);
  });

  it('places a named entity where that entity stands', () => {
    const plan = planEmitters(
      emitters({ emitters: [{ id: 'forge', entity: 'village-e0003', clip: 'audio/f.ogg' }] }),
      entities,
    );
    expect(plan.placements).toHaveLength(1);
    expect(plan.placements[0]?.position).toEqual([30, 1, 10]);
  });

  it('places a bare point with no entity behind it', () => {
    const plan = planEmitters(
      emitters({ emitters: [{ id: 'crows', position: [212, 14, 96], clip: 'audio/c.ogg' }] }),
      entities,
    );
    expect(plan.placements[0]?.entity).toBeNull();
    expect(plan.placements[0]?.position).toEqual([212, 14, 96]);
  });

  it('reports a rule that matched nothing instead of dropping it silently', () => {
    const plan = planEmitters(
      emitters({ emitters: [{ id: 'waterfall', prefab: 'nothing-here', clip: 'audio/w.ogg' }] }),
      entities,
    );
    expect(plan.placements).toHaveLength(0);
    expect(plan.unmatched).toEqual(['waterfall']);
  });

  it('reports an entity id that no longer exists', () => {
    const plan = planEmitters(
      emitters({ emitters: [{ id: 'well', entity: 'village-e9999', clip: 'audio/w.ogg' }] }),
      entities,
    );
    expect(plan.unmatched).toEqual(['well']);
  });

  it('caps a rule at maxCount and says that it did', () => {
    const plan = planEmitters(
      emitters({
        emitters: [{ id: 'fire', prefab: 'brazier', clip: 'audio/fire.ogg', maxCount: 1 }],
      }),
      entities,
    );
    expect(plan.placements).toHaveLength(1);
    expect(plan.capped).toEqual(['fire']);
  });

  it('keeps the zone’s own entity order, so a cap always keeps the same ones', () => {
    const plan = planEmitters(
      emitters({
        emitters: [{ id: 'fire', prefab: 'brazier', clip: 'audio/fire.ogg', maxCount: 1 }],
      }),
      entities,
    );
    expect(plan.placements[0]?.entity).toBe('village-e0001');
  });
});

describe('distanceBetween', () => {
  it('measures in three dimensions', () => {
    expect(distanceBetween([0, 0, 0], { x: 3, y: 0, z: 4 })).toBe(5);
  });
});
