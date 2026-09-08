/**
 * When a footstep happens — the pacing, with nothing in it but numbers.
 *
 * A footstep clock that ticks in *time* keeps playing while the player stands
 * against a wall, and plays at the same rate whether they are walking or
 * sprinting. So this counts **ground covered**: a step every `strideWalk`
 * metres, or every `strideSprint` metres when sprint is held — the sprint
 * stride being the longer of the two, because a run covers more ground per step
 * and still arrives sooner, since the metres go by faster.
 *
 * `minInterval` is the floor underneath that: however fast a slope, a slide or
 * a future dodge moves the capsule, two footsteps never land closer together
 * than a human foot can. Without it, being pushed along a wall by the collision
 * solver (ADR-0038) is a machine-gun.
 *
 * Only the vertical is thrown away — the distance is measured in x and z —
 * because falling is not walking, and a lift down a cliff should not sound like
 * a jog.
 *
 * Pure, so the whole of it can be watched in a test with no audio engine, no
 * scene and no clock (agent rule 14).
 */

/** How far apart footsteps are. */
export interface StrideSettings {
  /** Metres of ground between two steps at a walk. */
  readonly strideWalk: number;
  /** …and while sprint is held. */
  readonly strideSprint: number;
  /** Never two steps closer together than this, in seconds. */
  readonly minInterval: number;
}

/** What the accumulator remembers between steps. */
export interface StrideState {
  /** Metres of ground covered since the last footstep. */
  readonly distance: number;
  /** Seconds since the last footstep. */
  readonly sinceStep: number;
}

/**
 * A player who has just arrived, standing still.
 *
 * `sinceStep` starts high rather than at zero so that the very first step is
 * not swallowed by `minInterval` — walking out of a spawn should be audible
 * from the first stride.
 */
export const initialStride: StrideState = { distance: 0, sinceStep: 1000 };

/** One frame's worth of movement, as the accumulator needs it. */
export interface StrideInput {
  /** Where the player was, and is, in world metres. */
  readonly from: { readonly x: number; readonly y: number; readonly z: number };
  readonly to: { readonly x: number; readonly y: number; readonly z: number };
  /** Feet on something. A player in the air makes no footsteps. */
  readonly grounded: boolean;
  readonly sprinting: boolean;
  readonly deltaSeconds: number;
}

/** What {@link advanceStride} decided. */
export interface StrideStep {
  readonly state: StrideState;
  /** Whether a footstep should be played now. */
  readonly step: boolean;
}

/**
 * Advances the stride by one simulation step.
 *
 * At most one footstep per call, even when a single step covered three strides:
 * a teleport is not a sprint, and three clips fired in one frame is a stumble
 * nobody made. The surplus distance is dropped rather than carried, so a
 * respawn across the village does not owe the player four hundred footsteps.
 */
export function advanceStride(
  state: StrideState,
  input: StrideInput,
  settings: StrideSettings,
): StrideStep {
  const sinceStep = state.sinceStep + Math.max(input.deltaSeconds, 0);
  if (!input.grounded) {
    // In the air the clock still runs — landing should be able to make a sound
    // immediately — but no ground is covered.
    return { state: { distance: 0, sinceStep }, step: false };
  }

  const moved = Math.hypot(input.to.x - input.from.x, input.to.z - input.from.z);
  const distance = state.distance + moved;
  const stride = input.sprinting ? settings.strideSprint : settings.strideWalk;

  if (distance < stride || sinceStep < settings.minInterval) {
    return { state: { distance, sinceStep }, step: false };
  }
  return { state: { distance: 0, sinceStep: 0 }, step: true };
}
