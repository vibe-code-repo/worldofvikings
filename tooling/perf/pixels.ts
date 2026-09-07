/**
 * Comparing two frames pixel by pixel.
 *
 * A performance change has to leave the picture alone, and "it looks the same"
 * is not a claim anybody can check a week later. So every measurement writes
 * the canvas out as raw bytes beside its numbers, and this is the arithmetic
 * that says how far two of them are apart.
 *
 * The bytes come off the WebGL canvas, not off a page screenshot: the HUD is
 * DOM on top of the canvas, so reading the canvas is what excludes it — no
 * rectangle has to be guessed at and kept in step with the layout.
 */

/** How far apart two frames are. */
export interface FrameDifference {
  /** Mean absolute difference per colour channel, in 0–255. */
  readonly meanAbsolute: number;
  /** The largest single-channel difference found, in 0–255. */
  readonly maxAbsolute: number;
  /** Share of pixels differing by more than one step in any channel, 0–1. */
  readonly changedShare: number;
  readonly pixels: number;
}

/**
 * Compares two RGBA buffers of the same size.
 *
 * Alpha is skipped: the canvas is opaque and its alpha channel says nothing
 * about what was drawn, while including it would dilute every average by a
 * quarter.
 *
 * @throws {Error} when the two buffers are different lengths — two frames of
 * different sizes have no meaningful difference, and averaging over the shorter
 * one would report a small number for a completely different picture.
 */
export function compareFrames(before: Uint8Array, after: Uint8Array): FrameDifference {
  if (before.length !== after.length) {
    throw new Error(
      `frames differ in size: ${String(before.length)} vs ${String(after.length)} bytes`,
    );
  }
  if (before.length % 4 !== 0) {
    throw new Error(`not an RGBA buffer: ${String(before.length)} bytes is not a multiple of 4`);
  }

  let total = 0;
  let max = 0;
  let changed = 0;
  const pixels = before.length / 4;
  for (let index = 0; index < before.length; index += 4) {
    let worst = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const left = before[index + channel] ?? 0;
      const right = after[index + channel] ?? 0;
      const delta = Math.abs(left - right);
      total += delta;
      if (delta > worst) {
        worst = delta;
      }
    }
    if (worst > max) {
      max = worst;
    }
    if (worst > 1) {
      changed += 1;
    }
  }

  return {
    meanAbsolute: pixels === 0 ? 0 : total / (pixels * 3),
    maxAbsolute: max,
    changedShare: pixels === 0 ? 0 : changed / pixels,
    pixels,
  };
}
