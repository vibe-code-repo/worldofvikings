/**
 * The viewport grid, as plain geometry.
 *
 * Kept free of Babylon.js so the spacing rules can be tested without a browser:
 * a grid that silently loses its centre line or its outermost ring looks
 * plausible in a screenshot and is wrong in exactly the way that makes placing
 * things by eye untrustworthy.
 */

/** A point in world space. */
export type Point3 = readonly [number, number, number];

/** One straight segment, from a to b. */
export type GridLine = readonly [Point3, Point3];

export interface GridOptions {
  /** Half-width of the grid in metres; lines run from `-extent` to `+extent`. */
  readonly extent: number;
  /** Distance between two neighbouring lines, in metres. */
  readonly step: number;
  /** Every n-th line is drawn as a major line. `1` would make them all major. */
  readonly majorEvery: number;
}

export const defaultGridOptions: GridOptions = { extent: 50, step: 1, majorEvery: 10 };

export interface GridGeometry {
  /** The thin lines. */
  readonly minor: readonly GridLine[];
  /** Every `majorEvery`-th line, drawn brighter. Excludes the two axes. */
  readonly major: readonly GridLine[];
  /** The x axis (red) and the z axis (blue), in that order. */
  readonly axes: readonly [GridLine, GridLine];
}

/**
 * Builds the grid lines for one horizontal plane at `y = 0`.
 *
 * The count is `2 * floor(extent / step) + 1` per direction — both edges and
 * the centre — so the grid is symmetric around the origin whether or not
 * `extent` is a whole multiple of `step`.
 */
export function gridGeometry(overrides: Partial<GridOptions> = {}): GridGeometry {
  const { extent, step, majorEvery } = { ...defaultGridOptions, ...overrides };
  if (!(step > 0)) {
    throw new Error(`gridGeometry: step must be greater than 0, got ${String(step)}`);
  }
  if (!(extent > 0)) {
    throw new Error(`gridGeometry: extent must be greater than 0, got ${String(extent)}`);
  }
  if (!Number.isInteger(majorEvery) || majorEvery < 1) {
    throw new Error(`gridGeometry: majorEvery must be a positive integer`);
  }

  const steps = Math.floor(extent / step);
  const reach = steps * step;
  const minor: GridLine[] = [];
  const major: GridLine[] = [];

  for (let index = -steps; index <= steps; index += 1) {
    const offset = index * step;
    // The centre lines are the axes; they are drawn separately in their own
    // colours, so they must not be repeated here.
    if (index === 0) {
      continue;
    }
    const target = index % majorEvery === 0 ? major : minor;
    target.push([
      [offset, 0, -reach],
      [offset, 0, reach],
    ]);
    target.push([
      [-reach, 0, offset],
      [reach, 0, offset],
    ]);
  }

  return {
    minor,
    major,
    axes: [
      [
        [-reach, 0, 0],
        [reach, 0, 0],
      ],
      [
        [0, 0, -reach],
        [0, 0, reach],
      ],
    ],
  };
}
