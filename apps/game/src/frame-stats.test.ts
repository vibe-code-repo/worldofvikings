import { describe, expect, it } from 'vitest';
import { createFrameStats, formatFrameSample } from './frame-stats.js';

describe('createFrameStats', () => {
  it('publishes nothing before the window is full', () => {
    const stats = createFrameStats({ windowMs: 500 });
    expect(stats.frame(0)).toBeUndefined();
    expect(stats.frame(16)).toBeUndefined();
    expect(stats.frame(499)).toBeUndefined();
  });

  it('turns a window of frames into fps and ms per frame', () => {
    const stats = createFrameStats({ windowMs: 500 });
    let sample;
    // 60 Hz: the first frame opens the window, 30 more fill it.
    for (let i = 0; i <= 30; i += 1) {
      sample = stats.frame(i * (1000 / 60));
    }
    expect(sample).toBeDefined();
    expect(sample?.fps).toBeCloseTo(60, 5);
    expect(sample?.frameMs).toBeCloseTo(1000 / 60, 5);
  });

  it('starts the next window fresh, so a stall is not averaged away forever', () => {
    const stats = createFrameStats({ windowMs: 500 });
    stats.frame(0);
    expect(stats.frame(500)?.fps).toBeCloseTo(2, 5);
    // One frame after a long stall: only this window is measured.
    expect(stats.frame(1500)?.fps).toBeCloseTo(1, 5);
  });

  it('formats as whole fps and one decimal of milliseconds', () => {
    expect(formatFrameSample({ fps: 59.6, frameMs: 16.77 })).toBe('60 fps · 16.8 ms');
  });
});
