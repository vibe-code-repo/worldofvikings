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
 * `floor` is aimed rather than budgeted too: it looks down at the village's own
 * ground, which is the surface ADR-0043 changes and the one neither `square`
 * nor `slope` shows much of.
 *
 * `rim` is aimed rather than budgeted: it frames the north edge of the tile and
 * the sky above it, which is where the 100 cliffs of `surroundings` would stand
 * if they were ever moved into the village. Half of that frame is sky, so its
 * frame time says little — it exists so the picture in ADR-0037 can be taken
 * again by name instead of from a query string somebody pasted once.
 *
 * `workyard` is aimed too: it stands west of the brick and paving cluster at
 * x 181–188 / z 150–165, the densest run of ground dressing in the village and
 * the place where a change to the ground shows first, so it is a named view
 * rather than a coordinate somebody remembered.
 *
 * **A view is only reproducible where the capsule stands still.** The camera
 * follows the placeholder character, and on a slope that character keeps
 * sliding (ADR-0038), so a spawn on one is a different frame every run. All
 * four of these spawn on level ground; two runs of the same build over any of
 * them differ by 0.0000/255. Check that before adding a fifth.
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
    // The ground the author's report is about: the village floor between the
    // work area and the houses, pitched down so that the frame is mostly paths
    // and grass rather than fences and leaves. The square and the slope both
    // spend most of their pixels on something standing up, which is why a
    // change to the ground reads as almost nothing in either of them.
    id: 'floor',
    description: 'village floor, pitched down at the paths between the houses',
    query: '?debug=1&world=village1&spawn=172,150&look=0,32',
  },
  {
    id: 'rim',
    description: 'north rim, pitched up at the sky the cliff ring stands in',
    query: '?debug=1&world=village1&spawn=77,255&look=0,-28',
  },
  {
    id: 'workyard',
    description: 'work area east of the square, where the ground dressing is densest',
    query: '?debug=1&world=village1&spawn=178,154&look=90,24',
  },
];

/** The view with this id, or `undefined`. */
export function findView(id: string): PerfView | undefined {
  return PERF_VIEWS.find((view) => view.id === id);
}
