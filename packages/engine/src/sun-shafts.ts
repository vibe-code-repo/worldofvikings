/**
 * Where the sun stands in the frame, and whether shafts are worth drawing at
 * all (ADR-0042).
 *
 * Free of Babylon.js, like `shadow-snap.ts` and `fog.ts` next to it, because
 * both answers here are arithmetic and both are the kind of arithmetic that is
 * silently wrong rather than loudly broken.
 *
 * **Why a gate exists at all.** Babylon's volumetric scattering finds the sun
 * by projecting a world-space point onto the screen, and a perspective divide
 * does not know the difference between a point in front of the camera and its
 * mirror image behind it. Past 90° off axis the projected origin lands back
 * inside the frame, so an ungated effect does not fade out when the player
 * turns away from the sun — it paints a bright smear into the middle of a
 * picture that contains no sun. That is measured in ADR-0042, in pixels.
 *
 * **Why the sun needs an anchor.** The profile's sun is a direction, not a
 * place, and a direction cannot be projected onto a screen. So something has to
 * stand in for it: a point the camera carries with it, far enough out that the
 * painted range in front of it eclipses it and near enough to stay inside the
 * far plane.
 */
import type { Vector3Tuple } from './base-scene.js';

/** Length of a vector, without importing a maths library for it. */
function length(vector: Vector3Tuple): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

/**
 * The angle between the view axis and the sun, in degrees, or `null`.
 *
 * `forward` is where the camera looks; `sunDirection` is the direction the
 * light **travels**, matching `DirectionalLight` and the world format, so the
 * direction *towards* the sun is its negation. 0° means the sun is dead centre
 * in the frame, 180° means it is directly behind the player.
 *
 * `null` for a zero-length vector on either side, because there is no angle
 * between a direction and nothing. Callers read that as "no shafts", which is
 * the safe answer: a sun that cannot be located must not be guessed at.
 */
export function sunViewAngleDegrees(
  forward: Vector3Tuple,
  sunDirection: Vector3Tuple,
): number | null {
  const forwardLength = length(forward);
  const sunLength = length(sunDirection);
  if (forwardLength === 0 || sunLength === 0) {
    return null;
  }
  // Towards the sun, not along the light.
  const dot =
    (-sunDirection[0] * forward[0] - sunDirection[1] * forward[1] - sunDirection[2] * forward[2]) /
    (forwardLength * sunLength);
  // Rounding can push a parallel pair a hair past ±1, and `Math.acos` answers
  // that with NaN rather than 0 or π.
  return (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
}

/** What the gate decided for one frame. */
export interface SunShaftsGateState {
  /** Whether the effect should be attached to the camera this frame. */
  readonly active: boolean;
  /**
   * How much of the authored exposure to use, 0…1.
   *
   * It reaches 0 exactly where {@link sunShaftsGate} stops asking for the
   * effect, so detaching is invisible rather than a step in brightness.
   */
  readonly strength: number;
}

/**
 * Whether the sun is near enough to the view axis for shafts, and how strongly.
 *
 * The band is `maxAngleDegrees ± hysteresisDegrees`:
 *
 * - below the lower edge the effect is on at full strength;
 * - across the band the strength ramps to zero;
 * - at the upper edge it detaches, and it does not re-attach until the sun is
 *   back inside `maxAngleDegrees`.
 *
 * The two edges are what stops a player panning along the threshold from
 * switching a second full scene pass on and off sixty times a second. `wasActive`
 * is the caller's previous answer, which is what makes the gate a latch rather
 * than a comparison; a caller with no history passes `false` and gets the
 * stricter edge, which is the right way round for a first frame.
 */
export function sunShaftsGate(
  forward: Vector3Tuple,
  sunDirection: Vector3Tuple,
  maxAngleDegrees: number,
  hysteresisDegrees: number,
  wasActive: boolean,
): SunShaftsGateState {
  const angle = sunViewAngleDegrees(forward, sunDirection);
  if (angle === null || !Number.isFinite(maxAngleDegrees)) {
    return { active: false, strength: 0 };
  }
  const hysteresis = Number.isFinite(hysteresisDegrees) ? Math.max(0, hysteresisDegrees) : 0;
  const releaseAt = maxAngleDegrees + hysteresis;
  const fullUntil = maxAngleDegrees - hysteresis;
  const active = wasActive ? angle < releaseAt : angle <= maxAngleDegrees;
  if (!active) {
    return { active: false, strength: 0 };
  }
  if (hysteresis === 0) {
    // No band to fade across: the caller asked for a hard edge and gets one.
    return { active: true, strength: 1 };
  }
  const ramp = (releaseAt - angle) / (releaseAt - fullUntil);
  return { active: true, strength: Math.min(1, Math.max(0, ramp)) };
}

/**
 * Where to park the stand-in for the sun, given where the camera is.
 *
 * `distance` metres along the direction the light comes *from*, measured from
 * the camera, so the anchor keeps its place in the sky as the player walks
 * instead of sliding across it. It has to clear whatever the world paints on
 * its horizon — otherwise the sun floats in front of the mountains rather than
 * setting behind them — and it has to stay inside the camera's far plane, or it
 * is clipped away and the pass goes black. Those two bounds are the whole
 * reason `anchorDistance` is world data (ADR-0042).
 *
 * A zero sun direction leaves the anchor on the camera, which is the only
 * position that cannot be mistaken for a sun: the gate refuses that case
 * anyway, so nothing is ever drawn from it.
 */
export function sunAnchorPosition(
  cameraPosition: Vector3Tuple,
  sunDirection: Vector3Tuple,
  distance: number,
): Vector3Tuple {
  const sunLength = length(sunDirection);
  if (sunLength === 0 || !Number.isFinite(distance)) {
    return [cameraPosition[0], cameraPosition[1], cameraPosition[2]];
  }
  const scale = distance / sunLength;
  return [
    cameraPosition[0] - sunDirection[0] * scale,
    cameraPosition[1] - sunDirection[1] * scale,
    cameraPosition[2] - sunDirection[2] * scale,
  ];
}
