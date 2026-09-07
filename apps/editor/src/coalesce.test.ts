import { describe, expect, it, vi } from 'vitest';
import { createCoalescer, type ScheduleOnce } from './coalesce.js';

/** A scheduler the test drives by hand: nothing runs until `tick()` is called. */
function manualScheduler(): { schedule: ScheduleOnce; tick: () => void; pending: () => number } {
  let queued: (() => void) | null = null;
  let cancelled = 0;
  return {
    schedule: (callback) => {
      queued = callback;
      return () => {
        queued = null;
        cancelled += 1;
      };
    },
    tick: () => {
      const run = queued;
      queued = null;
      run?.();
    },
    pending: () => cancelled,
  };
}

describe('createCoalescer', () => {
  it('runs once for however many asks arrived before the frame', () => {
    const run = vi.fn();
    const scheduler = manualScheduler();
    const coalescer = createCoalescer(run, scheduler.schedule);

    for (let index = 0; index < 5_000; index += 1) {
      coalescer.schedule();
    }
    expect(run).not.toHaveBeenCalled();

    scheduler.tick();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs again for asks that arrive after the frame', () => {
    const run = vi.fn();
    const scheduler = manualScheduler();
    const coalescer = createCoalescer(run, scheduler.schedule);

    coalescer.schedule();
    scheduler.tick();
    coalescer.schedule();
    scheduler.tick();

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does nothing at all when nobody asked', () => {
    const run = vi.fn();
    const scheduler = manualScheduler();
    createCoalescer(run, scheduler.schedule);

    scheduler.tick();
    expect(run).not.toHaveBeenCalled();
  });

  it('flush runs a pending ask immediately and cancels the frame', () => {
    const run = vi.fn();
    const scheduler = manualScheduler();
    const coalescer = createCoalescer(run, scheduler.schedule);

    coalescer.schedule();
    coalescer.flush();
    expect(run).toHaveBeenCalledTimes(1);
    expect(scheduler.pending()).toBe(1);

    // The cancelled frame must not produce a second run of the same ask.
    scheduler.tick();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('flush without a pending ask is not a run', () => {
    const run = vi.fn();
    const scheduler = manualScheduler();
    const coalescer = createCoalescer(run, scheduler.schedule);

    coalescer.flush();
    expect(run).not.toHaveBeenCalled();
  });

  it('never runs after dispose, even for an ask already scheduled', () => {
    const run = vi.fn();
    const scheduler = manualScheduler();
    const coalescer = createCoalescer(run, scheduler.schedule);

    coalescer.schedule();
    coalescer.dispose();
    scheduler.tick();
    coalescer.schedule();
    coalescer.flush();

    expect(run).not.toHaveBeenCalled();
  });
});
