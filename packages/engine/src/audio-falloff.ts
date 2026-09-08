/**
 * How loud a placed sound is at a distance — the arithmetic, with no Babylon.js
 * and no WebAudio in it.
 *
 * The browser does this sum itself inside a `PannerNode`, so nothing here is
 * needed to *make* a sound quieter. It is needed to **answer questions about**
 * one, and there is no other way to ask:
 *
 * - "Is this emitter worth keeping running at all?" A distance cull needs the
 *   radius at which a source has faded into the bed. That number is a property
 *   of the curve, and the curve lives in the audio thread.
 * - "Why can I still hear the forge from across the square?" A radius that can
 *   be printed is a radius an author can argue with.
 * - "Does a rolloff of 1.6 mean anything?" It does, and a test can say what.
 *
 * The three models are the ones the Web Audio API specifies for
 * `PannerNode.distanceModel`, written out here in the same form, so that what
 * this predicts and what the browser plays are the same curve rather than two
 * approximations of one idea.
 */

/** The three curves a `PannerNode` can use. */
export type AudioDistanceModel = 'linear' | 'inverse' | 'exponential';

/** Everything that decides how a placed sound fades with distance. */
export interface AudioFalloff {
  readonly distanceModel: AudioDistanceModel;
  /**
   * Distance in metres at which the fade *starts*. Inside it the sound is at
   * full volume rather than louder — this is the value that keeps a brazier
   * from blowing up as the camera walks into the flame.
   */
  readonly minDistance: number;
  /**
   * Distance beyond which nothing gets quieter. **Only the `linear` model uses
   * it.** It is still carried, so the day a profile switches models it means
   * something rather than appearing from nowhere.
   */
  readonly maxDistance: number;
  /** How fast the fade is. `0` never fades; larger is steeper. */
  readonly rolloffFactor: number;
}

/**
 * The Web Audio defaults, restated rather than assumed.
 *
 * `inverse` because it is the only one of the three that behaves like distance
 * in air over the range a village spans: `linear` reaches silence at a hard
 * edge and `exponential` collapses too fast to hear anything mid-square.
 */
export const defaultAudioFalloff: AudioFalloff = {
  distanceModel: 'inverse',
  minDistance: 1,
  maxDistance: 10_000,
  rolloffFactor: 1,
};

/**
 * Fills in what a caller did not say, and refuses what cannot be played.
 *
 * A `minDistance` of zero divides by zero in two of the three models and yields
 * silence in the third, which reads on screen as "the emitter is broken"
 * a long way from the world file that caused it. It is clamped to a hair above
 * zero rather than accepted (agent rule 10).
 */
export function resolveAudioFalloff(options: Partial<AudioFalloff> = {}): AudioFalloff {
  const minDistance = Math.max(options.minDistance ?? defaultAudioFalloff.minDistance, 1e-4);
  return {
    distanceModel: options.distanceModel ?? defaultAudioFalloff.distanceModel,
    minDistance,
    maxDistance: Math.max(options.maxDistance ?? defaultAudioFalloff.maxDistance, minDistance),
    rolloffFactor: Math.max(options.rolloffFactor ?? defaultAudioFalloff.rolloffFactor, 0),
  };
}

/**
 * Gain in `0…1` at a distance in metres, by the Web Audio distance models.
 *
 * @example
 * // A brazier: full inside the flame's own width, gone across the square.
 * distanceGain({ distanceModel: 'inverse', minDistance: 1.5,
 *                maxDistance: 25, rolloffFactor: 1.6 }, 12)  // ≈ 0.082
 */
export function distanceGain(falloff: AudioFalloff, distance: number): number {
  const { distanceModel, minDistance, maxDistance, rolloffFactor } = falloff;
  const beyond = Math.max(distance, minDistance);

  if (distanceModel === 'linear') {
    // The one model that uses maxDistance, and the one that can reach silence.
    const span = Math.max(maxDistance - minDistance, 1e-4);
    const clamped = Math.min(beyond, maxDistance);
    return clamp01(1 - (rolloffFactor * (clamped - minDistance)) / span);
  }
  if (distanceModel === 'exponential') {
    return clamp01((beyond / minDistance) ** -rolloffFactor);
  }
  return clamp01(minDistance / (minDistance + rolloffFactor * (beyond - minDistance)));
}

/**
 * Below this gain a source is under the ambience bed and not worth a panner.
 *
 * Two percent, and not zero, because two of the three curves never reach zero:
 * `inverse` and `exponential` are asymptotic, so "where does it end" has no
 * answer without a threshold. Two percent is roughly −34 dB, which is under
 * every bed this project has.
 */
export const AUDIBLE_GAIN_THRESHOLD = 0.02;

/**
 * The distance past which a source is not worth playing — what a distance cull
 * asks for.
 *
 * Solved rather than searched: each model is inverted analytically, so this is
 * a handful of arithmetic per emitter and not a loop.
 *
 * Returns `Infinity` when the curve never falls below the threshold — a rolloff
 * of zero, or a `linear` curve whose floor of `1 - rolloffFactor` is still
 * audible. That is the honest answer, and a caller that culls on it will simply
 * never cull, which is correct: the sound really is still there.
 */
export function audibleRadius(
  falloff: AudioFalloff,
  threshold: number = AUDIBLE_GAIN_THRESHOLD,
): number {
  const { distanceModel, minDistance, maxDistance, rolloffFactor } = falloff;
  const wanted = clamp01(threshold);
  if (rolloffFactor <= 0 || wanted <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  if (distanceModel === 'linear') {
    const span = Math.max(maxDistance - minDistance, 1e-4);
    const atMax = 1 - rolloffFactor;
    if (atMax >= wanted) {
      return Number.POSITIVE_INFINITY;
    }
    return minDistance + ((1 - wanted) * span) / rolloffFactor;
  }
  if (distanceModel === 'exponential') {
    return minDistance * wanted ** (-1 / rolloffFactor);
  }
  return minDistance + (minDistance * (1 / wanted - 1)) / rolloffFactor;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
