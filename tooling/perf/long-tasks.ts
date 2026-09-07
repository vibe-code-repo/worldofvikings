/**
 * What the main thread was busy with, aggregated.
 *
 * The editor's complaint is not "the frame is expensive" — it is "the page
 * stopped answering". Those are different measurements: a frame that costs
 * 40 ms is slow, a *task* that costs 8 s is a browser that has stopped painting,
 * stopped taking clicks and stopped answering `page.evaluate`, which is exactly
 * what was reported when opening the village timed a probe out. `PerformanceObserver`
 * with `entryTypes: ['longtask']` reports every task over 50 ms, and this is the
 * arithmetic that turns a list of them into the two numbers a change is argued
 * with: how much of the wall clock the thread was blocked, and how bad the worst
 * single stall was.
 *
 * Kept apart from the script that drives the browser, and free of both DOM and
 * Playwright, for the reason `profile-summary.ts` gives: clipping to a window is
 * a decision, and a decision that can be wrong quietly is a decision a unit test
 * should hold still.
 */

/** One `longtask` entry, reduced to the two fields this needs. */
export interface LongTaskEntry {
  /** `performance.now()` at the start of the task, in milliseconds. */
  readonly start: number;
  /** How long it ran, in milliseconds. */
  readonly duration: number;
}

/** A half-open interval of page time, in `performance.now()` milliseconds. */
export interface TimeWindow {
  readonly from: number;
  readonly to: number;
}

/** What a set of long tasks adds up to. */
export interface LongTaskSummary {
  /** Tasks that overlap the window at all. */
  readonly count: number;
  /** Milliseconds of the window the thread was inside a long task. */
  readonly totalMs: number;
  /** The longest single overlap, in milliseconds. */
  readonly longestMs: number;
}

/**
 * Adds up the long tasks overlapping `window`, clipped to it.
 *
 * **Clipped, not counted whole.** A load scenario's window ends when the last
 * model lands, and a task that started 200 ms before that and ran for 3 s is not
 * 3 s of load time — attributing all of it to the load would let a change look
 * worse for finishing earlier. Only the part inside the window counts, which is
 * also what makes the number comparable with the window's own wall clock: it can
 * never exceed it.
 *
 * Tasks on one main thread do not overlap each other, so the clipped durations
 * are simply summed; the browser is the guarantor of that, not this function.
 *
 * @param window Omitted means "everything", so a caller that already knows its
 * entries are in range does not have to invent bounds.
 */
export function aggregateLongTasks(
  entries: readonly LongTaskEntry[],
  window?: TimeWindow,
): LongTaskSummary {
  const from = window?.from ?? Number.NEGATIVE_INFINITY;
  const to = window?.to ?? Number.POSITIVE_INFINITY;
  let count = 0;
  let totalMs = 0;
  let longestMs = 0;
  for (const entry of entries) {
    const overlap =
      Math.min(entry.start + Math.max(entry.duration, 0), to) - Math.max(entry.start, from);
    if (overlap <= 0) {
      continue;
    }
    count += 1;
    totalMs += overlap;
    longestMs = Math.max(longestMs, overlap);
  }
  return { count, totalMs, longestMs };
}

/** The shape of a list of measurements, for a report that has to stay small. */
export interface DurationSummary {
  readonly count: number;
  readonly meanMs: number;
  /** The middle value; the mean of the two middle ones for an even count. */
  readonly medianMs: number;
  readonly minMs: number;
  readonly maxMs: number;
}

/**
 * Mean, median and extremes of a handful of latencies.
 *
 * The median is here because the mean alone hides the shape these scenarios
 * produce: ten dial changes where nine cost 40 ms and one costs 4 s have a mean
 * of 436 ms, which describes none of them. The worst one is the number an author
 * feels, so it is reported beside the middle one rather than averaged into it.
 *
 * @returns all zeroes for an empty list — there is nothing to average, and a
 * `null` here would spread through every consumer for no gain.
 */
export function summariseDurations(values: readonly number[]): DurationSummary {
  if (values.length === 0) {
    return { count: 0, meanMs: 0, medianMs: 0, minMs: 0, maxMs: 0 };
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  const median =
    sorted.length % 2 === 1
      ? (sorted[middle] ?? 0)
      : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  let total = 0;
  for (const value of sorted) {
    total += value;
  }
  return {
    count: sorted.length,
    meanMs: total / sorted.length,
    medianMs: median,
    minMs: sorted[0] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
  };
}
