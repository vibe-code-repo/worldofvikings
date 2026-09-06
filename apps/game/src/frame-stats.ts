/**
 * The frame-rate readout in the corner of the game.
 *
 * Counts rendered frames and, once a sampling window has passed, turns them
 * into frames per second and milliseconds per frame. It reads no clock of its
 * own: the loop hands it the timestamp, so a test can drive a second of frames
 * by hand and always get the same numbers.
 *
 * Shown in every build, not only the dev build — the question "how fast does
 * it run on your machine" comes up on staging, where there is no debug bridge.
 */

/** One finished sampling window. */
export interface FrameSample {
  /** Rendered frames per second over the window. */
  readonly fps: number;
  /** Average wall-clock milliseconds between two frames in the window. */
  readonly frameMs: number;
}

export interface FrameStatsOptions {
  /** How long a sample runs before a new number is published, in ms. */
  readonly windowMs?: number;
}

export interface FrameStats {
  /**
   * Records one rendered frame at `timestampMs`. Returns a sample when the
   * window is full, `undefined` otherwise.
   */
  frame(timestampMs: number): FrameSample | undefined;
}

export const DEFAULT_WINDOW_MS = 500;

export function createFrameStats(options: FrameStatsOptions = {}): FrameStats {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  let windowStart: number | undefined;
  let frames = 0;

  return {
    frame(timestampMs) {
      // The first frame opens the window; it buys no time and counts no frame,
      // exactly like the first frame of the game loop.
      if (windowStart === undefined) {
        windowStart = timestampMs;
        return undefined;
      }
      frames += 1;
      const elapsed = timestampMs - windowStart;
      if (elapsed < windowMs) {
        return undefined;
      }
      const sample = { fps: (frames * 1000) / elapsed, frameMs: elapsed / frames };
      windowStart = timestampMs;
      frames = 0;
      return sample;
    },
  };
}

/** `60 fps · 16.7 ms` — what the readout shows. */
export function formatFrameSample(sample: FrameSample): string {
  return `${Math.round(sample.fps)} fps · ${sample.frameMs.toFixed(1)} ms`;
}
