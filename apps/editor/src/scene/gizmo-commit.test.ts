import { describe, expect, it } from 'vitest';
import { changesFromDrag, type DragSnapping } from './gizmo-commit.js';
import type { GizmoTransform } from './gizmos.js';

const off: DragSnapping = { enabled: false, step: 0.5, rotationStepDegrees: 15 };
const on: DragSnapping = { enabled: true, step: 0.5, rotationStepDegrees: 15 };

function at(x: number, y: number, z: number): GizmoTransform {
  return { position: [x, y, z], rotation: [0, 0, 0], scale: [1, 1, 1] };
}

describe('changesFromDrag', () => {
  it('moves the dragged entity to where it was left', () => {
    const starts = new Map([['barrel_001', at(0, 0, 0)]]);

    const changes = changesFromDrag(['barrel_001'], starts, 'barrel_001', at(3, 0, -2), off);

    expect(changes).toEqual([
      {
        entityId: 'barrel_001',
        patch: { position: [3, 0, -2], rotation: [0, 0, 0], scale: [1, 1, 1] },
      },
    ]);
  });

  it('applies the same delta to the rest of the selection', () => {
    const starts = new Map([
      ['a', at(0, 0, 0)],
      ['b', at(10, 0, 5)],
    ]);

    const changes = changesFromDrag(['a', 'b'], starts, 'b', at(12, 0, 5), off);

    expect(changes.map((change) => change.patch.position)).toEqual([
      [2, 0, 0],
      [12, 0, 5],
    ]);
  });

  it('multiplies scale instead of adding it, so a doubled handle doubles each entity', () => {
    const starts = new Map<string, GizmoTransform>([
      ['small', { ...at(0, 0, 0), scale: [1, 1, 1] }],
      ['large', { ...at(0, 0, 0), scale: [2, 2, 2] }],
    ]);

    const changes = changesFromDrag(
      ['small', 'large'],
      starts,
      'small',
      { ...at(0, 0, 0), scale: [2, 2, 2] },
      off,
    );

    expect(changes[0]?.patch.scale).toEqual([2, 2, 2]);
    expect(changes[1]?.patch.scale).toEqual([4, 4, 4]);
  });

  it('adds rotation deltas', () => {
    const starts = new Map<string, GizmoTransform>([
      ['a', { ...at(0, 0, 0), rotation: [0, 1, 0] }],
    ]);

    const changes = changesFromDrag(
      ['a'],
      starts,
      'a',
      { ...at(0, 0, 0), rotation: [0, 1.5, 0] },
      off,
    );

    expect(changes[0]?.patch.rotation?.[1]).toBeCloseTo(1.5, 10);
  });

  it('snaps the result to the grid when snapping is on', () => {
    const starts = new Map([['a', at(0, 0, 0)]]);

    const changes = changesFromDrag(['a'], starts, 'a', at(1.31, 0, -2.44), on);

    expect(changes[0]?.patch.position).toEqual([1.5, 0, -2.5]);
  });

  it('snaps rotation to whole steps', () => {
    const starts = new Map<string, GizmoTransform>([['a', at(0, 0, 0)]]);
    const eightDegrees = (8 * Math.PI) / 180;

    const changes = changesFromDrag(
      ['a'],
      starts,
      'a',
      { ...at(0, 0, 0), rotation: [0, eightDegrees, 0] },
      on,
    );

    expect(changes[0]?.patch.rotation?.[1]).toBeCloseTo((15 * Math.PI) / 180, 10);
  });

  it('leaves an entity out when nothing was recorded for it', () => {
    const starts = new Map([['a', at(0, 0, 0)]]);

    const changes = changesFromDrag(['a', 'gone'], starts, 'a', at(1, 0, 0), off);

    expect(changes.map((change) => change.entityId)).toEqual(['a']);
  });

  it('changes nothing when the drag has no starting point to measure against', () => {
    expect(changesFromDrag(['a'], new Map(), 'a', at(1, 0, 0), off)).toEqual([]);
    expect(changesFromDrag([], new Map(), undefined, at(1, 0, 0), off)).toEqual([]);
  });

  it('never divides by a zero scale', () => {
    const starts = new Map<string, GizmoTransform>([['a', { ...at(0, 0, 0), scale: [0, 1, 1] }]]);

    const changes = changesFromDrag(['a'], starts, 'a', { ...at(0, 0, 0), scale: [5, 1, 1] }, off);

    expect(changes[0]?.patch.scale).toEqual([0, 1, 1]);
  });
});
