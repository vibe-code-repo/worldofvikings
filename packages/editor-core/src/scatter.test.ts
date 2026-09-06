import { describe, expect, it } from 'vitest';
import { applyCommand } from './commands.js';
import { createDocument } from './document.js';
import { createEditorState, execute, undo } from './history.js';
import {
  SCATTER_MAXIMUM,
  insideRegion,
  planScatter,
  scatterCommand,
  scatterId,
  usableArea,
  type ScatterOptions,
} from './scatter.js';
import { world, zone } from './test-support.js';

const grassAndBush: ScatterOptions = {
  region: { rect: [0, 0, 100, 100] },
  prefabs: [
    { prefab: 'vegetation-grass-short-clump-1', weight: 3 },
    { prefab: 'vegetation-bush-1a2', weight: 1 },
  ],
  density: 10,
  seed: 7,
};

const planOf = (options: ScatterOptions) => {
  const result = planScatter(options);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.value;
};

describe('usableArea', () => {
  it('is the rectangle when nothing is taken out of it', () => {
    expect(usableArea({ rect: [10, 20, 30, 50] })).toBe(600);
  });

  it('takes a keep-out rectangle out of it', () => {
    const area = usableArea({ rect: [0, 0, 100, 100], exclude: [[0, 0, 50, 100]] });
    expect(area).toBeGreaterThan(4900);
    expect(area).toBeLessThan(5100);
  });

  it('counts overlapping keep-outs once', () => {
    const area = usableArea({
      rect: [0, 0, 100, 100],
      exclude: [
        [0, 0, 50, 100],
        [25, 0, 60, 100],
      ],
    });
    expect(area).toBeGreaterThan(3900);
    expect(area).toBeLessThan(4100);
  });

  it('follows a polygon', () => {
    // The lower-left triangle of the square: half its area.
    const area = usableArea({
      rect: [0, 0, 100, 100],
      polygon: [
        [0, 0],
        [100, 0],
        [0, 100],
      ],
    });
    expect(area).toBeGreaterThan(4800);
    expect(area).toBeLessThan(5200);
  });

  it('is zero for a rectangle with no area', () => {
    expect(usableArea({ rect: [5, 5, 5, 40] })).toBe(0);
  });
});

describe('insideRegion', () => {
  it('rejects a point outside the rectangle', () => {
    expect(insideRegion({ rect: [0, 0, 10, 10] }, 11, 5)).toBe(false);
    expect(insideRegion({ rect: [0, 0, 10, 10] }, 5, 5)).toBe(true);
  });

  it('rejects a point inside a keep-out', () => {
    const region = { rect: [0, 0, 10, 10] as const, exclude: [[2, 2, 4, 4] as const] };
    expect(insideRegion(region, 3, 3)).toBe(false);
    expect(insideRegion(region, 5, 5)).toBe(true);
  });

  it('rejects a point outside the polygon', () => {
    const region = {
      rect: [0, 0, 10, 10] as const,
      polygon: [
        [0, 0],
        [10, 0],
        [0, 10],
      ] as const,
    };
    expect(insideRegion(region, 1, 1)).toBe(true);
    expect(insideRegion(region, 9, 9)).toBe(false);
  });
});

describe('planScatter', () => {
  it('places the count the density asks for over the usable area', () => {
    // 100 m x 100 m is a hundred patches of 100 m²; ten each is a thousand.
    expect(planOf(grassAndBush).entities).toHaveLength(1000);
    expect(planOf(grassAndBush).requested).toBe(1000);
  });

  it('thins nothing when a keep-out shrinks the region, it only shortens it', () => {
    const half = planOf({
      ...grassAndBush,
      region: { rect: [0, 0, 100, 100], exclude: [[0, 0, 100, 50]] },
    });
    expect(half.entities.length).toBeGreaterThan(450);
    expect(half.entities.length).toBeLessThan(550);
  });

  it('gives the same entities for the same seed', () => {
    expect(planOf(grassAndBush).entities).toEqual(planOf(grassAndBush).entities);
  });

  it('gives different entities for a different seed', () => {
    const other = planOf({ ...grassAndBush, seed: 8 });
    expect(other.entities[0]?.position).not.toEqual(planOf(grassAndBush).entities[0]?.position);
  });

  it('never calls Math.random', () => {
    const real = Math.random;
    Math.random = () => {
      throw new Error('a scatter must not depend on Math.random (agent rule 17)');
    };
    try {
      expect(planOf(grassAndBush).entities.length).toBeGreaterThan(0);
    } finally {
      Math.random = real;
    }
  });

  it('keeps every instance inside the region', () => {
    const region = { rect: [0, 0, 100, 100] as const, exclude: [[40, 40, 60, 60] as const] };
    const outside = planOf({ ...grassAndBush, region }).entities.filter(
      (entity) => !insideRegion(region, entity.position[0], entity.position[2]),
    );
    expect(outside).toEqual([]);
  });

  it('draws prefabs roughly in proportion to their weights', () => {
    const entities = planOf(grassAndBush).entities;
    const grass = entities.filter(
      (entity) => entity.prefab === 'vegetation-grass-short-clump-1',
    ).length;
    expect(grass / entities.length).toBeGreaterThan(0.7);
    expect(grass / entities.length).toBeLessThan(0.8);
  });

  it('names an instance after its prefab, its seed and its number', () => {
    const first = planOf(grassAndBush).entities[0];
    expect(first?.id).toBe(scatterId(first?.prefab ?? '', 7, 1));
    expect(first?.id).toMatch(/_s7_0001$/);
  });

  it('returns the entities sorted by id, which is how they are written out', () => {
    const ids = planOf(grassAndBush).entities.map((entity) => entity.id);
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('stands every instance on the ground the height function gives', () => {
    const plan = planOf({ ...grassAndBush, heightAt: (x, z) => x / 10 + z / 20 });
    const wrong = plan.entities.filter(
      (entity) =>
        Math.abs(entity.position[1] - (entity.position[0] / 10 + entity.position[2] / 20)) > 0.002,
    );
    expect(wrong).toEqual([]);
  });

  it('is flat when no height function is given rather than guessing one', () => {
    expect(planOf(grassAndBush).entities.every((entity) => entity.position[1] === 0)).toBe(true);
  });

  it('keeps the minimum distance between instances', () => {
    const plan = planOf({ ...grassAndBush, density: 4, minimumDistance: 3 });
    const points = plan.entities.map((entity) => [entity.position[0], entity.position[2]]);
    let closest = Number.POSITIVE_INFINITY;
    for (let left = 0; left < points.length; left += 1) {
      for (let right = left + 1; right < points.length; right += 1) {
        const dx = (points[left]?.[0] ?? 0) - (points[right]?.[0] ?? 0);
        const dz = (points[left]?.[1] ?? 0) - (points[right]?.[1] ?? 0);
        closest = Math.min(closest, Math.hypot(dx, dz));
      }
    }
    // 2.99 rather than 3: the written position is rounded to millimetres.
    expect({ instances: points.length > 100, closest: closest >= 2.99 }).toEqual({
      instances: true,
      closest: true,
    });
  });

  it('reports the instances a minimum distance had no room for', () => {
    const plan = planOf({ ...grassAndBush, density: 100, minimumDistance: 5 });
    expect(plan.crowdedOut).toBeGreaterThan(0);
    expect(plan.entities.length + plan.crowdedOut).toBe(plan.requested);
  });

  it('stays inside the scale and yaw ranges', () => {
    const plan = planOf({ ...grassAndBush, scale: [0.8, 1.4], yawDegrees: [0, 90] });
    const outOfRange = plan.entities.filter(
      (entity) =>
        (entity.scale?.[0] ?? 0) < 0.8 ||
        (entity.scale?.[0] ?? 0) > 1.4 ||
        entity.scale?.[0] !== entity.scale?.[2] ||
        (entity.rotation?.[1] ?? -1) < 0 ||
        (entity.rotation?.[1] ?? 0) > Math.PI / 2 ||
        entity.rotation?.[0] !== 0,
    );
    expect(outOfRange).toEqual([]);
  });

  it('honours a maximum instead of obeying a mistyped density', () => {
    expect(planOf({ ...grassAndBush, density: 10_000, maximum: 250 }).entities).toHaveLength(250);
  });

  it('never exceeds the hard ceiling', () => {
    const plan = planOf({ ...grassAndBush, density: 1_000_000, maximum: 10 ** 9 });
    expect(plan.requested).toBe(SCATTER_MAXIMUM);
  });

  it('refuses a region with no area, a bad weight, a bad density and a bad seed', () => {
    const refusals = [
      { ...grassAndBush, region: { rect: [0, 0, 0, 10] as const } },
      { ...grassAndBush, prefabs: [] },
      { ...grassAndBush, prefabs: [{ prefab: 'x', weight: 0 }] },
      { ...grassAndBush, density: 0 },
      { ...grassAndBush, seed: 1.5 },
      { ...grassAndBush, seed: -1 },
      { ...grassAndBush, scale: [0, 2] as const },
      { ...grassAndBush, minimumDistance: -1 },
      { ...grassAndBush, region: { rect: [0, 0, 10, 10] as const, polygon: [[0, 0]] as const } },
    ];
    for (const options of refusals) {
      expect(planScatter(options).ok).toBe(false);
    }
  });
});

describe('scatterCommand', () => {
  const emptyVillage = world([zone('main', [])]);

  it('is one command holding every instance', () => {
    const result = scatterCommand('main', grassAndBush);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.command.kind).toBe('addEntities');
    expect(result.value.command.entries).toHaveLength(1000);
  });

  it('adds every instance to the zone as an ordinary entity', () => {
    const result = scatterCommand('main', grassAndBush);
    if (!result.ok) {
      throw new Error(result.error);
    }
    const applied = applyCommand(createDocument(emptyVillage), result.value.command);
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    const entities = applied.value.document.world.zones[0]?.entities ?? [];
    expect(entities).toHaveLength(1000);
    expect(entities[0]).toMatchObject({ prefab: expect.any(String), position: expect.any(Array) });
  });

  it('is taken back by one undo, all of it', () => {
    const result = scatterCommand('main', grassAndBush);
    if (!result.ok) {
      throw new Error(result.error);
    }
    const scattered = execute(createEditorState(emptyVillage), result.value.command);
    expect(scattered.ok).toBe(true);
    if (!scattered.ok) {
      return;
    }
    expect(scattered.state.history.past).toHaveLength(1);
    const back = undo(scattered.state);
    expect(back.document.world.zones[0]?.entities).toHaveLength(0);
  });

  it('refuses a second run with the same seed rather than doubling the field', () => {
    const result = scatterCommand('main', grassAndBush);
    if (!result.ok) {
      throw new Error(result.error);
    }
    const once = applyCommand(createDocument(emptyVillage), result.value.command);
    if (!once.ok) {
      throw new Error(once.error);
    }
    const twice = applyCommand(once.value.document, result.value.command);
    expect(twice.ok).toBe(false);
  });
});
