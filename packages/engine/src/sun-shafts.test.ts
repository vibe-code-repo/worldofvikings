import { describe, expect, it } from 'vitest';
import { sunAnchorPosition, sunShaftsGate, sunViewAngleDegrees } from './sun-shafts.js';
import type { Vector3Tuple } from './base-scene.js';

/**
 * A view direction at a given angle from the sun, in the x/z plane.
 *
 * The sun here travels along +x, so the direction *towards* it is -x, and a
 * camera looking at 0° looks along -x. Turning right by `degrees` swings the
 * forward vector into +z, which is a plain rotation and keeps every expected
 * angle in the tests below arithmetic rather than trigonometry a reader has to
 * redo.
 */
function forwardAt(degrees: number): Vector3Tuple {
  const radians = (degrees * Math.PI) / 180;
  return [-Math.cos(radians), 0, Math.sin(radians)];
}

/** The sun of the fixtures: travelling along +x, so it stands at -x. */
const SUN: Vector3Tuple = [1, 0, 0];

describe('sunViewAngleDegrees', () => {
  it('is zero when the sun is dead centre and 180 when it is behind', () => {
    expect(sunViewAngleDegrees(forwardAt(0), SUN)).toBeCloseTo(0, 6);
    expect(sunViewAngleDegrees(forwardAt(180), SUN)).toBeCloseTo(180, 6);
  });

  it('measures the angle whichever way the camera turned', () => {
    expect(sunViewAngleDegrees(forwardAt(41), SUN)).toBeCloseTo(41, 6);
    expect(sunViewAngleDegrees(forwardAt(-41), SUN)).toBeCloseTo(41, 6);
  });

  it('does not care how long either vector is', () => {
    expect(sunViewAngleDegrees([-7, 0, 0], [0.001, 0, 0])).toBeCloseTo(0, 6);
  });

  it('has no answer for a direction that is not one', () => {
    expect(sunViewAngleDegrees([0, 0, 0], SUN)).toBeNull();
    expect(sunViewAngleDegrees(forwardAt(0), [0, 0, 0])).toBeNull();
  });

  /**
   * The rounding case that would otherwise be `NaN`: a normalised dot product
   * can come out a hair past 1, and `Math.acos` answers that with `NaN` rather
   * than 0 — which then makes every comparison in the gate false and switches
   * the effect off for one frame, at exactly the angle it is most wanted.
   */
  it('survives a dot product rounded past one', () => {
    const angle = sunViewAngleDegrees([-0.1 - 0.2, 0, 0], [0.30000000000000004, 0, 0]);
    expect(angle).not.toBeNull();
    expect(Number.isNaN(angle ?? Number.NaN)).toBe(false);
  });
});

describe('sunShaftsGate', () => {
  const max = 55;
  const hysteresis = 5;

  it('is on at full strength with the sun in the middle of the frame', () => {
    expect(sunShaftsGate(forwardAt(0), SUN, max, hysteresis, false)).toEqual({
      active: true,
      strength: 1,
    });
  });

  /**
   * 41° is where the frame's corner sits at 16:9 with Babylon's default field
   * of view, so a sun just past the edge of the picture must still fan into it.
   */
  it('is still on at full strength when the sun has just left the frame', () => {
    const gate = sunShaftsGate(forwardAt(41), SUN, max, hysteresis, false);
    expect(gate.active).toBe(true);
    expect(gate.strength).toBe(1);
  });

  it('fades rather than steps across the band', () => {
    expect(sunShaftsGate(forwardAt(50), SUN, max, hysteresis, true).strength).toBeCloseTo(1, 6);
    expect(sunShaftsGate(forwardAt(55), SUN, max, hysteresis, true).strength).toBeCloseTo(0.5, 6);
    expect(sunShaftsGate(forwardAt(59), SUN, max, hysteresis, true).strength).toBeCloseTo(0.1, 6);
  });

  it('latches: it attaches at the angle and lets go past the band', () => {
    // Coming from off, 57° is past the threshold and stays off.
    expect(sunShaftsGate(forwardAt(57), SUN, max, hysteresis, false).active).toBe(false);
    // Already on, the same 57° holds — which is what stops a player panning
    // along the threshold from switching a second scene pass on and off.
    expect(sunShaftsGate(forwardAt(57), SUN, max, hysteresis, true).active).toBe(true);
    expect(sunShaftsGate(forwardAt(61), SUN, max, hysteresis, true).active).toBe(false);
  });

  it('is off, at zero strength, once the sun is off to the side', () => {
    expect(sunShaftsGate(forwardAt(90), SUN, max, hysteresis, true)).toEqual({
      active: false,
      strength: 0,
    });
  });

  /**
   * The failure the gate exists for: past 90° the perspective divide mirrors
   * the sun's projected position back into the frame, so an ungated effect
   * paints a bright smear into a picture with no sun in it (ADR-0042).
   */
  it('is off with the sun behind the player, where the projection lies', () => {
    expect(sunShaftsGate(forwardAt(160), SUN, max, hysteresis, true).active).toBe(false);
    expect(sunShaftsGate(forwardAt(180), SUN, max, hysteresis, true).active).toBe(false);
  });

  it('gives a hard edge when no hysteresis was asked for', () => {
    expect(sunShaftsGate(forwardAt(54.9), SUN, max, 0, false)).toEqual({
      active: true,
      strength: 1,
    });
    expect(sunShaftsGate(forwardAt(55.1), SUN, max, 0, true).active).toBe(false);
  });

  it('refuses rather than guesses when there is no angle to measure', () => {
    expect(sunShaftsGate([0, 0, 0], SUN, max, hysteresis, true)).toEqual({
      active: false,
      strength: 0,
    });
    expect(sunShaftsGate(forwardAt(0), SUN, Number.NaN, hysteresis, true).active).toBe(false);
  });
});

describe('sunAnchorPosition', () => {
  it('stands the anchor up the sunbeam, at the distance asked for', () => {
    const at = sunAnchorPosition([10, 2, -4], [0, -1, 0], 1400);
    expect(at).toEqual([10, 1402, -4]);
  });

  it('normalises the direction rather than scaling by it', () => {
    const at = sunAnchorPosition([0, 0, 0], [0, -3, 4], 100);
    expect(at[0]).toBeCloseTo(0, 6);
    expect(at[1]).toBeCloseTo(60, 6);
    expect(at[2]).toBeCloseTo(-80, 6);
  });

  it('keeps its distance from the camera wherever the camera walks', () => {
    const sun: Vector3Tuple = [0.58, -0.45, 0.68];
    const near = sunAnchorPosition([0, 0, 0], sun, 1400);
    const far = sunAnchorPosition([300, 0, 300], sun, 1400);
    expect(far[0] - near[0]).toBeCloseTo(300, 6);
    expect(far[2] - near[2]).toBeCloseTo(300, 6);
  });

  it('leaves the anchor on the camera when there is no sun to walk towards', () => {
    expect(sunAnchorPosition([1, 2, 3], [0, 0, 0], 1400)).toEqual([1, 2, 3]);
  });
});
