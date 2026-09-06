/**
 * Scattering props over a region — the one place the editor is allowed to
 * randomise (spec §12, agent rule 17).
 *
 * **Why this is not procedural generation.** Rule 16 forbids the game
 * generating world content, and this does not: nothing here runs in the game,
 * and nothing here is re-run to draw a frame. A scatter is a *one-off authoring
 * gesture* whose entire output is written into the world file as ordinary
 * entities — the same shape a hand-placed barrel has, editable and deletable
 * one by one afterwards. The seed is how the author repeats the gesture, not
 * how the world is stored. ADR-0025 states the rule; this module is where it is
 * kept.
 *
 * **Why it produces a command rather than editing anything.** The document is
 * the truth and the scene follows it (ADR-0018), so a scatter is
 * {@link scatterCommand}: one `addEntities` command holding every instance. One
 * command means one history entry, which means one Ctrl+Z takes back the whole
 * field of grass instead of three thousand of them.
 *
 * **Why the plan is a pure function.** {@link planScatter} takes numbers and a
 * height function and returns entities. It needs no document, no zone and no
 * renderer, so the editor panel, the `pnpm scatter` script and the tests all
 * run the same code and cannot drift apart — the reason the command-line tool
 * exists at all is that a reviewer must be able to reproduce a run without
 * opening a browser.
 */
import type { EntityDefinition, Vector3 } from '@wov/world-schema';
import { addEntities, type AddEntitiesCommand, type CommandResult } from './commands.js';
import { createRandom } from './random.js';

/** A point on the ground: `[x, z]` in metres. */
export type Point2 = readonly [number, number];

/** An axis-aligned rectangle on the ground: `[x0, z0, x1, z1]` in metres. */
export type Rect = readonly [number, number, number, number];

/**
 * Where instances may stand.
 *
 * The rectangle is what is sampled; the optional polygon and the optional
 * keep-out rectangles only ever remove from it. Buildings and paved paths come
 * in as {@link ScatterRegion.exclude} — a village square scattered without them
 * grows grass through the floorboards.
 */
export interface ScatterRegion {
  readonly rect: Rect;
  /** `[x, z]` corners; a point outside it is rejected. At least three. */
  readonly polygon?: readonly Point2[];
  /** Rectangles nothing may stand in. */
  readonly exclude?: readonly Rect[];
}

/** One prefab and how often it is drawn relative to the others. */
export interface WeightedPrefab {
  readonly prefab: string;
  /** Any positive number; only the ratios between them matter. */
  readonly weight: number;
}

export interface ScatterOptions {
  readonly region: ScatterRegion;
  readonly prefabs: readonly WeightedPrefab[];
  /** Instances per 100 m² of {@link ScatterPlan.usableArea}. */
  readonly density: number;
  /** Which run this is. The same seed and options give the same entities. */
  readonly seed: number;
  /** Uniform scale range, `[low, high]`. Defaults to 1. */
  readonly scale?: readonly [number, number];
  /** Yaw range in degrees, `[low, high]`. Defaults to a full turn. */
  readonly yawDegrees?: readonly [number, number];
  /** Metres two instances must keep between them. Defaults to none. */
  readonly minimumDistance?: number;
  /** Ground height at `[x, z]`. Defaults to a flat zero. */
  readonly heightAt?: (x: number, z: number) => number;
  /** A ceiling on the count, whatever the density asks for. */
  readonly maximum?: number;
}

export interface ScatterPlan {
  /** Sorted by id, which is also the order they are written to the file in. */
  readonly entities: readonly EntityDefinition[];
  /** Square metres of the rectangle left after polygon and keep-outs. */
  readonly usableArea: number;
  /** What the density asked for, before the minimum distance had its say. */
  readonly requested: number;
  /** Instances the minimum distance had no room for. */
  readonly crowdedOut: number;
}

/** A full turn, the default yaw range: foliage has no front. */
const FULL_TURN_DEGREES = 360;

/** Density is stated per this many square metres — a 10 m × 10 m patch. */
export const SCATTER_DENSITY_AREA = 100;

/**
 * Tries per instance before it is given up on.
 *
 * With a minimum distance that the region has room for, the first try almost
 * always lands; the retries are what keep a nearly-full region from ending
 * early. Twenty-four is the point past which more tries stopped adding
 * instances in the village run and only cost time.
 */
export const SCATTER_ATTEMPTS = 24;

/**
 * Probes per axis when measuring the usable area.
 *
 * The area is measured rather than computed because the region is a rectangle
 * minus a polygon minus a list of rectangles that may overlap each other, and
 * the closed form for that is a clipping library. A 128 × 128 lattice settles
 * the area of the village region to well under a percent, is deterministic, and
 * costs sixteen thousand point tests once per run.
 */
export const AREA_PROBES = 128;

/** How many decimals a scattered coordinate keeps, as in the authored world. */
const POSITION_DECIMALS = 3;
const ROTATION_DECIMALS = 5;
const SCALE_DECIMALS = 4;

/** Digits in the instance number, so that sorting by id is sorting by run. */
const INSTANCE_DIGITS = 4;

/** A safety net: a mistyped density must not lock the browser up. */
export const SCATTER_MAXIMUM = 50_000;

/** Whether `[x, z]` is inside the region — rectangle, polygon and keep-outs. */
export function insideRegion(region: ScatterRegion, x: number, z: number): boolean {
  const [x0, z0, x1, z1] = normalise(region.rect);
  if (x < x0 || x > x1 || z < z0 || z > z1) {
    return false;
  }
  if (region.polygon !== undefined && !insidePolygon(region.polygon, x, z)) {
    return false;
  }
  return !(region.exclude ?? []).some((rect) => insideRect(rect, x, z));
}

/**
 * The square metres a scatter may actually use.
 *
 * Density means "per 100 m² of ground I can stand on": excluding the houses
 * from a square must not silently thin the grass between them, it must only
 * make the field smaller.
 */
export function usableArea(region: ScatterRegion): number {
  const [x0, z0, x1, z1] = normalise(region.rect);
  const width = x1 - x0;
  const depth = z1 - z0;
  if (width <= 0 || depth <= 0) {
    return 0;
  }
  if (region.polygon === undefined && (region.exclude ?? []).length === 0) {
    return width * depth;
  }
  let accepted = 0;
  for (let column = 0; column < AREA_PROBES; column += 1) {
    const x = x0 + ((column + 0.5) / AREA_PROBES) * width;
    for (let row = 0; row < AREA_PROBES; row += 1) {
      const z = z0 + ((row + 0.5) / AREA_PROBES) * depth;
      if (insideRegion(region, x, z)) {
        accepted += 1;
      }
    }
  }
  return (width * depth * accepted) / (AREA_PROBES * AREA_PROBES);
}

/**
 * Plans one scatter run.
 *
 * Deterministic in every part: the count follows from the measured area, the
 * positions from the seed, and the ids from the seed and the prefab. Running it
 * twice with the same options produces the same list, byte for byte, which is
 * what makes `pnpm scatter` a reproducible step rather than a lottery.
 */
export function planScatter(options: ScatterOptions): CommandResult<ScatterPlan> {
  const problem = validate(options);
  if (problem !== undefined) {
    return { ok: false, error: problem };
  }

  const region = options.region;
  const [x0, z0, x1, z1] = normalise(region.rect);
  const area = usableArea(region);
  const ceiling = Math.min(options.maximum ?? SCATTER_MAXIMUM, SCATTER_MAXIMUM);
  const requested = Math.min(ceiling, Math.round((options.density * area) / SCATTER_DENSITY_AREA));

  const random = createRandom(options.seed);
  const weights = options.prefabs.map((entry) => entry.weight);
  const [scaleLow, scaleHigh] = options.scale ?? [1, 1];
  const [yawLow, yawHigh] = options.yawDegrees ?? [0, FULL_TURN_DEGREES];
  const spacing = options.minimumDistance ?? 0;
  const heightAt = options.heightAt ?? (() => 0);
  const grid = createSpacingGrid(spacing);

  const counters = new Map<string, number>();
  const entities: EntityDefinition[] = [];
  let crowdedOut = 0;

  for (let instance = 0; instance < requested; instance += 1) {
    let placed = false;
    for (let attempt = 0; attempt < SCATTER_ATTEMPTS && !placed; attempt += 1) {
      // Two draws per attempt, whether it lands or not: the stream a rejected
      // candidate consumed is part of what makes the run repeatable.
      const x = random.between(x0, x1);
      const z = random.between(z0, z1);
      if (!insideRegion(region, x, z) || !grid.accepts(x, z)) {
        continue;
      }
      grid.add(x, z);

      const prefab = options.prefabs[random.weighted(weights)]?.prefab ?? '';
      const scale = round(random.between(scaleLow, scaleHigh), SCALE_DECIMALS);
      const yaw = round((random.between(yawLow, yawHigh) * Math.PI) / 180, ROTATION_DECIMALS);
      const number = (counters.get(prefab) ?? 0) + 1;
      counters.set(prefab, number);

      const position: Vector3 = [
        round(x, POSITION_DECIMALS),
        round(heightAt(x, z), POSITION_DECIMALS),
        round(z, POSITION_DECIMALS),
      ];
      entities.push({
        id: scatterId(prefab, options.seed, number),
        prefab,
        position,
        rotation: [0, yaw, 0],
        scale: [scale, scale, scale],
      });
      placed = true;
    }
    if (!placed) {
      crowdedOut += 1;
    }
  }

  entities.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return { ok: true, value: { entities, usableArea: area, requested, crowdedOut } };
}

/**
 * The id one scattered instance carries: `<prefab>_s<seed>_<number>`.
 *
 * The seed is in the id on purpose. It says which run an entity came from, so a
 * second run over the same ground with a different seed cannot collide with the
 * first, and a run repeated with the same seed collides on every id — which the
 * `addEntities` command rejects, loudly, instead of doubling the grass.
 */
export function scatterId(prefab: string, seed: number, instance: number): string {
  return `${prefab}_s${String(seed)}_${String(instance).padStart(INSTANCE_DIGITS, '0')}`;
}

/**
 * One scatter run as one command.
 *
 * Every instance is in a single `addEntities`, so the history holds one entry
 * and undo takes the whole field back at once (spec §12).
 */
export function scatterCommand(
  zoneId: string,
  options: ScatterOptions,
): CommandResult<{ readonly command: AddEntitiesCommand; readonly plan: ScatterPlan }> {
  const planned = planScatter(options);
  if (!planned.ok) {
    return planned;
  }
  return {
    ok: true,
    value: {
      command: addEntities(
        zoneId,
        planned.value.entities.map((entity) => ({ entity })),
      ),
      plan: planned.value,
    },
  };
}

// --- helpers ----------------------------------------------------------------

function validate(options: ScatterOptions): string | undefined {
  const [x0, z0, x1, z1] = normalise(options.region.rect);
  if (![x0, z0, x1, z1].every((value) => Number.isFinite(value))) {
    return 'the region rectangle must be four finite numbers';
  }
  if (x1 <= x0 || z1 <= z0) {
    return 'the region rectangle has no area';
  }
  if (options.region.polygon !== undefined && options.region.polygon.length < 3) {
    return 'a region polygon needs at least three corners';
  }
  if (options.prefabs.length === 0) {
    return 'a scatter needs at least one prefab';
  }
  if (options.prefabs.some((entry) => !(entry.weight > 0) || !Number.isFinite(entry.weight))) {
    return 'every prefab weight must be a positive number';
  }
  if (!Number.isFinite(options.density) || options.density <= 0) {
    return 'the density must be a positive number of instances per 100 m²';
  }
  if (!Number.isInteger(options.seed) || options.seed < 0) {
    return 'the seed must be a whole number, zero or greater';
  }
  const [scaleLow, scaleHigh] = options.scale ?? [1, 1];
  if (!(scaleLow > 0) || !(scaleHigh >= scaleLow) || !Number.isFinite(scaleHigh)) {
    return 'the scale range must be positive and rise from low to high';
  }
  const spacing = options.minimumDistance ?? 0;
  if (!Number.isFinite(spacing) || spacing < 0) {
    return 'the minimum distance cannot be negative';
  }
  return undefined;
}

/** `[x0, z0, x1, z1]` with the low corner first, whichever way it was drawn. */
function normalise(rect: Rect): Rect {
  return [
    Math.min(rect[0], rect[2]),
    Math.min(rect[1], rect[3]),
    Math.max(rect[0], rect[2]),
    Math.max(rect[1], rect[3]),
  ];
}

function insideRect(rect: Rect, x: number, z: number): boolean {
  const [x0, z0, x1, z1] = normalise(rect);
  return x >= x0 && x <= x1 && z >= z0 && z <= z1;
}

/** Ray casting: an odd number of crossings to the right means inside. */
function insidePolygon(polygon: readonly Point2[], x: number, z: number): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; index += 1) {
    const corner = polygon[index];
    const before = polygon[previous];
    previous = index;
    if (corner === undefined || before === undefined) {
      continue;
    }
    const crosses = corner[1] > z !== before[1] > z;
    if (!crosses) {
      continue;
    }
    const at = ((before[0] - corner[0]) * (z - corner[1])) / (before[1] - corner[1]) + corner[0];
    if (x < at) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Accepted points in buckets the size of the minimum distance, so a candidate
 * is compared against the nine buckets around it instead of against every
 * instance already placed. Without it a three-thousand-tuft run is nine million
 * distance tests.
 */
function createSpacingGrid(spacing: number): {
  accepts(x: number, z: number): boolean;
  add(x: number, z: number): void;
} {
  if (spacing <= 0) {
    return { accepts: () => true, add: () => undefined };
  }
  const buckets = new Map<string, Point2[]>();
  const keyOf = (column: number, row: number): string => `${String(column)}:${String(row)}`;
  const cellOf = (value: number): number => Math.floor(value / spacing);
  const squared = spacing * spacing;
  return {
    accepts(x, z) {
      const column = cellOf(x);
      const row = cellOf(z);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          for (const point of buckets.get(keyOf(column + dx, row + dz)) ?? []) {
            const ax = point[0] - x;
            const az = point[1] - z;
            if (ax * ax + az * az < squared) {
              return false;
            }
          }
        }
      }
      return true;
    },
    add(x, z) {
      const key = keyOf(cellOf(x), cellOf(z));
      const bucket = buckets.get(key);
      if (bucket === undefined) {
        buckets.set(key, [[x, z]]);
      } else {
        bucket.push([x, z]);
      }
    },
  };
}

/** Rounds to a fixed number of decimals, and away from `-0`, which JSON keeps. */
function round(value: number, decimals: number): number {
  const rounded = Number(value.toFixed(decimals));
  return rounded === 0 ? 0 : rounded;
}
