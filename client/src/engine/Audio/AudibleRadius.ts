/**
 * Pure inversion of the WebAudio/Babylon 'inverse' distance model
 * (AudioV2 default, see abstractSpatialAudio.ts::spatialDistanceModel):
 *
 *   gain(d) = minDistance / (minDistance + rolloffFactor * (max(d, minDistance) - minDistance))
 *
 * Solving gain(d) = threshold for d gives the radius at which a spatial
 * sound has faded to `threshold` of its base volume:
 *
 *   d = minDistance * (1 + (1 - threshold) / (threshold * rolloffFactor))
 */

/** gain(d) for the 'inverse' distance model, see module doc. */
export function inverseDistanceGain(distance: number, minDistance: number, rolloffFactor: number): number {
  const d = Math.max(distance, minDistance);
  return minDistance / (minDistance + rolloffFactor * (d - minDistance));
}

/**
 * Distance at which the 'inverse' model's gain drops to `threshold`
 * (default 2 %) — analytic, not measured.
 */
export function audibleRadius(minDistance: number, rolloffFactor: number, threshold = 0.02): number {
  if (minDistance <= 0) throw new Error('minDistance must be > 0');
  if (rolloffFactor <= 0) throw new Error('rolloffFactor must be > 0');
  if (threshold <= 0 || threshold >= 1) throw new Error('threshold must be between 0 and 1');
  return minDistance * (1 + (1 - threshold) / (threshold * rolloffFactor));
}
