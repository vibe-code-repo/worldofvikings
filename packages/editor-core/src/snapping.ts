/**
 * Grid and angle snapping (spec §14: "grid snapping").
 *
 * Pure number work, deliberately free of any editor state, so the viewport, the
 * inspector's numeric fields and a scatter tool all round the same way.
 */
import type { Vector3 } from '@wov/world-schema';

/** Half a metre: fine enough for props, coarse enough to line up walls. */
export const DEFAULT_GRID_STEP = 0.5;

/** 15° — the smallest step that still divides 90° and 360° evenly. */
export const DEFAULT_ROTATION_STEP_DEGREES = 15;

/**
 * Decimal places kept after snapping.
 *
 * `Math.round(0.29 / 0.1) * 0.1` is `0.30000000000000004`. Writing that into a
 * world file would make a snapped value look unsnapped in every diff, so the
 * result is rounded back to a number the file can show.
 */
const OUTPUT_DECIMALS = 6;

/**
 * Rounds `value` to the nearest multiple of `step`.
 *
 * A step that cannot snap anything — zero, negative, or not a number — returns
 * the value unchanged instead of producing `NaN` or `Infinity`: snapping off is
 * a normal editor state, not an error.
 */
export function gridSnap(value: number, step: number = DEFAULT_GRID_STEP): number {
  if (!Number.isFinite(step) || step <= 0 || !Number.isFinite(value)) {
    return value;
  }
  return cleanNumber(Math.round(value / step) * step);
}

/** {@link gridSnap} on all three axes. */
export function snapPosition(position: Vector3, step: number = DEFAULT_GRID_STEP): Vector3 {
  return [gridSnap(position[0], step), gridSnap(position[1], step), gridSnap(position[2], step)];
}

/**
 * Rounds one Euler angle to whole degree steps.
 *
 * World data stores radians (Babylon.js), but people think in degrees and a
 * gizmo snaps in degrees, so the rounding happens in degrees and the result
 * goes back to radians.
 */
export function snapRotationAngle(
  radians: number,
  stepDegrees: number = DEFAULT_ROTATION_STEP_DEGREES,
): number {
  if (!Number.isFinite(stepDegrees) || stepDegrees <= 0 || !Number.isFinite(radians)) {
    return radians;
  }
  const degrees = (radians * 180) / Math.PI;
  const snapped = Math.round(degrees / stepDegrees) * stepDegrees;
  // No decimal rounding here, unlike a position: the honest radian value of a
  // whole degree count is irrational, and cutting it short would move the model
  // instead of tidying the file. Only `-0` is normalised, because JSON keeps it.
  return withoutNegativeZero((snapped * Math.PI) / 180);
}

/** {@link snapRotationAngle} on all three Euler angles. */
export function snapRotation(
  rotation: Vector3,
  stepDegrees: number = DEFAULT_ROTATION_STEP_DEGREES,
): Vector3 {
  return [
    snapRotationAngle(rotation[0], stepDegrees),
    snapRotationAngle(rotation[1], stepDegrees),
    snapRotationAngle(rotation[2], stepDegrees),
  ];
}

/** Rounds away binary floating point noise, and `-0`, which JSON keeps. */
function cleanNumber(value: number): number {
  return withoutNegativeZero(Number(value.toFixed(OUTPUT_DECIMALS)));
}

function withoutNegativeZero(value: number): number {
  return value === 0 ? 0 : value;
}
