/**
 * Six-state automaton for the browser autoplay rule: an AudioContext may
 * start suspended and only resumes after a user gesture. Pure state
 * logic — no AudioContext here. AudioEngine drives it with the four
 * events below and must not queue or play anything before 'unlocked'.
 *
 *   starting --beginBuildup--> loading --contextReady(running)--------> unlocked
 *                                 |          \--contextReady(other)--> blocked --gesture--> unlocking --resumeSucceeded--> unlocked
 *                                 |                                                              \--resumeFailed--> failed
 *                                 \--buildupFailed--> failed
 */
export type AutoplayState = 'starting' | 'loading' | 'blocked' | 'unlocking' | 'unlocked' | 'failed';

/** Subset of AudioContextState this automaton cares about. */
export type AudioContextLikeState = 'running' | 'suspended' | 'closed' | 'interrupted';

export class AutoplayAutomaton {
  private state: AutoplayState = 'starting';
  private readonly onChange?: (state: AutoplayState) => void;

  constructor(onChange?: (state: AutoplayState) => void) {
    this.onChange = onChange;
  }

  get current(): AutoplayState {
    return this.state;
  }

  /** Engine creation (CreateAudioEngineAsync) has started. */
  beginBuildup(): void {
    this.transition('starting', 'loading');
  }

  /** Engine creation failed. */
  buildupFailed(): void {
    if (this.state === 'loading') this.set('failed');
  }

  /** Engine created; its context's initial state decides blocked vs. unlocked. */
  contextReady(contextState: AudioContextLikeState): void {
    if (this.state !== 'loading') return;
    this.set(contextState === 'running' ? 'unlocked' : 'blocked');
  }

  /** First user gesture (click/key) while blocked. */
  gesture(): void {
    this.transition('blocked', 'unlocking');
  }

  /** context.resume() (or engine.resumeAsync()) resolved. */
  resumeSucceeded(): void {
    this.transition('unlocking', 'unlocked');
  }

  /** context.resume() (or engine.resumeAsync()) rejected. */
  resumeFailed(): void {
    if (this.state === 'unlocking') this.set('failed');
  }

  private transition(from: AutoplayState, to: AutoplayState): void {
    if (this.state === from) this.set(to);
  }

  private set(state: AutoplayState): void {
    this.state = state;
    this.onChange?.(state);
  }
}
