/**
 * Whether there is sound, and if not, whose fault that is — as a pure state
 * machine, with no browser in it.
 *
 * Every browser refuses to start an `AudioContext` until the page has been
 * interacted with. That refusal is not an error and not a bug, and a client
 * that treats it as either gets one of two wrong screens: an error the user
 * cannot act on, or silence with no explanation. What the user needs is one
 * line saying "click anywhere", and what a developer needs is to be able to
 * tell that line apart from three others that look identical from outside:
 *
 * - the page has not been clicked yet — **blocked**, and a click fixes it;
 * - it was clicked and something else stopped the audio — **interrupted**,
 *   and a click does not fix it;
 * - this browser has no Web Audio at all — **unavailable**, nothing fixes it;
 * - the engine is still being built — **starting**, and waiting fixes it.
 *
 * The distinguishing fact is not the audio context's state, which reads
 * `suspended` for the first two alike. It is **whether a user gesture has
 * happened yet**, and that is why this is a machine with memory rather than a
 * mapping from one enum to another.
 */

/** What an app shows. See the module note for why there are six and not two. */
export type AudioStatus =
  /** The engine is being created; nothing is known yet. */
  | 'starting'
  /** Suspended, and the page has never been interacted with. A click fixes it. */
  | 'blocked'
  /** Running. Sound comes out. */
  | 'unlocked'
  /** Stopped after a gesture — another app took the device, or the tab slept. */
  | 'interrupted'
  /** No Web Audio, or the engine could not be created. Terminal. */
  | 'unavailable'
  /** Disposed. Terminal. */
  | 'closed';

/**
 * The status plus the one thing the status cannot carry: whether the page has
 * ever been interacted with.
 */
export interface AudioUnlockState {
  readonly status: AudioStatus;
  /**
   * Whether a user gesture has reached this page. Once true it stays true —
   * the autoplay policy is satisfied for the life of the document, so it can
   * never be the explanation for silence again.
   */
  readonly gestured: boolean;
}

/** What the audio engine or the app reports. */
export type AudioUnlockEvent =
  /** The audio engine's own state, read from its public `state` property. */
  | { readonly type: 'engine'; readonly state: 'running' | 'suspended' | 'interrupted' | 'closed' }
  /** A user gesture reached the page. Not a promise that audio now works. */
  | { readonly type: 'gesture' }
  /** Web Audio is missing, or creating the engine threw. */
  | { readonly type: 'unavailable' }
  /** The handle was disposed. */
  | { readonly type: 'disposed' };

/** Where every session starts: nothing built, nothing clicked. */
export const initialAudioUnlockState: AudioUnlockState = { status: 'starting', gestured: false };

/**
 * The whole transition table.
 *
 * Two rules carry all of it:
 *
 * 1. **`unavailable` and `closed` are terminal.** An engine that could not be
 *    created does not become available because a later poll says `suspended`,
 *    and a disposed handle does not come back.
 * 2. **A gesture never announces success.** It only records that the autoplay
 *    policy has been satisfied, which changes what a *later* `suspended` means:
 *    before a gesture it is the policy, after one it is an interruption. The
 *    status itself moves to `unlocked` when — and only when — the engine says
 *    it is running. Calling `resumeAsync()` inside a gesture handler can still
 *    fail, and a client that reported "sound: on" on the click would be lying
 *    about a thing the user can hear.
 */
export function nextAudioUnlockState(
  state: AudioUnlockState,
  event: AudioUnlockEvent,
): AudioUnlockState {
  if (state.status === 'unavailable' || state.status === 'closed') {
    return state;
  }
  switch (event.type) {
    case 'gesture':
      return state.gestured ? state : { ...state, gestured: true };
    case 'unavailable':
      return { status: 'unavailable', gestured: state.gestured };
    case 'disposed':
      return { status: 'closed', gestured: state.gestured };
    case 'engine':
      return { status: statusFromEngine(event.state, state.gestured), gestured: state.gestured };
  }
}

function statusFromEngine(
  engineState: 'running' | 'suspended' | 'interrupted' | 'closed',
  gestured: boolean,
): AudioStatus {
  switch (engineState) {
    case 'running':
      return 'unlocked';
    case 'interrupted':
      return 'interrupted';
    case 'closed':
      return 'closed';
    case 'suspended':
      // The whole reason this machine has memory.
      return gestured ? 'interrupted' : 'blocked';
  }
}

/**
 * Whether a user gesture would plausibly help. What a "click to enable" prompt
 * should be shown on, and nothing else.
 */
export function needsUserGesture(state: AudioUnlockState): boolean {
  return state.status === 'blocked' || (state.status === 'interrupted' && !state.gestured);
}

/**
 * The one spelling of the audio status line.
 *
 * It lives here rather than in an app because two clients show it and a smoke
 * test asserts it — one wording, not three that drift (the same reason
 * `summarizeAssetSources` lives in `@wov/asset-system`).
 */
export function summarizeAudioStatus(state: AudioUnlockState): string {
  switch (state.status) {
    case 'starting':
      return 'sound: starting';
    case 'blocked':
      return 'sound: click to enable';
    case 'unlocked':
      return 'sound: on';
    case 'interrupted':
      return 'sound: interrupted';
    case 'unavailable':
      return 'sound: unavailable';
    case 'closed':
      return 'sound: off';
  }
}
