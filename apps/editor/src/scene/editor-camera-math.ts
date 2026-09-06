/**
 * The free editor camera, as arithmetic.
 *
 * Babylon's `ArcRotateCamera` holds the same four numbers (alpha, beta, radius,
 * target), but every rule worth getting right — which way a drag turns the
 * view, how far a pan moves the world under the cursor, where `F` puts the
 * camera — is arithmetic, and arithmetic is testable without a GPU. The Babylon
 * binding in `editor-camera.ts` does nothing but read events and write these
 * results onto the camera.
 *
 * Conventions follow Babylon's left-handed `ArcRotateCamera`:
 *
 * ```text
 * position = target + radius * (cos α · sin β, cos β, sin α · sin β)
 * ```
 *
 * so β is the angle down from +Y and α turns around it.
 */

export type Vec3 = readonly [number, number, number];

export interface OrbitState {
  /** Rotation around the world Y axis, in radians. */
  readonly alpha: number;
  /** Angle from +Y, in radians. Clamped away from the poles. */
  readonly beta: number;
  /** Distance from {@link OrbitState.target}, in metres. */
  readonly radius: number;
  /** The point the camera looks at. */
  readonly target: Vec3;
}

export interface CameraLimits {
  readonly minRadius: number;
  readonly maxRadius: number;
  /** How close β may come to straight up or straight down, in radians. */
  readonly polarEpsilon: number;
}

export const defaultCameraLimits: CameraLimits = {
  minRadius: 0.5,
  maxRadius: 2000,
  // Babylon's ArcRotateCamera has no up vector at the poles and flips there.
  polarEpsilon: 0.01,
};

/** Where the editor camera stands when a session opens: above and behind origin. */
export const defaultOrbitState: OrbitState = {
  alpha: -Math.PI / 2,
  beta: Math.PI / 3,
  radius: 30,
  target: [0, 0, 0],
};

/** Vertical field of view, in radians — Babylon's own default. */
export const CAMERA_FOV = 0.8;

export interface OrbitSensitivity {
  /** Radians per pixel of horizontal drag. */
  readonly yaw: number;
  /** Radians per pixel of vertical drag. */
  readonly pitch: number;
}

export const defaultOrbitSensitivity: OrbitSensitivity = { yaw: 0.005, pitch: 0.005 };

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Keeps β off the poles and the radius inside its limits. */
export function clampOrbit(
  state: OrbitState,
  limits: CameraLimits = defaultCameraLimits,
): OrbitState {
  return {
    ...state,
    beta: clamp(state.beta, limits.polarEpsilon, Math.PI - limits.polarEpsilon),
    radius: clamp(state.radius, limits.minRadius, limits.maxRadius),
  };
}

/**
 * Turns the view by a mouse drag.
 *
 * Dragging right turns the camera right around the target, dragging down lifts
 * it — the direction every 3D editor uses, and the reason the signs are pinned
 * by a test instead of by trial and error in the browser.
 */
export function orbitBy(
  state: OrbitState,
  deltaX: number,
  deltaY: number,
  sensitivity: OrbitSensitivity = defaultOrbitSensitivity,
  limits: CameraLimits = defaultCameraLimits,
): OrbitState {
  return clampOrbit(
    {
      ...state,
      alpha: state.alpha - deltaX * sensitivity.yaw,
      beta: state.beta - deltaY * sensitivity.pitch,
    },
    limits,
  );
}

/**
 * Moves the camera closer or further away by a wheel notch.
 *
 * The step is proportional to the current radius, so one notch feels the same
 * whether the camera is a metre or a hundred metres out; a fixed step is either
 * useless up close or useless far away.
 */
export function dollyBy(
  state: OrbitState,
  wheelDelta: number,
  limits: CameraLimits = defaultCameraLimits,
): OrbitState {
  const factor = Math.exp(wheelDelta * 0.001);
  return clampOrbit({ ...state, radius: state.radius * factor }, limits);
}

/** The unit vector pointing from the camera towards its target. */
export function forwardVector(state: OrbitState): Vec3 {
  const sinBeta = Math.sin(state.beta);
  return [
    -Math.cos(state.alpha) * sinBeta,
    -Math.cos(state.beta),
    -Math.sin(state.alpha) * sinBeta,
  ];
}

/** The same direction flattened onto the ground plane, normalised. */
export function groundForwardVector(state: OrbitState): Vec3 {
  return [-Math.cos(state.alpha), 0, -Math.sin(state.alpha)];
}

/** Screen-right in world space; horizontal by construction. */
export function rightVector(state: OrbitState): Vec3 {
  return [-Math.sin(state.alpha), 0, Math.cos(state.alpha)];
}

/** Screen-up in world space. */
export function upVector(state: OrbitState): Vec3 {
  const cosBeta = Math.cos(state.beta);
  return [-Math.cos(state.alpha) * cosBeta, Math.sin(state.beta), -Math.sin(state.alpha) * cosBeta];
}

function add(point: Vec3, direction: Vec3, scale: number): Vec3 {
  return [
    point[0] + direction[0] * scale,
    point[1] + direction[1] * scale,
    point[2] + direction[2] * scale,
  ];
}

/**
 * Drags the world with the cursor.
 *
 * The metres-per-pixel factor is derived from the view frustum at the target
 * distance, so the point under the cursor stays under the cursor: the visible
 * height at distance `radius` is `2 · radius · tan(fov / 2)`, spread over
 * `viewportHeight` pixels.
 */
export function panBy(
  state: OrbitState,
  deltaX: number,
  deltaY: number,
  viewportHeight: number,
  fov: number = CAMERA_FOV,
): OrbitState {
  if (viewportHeight <= 0) {
    return state;
  }
  const metresPerPixel = (2 * state.radius * Math.tan(fov / 2)) / viewportHeight;
  const moved = add(
    add(state.target, rightVector(state), -deltaX * metresPerPixel),
    upVector(state),
    deltaY * metresPerPixel,
  );
  return { ...state, target: moved };
}

/** Which fly keys are held. All false means the camera stands still. */
export interface FlyInput {
  readonly forward: boolean;
  readonly back: boolean;
  readonly left: boolean;
  readonly right: boolean;
  readonly up: boolean;
  readonly down: boolean;
  /** Hold to move faster. */
  readonly fast: boolean;
}

export const noFly: FlyInput = {
  forward: false,
  back: false,
  left: false,
  right: false,
  up: false,
  down: false,
  fast: false,
};

/** Metres per second at a normal pace, and the multiplier when `fast` is held. */
export const FLY_SPEED = 12;
export const FLY_FAST_MULTIPLIER = 4;

/**
 * Flies the camera for one frame.
 *
 * Horizontal movement follows the flattened view direction rather than the true
 * forward: a camera pitched steeply down would otherwise crawl across the
 * ground while appearing to fly at full speed.
 */
export function flyBy(state: OrbitState, input: FlyInput, seconds: number): OrbitState {
  const forward = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
  const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const lift = (input.up ? 1 : 0) - (input.down ? 1 : 0);
  if (forward === 0 && strafe === 0 && lift === 0) {
    return state;
  }

  // A diagonal must not be faster than a straight line.
  const planar = Math.hypot(forward, strafe);
  const normalise = planar > 1 ? 1 / planar : 1;
  const distance = FLY_SPEED * (input.fast ? FLY_FAST_MULTIPLIER : 1) * seconds;

  let target = state.target;
  target = add(target, groundForwardVector(state), forward * normalise * distance);
  target = add(target, rightVector(state), strafe * normalise * distance);
  target = add(target, [0, 1, 0], lift * distance);
  return { ...state, target };
}

/** An axis-aligned box in world space. */
export interface Bounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

/** How much empty space `F` leaves around what it frames. */
export const FOCUS_MARGIN = 1.4;

/**
 * The smallest thing `F` frames as if it were this big, in metres.
 *
 * Roughly a doorway: small enough that a hut still fills the view, large enough
 * that a barrel is shown standing somewhere rather than filling the screen.
 */
export const MINIMUM_FRAMED_SIZE = 2;

/**
 * Where `F` puts the camera: looking at the centre of `bounds` from far enough
 * away that the whole box fits, and never closer than the minimum radius.
 *
 * The view direction is kept — focusing is a move, not a reset, so the author
 * does not lose the angle they were working from.
 */
export function focusOn(
  state: OrbitState,
  bounds: Bounds,
  fov: number = CAMERA_FOV,
  limits: CameraLimits = defaultCameraLimits,
): OrbitState {
  const centre: Vec3 = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  const size = Math.max(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  );
  // Never frame tighter than {@link MINIMUM_FRAMED_SIZE}: a barrel is 25 cm
  // across, and putting the camera 40 cm from it fills the screen with wood and
  // shows nothing of where it stands. A point (size 0) needs the same floor.
  const radius = (Math.max(size, MINIMUM_FRAMED_SIZE) / 2 / Math.tan(fov / 2)) * FOCUS_MARGIN;
  return clampOrbit({ ...state, target: centre, radius }, limits);
}
