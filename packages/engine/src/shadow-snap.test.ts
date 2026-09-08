import { describe, expect, it } from 'vitest';
import { shadowBasis, snapShadowFocus, type ShadowVec3 } from './shadow-snap.js';

/** The village's own numbers: a 120 m map over 2048 texels (ADR-0039). */
const TEXEL = 120 / 2048;
/** The village's evening sun. */
const EVENING: ShadowVec3 = [0.58, -0.45, 0.68];

/** Where a point lands on the map's two lateral axes, measured in texels. */
function lateralTexels(point: ShadowVec3, direction: ShadowVec3, texel: number): [number, number] {
  const basis = shadowBasis(direction);
  const along = (axis: ShadowVec3): number =>
    (point[0] * axis[0] + point[1] * axis[1] + point[2] * axis[2]) / texel;
  return [along(basis.right), along(basis.up)];
}

describe('shadowBasis', () => {
  it('is orthonormal and points along the light', () => {
    const { forward, right, up } = shadowBasis(EVENING);
    const length = (v: ShadowVec3): number => Math.hypot(v[0], v[1], v[2]);
    const dot = (a: ShadowVec3, b: ShadowVec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

    expect(length(forward)).toBeCloseTo(1, 12);
    expect(length(right)).toBeCloseTo(1, 12);
    expect(length(up)).toBeCloseTo(1, 12);
    expect(dot(forward, right)).toBeCloseTo(0, 12);
    expect(dot(forward, up)).toBeCloseTo(0, 12);
    expect(dot(right, up)).toBeCloseTo(0, 12);
    // Normalised direction, not the raw one it was given.
    const scale = 1 / Math.hypot(...EVENING);
    expect(forward).toEqual([
      expect.closeTo(EVENING[0] * scale, 12),
      expect.closeTo(EVENING[1] * scale, 12),
      expect.closeTo(EVENING[2] * scale, 12),
    ]);
  });

  it('survives a light pointing straight down, where world up is no reference', () => {
    for (const direction of [
      [0, -1, 0],
      [0, 1, 0],
    ] as ShadowVec3[]) {
      const { forward, right, up } = shadowBasis(direction);
      for (const value of [...forward, ...right, ...up]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(Math.hypot(...right)).toBeCloseTo(1, 12);
      expect(Math.hypot(...up)).toBeCloseTo(1, 12);
    }
  });
});

describe('snapShadowFocus', () => {
  it('lands on whole texels of both lateral axes', () => {
    const focus: ShadowVec3 = [37.13, 11.9, -4.77];
    const snapped = snapShadowFocus(focus, shadowBasis(EVENING), TEXEL);
    const [right, up] = lateralTexels(snapped, EVENING, TEXEL);

    expect(right).toBeCloseTo(Math.round(right), 9);
    expect(up).toBeCloseTo(Math.round(up), 9);
  });

  it('leaves the component along the light exactly where it was', () => {
    const focus: ShadowVec3 = [37.13, 11.9, -4.77];
    const basis = shadowBasis(EVENING);
    const along = (p: ShadowVec3): number =>
      p[0] * basis.forward[0] + p[1] * basis.forward[1] + p[2] * basis.forward[2];

    expect(along(snapShadowFocus(focus, basis, TEXEL))).toBeCloseTo(along(focus), 9);
  });

  it('never moves the centre by more than half a texel on either axis', () => {
    const basis = shadowBasis(EVENING);
    for (let step = 0; step < 200; step += 1) {
      // A walk that is not a multiple of anything, so every phase is visited.
      const focus: ShadowVec3 = [step * 0.0731, 2 + step * 0.0119, -step * 0.0413];
      const snapped = snapShadowFocus(focus, basis, TEXEL);
      const before = lateralTexels(focus, EVENING, TEXEL);
      const after = lateralTexels(snapped, EVENING, TEXEL);
      expect(Math.abs(after[0] - before[0])).toBeLessThanOrEqual(0.5 + 1e-9);
      expect(Math.abs(after[1] - before[1])).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });

  it('does not move at all for a step smaller than a texel — the flicker fix', () => {
    const basis = shadowBasis(EVENING);
    // Sixty focus points a third of a texel apart, the way a walking player
    // moves between frames. Unsnapped they sweep the whole texel; snapped they
    // must sit on exactly the lattice points they reach.
    const seen = new Set<string>();
    let steps = 0;
    for (let step = 0; step < 60; step += 1) {
      const distance = (step * TEXEL) / 3;
      const focus: ShadowVec3 = [distance, 5, 0];
      const snapped = snapShadowFocus(focus, basis, TEXEL);
      const [right, up] = lateralTexels(snapped, EVENING, TEXEL);
      seen.add(`${String(Math.round(right))}/${String(Math.round(up))}`);
      steps += 1;
    }
    // Sixty thirds of a texel is twenty texels of travel, so the map may not
    // have taken more than twenty-one distinct positions — one per texel
    // crossed. Without snapping there would be sixty.
    expect(steps).toBe(60);
    expect(seen.size).toBeLessThanOrEqual(21);
    expect(seen.size).toBeGreaterThan(1);
  });

  it('gives one and the same centre for two points inside the same texel', () => {
    const basis = shadowBasis(EVENING);
    const centre = snapShadowFocus([12, 3, -8], basis, TEXEL);
    // A tenth of a texel away in each lateral direction, so both round the
    // same way whichever side of the lattice point the first one fell on.
    const nudge = TEXEL * 0.1;
    const near: ShadowVec3 = [
      centre[0] + basis.right[0] * nudge + basis.up[0] * nudge,
      centre[1] + basis.right[1] * nudge + basis.up[1] * nudge,
      centre[2] + basis.right[2] * nudge + basis.up[2] * nudge,
    ];
    const snapped = snapShadowFocus(near, basis, TEXEL);

    expect(snapped[0]).toBeCloseTo(centre[0], 9);
    expect(snapped[1]).toBeCloseTo(centre[1], 9);
    expect(snapped[2]).toBeCloseTo(centre[2], 9);
  });

  it('steps by exactly one texel when the focus moves by one', () => {
    const basis = shadowBasis(EVENING);
    const from: ShadowVec3 = [12, 3, -8];
    const to: ShadowVec3 = [
      from[0] + basis.right[0] * TEXEL,
      from[1] + basis.right[1] * TEXEL,
      from[2] + basis.right[2] * TEXEL,
    ];
    const a = lateralTexels(snapShadowFocus(from, basis, TEXEL), EVENING, TEXEL);
    const b = lateralTexels(snapShadowFocus(to, basis, TEXEL), EVENING, TEXEL);

    expect(b[0] - a[0]).toBeCloseTo(1, 9);
    expect(b[1] - a[1]).toBeCloseTo(0, 9);
  });

  it('hands back the focus point untouched when there is no texel to snap to', () => {
    const focus: ShadowVec3 = [1.234, 5.678, -9.012];
    expect(snapShadowFocus(focus, shadowBasis(EVENING), 0)).toEqual(focus);
    expect(snapShadowFocus(focus, shadowBasis(EVENING), Number.NaN)).toEqual(focus);
  });
});
