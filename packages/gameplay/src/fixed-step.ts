/**
 * Fixed simulation steps on top of a variable frame rate.
 *
 * Browsers hand out whatever frame time the machine managed. Feeding that
 * straight into the movement system would make the game behave differently on
 * a 144 Hz monitor than on a 30 fps laptop and would make a replay
 * unreproducible. The accumulator collects real time and hands out whole steps
 * of a constant length instead.
 */

/** 60 simulation steps per second — the frame budget of spec §38. */
export const DEFAULT_FIXED_DELTA = 1 / 60;

/** Guard against the spiral of death after a long stall (tab in background). */
export const DEFAULT_MAX_STEPS_PER_FRAME = 5;

/** Immutable accumulator state. */
export interface FixedStepAccumulator {
  /** Length of one simulation step in seconds. */
  readonly fixedDelta: number;
  /** Real time collected but not yet simulated, in seconds. */
  readonly remainder: number;
  /** Upper bound of steps a single frame may run. */
  readonly maxStepsPerFrame: number;
}

/** What one frame of real time turned into. */
export interface FixedStepResult {
  /** The accumulator to carry into the next frame. */
  readonly accumulator: FixedStepAccumulator;
  /** How often the systems must run with `accumulator.fixedDelta`. */
  readonly steps: number;
  /**
   * Position between the last and the next step, in `[0, 1)`. The renderer
   * interpolates with it so a 144 Hz display still looks smooth at 60 steps.
   */
  readonly alpha: number;
  /** Seconds thrown away by the {@link FixedStepAccumulator.maxStepsPerFrame} cap. */
  readonly dropped: number;
}

/** Options of {@link createStepAccumulator}. */
export interface StepAccumulatorOptions {
  readonly fixedDelta?: number;
  readonly maxStepsPerFrame?: number;
}

/** Creates an empty accumulator. */
export function createStepAccumulator(options: StepAccumulatorOptions = {}): FixedStepAccumulator {
  const fixedDelta = options.fixedDelta ?? DEFAULT_FIXED_DELTA;
  const maxStepsPerFrame = options.maxStepsPerFrame ?? DEFAULT_MAX_STEPS_PER_FRAME;

  if (!Number.isFinite(fixedDelta) || fixedDelta <= 0) {
    throw new RangeError(`createStepAccumulator: fixedDelta must be > 0, got ${fixedDelta}`);
  }
  if (!Number.isInteger(maxStepsPerFrame) || maxStepsPerFrame < 1) {
    throw new RangeError(
      `createStepAccumulator: maxStepsPerFrame must be a positive integer, got ${maxStepsPerFrame}`,
    );
  }

  return { fixedDelta, remainder: 0, maxStepsPerFrame };
}

/**
 * Adds one frame of real time and reports how many fixed steps it buys.
 *
 * The step count is a division, not a subtraction loop: dividing once keeps
 * the rounding error out of the remainder, so 30 frames of 1/30 s produce
 * exactly the same 60 steps as 60 frames of 1/60 s.
 */
export function advance(accumulator: FixedStepAccumulator, frameDelta: number): FixedStepResult {
  if (!Number.isFinite(frameDelta) || frameDelta < 0) {
    throw new RangeError(`advance: frameDelta must be finite and >= 0, got ${frameDelta}`);
  }

  const { fixedDelta, maxStepsPerFrame } = accumulator;
  const pending = accumulator.remainder + frameDelta;
  const wanted = Math.floor(pending / fixedDelta);
  const steps = Math.min(wanted, maxStepsPerFrame);
  const consumed = steps * fixedDelta;

  // Over the cap the surplus is discarded on purpose: catching up would make
  // the next frames even longer, which is exactly the spiral we avoid here.
  const remainder = wanted > maxStepsPerFrame ? 0 : pending - consumed;
  const dropped = wanted > maxStepsPerFrame ? pending - consumed : 0;

  return {
    accumulator: { fixedDelta, remainder, maxStepsPerFrame },
    steps,
    alpha: remainder / fixedDelta,
    dropped,
  };
}
