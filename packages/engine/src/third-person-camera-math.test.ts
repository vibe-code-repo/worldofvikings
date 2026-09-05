import { describe, expect, it } from 'vitest';
import {
  applyLook,
  applyZoom,
  createThirdPersonCameraState,
  defaultThirdPersonCameraSettings,
  noCameraObstacles,
  orbitDirection,
  resolveObstacleLimit,
  resolveThirdPersonCameraSettings,
  settleDistance,
  smoothPoint,
  smoothingFactor,
  stepThirdPersonCamera,
  wheelTicks,
  wrapAngle,
} from './third-person-camera-math.js';
import type { CameraObstacleQuery, Vec3 } from './third-person-camera-math.js';

const settings = defaultThirdPersonCameraSettings;

function length(vector: Vec3): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

describe('wrapAngle', () => {
  it('leaves an angle inside (-π, π] alone', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(1.5)).toBeCloseTo(1.5, 12);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI, 12);
  });

  it('folds a full turn back onto itself, in both directions', () => {
    expect(wrapAngle(1.5 + 2 * Math.PI)).toBeCloseTo(1.5, 12);
    expect(wrapAngle(1.5 - 4 * Math.PI)).toBeCloseTo(1.5, 12);
    // -π and +π are the same direction; the range is half-open so it answers +π.
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(1.5 * Math.PI)).toBeCloseTo(-0.5 * Math.PI, 12);
  });
});

describe('smoothingFactor', () => {
  it('does not move without time', () => {
    expect(smoothingFactor(0.2, 0)).toBe(0);
    expect(smoothingFactor(0.2, -1)).toBe(0);
    expect(smoothingFactor(0.2, Number.NaN)).toBe(0);
  });

  it('snaps when smoothing is switched off', () => {
    expect(smoothingFactor(0, 1 / 60)).toBe(1);
    expect(smoothingFactor(-1, 1 / 60)).toBe(1);
  });

  it('closes ~63 % of the gap after one time constant', () => {
    expect(smoothingFactor(0.2, 0.2)).toBeCloseTo(1 - Math.exp(-1), 12);
  });

  /**
   * The whole point of the exponential form: two half-steps must land where a
   * single full step lands. A naive `current += (target - current) * rate`
   * fails this and makes the camera lag depend on the frame rate.
   */
  it('is frame-rate independent', () => {
    const once = smoothingFactor(0.2, 1 / 30);
    const twice = 1 - (1 - smoothingFactor(0.2, 1 / 60)) ** 2;
    expect(twice).toBeCloseTo(once, 12);
  });
});

describe('smoothPoint', () => {
  it('moves part of the way towards the target', () => {
    const moved = smoothPoint([0, 0, 0], [10, 0, 0], 0.2, 0.2);
    expect(moved[0]).toBeCloseTo(10 * (1 - Math.exp(-1)), 12);
    expect(moved[1]).toBe(0);
    expect(moved[2]).toBe(0);
  });

  it('arrives exactly when smoothing is off', () => {
    expect(smoothPoint([1, 2, 3], [4, 5, 6], 0, 1 / 60)).toEqual([4, 5, 6]);
  });
});

describe('applyLook', () => {
  it('turns right when the mouse moves right', () => {
    const looked = applyLook({ yaw: 0, pitch: 0 }, { lookDx: 100 }, settings);
    expect(looked.yaw).toBeCloseTo(100 * settings.yawSensitivity, 12);
  });

  it('keeps yaw wrapped however far the mouse travels', () => {
    let orientation = { yaw: 0, pitch: 0 };
    for (let i = 0; i < 40; i += 1) {
      orientation = applyLook(orientation, { lookDx: 1000 }, settings);
    }
    expect(orientation.yaw).toBeGreaterThan(-Math.PI);
    expect(orientation.yaw).toBeLessThanOrEqual(Math.PI);
  });

  it('clamps pitch at both limits instead of flipping over the pole', () => {
    const up = applyLook({ yaw: 0, pitch: 0 }, { lookDy: -100_000 }, settings);
    const down = applyLook({ yaw: 0, pitch: 0 }, { lookDy: 100_000 }, settings);
    expect(up.pitch).toBe(settings.minPitch);
    expect(down.pitch).toBe(settings.maxPitch);
  });

  it('reverses the vertical axis when invertY is set', () => {
    const inverted = resolveThirdPersonCameraSettings({ invertY: true });
    const normal = applyLook({ yaw: 0, pitch: 0 }, { lookDy: 40 }, settings);
    const flipped = applyLook({ yaw: 0, pitch: 0 }, { lookDy: 40 }, inverted);
    expect(normal.pitch).toBeGreaterThan(0);
    expect(flipped.pitch).toBeLessThan(0);
  });

  it('ignores a non-finite movement instead of poisoning the orientation', () => {
    const looked = applyLook({ yaw: 0.5, pitch: 0.2 }, { lookDx: Number.NaN }, settings);
    expect(looked.yaw).toBeCloseTo(0.5, 12);
  });
});

describe('applyZoom', () => {
  it('scrolling down pushes the camera out, scrolling up pulls it in', () => {
    expect(applyZoom(6, 1, settings)).toBeCloseTo(6 + settings.zoomStep, 12);
    expect(applyZoom(6, -1, settings)).toBeCloseTo(6 - settings.zoomStep, 12);
  });

  it('stays inside the configured distance range', () => {
    expect(applyZoom(6, 1000, settings)).toBe(settings.maxDistance);
    expect(applyZoom(6, -1000, settings)).toBe(settings.minDistance);
  });
});

describe('wheelTicks', () => {
  it('normalises the three wheel delta modes to comparable ticks', () => {
    expect(wheelTicks(100, 0)).toBeCloseTo(1, 12);
    expect(wheelTicks(3, 1)).toBeCloseTo(1, 12);
    expect(wheelTicks(1, 2)).toBeCloseTo(1, 12);
  });

  it('keeps the direction and survives nonsense', () => {
    expect(wheelTicks(-100, 0)).toBeCloseTo(-1, 12);
    expect(wheelTicks(Number.NaN, 0)).toBe(0);
  });
});

describe('orbitDirection', () => {
  it('is a unit vector for every orientation', () => {
    for (const yaw of [0, 1, -2.5, 3]) {
      for (const pitch of [-0.3, 0, 0.9]) {
        expect(length(orbitDirection(yaw, pitch))).toBeCloseTo(1, 12);
      }
    }
  });

  it('sits behind the target at yaw 0 and rises with pitch', () => {
    const behind = orbitDirection(0, 0);
    expect(behind[0]).toBeCloseTo(0, 12);
    expect(behind[1]).toBeCloseTo(0, 12);
    expect(behind[2]).toBeCloseTo(-1, 12);

    const raised = orbitDirection(0, Math.PI / 6);
    expect(raised[1]).toBeCloseTo(Math.sin(Math.PI / 6), 12);
    expect(raised[2]).toBeCloseTo(-Math.cos(Math.PI / 6), 12);
  });

  it('yaws around the vertical axis', () => {
    const quarter = orbitDirection(Math.PI / 2, 0);
    expect(quarter[0]).toBeCloseTo(-1, 12);
    expect(quarter[2]).toBeCloseTo(0, 12);
  });
});

describe('resolveObstacleLimit', () => {
  it('reports no limit when nothing is in the way', () => {
    expect(resolveObstacleLimit(6, null, settings)).toBeNull();
    expect(resolveObstacleLimit(6, 6 + settings.obstaclePadding + 0.1, settings)).toBeNull();
  });

  it('keeps the padding between the lens and the wall', () => {
    const limit = resolveObstacleLimit(6, 4, settings);
    expect(limit).toBeCloseTo(4 - settings.obstaclePadding, 12);
  });

  it('never pulls closer than the minimum, however tight the corner', () => {
    expect(resolveObstacleLimit(6, 0, settings)).toBe(settings.minObstructedDistance);
  });

  /**
   * A query answering NaN is a bug in the query. Trusting it would slam the
   * camera into the character's face; ignoring it keeps the shot and leaves the
   * bug where it belongs.
   */
  it('ignores a non-finite answer instead of acting on it', () => {
    expect(resolveObstacleLimit(6, Number.NaN, settings)).toBeNull();
  });
});

describe('settleDistance', () => {
  it('snaps inwards the instant something blocks the view', () => {
    expect(settleDistance(6, 6, 2.5, settings, 1 / 60)).toBe(2.5);
  });

  it('eases back out once the way is clear again', () => {
    const eased = settleDistance(2.5, 6, null, settings, 1 / 60);
    expect(eased).toBeGreaterThan(2.5);
    expect(eased).toBeLessThan(6);
  });

  it('eases the zoom instead of jumping to the new distance', () => {
    const eased = settleDistance(6, 4, null, settings, 1 / 60);
    expect(eased).toBeLessThan(6);
    expect(eased).toBeGreaterThan(4);
  });
});

describe('resolveThirdPersonCameraSettings', () => {
  it('places the pivot at head height behind the character', () => {
    expect(defaultThirdPersonCameraSettings.targetOffset[1]).toBeGreaterThan(1);
    expect(defaultThirdPersonCameraSettings.distance).toBeGreaterThan(
      defaultThirdPersonCameraSettings.minDistance,
    );
  });

  it('clamps the starting distance and pitch into their own limits', () => {
    const resolved = resolveThirdPersonCameraSettings({
      distance: 100,
      maxDistance: 12,
      initialPitch: 5,
    });
    expect(resolved.distance).toBe(12);
    expect(resolved.initialPitch).toBe(resolved.maxPitch);
  });

  it('rejects a pitch range that would put the camera on the pole', () => {
    expect(() => resolveThirdPersonCameraSettings({ maxPitch: Math.PI / 2 })).toThrow(/maxPitch/);
    expect(() => resolveThirdPersonCameraSettings({ minPitch: -Math.PI })).toThrow(/minPitch/);
  });

  it('rejects an inverted or empty distance range', () => {
    expect(() => resolveThirdPersonCameraSettings({ minDistance: 9, maxDistance: 3 })).toThrow(
      /minDistance/,
    );
    expect(() => resolveThirdPersonCameraSettings({ minDistance: 0 })).toThrow(/minDistance/);
  });

  it('rejects a pitch range whose ends are the wrong way round', () => {
    expect(() => resolveThirdPersonCameraSettings({ minPitch: 0.9, maxPitch: 0.2 })).toThrow(
      /minPitch/,
    );
  });
});

describe('createThirdPersonCameraState', () => {
  it('starts framed on the target instead of easing in from the origin', () => {
    const state = createThirdPersonCameraState(settings, [10, 0, -4]);
    expect(state.pivot).toEqual([
      10 + settings.targetOffset[0],
      settings.targetOffset[1],
      -4 + settings.targetOffset[2],
    ]);
    expect(state.distance).toBe(settings.distance);
    expect(state.desiredDistance).toBe(settings.distance);
    expect(state.pitch).toBe(settings.initialPitch);
  });
});

describe('stepThirdPersonCamera', () => {
  it('places the camera on the orbit around the pivot it looks at', () => {
    const state = createThirdPersonCameraState(settings, [0, 0, 0]);
    const step = stepThirdPersonCamera(
      state,
      { target: [0, 0, 0], deltaSeconds: 1 / 60 },
      settings,
    );

    expect(step.focus).toEqual(step.state.pivot);
    const toCamera: Vec3 = [
      step.position[0] - step.focus[0],
      step.position[1] - step.focus[1],
      step.position[2] - step.focus[2],
    ];
    expect(length(toCamera)).toBeCloseTo(step.state.distance, 12);
    // Behind and above: the shot a third-person camera owes the player.
    expect(step.position[1]).toBeGreaterThan(step.focus[1]);
    expect(step.position[2]).toBeLessThan(step.focus[2]);
  });

  it('follows a moving target with a lag, and catches up', () => {
    let state = createThirdPersonCameraState(settings, [0, 0, 0]);
    const target: Vec3 = [0, 0, 10];

    state = stepThirdPersonCamera(state, { target, deltaSeconds: 1 / 60 }, settings).state;
    expect(state.pivot[2]).toBeGreaterThan(0);
    expect(state.pivot[2]).toBeLessThan(10);

    for (let i = 0; i < 200; i += 1) {
      state = stepThirdPersonCamera(state, { target, deltaSeconds: 1 / 60 }, settings).state;
    }
    expect(state.pivot[2]).toBeCloseTo(10, 3);
  });

  it('caps a huge time step so a backgrounded tab does not teleport the camera', () => {
    const state = createThirdPersonCameraState(settings, [0, 0, 0]);
    const jump = stepThirdPersonCamera(state, { target: [0, 0, 100], deltaSeconds: 30 }, settings);
    const capped = stepThirdPersonCamera(
      state,
      { target: [0, 0, 100], deltaSeconds: settings.maxDeltaSeconds },
      settings,
    );
    expect(jump.state.pivot[2]).toBeCloseTo(capped.state.pivot[2], 12);
    expect(jump.state.pivot[2]).toBeLessThan(100);
  });

  it('asks the obstacle query along the line it is about to use', () => {
    const state = createThirdPersonCameraState(settings, [0, 0, 0]);
    const probes: { origin: Vec3; direction: Vec3; maxDistance: number }[] = [];
    const query: CameraObstacleQuery = (probe) => {
      probes.push({ ...probe });
      return null;
    };

    const step = stepThirdPersonCamera(
      state,
      { target: [0, 0, 0], deltaSeconds: 1 / 60, obstacle: query },
      settings,
    );

    expect(probes).toHaveLength(1);
    const probe = probes[0];
    expect(probe?.origin).toEqual(step.focus);
    expect(probe?.maxDistance).toBe(step.state.desiredDistance);
    expect(length(probe?.direction ?? [0, 0, 0])).toBeCloseTo(1, 12);
  });

  it('pulls in front of a wall and remembers the distance the player asked for', () => {
    const state = createThirdPersonCameraState(settings, [0, 0, 0]);
    const wall: CameraObstacleQuery = () => 3;

    const blocked = stepThirdPersonCamera(
      state,
      { target: [0, 0, 0], deltaSeconds: 1 / 60, obstacle: wall },
      settings,
    );
    expect(blocked.state.distance).toBeCloseTo(3 - settings.obstaclePadding, 12);
    expect(blocked.state.desiredDistance).toBe(settings.distance);

    const freed = stepThirdPersonCamera(
      blocked.state,
      { target: [0, 0, 0], deltaSeconds: 1 / 60 },
      settings,
    );
    expect(freed.state.distance).toBeGreaterThan(blocked.state.distance);
  });

  it('defaults to no obstacles at all', () => {
    const state = createThirdPersonCameraState(settings, [0, 0, 0]);
    expect(
      noCameraObstacles({ origin: [0, 0, 0], direction: [0, 0, -1], maxDistance: 6 }),
    ).toBeNull(
      // Havok arrives with chain D; until then the camera is never blocked.
    );
    const step = stepThirdPersonCamera(
      state,
      { target: [0, 0, 0], deltaSeconds: 1 / 60 },
      settings,
    );
    expect(step.state.distance).toBe(settings.distance);
  });

  it('keeps the orientation when no input arrives', () => {
    const start = createThirdPersonCameraState(settings, [0, 0, 0]);
    const turned = stepThirdPersonCamera(
      start,
      { target: [0, 0, 0], deltaSeconds: 1 / 60, lookDx: 200, lookDy: 40 },
      settings,
    ).state;
    const idle = stepThirdPersonCamera(
      turned,
      { target: [0, 0, 0], deltaSeconds: 1 / 60 },
      settings,
    ).state;

    expect(turned.yaw).not.toBe(start.yaw);
    expect(idle.yaw).toBe(turned.yaw);
    expect(idle.pitch).toBe(turned.pitch);
  });
});
