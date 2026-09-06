import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRID_STEP,
  DEFAULT_ROTATION_STEP_DEGREES,
  gridSnap,
  snapPosition,
  snapRotation,
  snapRotationAngle,
} from './snapping.js';

describe('gridSnap', () => {
  it('rounds to the nearest multiple of the step', () => {
    expect(gridSnap(1.2, 0.5)).toBe(1);
    expect(gridSnap(1.3, 0.5)).toBe(1.5);
    expect(gridSnap(-1.3, 0.5)).toBe(-1.5);
    expect(gridSnap(4, 1)).toBe(4);
  });

  it('does not leak floating point noise into world data', () => {
    // 0.1 * 3 is 0.30000000000000004 in binary floating point; a world file
    // must not grow such a number just because something was snapped.
    expect(gridSnap(0.29, 0.1)).toBe(0.3);
    expect(gridSnap(-0.04, 0.1)).toBe(0);
    expect(Object.is(gridSnap(-0.04, 0.1), -0)).toBe(false);
  });

  it('returns the value unchanged for a step that cannot snap anything', () => {
    expect(gridSnap(1.234, 0)).toBe(1.234);
    expect(gridSnap(1.234, -1)).toBe(1.234);
    expect(gridSnap(Number.NaN, 1)).toBeNaN();
  });

  it('has a default step', () => {
    expect(DEFAULT_GRID_STEP).toBeGreaterThan(0);
  });
});

describe('snapPosition', () => {
  it('snaps every axis', () => {
    expect(snapPosition([1.2, 0.4, -2.6], 0.5)).toEqual([1, 0.5, -2.5]);
  });
});

describe('snapRotationAngle', () => {
  it('rounds radians to whole degree steps and returns radians', () => {
    const quarterTurn = Math.PI / 2;
    expect(snapRotationAngle(quarterTurn + 0.05, 15)).toBeCloseTo(quarterTurn, 10);
    // 0.7 rad is 40.1°, which rounds to 45° — a quarter of a right angle.
    expect(snapRotationAngle(0.7, 45)).toBeCloseTo(Math.PI / 4, 10);
    expect(snapRotationAngle(0.1, 90)).toBe(0);
  });

  it('keeps the angle when the step cannot snap anything', () => {
    expect(snapRotationAngle(1.234, 0)).toBe(1.234);
  });

  it('has a default step in degrees', () => {
    expect(DEFAULT_ROTATION_STEP_DEGREES).toBe(15);
  });
});

describe('snapRotation', () => {
  it('snaps all three euler angles', () => {
    const snapped = snapRotation([0.1, Math.PI / 2 + 0.05, -0.1], 90);
    expect(snapped[0]).toBe(0);
    expect(snapped[1]).toBeCloseTo(Math.PI / 2, 10);
    expect(snapped[2]).toBe(0);
  });
});
