import { DEFAULT_FIXED_DELTA } from '@wov/gameplay';
import { describe, expect, it } from 'vitest';
import { createGameLoop, type FrameScheduler } from './loop.js';

/**
 * A scheduler the test drives by hand.
 *
 * The loop never reads a clock of its own — it is handed the frame timestamp,
 * exactly as `requestAnimationFrame` does — so a whole second of frames runs
 * here in microseconds and always produces the same numbers.
 */
function createFakeScheduler() {
  // A list, not a single slot: a loop that schedules itself twice must show up
  // as two callbacks here rather than quietly overwriting the first.
  let pending: { handle: number; callback: (timestampMs: number) => void }[] = [];
  let nextHandle = 1;
  let cancelled = 0;

  const scheduler: FrameScheduler = {
    request(callback) {
      const handle = nextHandle++;
      pending.push({ handle, callback });
      return handle;
    },
    cancel(handle) {
      cancelled += 1;
      pending = pending.filter((entry) => entry.handle !== handle);
    },
  };

  return {
    scheduler,
    get cancelled(): number {
      return cancelled;
    },
    get idle(): boolean {
      return pending.length === 0;
    },
    /** Delivers one frame at `timestampMs` to everything currently scheduled. */
    frame(timestampMs: number): void {
      if (pending.length === 0) {
        throw new Error('no frame scheduled');
      }
      const due = pending;
      pending = [];
      for (const entry of due) {
        entry.callback(timestampMs);
      }
    },
  };
}

function createRecorder() {
  const steps: number[] = [];
  const renders: number[] = [];
  return {
    steps,
    renders,
    step: (delta: number): void => {
      steps.push(delta);
    },
    render: (alpha: number): void => {
      renders.push(alpha);
    },
  };
}

/** Runs `seconds` of wall time at `fps` and reports what the loop did. */
function run(fps: number, seconds: number): { steps: number[]; renders: number[] } {
  const fake = createFakeScheduler();
  const record = createRecorder();
  const loop = createGameLoop({ scheduler: fake.scheduler, ...record });

  loop.start();
  for (let frame = 0; frame <= fps * seconds; frame += 1) {
    fake.frame((frame * 1000) / fps);
  }
  return { steps: record.steps, renders: record.renders };
}

describe('the frame rate does not change the simulation', () => {
  it('simulates the elapsed wall time, whatever the display does', () => {
    // The invariant, stated as time rather than as a step count: ten seconds of
    // frames simulate ten seconds, to within the one step that the boundary
    // rounding of a float timestamp can cost. Stepping with the frame time
    // instead would keep this true while breaking the next assertion.
    const expected = Math.round(10 / DEFAULT_FIXED_DELTA);

    for (const fps of [30, 60, 90, 120, 144]) {
      expect(Math.abs(run(fps, 10).steps.length - expected)).toBeLessThanOrEqual(1);
    }
  });

  it('runs the same number of steps at 30 fps as at 144 fps', () => {
    const slow = run(30, 10).steps.length;
    const fast = run(144, 10).steps.length;

    expect(Math.abs(slow - fast)).toBeLessThanOrEqual(1);
    expect(run(30, 10).renders).toHaveLength(301);
    expect(run(144, 10).renders).toHaveLength(1441);
  });

  it('always steps with the fixed delta, never with the frame time', () => {
    const fake = createFakeScheduler();
    const record = createRecorder();
    const loop = createGameLoop({ scheduler: fake.scheduler, ...record });

    loop.start();
    fake.frame(0);
    fake.frame(7);
    fake.frame(51);
    fake.frame(52);

    expect(record.steps.length).toBeGreaterThan(0);
    for (const delta of record.steps) {
      expect(delta).toBe(DEFAULT_FIXED_DELTA);
    }
  });

  it('simulates a frame before it draws it', () => {
    // Drawing first would show the state as it was one step ago while handing
    // the renderer the interpolation factor of the step it has not run yet —
    // a permanent frame of lag that is very hard to see and very easy to keep.
    const fake = createFakeScheduler();
    const order: string[] = [];
    const loop = createGameLoop({
      scheduler: fake.scheduler,
      step: () => order.push('step'),
      render: () => order.push('render'),
    });

    loop.start();
    fake.frame(0);
    fake.frame(2000 / 60);

    expect(order).toEqual(['render', 'step', 'step', 'render']);
  });

  it('renders every frame, including the ones that buy no step', () => {
    const fake = createFakeScheduler();
    const record = createRecorder();
    const loop = createGameLoop({ scheduler: fake.scheduler, ...record });

    loop.start();
    fake.frame(0);
    fake.frame(1);
    fake.frame(2);

    expect(record.steps).toHaveLength(0);
    expect(record.renders).toHaveLength(3);
  });
});

describe('interpolation factor', () => {
  it('reports where the frame sits between two steps', () => {
    const fake = createFakeScheduler();
    const record = createRecorder();
    const loop = createGameLoop({ scheduler: fake.scheduler, ...record });

    loop.start();
    fake.frame(0);
    // Half a step of 16.667 ms.
    fake.frame(1000 / 120);

    expect(record.renders.at(-1)).toBeCloseTo(0.5, 6);
  });

  it('stays in [0, 1) so the renderer never extrapolates past the state', () => {
    const fake = createFakeScheduler();
    const record = createRecorder();
    const loop = createGameLoop({ scheduler: fake.scheduler, ...record });

    loop.start();
    let timestamp = 0;
    for (let frame = 0; frame < 40; frame += 1) {
      timestamp += 3 + (frame % 7) * 4.5;
      fake.frame(timestamp);
    }

    for (const alpha of record.renders) {
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }
  });
});

describe('the spiral of death', () => {
  it('caps the steps a single frame may run', () => {
    const fake = createFakeScheduler();
    const record = createRecorder();
    const loop = createGameLoop({
      scheduler: fake.scheduler,
      ...record,
      maxStepsPerFrame: 5,
    });

    loop.start();
    fake.frame(0);
    // A background tab, a breakpoint, a garbage collection: ten seconds.
    fake.frame(10_000);

    expect(record.steps).toHaveLength(5);
  });

  it('does not replay the lost time once the stall is over', () => {
    // The surplus of a capped frame is thrown away on purpose. If it were kept
    // instead, the second after a ten-second stall would try to simulate ten
    // seconds and stall again — the spiral this cap exists to prevent.
    const fake = createFakeScheduler();
    const record = createRecorder();
    const loop = createGameLoop({ scheduler: fake.scheduler, ...record, maxStepsPerFrame: 5 });

    loop.start();
    fake.frame(0);
    fake.frame(10_000);
    record.steps.length = 0;

    for (let frame = 1; frame <= 60; frame += 1) {
      fake.frame(10_000 + (frame * 1000) / 60);
    }

    expect(record.steps.length).toBeGreaterThanOrEqual(59);
    expect(record.steps.length).toBeLessThanOrEqual(60);
  });
});

describe('start and stop', () => {
  it('does nothing before it is started', () => {
    const fake = createFakeScheduler();
    createGameLoop({ scheduler: fake.scheduler, ...createRecorder() });

    expect(fake.idle).toBe(true);
  });

  it('reports whether it runs', () => {
    const fake = createFakeScheduler();
    const loop = createGameLoop({ scheduler: fake.scheduler, ...createRecorder() });

    expect(loop.running).toBe(false);
    loop.start();
    expect(loop.running).toBe(true);
    loop.stop();
    expect(loop.running).toBe(false);
  });

  it('starting twice does not run the simulation at double speed', () => {
    const fake = createFakeScheduler();
    const record = createRecorder();
    const loop = createGameLoop({ scheduler: fake.scheduler, ...record });

    loop.start();
    loop.start();
    fake.frame(0);
    fake.frame(1000 / 60);

    expect(record.steps).toHaveLength(1);
    expect(record.renders).toHaveLength(2);
  });

  it('cancels the frame it has queued when it stops', () => {
    const fake = createFakeScheduler();
    const loop = createGameLoop({ scheduler: fake.scheduler, ...createRecorder() });

    loop.start();
    loop.stop();

    expect(fake.cancelled).toBe(1);
    expect(fake.idle).toBe(true);
  });

  it('does not simulate the pause after it is restarted', () => {
    // Without a fresh baseline the first frame after a pause would look like a
    // multi-second frame and teleport the player.
    const fake = createFakeScheduler();
    const record = createRecorder();
    const loop = createGameLoop({ scheduler: fake.scheduler, ...record });

    loop.start();
    fake.frame(0);
    fake.frame(1000 / 60);
    record.steps.length = 0;

    loop.stop();
    loop.start();
    fake.frame(30_000);
    fake.frame(30_000 + 1000 / 60);

    expect(record.steps).toHaveLength(1);
  });

  it('survives a frame timestamp that goes backwards', () => {
    // A clock adjustment or a restored tab can hand out a timestamp older than
    // the previous one. The step accumulator rejects a negative delta with a
    // RangeError, and a throw inside the frame stops the loop for good — so
    // the loop has to absorb it rather than pass it on.
    const fake = createFakeScheduler();
    const record = createRecorder();
    const loop = createGameLoop({ scheduler: fake.scheduler, ...record });

    loop.start();
    fake.frame(1000);

    expect(() => {
      fake.frame(900);
    }).not.toThrow();
    expect(loop.running).toBe(true);

    // And it keeps simulating from the new baseline afterwards: 50 ms is
    // three steps of a sixtieth of a second.
    fake.frame(950);
    expect(record.steps).toHaveLength(3);
  });

  it('stopping twice is harmless', () => {
    const fake = createFakeScheduler();
    const loop = createGameLoop({ scheduler: fake.scheduler, ...createRecorder() });

    loop.start();
    loop.stop();

    expect(() => {
      loop.stop();
    }).not.toThrow();
    expect(fake.cancelled).toBe(1);
  });
});
