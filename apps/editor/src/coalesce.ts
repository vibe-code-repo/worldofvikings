/**
 * One run per frame, however many times it was asked for.
 *
 * The viewport reports what the scene looks like — how many entities carry
 * their model, which texture files arrived, where the selection outline
 * belongs, which asset origins the status bar names. Every one of those answers
 * is a walk over the whole zone, and every loaded model and every decoded
 * texture asks for a fresh one. Opening `village1` asks about ten thousand
 * times, and the answers in between are read by nobody: the page cannot draw
 * them, because it is inside the same task that is producing them.
 *
 * So the asking is separated from the answering. A caller says "this changed"
 * as often as it likes; the answer is computed once, just before the frame that
 * would show it. Nothing is skipped — the run that happens is the run with the
 * newest state in it — and the last one always happens, because a frame always
 * follows the last change.
 *
 * The fallback timer exists because `requestAnimationFrame` is not a promise
 * that a callback will run: a hidden tab does not paint, and a bridge that
 * stops being written while the tab is in the background would hang anything
 * polling it (`pnpm smoke` does exactly that). Whichever of the two comes
 * first wins and cancels the other.
 */

/** How long a pending run waits when no frame comes to carry it. */
const FALLBACK_MS = 250;

/** Schedules one callback and hands back the function that cancels it. */
export type ScheduleOnce = (callback: () => void) => () => void;

export interface Coalescer {
  /** Ask for a run. Repeated asks before it happens collapse into one. */
  schedule(): void;
  /** Run a pending ask right now, so a caller can insist on being current. */
  flush(): void;
  /** Drop a pending ask and refuse further ones. */
  dispose(): void;
}

/** The default scheduler: the next frame, or a short timer if none comes. */
export const nextFrame: ScheduleOnce = (callback) => {
  let spent = false;
  let frame = 0;
  let timer = 0;
  const clear = (): void => {
    spent = true;
    window.cancelAnimationFrame(frame);
    window.clearTimeout(timer);
  };
  const fire = (): void => {
    if (!spent) {
      clear();
      callback();
    }
  };
  frame = window.requestAnimationFrame(fire);
  timer = window.setTimeout(fire, FALLBACK_MS);
  return clear;
};

/**
 * Folds any number of `schedule()` calls into one `run()` per frame.
 *
 * @param run the work to do; it reads the current state itself, so a run that
 * stands in for fifty asks is not a run of out-of-date data.
 * @param schedule when the run happens; injected so it can be driven by a test.
 */
export function createCoalescer(run: () => void, schedule: ScheduleOnce = nextFrame): Coalescer {
  let cancel: (() => void) | null = null;
  let disposed = false;

  const fire = (): void => {
    cancel = null;
    if (!disposed) {
      run();
    }
  };

  return {
    schedule() {
      if (disposed || cancel !== null) {
        return;
      }
      cancel = schedule(fire);
    },
    flush() {
      if (cancel === null) {
        return;
      }
      cancel();
      cancel = null;
      if (!disposed) {
        run();
      }
    },
    dispose() {
      disposed = true;
      cancel?.();
      cancel = null;
    },
  };
}
