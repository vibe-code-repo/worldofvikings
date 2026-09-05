import {
  advance,
  createStepAccumulator,
  type FixedStepAccumulator,
  type StepAccumulatorOptions,
} from '@wov/gameplay';

/**
 * The frame loop of the game client (ADR-0010).
 *
 * Gameplay runs on a fixed step, the renderer runs once per frame. The
 * accumulator that splits real time into whole steps lives in `@wov/gameplay`
 * (ADR-0009); what lives here is the browser side of it — when a frame
 * happens, and what to do with the one that is left over.
 *
 * The loop reads no clock. It is handed the frame timestamp, the way
 * `requestAnimationFrame` hands it over, which is what makes it reproducible
 * in a test.
 */

/** The `requestAnimationFrame` pair, as a port. */
export interface FrameScheduler {
  request(callback: (timestampMs: number) => void): number;
  cancel(handle: number): void;
}

/** What {@link createGameLoop} needs. */
export interface GameLoopOptions extends StepAccumulatorOptions {
  readonly scheduler: FrameScheduler;
  /** One simulation step. Always called with the same `fixedDelta`, in seconds. */
  step(fixedDelta: number): void;
  /**
   * One rendered frame. `alpha` in `[0, 1)` says how far the frame sits past
   * the last simulated step, so the presentation can interpolate instead of
   * snapping at 60 Hz on a 144 Hz display.
   */
  render(alpha: number): void;
}

/** A running frame loop. */
export interface GameLoop {
  readonly running: boolean;
  /** Starts scheduling frames. Starting a running loop does nothing. */
  start(): void;
  /** Cancels the queued frame. Stopping a stopped loop does nothing. */
  stop(): void;
}

/** Builds a loop. It is created stopped. */
export function createGameLoop(options: GameLoopOptions): GameLoop {
  const { scheduler, step, render } = options;

  let accumulator: FixedStepAccumulator = createStepAccumulator(options);
  let handle: number | undefined;
  let previousTimestamp: number | undefined;

  function frame(timestamp: number): void {
    handle = undefined;

    // The first frame after a start has no predecessor, so it buys no time.
    // That is what keeps a restart from simulating the whole pause at once.
    const frameDelta =
      previousTimestamp === undefined ? 0 : Math.max(0, (timestamp - previousTimestamp) / 1000);
    previousTimestamp = timestamp;

    const result = advance(accumulator, frameDelta);
    accumulator = result.accumulator;

    for (let index = 0; index < result.steps; index += 1) {
      step(accumulator.fixedDelta);
    }
    render(result.alpha);

    // Queued last: a throwing callback stops the loop and surfaces the error
    // instead of repeating it every frame forever.
    handle = scheduler.request(frame);
  }

  return {
    get running(): boolean {
      return handle !== undefined;
    },

    start(): void {
      if (handle !== undefined) {
        return;
      }
      previousTimestamp = undefined;
      handle = scheduler.request(frame);
    },

    stop(): void {
      if (handle === undefined) {
        return;
      }
      scheduler.cancel(handle);
      handle = undefined;
    },
  };
}
