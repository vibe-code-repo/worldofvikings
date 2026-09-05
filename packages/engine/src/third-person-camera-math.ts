/**
 * The arithmetic of the third-person camera (spec §26): where it sits, where
 * it looks, how it turns, how it zooms and how it gets out of a wall's way.
 *
 * Babylon.js is deliberately absent from this file, and so is the DOM. A
 * camera is the one part of the renderer a player *feels*, and feel is a
 * property of numbers over time — a lag that halves when the frame rate
 * doubles, a pitch that flips at the pole, a zoom that jumps. None of that is
 * visible in a screenshot and none of it is testable through a GPU, so it
 * lives here where a plain Vitest run can pin it down.
 *
 * The module holds no state of its own: every function takes a state and
 * answers a new one. The Babylon binding in `./third-person-camera.ts` keeps
 * the current state and copies the result onto a `TargetCamera`. That is also
 * why this is not gameplay: the camera reads the target point through a getter
 * the app owns and never writes anything back (spec §25).
 *
 * Coordinates follow Babylon's default left-handed, Y-up system: with yaw 0 the
 * character faces +Z and the camera sits behind it at -Z; positive pitch lifts
 * the camera and makes it look down.
 */
import { clamp } from '@wov/shared';

/** A point or direction as `[x, y, z]`, so this module needs no Babylon type. */
export type Vec3 = readonly [number, number, number];

/** The line the camera would like to occupy this frame. */
export interface CameraObstacleProbe {
  /** The point the camera looks at — the pivot, not the character's feet. */
  readonly origin: Vec3;
  /** Unit vector from the pivot towards the camera. */
  readonly direction: Vec3;
  /** How far out the camera wants to sit, in metres. */
  readonly maxDistance: number;
}

/**
 * Answers how much of the probe is free, or `null` when nothing blocks it.
 *
 * This is the seam the physics layer plugs into: chain D backs it with a Havok
 * shape cast (spec §29). Until then {@link noCameraObstacles} is the default,
 * so the camera behaves exactly as if it were outdoors — the one honest
 * behaviour for "nothing has been asked yet".
 */
export type CameraObstacleQuery = (probe: CameraObstacleProbe) => number | null;

/** The default query: the world is empty, the camera keeps its distance. */
export const noCameraObstacles: CameraObstacleQuery = () => null;

/** Where the camera is aimed, before the distance is applied. */
export interface CameraOrientation {
  /** Rotation around Y in radians, wrapped into `(-π, π]`. */
  readonly yaw: number;
  /** Elevation above the pivot in radians, clamped to the pitch limits. */
  readonly pitch: number;
}

/** Mouse and wheel movement accumulated since the previous frame. */
export interface CameraLookMovement {
  /** Horizontal mouse movement in pixels; positive turns right. */
  readonly lookDx?: number;
  /** Vertical mouse movement in pixels; positive lifts the camera. */
  readonly lookDy?: number;
}

/** Everything one camera frame depends on. */
export interface CameraFrameInput extends CameraLookMovement {
  /** The point being followed, read fresh each frame from the app's getter. */
  readonly target: Vec3;
  /** Normalised wheel ticks; positive pushes the camera out. */
  readonly zoomTicks?: number;
  /** Real time since the previous frame. Capped by `maxDeltaSeconds`. */
  readonly deltaSeconds: number;
  /** Defaults to {@link noCameraObstacles}. */
  readonly obstacle?: CameraObstacleQuery;
}

/** The camera's whole memory. Everything else is derived per frame. */
export interface ThirdPersonCameraState extends CameraOrientation {
  /** The distance the player asked for with the wheel, before obstacles. */
  readonly desiredDistance: number;
  /** The distance actually used, after obstacles and smoothing. */
  readonly distance: number;
  /** The smoothed point the camera looks at (target plus `targetOffset`). */
  readonly pivot: Vec3;
}

/** A stepped state plus the placement it implies. */
export interface ThirdPersonCameraStep {
  readonly state: ThirdPersonCameraState;
  /** Where the camera goes. */
  readonly position: Vec3;
  /** What it looks at. Identical to `state.pivot`, named for the caller. */
  readonly focus: Vec3;
}

/** A complete, validated camera description. Plain data — no Babylon types. */
export interface ResolvedThirdPersonCameraSettings {
  /** Distance the camera starts at and returns to, in metres. */
  readonly distance: number;
  readonly minDistance: number;
  readonly maxDistance: number;
  /** Metres of distance per wheel tick. */
  readonly zoomStep: number;
  /** Lowest camera elevation in radians; negative looks up at the character. */
  readonly minPitch: number;
  /** Highest camera elevation in radians; must stay short of straight down. */
  readonly maxPitch: number;
  /** Radians of yaw per pixel of mouse movement. */
  readonly yawSensitivity: number;
  /** Radians of pitch per pixel of mouse movement. */
  readonly pitchSensitivity: number;
  /** Flips the vertical axis for players who fly rather than aim. */
  readonly invertY: boolean;
  /** Offset from the followed point to the pivot — head height, not feet. */
  readonly targetOffset: Vec3;
  /** Time constant of the follow lag in seconds; `0` follows rigidly. */
  readonly followSmoothing: number;
  /** Time constant for distance changes (zoom and getting clear of a wall). */
  readonly distanceSmoothing: number;
  /** Gap kept between the lens and whatever the obstacle query hit. */
  readonly obstaclePadding: number;
  /** The camera never comes closer than this, however tight the corner. */
  readonly minObstructedDistance: number;
  /** Longest time step honoured; protects against backgrounded tabs. */
  readonly maxDeltaSeconds: number;
  readonly initialYaw: number;
  readonly initialPitch: number;
}

export type ThirdPersonCameraSettings = Partial<ResolvedThirdPersonCameraSettings>;

const CAMERA_DEFAULTS = {
  distance: 6,
  minDistance: 2,
  maxDistance: 12,
  zoomStep: 0.9,
  // −17° to 66°: low enough to look up at a cliff, high enough for a near
  // top-down view, and short of the pole where the up vector degenerates.
  minPitch: -0.3,
  maxPitch: 1.15,
  // ~0.14° per pixel: a 180° turn takes roughly 1250 px, the usual desktop feel.
  yawSensitivity: 0.0025,
  pitchSensitivity: 0.0025,
  invertY: false,
  // Chest/head height of a ~1.8 m viking: the camera looks at the character,
  // not at the ground between its boots.
  targetOffset: [0, 1.5, 0],
  followSmoothing: 0.12,
  distanceSmoothing: 0.18,
  obstaclePadding: 0.3,
  minObstructedDistance: 0.8,
  maxDeltaSeconds: 0.1,
  initialYaw: 0,
  initialPitch: 0.28,
} as const satisfies ResolvedThirdPersonCameraSettings;

/**
 * Half a turn short of the pole. At exactly ±π/2 the camera's forward vector
 * is parallel to its up vector and the view rolls at random, so the pitch
 * limits have to stay strictly inside.
 */
const PITCH_LIMIT = Math.PI / 2;

function requireFinite(value: number, field: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`third-person camera: ${field} must be a finite number, got ${value}`);
  }
  return value;
}

function requirePositive(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`third-person camera: ${field} must be a positive number, got ${value}`);
  }
  return value;
}

function requireNonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`third-person camera: ${field} must be zero or more, got ${value}`);
  }
  return value;
}

/** A movement that is not a number is dropped, not propagated into the state. */
function usableMovement(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : 0;
}

/**
 * Folds an angle into `(-π, π]`.
 *
 * Yaw accumulates for as long as the session lasts; left alone it grows without
 * bound and loses precision where the player can feel it.
 */
export function wrapAngle(radians: number): number {
  if (!Number.isFinite(radians)) {
    return 0;
  }
  const turn = 2 * Math.PI;
  const folded = radians % turn;
  if (folded <= -Math.PI) {
    return folded + turn;
  }
  if (folded > Math.PI) {
    return folded - turn;
  }
  return folded;
}

/**
 * How much of the remaining gap to close in `deltaSeconds`, for a lag with the
 * time constant `smoothingSeconds` (after which ~63 % of the gap is gone).
 *
 * Exponential rather than the usual `current += gap * rate`: only this form
 * gives the same lag at 30 and at 144 FPS, because two half steps compose into
 * one whole step. A fixed per-frame rate ties the camera's feel to the frame
 * rate, which is exactly the bug nobody sees on their own machine.
 */
export function smoothingFactor(smoothingSeconds: number, deltaSeconds: number): number {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
    return 0;
  }
  if (!Number.isFinite(smoothingSeconds) || smoothingSeconds <= 0) {
    return 1;
  }
  return 1 - Math.exp(-deltaSeconds / smoothingSeconds);
}

/** Moves `current` towards `target` with the lag of {@link smoothingFactor}. */
export function smoothScalar(
  current: number,
  target: number,
  smoothingSeconds: number,
  deltaSeconds: number,
): number {
  const factor = smoothingFactor(smoothingSeconds, deltaSeconds);
  return factor >= 1 ? target : current + (target - current) * factor;
}

/** Component-wise {@link smoothScalar}. */
export function smoothPoint(
  current: Vec3,
  target: Vec3,
  smoothingSeconds: number,
  deltaSeconds: number,
): Vec3 {
  const factor = smoothingFactor(smoothingSeconds, deltaSeconds);
  if (factor >= 1) {
    return [target[0], target[1], target[2]];
  }
  return [
    current[0] + (target[0] - current[0]) * factor,
    current[1] + (target[1] - current[1]) * factor,
    current[2] + (target[2] - current[2]) * factor,
  ];
}

/** Applies mouse movement to an orientation: yaw wraps, pitch is clamped. */
export function applyLook(
  orientation: CameraOrientation,
  look: CameraLookMovement,
  settings: ResolvedThirdPersonCameraSettings,
): CameraOrientation {
  const dx = usableMovement(look.lookDx);
  const dy = usableMovement(look.lookDy);
  const pitchDelta = (settings.invertY ? -dy : dy) * settings.pitchSensitivity;
  return {
    yaw: wrapAngle(orientation.yaw + dx * settings.yawSensitivity),
    pitch: clamp(orientation.pitch + pitchDelta, settings.minPitch, settings.maxPitch),
  };
}

/** Applies wheel ticks to the distance the player asked for. */
export function applyZoom(
  desiredDistance: number,
  ticks: number,
  settings: ResolvedThirdPersonCameraSettings,
): number {
  const usable = Number.isFinite(ticks) ? ticks : 0;
  return clamp(
    desiredDistance + usable * settings.zoomStep,
    settings.minDistance,
    settings.maxDistance,
  );
}

const WHEEL_PIXELS_PER_TICK = 100;
const WHEEL_LINES_PER_TICK = 3;

/**
 * Normalises a `WheelEvent` into ticks.
 *
 * `deltaY` is not comparable across browsers or devices: `deltaMode` says
 * whether it counts pixels (0), lines (1) or pages (2), and the same notch of
 * the same wheel reports ~100 in Chrome and ~3 lines in Firefox. Zooming
 * straight from `deltaY` therefore moves a different distance per browser.
 */
export function wheelTicks(deltaY: number, deltaMode: number = 0): number {
  if (!Number.isFinite(deltaY)) {
    return 0;
  }
  if (deltaMode === 1) {
    return deltaY / WHEEL_LINES_PER_TICK;
  }
  if (deltaMode === 2) {
    return deltaY;
  }
  return deltaY / WHEEL_PIXELS_PER_TICK;
}

/** The unit vector from the pivot towards the camera. */
export function orbitDirection(yaw: number, pitch: number): Vec3 {
  const cosPitch = Math.cos(pitch);
  return [-Math.sin(yaw) * cosPitch, Math.sin(pitch), -Math.cos(yaw) * cosPitch];
}

/** `origin + direction * distance`. */
export function pointOnRay(origin: Vec3, direction: Vec3, distance: number): Vec3 {
  return [
    origin[0] + direction[0] * distance,
    origin[1] + direction[1] * distance,
    origin[2] + direction[2] * distance,
  ];
}

/**
 * Turns an obstacle query's answer into the distance the camera may use, or
 * `null` when the answer imposes no limit at all.
 *
 * A non-finite answer is a bug in the query. Acting on it would slam the
 * camera into the character's face; ignoring it keeps the shot and leaves the
 * bug visible where it was made.
 */
export function resolveObstacleLimit(
  desiredDistance: number,
  free: number | null,
  settings: ResolvedThirdPersonCameraSettings,
): number | null {
  if (free === null || !Number.isFinite(free)) {
    return null;
  }
  const padded = free - settings.obstaclePadding;
  if (padded >= desiredDistance) {
    return null;
  }
  return Math.min(desiredDistance, Math.max(padded, settings.minObstructedDistance));
}

/**
 * Chooses this frame's distance.
 *
 * Asymmetric on purpose: a wall arrives instantly (a smoothed approach would
 * let the geometry cross the near plane for a few frames and the player would
 * see through the world), while every widening — the wall ending, or the
 * player zooming out — is eased so the shot does not snap open.
 */
export function settleDistance(
  currentDistance: number,
  desiredDistance: number,
  limit: number | null,
  settings: ResolvedThirdPersonCameraSettings,
  deltaSeconds: number,
): number {
  if (limit !== null && limit <= currentDistance) {
    return limit;
  }
  const goal = limit ?? desiredDistance;
  return smoothScalar(currentDistance, goal, settings.distanceSmoothing, deltaSeconds);
}

/** Validates and completes a partial camera description. */
export function resolveThirdPersonCameraSettings(
  overrides: ThirdPersonCameraSettings = {},
): ResolvedThirdPersonCameraSettings {
  const minDistance = requirePositive(
    overrides.minDistance ?? CAMERA_DEFAULTS.minDistance,
    'minDistance',
  );
  const maxDistance = requirePositive(
    overrides.maxDistance ?? CAMERA_DEFAULTS.maxDistance,
    'maxDistance',
  );
  if (minDistance > maxDistance) {
    throw new Error(
      `third-person camera: minDistance (${minDistance}) must not exceed maxDistance (${maxDistance})`,
    );
  }

  const minPitch = requireFinite(overrides.minPitch ?? CAMERA_DEFAULTS.minPitch, 'minPitch');
  const maxPitch = requireFinite(overrides.maxPitch ?? CAMERA_DEFAULTS.maxPitch, 'maxPitch');
  if (minPitch <= -PITCH_LIMIT) {
    throw new Error(
      `third-person camera: minPitch (${minPitch}) must stay above -π/2, where the view rolls freely`,
    );
  }
  if (maxPitch >= PITCH_LIMIT) {
    throw new Error(
      `third-person camera: maxPitch (${maxPitch}) must stay below π/2, where the view rolls freely`,
    );
  }
  if (minPitch > maxPitch) {
    throw new Error(
      `third-person camera: minPitch (${minPitch}) must not exceed maxPitch (${maxPitch})`,
    );
  }

  const offset = overrides.targetOffset ?? CAMERA_DEFAULTS.targetOffset;
  for (const [axis, component] of offset.entries()) {
    requireFinite(component, `targetOffset[${axis}]`);
  }

  const minObstructedDistance = requirePositive(
    overrides.minObstructedDistance ?? CAMERA_DEFAULTS.minObstructedDistance,
    'minObstructedDistance',
  );

  return {
    // Clamped rather than rejected: a starting distance outside the range is a
    // preference, not a contradiction, and the wheel would clamp it anyway.
    distance: clamp(
      requirePositive(overrides.distance ?? CAMERA_DEFAULTS.distance, 'distance'),
      minDistance,
      maxDistance,
    ),
    minDistance,
    maxDistance,
    zoomStep: requirePositive(overrides.zoomStep ?? CAMERA_DEFAULTS.zoomStep, 'zoomStep'),
    minPitch,
    maxPitch,
    yawSensitivity: requireNonNegative(
      overrides.yawSensitivity ?? CAMERA_DEFAULTS.yawSensitivity,
      'yawSensitivity',
    ),
    pitchSensitivity: requireNonNegative(
      overrides.pitchSensitivity ?? CAMERA_DEFAULTS.pitchSensitivity,
      'pitchSensitivity',
    ),
    invertY: overrides.invertY ?? CAMERA_DEFAULTS.invertY,
    targetOffset: [offset[0], offset[1], offset[2]],
    followSmoothing: requireNonNegative(
      overrides.followSmoothing ?? CAMERA_DEFAULTS.followSmoothing,
      'followSmoothing',
    ),
    distanceSmoothing: requireNonNegative(
      overrides.distanceSmoothing ?? CAMERA_DEFAULTS.distanceSmoothing,
      'distanceSmoothing',
    ),
    obstaclePadding: requireNonNegative(
      overrides.obstaclePadding ?? CAMERA_DEFAULTS.obstaclePadding,
      'obstaclePadding',
    ),
    minObstructedDistance,
    maxDeltaSeconds: requirePositive(
      overrides.maxDeltaSeconds ?? CAMERA_DEFAULTS.maxDeltaSeconds,
      'maxDeltaSeconds',
    ),
    initialYaw: wrapAngle(
      requireFinite(overrides.initialYaw ?? CAMERA_DEFAULTS.initialYaw, 'initialYaw'),
    ),
    initialPitch: clamp(
      requireFinite(overrides.initialPitch ?? CAMERA_DEFAULTS.initialPitch, 'initialPitch'),
      minPitch,
      maxPitch,
    ),
  };
}

/** The description used when the camera is created with nothing. */
export const defaultThirdPersonCameraSettings: ResolvedThirdPersonCameraSettings =
  resolveThirdPersonCameraSettings();

/**
 * The state of a camera that has just been created: already framed on the
 * target rather than easing in from the world origin, which would otherwise be
 * the first thing every player sees.
 */
export function createThirdPersonCameraState(
  settings: ResolvedThirdPersonCameraSettings,
  target: Vec3,
): ThirdPersonCameraState {
  return {
    yaw: settings.initialYaw,
    pitch: settings.initialPitch,
    desiredDistance: settings.distance,
    distance: settings.distance,
    pivot: [
      target[0] + settings.targetOffset[0],
      target[1] + settings.targetOffset[1],
      target[2] + settings.targetOffset[2],
    ],
  };
}

/**
 * One camera frame: input first, then the follow lag, then the obstacle query
 * along the line the camera is actually about to use.
 *
 * The order matters. Probing before the orientation is updated would test last
 * frame's line, which is how a camera ends up inside the wall it just checked.
 */
export function stepThirdPersonCamera(
  state: ThirdPersonCameraState,
  input: CameraFrameInput,
  settings: ResolvedThirdPersonCameraSettings,
): ThirdPersonCameraStep {
  // A backgrounded tab hands back one enormous delta on its first frame. Left
  // uncapped it closes every lag at once and the camera teleports.
  const deltaSeconds = clamp(
    Number.isFinite(input.deltaSeconds) ? Math.max(input.deltaSeconds, 0) : 0,
    0,
    settings.maxDeltaSeconds,
  );

  const orientation = applyLook(state, input, settings);
  const desiredDistance = applyZoom(state.desiredDistance, input.zoomTicks ?? 0, settings);

  const pivot = smoothPoint(
    state.pivot,
    [
      input.target[0] + settings.targetOffset[0],
      input.target[1] + settings.targetOffset[1],
      input.target[2] + settings.targetOffset[2],
    ],
    settings.followSmoothing,
    deltaSeconds,
  );

  const direction = orbitDirection(orientation.yaw, orientation.pitch);
  const query = input.obstacle ?? noCameraObstacles;
  const limit = resolveObstacleLimit(
    desiredDistance,
    query({ origin: pivot, direction, maxDistance: desiredDistance }),
    settings,
  );
  const distance = settleDistance(state.distance, desiredDistance, limit, settings, deltaSeconds);

  return {
    state: { ...orientation, desiredDistance, distance, pivot },
    position: pointOnRay(pivot, direction, distance),
    focus: pivot,
  };
}
