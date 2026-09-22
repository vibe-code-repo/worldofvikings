/**
 * Playback rate of a walk or run clip, coupled to the ground speed.
 *
 * A clip carries a stride cycle built for ONE ground speed (its
 * `PrefabDef.animationTempo`, m/s at rate 1). The server moves an animal at
 * its own numbers (`SpawnEntry.walkSpeed` / `runSpeed`), and where the two
 * differ the feet slide: at twice the clip speed each foot drags across the
 * ground for as long as it is planted. Playing the clip at
 * `actual speed / clip speed` keeps the planted foot still relative to the
 * ground, whatever the server number is.
 *
 * `ist` is the smoothed ground speed of the rendered root in m/s, measured
 * from its own movement (the same way the procedural gait does), so it
 * follows the interpolation the player sees and not the 4 Hz position steps.
 *
 * No entry for the state (idle, or a prefab without `animationTempo`) = the
 * clip plays as authored. The upper bound is a legibility cap, not physics:
 * beyond four times the authored cycle the legs are a blur, and the residual
 * slide is then reported by the probe instead of hidden.
 */
export const CLIP_RATE_MAX = 4;

export function clipRate(ist: number, clipTempo: number | undefined): number {
  if (clipTempo === undefined || !(clipTempo > 0)) return 1;
  return Math.min(CLIP_RATE_MAX, Math.max(0, ist / clipTempo));
}
