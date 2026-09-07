/**
 * Which rows of a long, uniform-height list a scrolled panel actually shows.
 *
 * The hierarchy lists every entity of the active zone, and `village1` has 5273
 * of them. Rendered in full that is 5273 buttons React has to build, lay out
 * and then reconcile again on every change anywhere in the shell — for the
 * thirty or so rows a 700-pixel column can display.
 *
 * So only the visible slice is rendered, and the rows above and below it are
 * replaced by two spacers of exactly their height. The scrollbar, the scroll
 * position and the height of the list are unchanged; what changes is how many
 * elements exist.
 *
 * The arithmetic is here, framework-free, because it is the part that can be
 * wrong in a way nothing notices: a window one row short shows a gap at the
 * bottom edge only while scrolling, and a spacer one row too tall shifts every
 * row under the pointer. The React side measures, this side decides.
 */

export interface ListWindowInput {
  /** How many rows the list has in total. */
  readonly count: number;
  /** Height of one row in CSS pixels; every row has the same one. */
  readonly rowHeight: number;
  /** Where row 0 starts, in the scroll container's own scroll coordinates. */
  readonly listTop: number;
  /** `scrollTop` of the container the list sits in. */
  readonly scrollTop: number;
  /** Visible height of that container. */
  readonly viewportHeight: number;
  /** Extra rows kept above and below, so a small scroll shows filled rows. */
  readonly overscan: number;
}

export interface ListWindow {
  /** Index of the first rendered row. */
  readonly first: number;
  /** Index *after* the last rendered row, so `slice(first, end)` is the window. */
  readonly end: number;
  /** Height of the spacer that stands in for the rows before `first`. */
  readonly leadingPx: number;
  /** Height of the spacer that stands in for the rows after `end`. */
  readonly trailingPx: number;
}

/** The whole list, with no spacers — what a short list gets. */
function everything(count: number): ListWindow {
  return { first: 0, end: count, leadingPx: 0, trailingPx: 0 };
}

/**
 * The slice to render, and the two spacers that keep the list its full height.
 *
 * Degenerate measurements render everything rather than nothing: a row height
 * or a viewport height of zero means the panel has not been measured yet, and a
 * list that renders nothing until its first layout is a list that answers "no
 * such row" to whoever looks first.
 */
export function windowedRange(input: ListWindowInput): ListWindow {
  const { count, rowHeight, listTop, scrollTop, viewportHeight, overscan } = input;
  if (count <= 0) {
    return everything(0);
  }
  if (!(rowHeight > 0) || !(viewportHeight > 0)) {
    return everything(count);
  }

  // Where the viewport's edges fall inside the list, in rows.
  const topRow = (scrollTop - listTop) / rowHeight;
  const bottomRow = (scrollTop + viewportHeight - listTop) / rowHeight;

  const first = clamp(Math.floor(topRow) - overscan, 0, count);
  const end = clamp(Math.ceil(bottomRow) + overscan, first, count);
  if (first === 0 && end === count) {
    return everything(count);
  }

  return {
    first,
    end,
    leadingPx: first * rowHeight,
    trailingPx: (count - end) * rowHeight,
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * Where the container has to be scrolled for row `index` to be fully visible,
 * or `null` when it already is.
 *
 * The smallest movement that works, not a centring: selecting a prop in the
 * viewport should bring its row into view, not reshuffle a list the author was
 * reading.
 */
export function scrollToShowRow(input: {
  readonly index: number;
  readonly rowHeight: number;
  readonly listTop: number;
  readonly scrollTop: number;
  readonly viewportHeight: number;
}): number | null {
  const { index, rowHeight, listTop, scrollTop, viewportHeight } = input;
  if (index < 0 || !(rowHeight > 0) || !(viewportHeight > 0)) {
    return null;
  }
  const top = listTop + index * rowHeight;
  const bottom = top + rowHeight;
  if (top < scrollTop) {
    return top;
  }
  if (bottom > scrollTop + viewportHeight) {
    return bottom - viewportHeight;
  }
  return null;
}
