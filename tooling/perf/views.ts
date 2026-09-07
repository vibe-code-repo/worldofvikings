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
 * frame time says little — it exists so the picture in ADR-0037 can be taken
 * again by name instead of from a query string somebody pasted once.
 *
 * `vista` is the wide one, and it exists because the other two are not: a
 * palisade fills `square` and a bush fills `slope`, so their colour statistics
 * belong to two or three materials. `vista` stands at the north rim with the
 * horizon across the middle of the frame — ground, haze and the painted range
 * all in one picture — which is the kind of view a grade is actually judged in
 * (ADR-0040).
 *
 * `square-focus-sub` and `square-focus-texel` are `square` with the shadow
 * map's centre displaced by hand (`?shadowFocus=`, `apps/game/src/config.ts`).
 * They exist to prove shadow stability, which no single picture can show: with
 * the village's 120 m map over 2048 texels one texel is 5.86 cm, so the two
 * views nudge the map by 0.4 of a texel and by a whole one while camera,
 * player and sun stay exactly where `square` puts them. Against `square` both
 * must come out pixel-identical — the first because the map does not move at
 * all, the second because it moves by whole texels and lands on the same world
 * pixels (ADR-0039).
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
    id: 'square-focus-sub',
    description: 'village square, shadow focus nudged 0.4 of a shadow texel (2.34 cm)',
    query: '?debug=1&shadowFocus=0.0234375,0',
  },
  {
    id: 'square-focus-texel',
    description: 'village square, shadow focus nudged one whole shadow texel (5.86 cm)',
    query: '?debug=1&shadowFocus=0.05859375,0',
  },
  {
    id: 'vista',
    description: 'north-east slope, looking out over the ground at the painted range',
    query: '?debug=1&world=village1&spawn=120,120&look=75,-4',
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
