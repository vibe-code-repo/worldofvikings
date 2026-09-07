import { describe, expect, it } from 'vitest';
import { aggregateLongTasks, summariseDurations } from './long-tasks.js';

describe('aggregateLongTasks', () => {
  it('adds up tasks and reports the worst one', () => {
    const summary = aggregateLongTasks([
      { start: 100, duration: 60 },
      { start: 300, duration: 900 },
      { start: 2_000, duration: 120 },
    ]);
    expect(summary).toEqual({ count: 3, totalMs: 1_080, longestMs: 900 });
  });

  it('has nothing to say about an empty list', () => {
    expect(aggregateLongTasks([])).toEqual({ count: 0, totalMs: 0, longestMs: 0 });
  });

  it('clips a task that started before the window to the part inside it', () => {
    // The load window opens at 1000; the task began at 800 and ran 500 ms, so
    // 300 of those belong to the load and 200 belong to whatever came before.
    const summary = aggregateLongTasks([{ start: 800, duration: 500 }], { from: 1_000, to: 5_000 });
    expect(summary).toEqual({ count: 1, totalMs: 300, longestMs: 300 });
  });

  it('clips a task that outlives the window', () => {
    const summary = aggregateLongTasks([{ start: 4_900, duration: 3_000 }], {
      from: 1_000,
      to: 5_000,
    });
    expect(summary).toEqual({ count: 1, totalMs: 100, longestMs: 100 });
  });

  it('never reports more blocked time than the window is long', () => {
    const window = { from: 0, to: 1_000 };
    const summary = aggregateLongTasks(
      [
        { start: -500, duration: 600 },
        { start: 100, duration: 200 },
        { start: 900, duration: 5_000 },
      ],
      window,
    );
    expect(summary.totalMs).toBeLessThanOrEqual(window.to - window.from);
    expect(summary).toEqual({ count: 3, totalMs: 400, longestMs: 200 });
  });

  it('drops tasks that only touch the window edge or miss it', () => {
    expect(
      aggregateLongTasks(
        [
          { start: 0, duration: 100 },
          { start: 900, duration: 100 },
        ],
        { from: 100, to: 900 },
      ),
    ).toEqual({ count: 0, totalMs: 0, longestMs: 0 });
  });

  it('ignores a negative duration rather than subtracting it', () => {
    expect(aggregateLongTasks([{ start: 10, duration: -5 }])).toEqual({
      count: 0,
      totalMs: 0,
      longestMs: 0,
    });
  });
});

describe('summariseDurations', () => {
  it('reports the middle value beside the mean, so one stall cannot hide', () => {
    // Nine cheap changes and one that rebuilt the ground: the mean describes
    // neither, which is exactly why both numbers are in the report.
    const values = [40, 41, 39, 42, 40, 38, 41, 40, 39, 4_000];
    const summary = summariseDurations(values);
    expect(summary.count).toBe(10);
    expect(summary.medianMs).toBe(40);
    expect(summary.maxMs).toBe(4_000);
    expect(summary.minMs).toBe(38);
    expect(summary.meanMs).toBeCloseTo(436, 5);
  });

  it('takes the mean of the two middle values for an even count', () => {
    expect(summariseDurations([1, 2, 3, 4]).medianMs).toBe(2.5);
  });

  it('handles a single measurement', () => {
    expect(summariseDurations([7])).toEqual({
      count: 1,
      meanMs: 7,
      medianMs: 7,
      minMs: 7,
      maxMs: 7,
    });
  });

  it('answers zeroes for nothing measured', () => {
    expect(summariseDurations([])).toEqual({
      count: 0,
      meanMs: 0,
      medianMs: 0,
      minMs: 0,
      maxMs: 0,
    });
  });

  it('does not reorder the array it was given', () => {
    const values = [3, 1, 2];
    summariseDurations(values);
    expect(values).toEqual([3, 1, 2]);
  });
});
