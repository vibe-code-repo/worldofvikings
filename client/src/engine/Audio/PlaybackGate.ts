import type { AutoplayState } from './AutoplayAutomaton';

/**
 * Whether a clip may start: the browser autoplay gate has released
 * ('unlocked') and `?mute=1` (karte B2) is not set. Pulled out of
 * AudioEngine.playAsync so the mute/unlock gating is testable without a
 * real AudioContext.
 */
export function isPlaybackAllowed(state: AutoplayState, muted: boolean): boolean {
  return state === 'unlocked' && !muted;
}
