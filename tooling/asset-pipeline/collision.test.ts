import { describe, expect, it } from 'vitest';
import { measureTrunkBox, roundBounds } from './collision.js';

/**
 * A tree: a thin upright trunk of radius `trunkRadius` from y=0 to y=2, and a
 * wide crown of radius `crownRadius` above it. The crown carries far more
 * vertices than the trunk, exactly as a real model does.
 */
function tree(trunkRadius: number, crownRadius: number): number[] {
  const points: number[] = [];
  for (let ring = 0; ring <= 20; ring += 1) {
    const y = (ring / 20) * 2;
    for (let step = 0; step < 8; step += 1) {
      const angle = (step / 8) * Math.PI * 2;
      points.push(Math.cos(angle) * trunkRadius, y, Math.sin(angle) * trunkRadius);
    }
  }
  for (let ring = 0; ring <= 40; ring += 1) {
    const y = 2 + (ring / 40) * 8;
    for (let step = 0; step < 16; step += 1) {
      const angle = (step / 16) * Math.PI * 2;
      points.push(Math.cos(angle) * crownRadius, y, Math.sin(angle) * crownRadius);
    }
  }
  return points;
}

describe('measureTrunkBox', () => {
  it('measures the trunk, not the crown', () => {
    const box = measureTrunkBox(tree(0.2, 4));
    expect(box).toBeDefined();
    if (!box) {
      return;
    }
    expect(box.max[0] - box.min[0]).toBeCloseTo(0.4, 2);
    expect(box.max[2] - box.min[2]).toBeCloseTo(0.4, 2);
  });

  it('keeps the full model height, so nothing flies through the crown', () => {
    const box = measureTrunkBox(tree(0.2, 4));
    expect(box?.min[1]).toBeCloseTo(0, 5);
    expect(box?.max[1]).toBeCloseTo(10, 5);
  });

  it('follows a leaning trunk instead of centring on the model', () => {
    const leaning = tree(0.2, 4).map((value, index) => (index % 3 === 0 ? value + 5 : value));
    const box = measureTrunkBox(leaning);
    expect(((box?.min[0] ?? 0) + (box?.max[0] ?? 0)) / 2).toBeCloseTo(5, 2);
  });

  it('ignores a single stray vertex at ankle height', () => {
    const strayed = [...tree(0.2, 4), 9, 0.05, 9];
    const box = measureTrunkBox(strayed);
    expect(box?.max[0]).toBeLessThan(1);
  });

  it('never reports a trunk of width zero', () => {
    const pole = [0, 0, 0, 0, 1, 0, 0, 2, 0];
    const box = measureTrunkBox(pole);
    expect((box?.max[0] ?? 0) - (box?.min[0] ?? 0)).toBeGreaterThan(0);
  });

  it('measures nothing when there is nothing to measure', () => {
    expect(measureTrunkBox([])).toBeUndefined();
  });
});

describe('roundBounds', () => {
  it('rounds to a fixed number of digits so a regenerated file is stable', () => {
    expect(roundBounds({ min: [-0.123456, 0, -0.123456], max: [0.123456, 1, 0.123456] })).toEqual({
      min: [-0.1235, 0, -0.1235],
      max: [0.1235, 1, 0.1235],
    });
  });
});
