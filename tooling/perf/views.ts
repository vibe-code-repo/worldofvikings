/**
 * The named camera positions a frame measurement is taken from.
 *
 * A performance number without a view is not a number: the village costs three
 * times as much looked at across the square as it does looked at a wall. So the
 * two views this project compares builds at are written down once, here, and
 * both the profiler and the picture comparison take their query string from
 * this list rather than from whatever was pasted into a shell last time.
 */

/** One reproducible camera position, as the query string that produces it. */
export interface PerfView {
  readonly id: string;
  /** What is in the frame, for the report. */
  readonly description: string;
  /** Query string appended to the game URL, `?` included. */
  readonly query: string;
}

/**
 * The views `pnpm perf:frame` knows.
 *
 * `square` is the spawn default — the densest thing in the village and the view
 * the CPU budget is set by. `slope` looks down the hill from the north-east
 * corner, where the shadow map covers ground the square's view never shows.
 *
 * `rim` is aimed rather than budgeted: it frames the north edge of the tile and
 * the sky above it, which is where the 100 cliffs of `surroundings` would stand
 * if they were ever moved into the village. Half of that frame is sky, so its
 * frame time says little — it exists so the picture in ADR-0036 can be taken
 * again by name instead of from a query string somebody pasted once.
 */
export const PERF_VIEWS: readonly PerfView[] = [
  {
    id: 'square',
    description: 'village square, spawn default',
    query: '?debug=1',
  },
  {
    id: 'slope',
    description: 'north-east slope, looking back at the village',
    query: '?debug=1&world=village1&spawn=120,120&look=-105,14',
  },
  {
    id: 'rim',
    description: 'north rim, pitched up at the sky the cliff ring stands in',
    query: '?debug=1&world=village1&spawn=77,255&look=0,-28',
  },
];

/** The view with this id, or `undefined`. */
export function findView(id: string): PerfView | undefined {
  return PERF_VIEWS.find((view) => view.id === id);
}
