import { describe, expect, it } from 'vitest';
import { scrollToShowRow, windowedRange } from './list-window.js';

const VILLAGE = {
  count: 5273,
  rowHeight: 22,
  listTop: 48,
  viewportHeight: 700,
  overscan: 12,
};

describe('windowedRange', () => {
  it('renders a short list whole, with no spacers', () => {
    const window_ = windowedRange({ ...VILLAGE, count: 7, scrollTop: 0 });
    expect(window_).toEqual({ first: 0, end: 7, leadingPx: 0, trailingPx: 0 });
  });

  it('renders an empty list as nothing at all', () => {
    expect(windowedRange({ ...VILLAGE, count: 0, scrollTop: 0 })).toEqual({
      first: 0,
      end: 0,
      leadingPx: 0,
      trailingPx: 0,
    });
  });

  it('renders a screenful plus the overscan out of five thousand rows', () => {
    const window_ = windowedRange({ ...VILLAGE, scrollTop: 0 });
    // 700 px of 22 px rows is 32 rows; the list starts 48 px down, so the
    // bottom edge falls in row 30. Plus the overscan below, and nothing above.
    expect(window_.first).toBe(0);
    expect(window_.end).toBe(Math.ceil((700 - 48) / 22) + 12);
    expect(window_.end - window_.first).toBeLessThan(60);
  });

  it('keeps the list its full height with the two spacers', () => {
    const window_ = windowedRange({ ...VILLAGE, scrollTop: 20_000 });
    const rendered = (window_.end - window_.first) * VILLAGE.rowHeight;
    expect(window_.leadingPx + rendered + window_.trailingPx).toBeCloseTo(
      VILLAGE.count * VILLAGE.rowHeight,
      6,
    );
  });

  it('shows the rows the viewport is over, with the overscan around them', () => {
    const scrollTop = 20_000;
    const window_ = windowedRange({ ...VILLAGE, scrollTop });
    const firstVisible = Math.floor((scrollTop - VILLAGE.listTop) / VILLAGE.rowHeight);
    const lastVisible = Math.floor(
      (scrollTop + VILLAGE.viewportHeight - VILLAGE.listTop) / VILLAGE.rowHeight,
    );
    expect(window_.first).toBe(firstVisible - VILLAGE.overscan);
    expect(window_.end).toBeGreaterThan(lastVisible + VILLAGE.overscan - 1);
  });

  it('clamps at both ends instead of asking for rows that do not exist', () => {
    const top = windowedRange({ ...VILLAGE, scrollTop: -500 });
    expect(top.first).toBe(0);
    expect(top.leadingPx).toBe(0);

    const bottom = windowedRange({ ...VILLAGE, scrollTop: VILLAGE.count * VILLAGE.rowHeight });
    expect(bottom.end).toBe(VILLAGE.count);
    expect(bottom.trailingPx).toBe(0);
  });

  it('renders everything when the panel has not been measured yet', () => {
    expect(windowedRange({ ...VILLAGE, scrollTop: 0, viewportHeight: 0 }).end).toBe(VILLAGE.count);
    expect(windowedRange({ ...VILLAGE, scrollTop: 0, rowHeight: 0 }).end).toBe(VILLAGE.count);
  });
});

describe('scrollToShowRow', () => {
  const view = { rowHeight: 22, listTop: 48, viewportHeight: 700 };

  it('leaves a row that is already visible alone', () => {
    expect(scrollToShowRow({ ...view, index: 5, scrollTop: 0 })).toBeNull();
  });

  it('scrolls up to the top edge of a row above the view', () => {
    expect(scrollToShowRow({ ...view, index: 100, scrollTop: 5_000 })).toBe(48 + 100 * 22);
  });

  it('scrolls down by the smallest amount that shows the row', () => {
    const to = scrollToShowRow({ ...view, index: 4_000, scrollTop: 0 });
    expect(to).toBe(48 + 4_001 * 22 - 700);
  });

  it('has no answer for a row that is not in the list', () => {
    expect(scrollToShowRow({ ...view, index: -1, scrollTop: 0 })).toBeNull();
  });

  it('has no answer before the panel is measured', () => {
    expect(scrollToShowRow({ ...view, viewportHeight: 0, index: 3, scrollTop: 0 })).toBeNull();
  });
});
