import { describe, expect, it } from 'vitest';
import {
  formatProfileTable,
  summarizeProfile,
  windowMean,
  type CpuProfile,
} from './profile-summary.js';
import { compareFrames } from './pixels.js';
import { findView, PERF_VIEWS } from './views.js';

/**
 * A three-level profile: `frame` calls `render`, `render` calls `shadow`.
 * Every sample lands in `shadow`, so the inclusive time of all three is the
 * whole profile and only `shadow` has self time.
 */
const nested: CpuProfile = {
  nodes: [
    { id: 1, callFrame: { functionName: 'frame' }, children: [2] },
    { id: 2, callFrame: { functionName: 'render' }, children: [3] },
    { id: 3, callFrame: { functionName: 'shadow' } },
  ],
  samples: [3, 3, 3, 3],
  timeDeltas: [1000, 1000, 1000, 1000],
};

describe('summarizeProfile', () => {
  it('adds a sample to the self time of its leaf only', () => {
    const summary = summarizeProfile(nested);
    const shadow = summary.rows.find((row) => row.name === 'shadow');
    const render = summary.rows.find((row) => row.name === 'render');
    expect(shadow?.selfMs).toBe(4);
    expect(render?.selfMs).toBe(0);
  });

  it('adds a sample to the inclusive time of every function above it', () => {
    const summary = summarizeProfile(nested);
    expect(summary.rows.map((row) => [row.name, row.inclusiveMs])).toEqual([
      ['frame', 4],
      ['render', 4],
      ['shadow', 4],
    ]);
    expect(summary.totalMs).toBe(4);
    expect(summary.samples).toBe(4);
  });

  it('counts a recursive function once per stack, not once per level', () => {
    const recursive: CpuProfile = {
      nodes: [
        { id: 1, callFrame: { functionName: 'walk' }, children: [2] },
        { id: 2, callFrame: { functionName: 'walk' }, children: [3] },
        { id: 3, callFrame: { functionName: 'walk' } },
      ],
      samples: [3],
      timeDeltas: [2000],
    };
    const summary = summarizeProfile(recursive);
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0]?.inclusiveMs).toBe(2);
    expect(summary.rows[0]?.inclusiveShare).toBe(1);
  });

  it('sorts the heaviest phase first and reports shares of the profile', () => {
    const mixed: CpuProfile = {
      nodes: [
        { id: 1, callFrame: { functionName: 'root' }, children: [2, 3] },
        { id: 2, callFrame: { functionName: 'cheap' } },
        { id: 3, callFrame: { functionName: 'costly' } },
      ],
      samples: [2, 3, 3, 3],
      timeDeltas: [1000, 1000, 1000, 1000],
    };
    const summary = summarizeProfile(mixed);
    expect(summary.rows.map((row) => row.name)).toEqual(['root', 'costly', 'cheap']);
    expect(summary.rows[1]?.selfShare).toBeCloseTo(0.75, 10);
  });

  it('drops a sample whose node the profile does not describe', () => {
    const dangling: CpuProfile = {
      nodes: [{ id: 1, callFrame: { functionName: 'frame' } }],
      samples: [1, 99],
      timeDeltas: [1000, 5000],
    };
    expect(summarizeProfile(dangling).totalMs).toBe(1);
  });

  it('names an anonymous frame instead of merging it into the empty string', () => {
    const anonymous: CpuProfile = {
      nodes: [{ id: 1, callFrame: {} }],
      samples: [1],
      timeDeltas: [1000],
    };
    expect(summarizeProfile(anonymous).rows[0]?.name).toBe('(anonymous)');
  });

  it('survives a profile with no samples at all', () => {
    const summary = summarizeProfile({ nodes: [] });
    expect(summary.rows).toEqual([]);
    expect(summary.totalMs).toBe(0);
  });
});

describe('formatProfileTable', () => {
  it('prints a header and one line per row, longest first', () => {
    const lines = formatProfileTable(summarizeProfile(nested), 2).split('\n');
    expect(lines[0]).toContain('function');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('frame');
  });
});

describe('windowMean', () => {
  it('recovers the mean of the frames between two readings of a running mean', () => {
    // 100 frames averaging 30 ms, then 100 more averaging 10: the running mean
    // reads 20 at the end, and the window's own answer is 10.
    const before = { frameTimeMs: 30, frames: 100 };
    const after = { frameTimeMs: 20, frames: 200 };
    expect(windowMean(before, after)).toBeCloseTo(10, 10);
  });

  it('answers null when no frame was drawn in between', () => {
    expect(
      windowMean({ frameTimeMs: 30, frames: 100 }, { frameTimeMs: 30, frames: 100 }),
    ).toBeNull();
  });
});

describe('compareFrames', () => {
  const solid = (r: number, g: number, b: number, pixels: number): Uint8Array =>
    Uint8Array.from(Array.from({ length: pixels }, () => [r, g, b, 255]).flat());

  it('calls two identical frames identical', () => {
    const difference = compareFrames(solid(10, 20, 30, 4), solid(10, 20, 30, 4));
    expect(difference.meanAbsolute).toBe(0);
    expect(difference.changedShare).toBe(0);
  });

  it('averages over colour channels and ignores alpha', () => {
    // One channel of one pixel differs by 3, over 2 pixels × 3 channels.
    const before = Uint8Array.from([0, 0, 0, 255, 0, 0, 0, 0]);
    const after = Uint8Array.from([3, 0, 0, 255, 0, 0, 0, 255]);
    const difference = compareFrames(before, after);
    expect(difference.meanAbsolute).toBeCloseTo(3 / 6, 10);
    expect(difference.maxAbsolute).toBe(3);
    expect(difference.changedShare).toBe(0.5);
  });

  it('refuses to average two frames of different sizes', () => {
    expect(() => compareFrames(solid(0, 0, 0, 2), solid(0, 0, 0, 3))).toThrow(/differ in size/);
  });
});

describe('perf views', () => {
  it('finds a view by id and nothing by a name it does not have', () => {
    expect(findView('square')?.query).toContain('debug=1');
    expect(findView('nowhere')).toBeUndefined();
  });

  it('turns the debug bridge on in every view, because it is what is read', () => {
    for (const view of PERF_VIEWS) {
      expect(view.query).toContain('debug=1');
    }
  });
});
