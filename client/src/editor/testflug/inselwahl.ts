/**
 * Island pick and jump target for the offline flight ("Testflug").
 *
 * The flight is the real game client without a server, but it always started
 * at (0, 0) — open sea in the dev world, 17.7 km from the nearest island.
 * This module answers three questions WITHOUT a window, a scene or a
 * physics engine (so the same code runs in the editor, in the client and in
 * a test):
 *
 *   1. Which islands does the world document have, how many placements sit
 *      on each, and where is a sensible jump target on it?
 *   2. Is a given world point a safe place to arrive? (inside a region,
 *      above the water line — otherwise a message, never a jump.)
 *   3. What does the flight tell the player about where they are?
 *      (region, coordinate, height above ground, compass direction.)
 *
 * The height source is a plain function, so the editor hands in the very
 * `getGroundHeight` the flight uses later: what the editor checks is what the
 * client finds on arrival.
 *
 * Insel-Wahl und Sprungziel für den Offline-Testflug. Alles hier ist
 * DOM-frei: Editor, Client und Test rechnen mit demselben Code.
 */
import { WATER_LEVEL, sanitizeWorldLayout, shapeBounds, signedDistance } from '@wov/shared';
import type { ContinentDef, RegionDef, WorldLayout } from '@wov/shared';
import { createWorld } from '../../world/World';

/** Ground height in metres at a world point (`ClientWorld.getGroundHeight`). */
export type GroundHeight = (x: number, z: number) => number;

/**
 * The figure is put down this far above the ground. The capsule collider sits
 * on the collision mesh, which measured up to 0.7 m above the height field
 * (PlayerController, flight notes); arriving with the capsule centre exactly
 * on the field would start it inside the mesh.
 */
export const JUMP_CLEARANCE = 2;

/**
 * Ground must lie at least this far above the water line to count as land.
 * A point at 0.1 m above the line is a wet beach that the waves cover.
 */
export const MIN_ABOVE_WATER = 0.5;

/**
 * Where an island target is searched, ground should stand at least this far
 * above the water line: a target 1 m over the line is a wet beach (measured
 * on three of the 19 dev regions before this rule). Low-lying regions (a
 * swamp whose highest point is 3 m) take the best they have instead.
 */
export const TARGET_HEIGHT = 5;

/** Coordinates in the jump URL are rounded to this step (m). */
const COORDINATE_STEP = 0.1;

/** Query values of the jump — the editor writes them, the client reads them. */
export const JUMP_PARAM = 'pos';

export type JumpRefusal = 'invalid' | 'outside' | 'water';

export interface JumpTarget {
  x: number;
  z: number;
  /** Ground height at the target (m). */
  ground: number;
  /** Where the figure is put down: ground plus `JUMP_CLEARANCE`. */
  y: number;
  region: RegionDef;
}

export type JumpCheck =
  | ({ ok: true } & JumpTarget)
  | { ok: false; reason: JumpRefusal; message: string };

export interface IslandEntry {
  id: string;
  biome: string;
  /** Name of the continent the region belongs to, if any. */
  continent: string | null;
  /** Placements on this region (Z-order: the last drawn region wins). */
  placements: number;
  /** The jump target, or null when the region has no land to arrive on. */
  target: { x: number; z: number } | null;
  /** Why there is no target (shown instead of the button). */
  message: string | null;
}

const num = (v: number, digits = 1): string =>
  v.toFixed(digits).replace('.', ',');

const roundStep = (v: number): number => Math.round(v / COORDINATE_STEP) * COORDINATE_STEP;

/** Round a coordinate to the URL step, without float noise (`-17620.1`, not `-17620.100000000002`). */
export function roundCoordinate(v: number): number {
  return Number(roundStep(v).toFixed(1));
}

/**
 * Topmost region containing the point, or null for open sea.
 * Same rule as the map selection and the editor tree: the region drawn LAST
 * wins (`WorldLayout.regions` is the Z-order).
 */
export function regionAt(layout: WorldLayout, x: number, z: number): RegionDef | null {
  for (let i = layout.regions.length - 1; i >= 0; i--) {
    const r = layout.regions[i]!;
    if (signedDistance(r.shape, x, z) >= 0) return r;
  }
  return null;
}

/**
 * Is (x, z) a safe place to arrive? Inside a region and on land.
 * Anything else yields a German message for the player and no target.
 */
export function checkJump(
  layout: WorldLayout,
  ground: GroundHeight,
  rawX: number,
  rawZ: number
): JumpCheck {
  if (!Number.isFinite(rawX) || !Number.isFinite(rawZ)) {
    return { ok: false, reason: 'invalid', message: 'Keine gültige Stelle.' };
  }
  const x = roundCoordinate(rawX);
  const z = roundCoordinate(rawZ);
  const region = regionAt(layout, x, z);
  if (!region) {
    return {
      ok: false,
      reason: 'outside',
      message: `Stelle (${Math.round(x)}, ${Math.round(z)}) liegt außerhalb jeder Region — offene See, dort gibt es nichts zu betreten.`,
    };
  }
  const g = ground(x, z);
  if (!(g >= WATER_LEVEL + MIN_ABOVE_WATER)) {
    return {
      ok: false,
      reason: 'water',
      message:
        `Stelle (${Math.round(x)}, ${Math.round(z)}) in ${region.id} liegt im Wasser ` +
        `(Gelände ${num(g)} m, Wasserlinie ${num(WATER_LEVEL, 0)} m).`,
    };
  }
  return { ok: true, x, z, ground: g, y: g + JUMP_CLEARANCE, region };
}

/**
 * The client's side of the jump: the raw draft (what `main.ts` holds) and the
 * `pos` query value. Refuses cleanly when either is unusable.
 */
export function checkJumpFromDraft(
  draft: unknown,
  ground: GroundHeight,
  posParam: string | null
): JumpCheck {
  const target = parseJumpParam(posParam);
  if (!target) return { ok: false, reason: 'invalid', message: 'Keine gültige Stelle in der Adresse.' };
  const layout = draft ? sanitizeWorldLayout(draft) : null;
  if (!layout) return { ok: false, reason: 'invalid', message: 'Kein Entwurf zum Betreten.' };
  return checkJump(layout, ground, target.x, target.z);
}

/** Area centroid of a polygon; the vertex mean for degenerate (zero-area) input. */
function polygonCentroid(points: ReadonlyArray<readonly [number, number]>): { x: number; z: number } {
  let a = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, zi] = points[i]!;
    const [xj, zj] = points[j]!;
    const w = xj * zi - xi * zj;
    a += w;
    cx += (xj + xi) * w;
    cz += (zj + zi) * w;
  }
  if (Math.abs(a) < 1e-6) {
    const n = points.length || 1;
    return {
      x: points.reduce((s, p) => s + p[0], 0) / n,
      z: points.reduce((s, p) => s + p[1], 0) / n,
    };
  }
  return { x: cx / (3 * a), z: cz / (3 * a) };
}

/** The geometric centre of a region: circle centre or polygon centroid. */
export function regionCentre(region: RegionDef): { x: number; z: number } {
  const s = region.shape;
  return s.kind === 'circle' ? { x: s.x, z: s.z } : polygonCentroid(s.points);
}

/** Samples per axis of the search. */
const SEARCH_GRID = 41;
/**
 * The cheap estimate only orders the grid: points it puts this far below the
 * water line are tried last. It is NOT a filter — on terrain the draft has
 * edited the estimate (world generator alone) can be tens of metres off, and
 * real land was invisible to it (measured on insel-3 and insel-16).
 */
const ESTIMATE_MARGIN = 5;
/** Real heights read per region at most: the whole grid. */
const SEARCH_MAX_READS = SEARCH_GRID * SEARCH_GRID;
/**
 * Wall-clock limit of one search in the editor (ms). A region without any high
 * land makes the search read the whole grid (measured 1.2 to 5.3 s for water
 * regions); after this the best point found so far is taken and the player is
 * told the search was cut off.
 */
export const SEARCH_BUDGET_MS = 4000;
/** Reads between two breaks of the stepwise search (the page breathes in between). */
const SEARCH_CHUNK = 8;

export interface IslandSearch {
  /** The jump target, or null when no land was found. */
  target: { x: number; z: number } | null;
  /** Height of the target above the water line (m); null without a target. */
  height: number | null;
  /** False when the time limit ended the search before the grid was read. */
  complete: boolean;
  /** Real heights read. */
  reads: number;
}

export interface SearchOptions {
  /** Ends the search when it returns true (checked before every read); default: never. */
  stop?: () => boolean;
  /** Try the region centre first (default true); the test turns it off to exercise the grid everywhere. */
  useCentre?: boolean;
}

/**
 * The search for a jump target as a generator: it yields every `SEARCH_CHUNK`
 * reads so a driver can give the page a break, and returns the result.
 *
 * Jump target for a region: its centre when that is high land of THIS region,
 * otherwise the most inland grid point that is high land.
 *
 * Which grid points count: those the region OWNS (it is the topmost region
 * there). Only when it owns none — it lies completely under later regions —
 * the points inside it that a later region covers count; a target the player
 * asked for by region name must not land on another region's mountain.
 *
 * Order of the points: those the estimate does not put deep under water, the
 * farthest from the region edge first; then the others, likewise. Each is read
 * with the REAL ground height (`ground`, one height zone per call, ~4 ms cold,
 * ~1.5 ms warm) until one stands at least `TARGET_HEIGHT` above the water
 * line — that is the target, so most regions cost one to a few reads. When none
 * does (a swamp whose hills the estimate cannot see, or a region under water)
 * the grid is read until `stop` says enough, and the highest point that is land
 * at all is taken; no target when there is none.
 */
function* searchSteps(
  layout: WorldLayout,
  region: RegionDef,
  ground: GroundHeight,
  estimate: GroundHeight,
  opt: SearchOptions
): Generator<void, IslandSearch, void> {
  const high = (g: number): boolean => g >= WATER_LEVEL + TARGET_HEIGHT;
  const found = (x: number, z: number, g: number, complete: boolean, reads: number): IslandSearch => ({
    target: { x, z },
    height: g - WATER_LEVEL,
    complete,
    reads,
  });
  const c = regionCentre(region);
  const cx = roundCoordinate(c.x);
  const cz = roundCoordinate(c.z);
  let reads = 0;
  if (opt.useCentre !== false) {
    reads++;
    const centre = checkJump(layout, ground, cx, cz);
    if (centre.ok && centre.region === region && high(centre.ground)) return found(cx, cz, centre.ground, true, reads);
  }

  const b = shapeBounds(region.shape);
  interface Candidate {
    x: number;
    z: number;
    /** The estimate does not put it deep under water. */
    likely: boolean;
    owned: boolean;
    /** Distance from the region edge (m). */
    d: number;
    near: number;
  }
  const candidates: Candidate[] = [];
  for (let i = 0; i < SEARCH_GRID; i++) {
    for (let j = 0; j < SEARCH_GRID; j++) {
      const x = roundCoordinate(b.minX + ((i + 0.5) / SEARCH_GRID) * (b.maxX - b.minX));
      const z = roundCoordinate(b.minZ + ((j + 0.5) / SEARCH_GRID) * (b.maxZ - b.minZ));
      const d = signedDistance(region.shape, x, z);
      if (!(d >= 0)) continue;
      candidates.push({
        x,
        z,
        likely: estimate(x, z) >= WATER_LEVEL - ESTIMATE_MARGIN,
        owned: regionAt(layout, x, z) === region,
        d,
        near: Math.hypot(x - c.x, z - c.z),
      });
    }
  }
  const owned = candidates.filter((k) => k.owned);
  const pool = owned.length > 0 ? owned : candidates;
  pool.sort((p, q) => {
    if (p.likely !== q.likely) return p.likely ? -1 : 1;
    return q.d - p.d || p.near - q.near;
  });

  let best: { x: number; z: number; ground: number } | null = null;
  let complete = true;
  for (const cand of pool.slice(0, SEARCH_MAX_READS)) {
    if (opt.stop?.()) {
      complete = false;
      break;
    }
    const g = ground(cand.x, cand.z);
    reads++;
    if (g >= WATER_LEVEL + MIN_ABOVE_WATER) {
      if (high(g)) return found(cand.x, cand.z, g, true, reads);
      if (!best || g > best.ground) best = { x: cand.x, z: cand.z, ground: g };
    }
    if (reads % SEARCH_CHUNK === 0) yield;
  }
  return best ? found(best.x, best.z, best.ground, complete, reads) : { target: null, height: null, complete, reads };
}

/** The search in one go (no breaks): tests, and the list of all islands. */
export function islandSearch(
  layout: WorldLayout,
  region: RegionDef,
  ground: GroundHeight,
  estimate: GroundHeight = ground,
  opt: SearchOptions = {}
): IslandSearch {
  const it = searchSteps(layout, region, ground, estimate, opt);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/** Gives the event loop a turn (a message task: not throttled in a tab that is in the background). */
function breathe(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      ch.port2.close();
      resolve();
    };
    ch.port2.postMessage(0);
  });
}

/**
 * The search stepwise: after every `SEARCH_CHUNK` reads the page gets a turn
 * (the button repaints, the new tab draws), and after `budgetMs` of wall-clock
 * time it stops with what it has (`complete: false`).
 */
export async function islandSearchAsync(
  layout: WorldLayout,
  region: RegionDef,
  ground: GroundHeight,
  estimate: GroundHeight = ground,
  budgetMs: number = SEARCH_BUDGET_MS,
  now: () => number = () => performance.now(),
  opt: Omit<SearchOptions, 'stop'> = {}
): Promise<IslandSearch> {
  const t0 = now();
  const it = searchSteps(layout, region, ground, estimate, { ...opt, stop: () => now() - t0 > budgetMs });
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
    await breathe();
  }
}

/** Target of a region without a time limit (see `searchSteps`); null when it has no land. */
export function islandCentre(
  layout: WorldLayout,
  region: RegionDef,
  ground: GroundHeight,
  estimate: GroundHeight = ground,
  opt: SearchOptions = {}
): { x: number; z: number } | null {
  return islandSearch(layout, region, ground, estimate, opt).target;
}

const sekunden = (ms: number): string => (ms / 1000).toFixed(1).replace('.', ',');

/**
 * What the player is told after a search, or null when there is nothing to
 * say (a target on high land). `error`: no jump happens.
 * Low land and a cut-off search are said out loud: a target 1 m above the
 * water line, or "no land" after the time limit, must not look like a normal answer.
 */
export function searchMessage(
  id: string,
  r: IslandSearch,
  budgetMs: number = SEARCH_BUDGET_MS
): { text: string; error: boolean } | null {
  if (!r.target) {
    return r.complete
      ? { text: `${id} hat kein Land über der Wasserlinie — dort gibt es nichts zu betreten.`, error: true }
      : {
          text: `Suche nach ${sekunden(budgetMs)} s abgebrochen — bis dahin kein Land in ${id} gefunden, vermutlich hat es keines.`,
          error: true,
        };
  }
  if (r.height !== null && r.height < TARGET_HEIGHT) {
    return {
      text:
        `${id}: das Ziel liegt niedrig — nur ${num(r.height)} m über der Wasserlinie` +
        (r.complete ? '' : `, die Suche wurde nach ${sekunden(budgetMs)} s abgebrochen`) +
        ', höheres Land wurde nicht gefunden.',
      error: false,
    };
  }
  return null;
}

/** One row of the island pick, without the jump target (that needs heights). */
export type IslandRow = Omit<IslandEntry, 'target' | 'message'>;

/**
 * The rows behind the island pick: every region with its placement count.
 * Labels are those of the editor tree (region id, biome).
 */
export function islandRows(layout: WorldLayout): IslandRow[] {
  const counts = new Map<string, number>();
  for (const p of layout.placements ?? []) {
    const r = regionAt(layout, p.x, p.z);
    if (r) counts.set(r.id, (counts.get(r.id) ?? 0) + 1);
  }
  const continents = new Map<string, ContinentDef>(layout.continents.map((k) => [k.id, k]));
  return layout.regions.map((region) => ({
    id: region.id,
    biome: region.biome,
    continent: region.continentId ? (continents.get(region.continentId)?.name ?? null) : null,
    placements: counts.get(region.id) ?? 0,
  }));
}

/** The rows with the jump target of each region (see `islandCentre`). */
export function islandList(
  layout: WorldLayout,
  ground: GroundHeight,
  estimate: GroundHeight = ground
): IslandEntry[] {
  return islandRows(layout).map((row) => {
    const region = layout.regions.find((r) => r.id === row.id)!;
    const target = islandCentre(layout, region, ground, estimate);
    return {
      ...row,
      target,
      message: target ? null : `${row.id} hat kein Land über der Wasserlinie.`,
    };
  });
}

/**
 * Height sources for a layout: the real ground height of the flight, and the
 * cheap generator height for searches. Same world the flight builds from the
 * same draft (`detailSeed` of the document wins over any seed).
 */
export function heightSourcesFor(layout: WorldLayout): { ground: GroundHeight; estimate: GroundHeight } {
  const world = createWorld(undefined, {}, layout);
  return {
    ground: (x, z) => world.getGroundHeight(x, z),
    estimate: (x, z) => world.geo.getHeight(x, z),
  };
}

/** Address the editor opens: the flight with the draft and a jump target. */
export function flightUrl(target?: { x: number; z: number }): string {
  const base = '/?offline=1&layout=editor';
  if (!target) return base;
  return `${base}&${JUMP_PARAM}=${roundCoordinate(target.x)},${roundCoordinate(target.z)}`;
}

/** Parse the `pos` query value; null unless it is exactly two finite numbers. */
export function parseJumpParam(value: string | null): { x: number; z: number } | null {
  if (value === null) return null;
  const parts = value.split(',');
  if (parts.length !== 2 || parts.some((p) => p.trim() === '')) return null;
  const x = Number(parts[0]);
  const z = Number(parts[1]);
  return Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null;
}

const COMPASS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'] as const;

/**
 * Compass heading of a view direction, in degrees (0 = north = +z, 90 = east
 * = +x — the orientation of the in-game minimap and world map).
 * The camera looks along (-sin yaw, -cos yaw).
 */
export function headingOf(yaw: number): number {
  const deg = (Math.atan2(-Math.sin(yaw), -Math.cos(yaw)) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export function compassName(heading: number): string {
  return COMPASS[Math.round((((heading % 360) + 360) % 360) / 45) % 8]!;
}

export interface PositionInput {
  x: number;
  z: number;
  /** Feet height of the figure (m). */
  y: number;
  yaw: number;
}

/**
 * The lines of the orientation display, in the words of the editor:
 * region id and biome, world coordinate, height above ground, direction.
 */
export function positionLines(
  layout: WorldLayout | null,
  ground: GroundHeight,
  p: PositionInput
): string[] {
  const region = layout ? regionAt(layout, p.x, p.z) : null;
  const g = ground(p.x, p.z);
  const heading = headingOf(p.yaw);
  return [
    region ? `${region.id} · ${region.biome}` : 'offene See',
    `x ${Math.round(p.x)}  z ${Math.round(p.z)}`,
    `${num(p.y - g)} m über Grund (Gelände ${num(g)} m)`,
    `Blick ${compassName(heading)} ${Math.round(heading)}°`,
  ];
}
