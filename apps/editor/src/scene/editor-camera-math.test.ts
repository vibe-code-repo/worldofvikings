import { describe, expect, it } from 'vitest';
import {
  CAMERA_FOV,
  FLY_SPEED,
  clampOrbit,
  defaultCameraLimits,
  defaultOrbitState,
  dollyBy,
  flyBy,
  focusOn,
  groundForwardVector,
  noFly,
  orbitBy,
  panBy,
  rightVector,
  upVector,
  type OrbitState,
} from './editor-camera-math.js';

/** The camera position Babylon derives from an orbit state. */
function positionOf(state: OrbitState): readonly [number, number, number] {
  const sinBeta = Math.sin(state.beta);
  return [
    state.target[0] + state.radius * Math.cos(state.alpha) * sinBeta,
    state.target[1] + state.radius * Math.cos(state.beta),
    state.target[2] + state.radius * Math.sin(state.alpha) * sinBeta,
  ];
}

describe('orbitBy', () => {
  it('turns the camera around the target and lifts it when dragged down', () => {
    const turned = orbitBy(defaultOrbitState, 100, 0);
    expect(turned.alpha).toBeLessThan(defaultOrbitState.alpha);

    const lifted = orbitBy(defaultOrbitState, 0, 100);
    expect(lifted.beta).toBeLessThan(defaultOrbitState.beta);
    // Smaller beta means further above the target.
    expect(positionOf(lifted)[1]).toBeGreaterThan(positionOf(defaultOrbitState)[1]);
  });

  it('never reaches the poles, where the camera would flip', () => {
    const overhead = orbitBy(defaultOrbitState, 0, 100_000);
    const underneath = orbitBy(defaultOrbitState, 0, -100_000);

    expect(overhead.beta).toBeCloseTo(defaultCameraLimits.polarEpsilon, 10);
    expect(underneath.beta).toBeCloseTo(Math.PI - defaultCameraLimits.polarEpsilon, 10);
  });

  it('leaves the target where it was', () => {
    expect(orbitBy(defaultOrbitState, 40, -20).target).toEqual(defaultOrbitState.target);
  });
});

describe('dollyBy', () => {
  it('scales with the current distance, so one notch feels the same everywhere', () => {
    const near = dollyBy({ ...defaultOrbitState, radius: 4 }, 120);
    const far = dollyBy({ ...defaultOrbitState, radius: 400 }, 120);

    expect(near.radius / 4).toBeCloseTo(far.radius / 400, 10);
    expect(near.radius).toBeGreaterThan(4);
  });

  it('moves closer on a negative wheel delta and stops at the limits', () => {
    expect(dollyBy(defaultOrbitState, -120).radius).toBeLessThan(defaultOrbitState.radius);
    expect(dollyBy(defaultOrbitState, -100_000).radius).toBe(defaultCameraLimits.minRadius);
    expect(dollyBy(defaultOrbitState, 100_000).radius).toBe(defaultCameraLimits.maxRadius);
  });
});

describe('panBy', () => {
  it('drags the world with the cursor: one pixel moves one pixel worth of metres', () => {
    const height = 800;
    const state: OrbitState = { ...defaultOrbitState, alpha: -Math.PI / 2, beta: Math.PI / 2 };
    const metresPerPixel = (2 * state.radius * Math.tan(CAMERA_FOV / 2)) / height;

    const panned = panBy(state, 100, 0, height);
    const right = rightVector(state);
    expect(panned.target[0] - state.target[0]).toBeCloseTo(-right[0] * 100 * metresPerPixel, 10);
    expect(panned.target[2] - state.target[2]).toBeCloseTo(-right[2] * 100 * metresPerPixel, 10);
  });

  it('moves the view up when the cursor is dragged down', () => {
    const panned = panBy(defaultOrbitState, 0, 100, 800);
    const up = upVector(defaultOrbitState);
    expect(Math.sign(panned.target[1] - defaultOrbitState.target[1])).toBe(Math.sign(up[1]));
  });

  it('changes nothing without a viewport to measure against', () => {
    expect(panBy(defaultOrbitState, 30, 30, 0)).toEqual(defaultOrbitState);
  });
});

describe('flyBy', () => {
  it('does nothing while no key is held', () => {
    expect(flyBy(defaultOrbitState, noFly, 1)).toBe(defaultOrbitState);
  });

  it('moves along the flattened view direction, never through the floor', () => {
    const steep: OrbitState = { ...defaultOrbitState, beta: 0.2 };
    const flown = flyBy(steep, { ...noFly, forward: true }, 1);

    expect(flown.target[1]).toBe(steep.target[1]);
    const forward = groundForwardVector(steep);
    expect(flown.target[0] - steep.target[0]).toBeCloseTo(forward[0] * FLY_SPEED, 10);
    expect(flown.target[2] - steep.target[2]).toBeCloseTo(forward[2] * FLY_SPEED, 10);
  });

  it('does not let a diagonal outrun a straight line', () => {
    const straight = flyBy(defaultOrbitState, { ...noFly, forward: true }, 1);
    const diagonal = flyBy(defaultOrbitState, { ...noFly, forward: true, right: true }, 1);

    const distance = (state: OrbitState): number =>
      Math.hypot(
        state.target[0] - defaultOrbitState.target[0],
        state.target[2] - defaultOrbitState.target[2],
      );
    expect(distance(diagonal)).toBeCloseTo(distance(straight), 10);
  });

  it('lifts and lowers along world up, whatever the camera is looking at', () => {
    const steep: OrbitState = { ...defaultOrbitState, beta: 0.2 };
    const risen = flyBy(steep, { ...noFly, up: true }, 0.5);

    expect(risen.target[1] - steep.target[1]).toBeCloseTo(FLY_SPEED * 0.5, 10);
    expect(risen.target[0]).toBe(steep.target[0]);
  });

  it('multiplies the pace while the fast key is held', () => {
    const normal = flyBy(defaultOrbitState, { ...noFly, forward: true }, 1);
    const fast = flyBy(defaultOrbitState, { ...noFly, forward: true, fast: true }, 1);

    expect(Math.abs(fast.target[0])).toBeGreaterThan(Math.abs(normal.target[0]));
  });
});

describe('focusOn', () => {
  it('centres on the box and backs off far enough to see all of it', () => {
    const focused = focusOn(defaultOrbitState, { min: [10, 0, -4], max: [14, 6, 2] });

    expect(focused.target).toEqual([12, 3, -1]);
    // 6 m tall at the default field of view needs more than 6 m of distance.
    expect(focused.radius).toBeGreaterThan(6);
    expect(focused.alpha).toBe(defaultOrbitState.alpha);
    expect(focused.beta).toBe(defaultOrbitState.beta);
  });

  it('still gives a single point a distance to be looked at from', () => {
    const focused = focusOn(defaultOrbitState, { min: [1, 2, 3], max: [1, 2, 3] });

    expect(focused.target).toEqual([1, 2, 3]);
    expect(focused.radius).toBeGreaterThanOrEqual(defaultCameraLimits.minRadius);
  });
});

describe('clampOrbit', () => {
  it('leaves a state inside the limits untouched', () => {
    expect(clampOrbit(defaultOrbitState)).toEqual(defaultOrbitState);
  });
});
