/**
 * GeoManager — 1:1 port of Valhalla2.0 `IGeoManager` (GeoManager.cpp/.h).
 *
 * Deterministic world generation: seed offsets, lakes, rivers, streams,
 * base height, biome classification and per-biome height functions.
 * Everything below follows the C++ source statement by statement; the C++
 * origin of each function is documented at its declaration.
 *
 * PRECISION MODEL (matches the C++ HEIGHTFIX-02 state):
 *  - PerlinNoise and all height-function INTERMEDIATES: double (plain JS
 *    numbers) — bit-exact.
 *  - Vector2f geometry (rivers/streams/lakes), magnitude(), WorldAngle,
 *    RNG draws, Biome-noise ARGUMENTS: float32 — emulated with Math.fround
 *    at exactly the operations where C++ uses `float`.
 *  - Function RESULTS declared `float` in C++: fround at the return.
 *  - Trig: C++ calls sinf/cosf/atan2f (float); Math.* + fround can differ by
 *    ~1 ulp. This can in principle flip a borderline comparison (a river end
 *    point choice, a biome edge) — the C6 harness measures the real impact.
 *
 * Modern Ashlands (ASHLANDS_2.0, worldAshlandsModernNoise=true): ported in
 * Phase B5 — FastNoise cellular/simplex (seed=0, NOT the world seed) plus the
 * lava mask output. Rivers/streams/preGeneration heights always use the
 * legacy/pregen formulas, exactly like C++.
 */

import { XorShiftRandom } from './Random.js';
import { perlinNoise } from './Perlin.js';
import { FastNoise } from './FastNoise.js';
import {
  clamp01,
  lerpStep,
  smoothStep,
  lerp,
  magnitudeF,
  fbm,
  mathfLikeSmoothStep,
  remap,
  blendOverlay,
  mathfLerp,
} from './Mathf.js';
import { Biome, BiomeArea } from '../types.js';

/** Round to nearest float32 (IEEE single), like a C++ `float` cast/store. */
const f32 = Math.fround;

/** C++ std::numeric_limits<float>::max() */
const FLT_MAX = 3.4028234663852886e38;

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

// ── float32 2D vector helpers (C++ Vector2f) ──────────────────────

interface V2 {
  x: number;
  y: number;
}

const v2 = (x: number, y: number): V2 => ({ x, y });

/** C++ Vector2f::operator+ — per-component float32 add. */
const v2add = (a: V2, b: V2): V2 => ({ x: f32(a.x + b.x), y: f32(a.y + b.y) });

/** C++ Vector2f::operator- — per-component float32 sub. */
const v2sub = (a: V2, b: V2): V2 => ({ x: f32(a.x - b.x), y: f32(a.y - b.y) });

/** C++ Vector2f::operator*(float) — per-component float32 mul. */
const v2scale = (a: V2, s: number): V2 => ({ x: f32(a.x * s), y: f32(a.y * s) });

/** C++ Vector2f::operator== — exact per-component equality. */
const v2eq = (a: V2, b: V2): boolean => a.x === b.x && a.y === b.y;

/** C++ Vector2f::sq_magnitude: x*x + y*y (float32). */
const v2sqMag = (a: V2): number => f32(f32(a.x * a.x) + f32(a.y * a.y));

/** C++ Vector2f::magnitude: std::sqrt(sq_magnitude()) (float32 sqrt). */
const v2mag = (a: V2): number => f32(Math.sqrt(v2sqMag(a)));

/** C++ Vector2f::sq_distance_to(rhs). */
const v2sqDistTo = (a: V2, b: V2): number =>
  f32(f32(f32(a.x - b.x) * f32(a.x - b.x)) + f32(f32(a.y - b.y) * f32(a.y - b.y)));

/** C++ Vector2f::distance_to(rhs): std::sqrt(sq_distance_to) (float32). */
const v2distTo = (a: V2, b: V2): number => f32(Math.sqrt(v2sqDistTo(a, b)));

/** Threshold from C++ Vector2f::normal(): sq > 1E-05f * 1E-05f (float32 mul). */
const NORMAL_SQ_THRESHOLD = f32(f32(1e-5) * f32(1e-5));

/**
 * C++ Vector2f::normal():
 *   auto sq = sq_magnitude();
 *   if (sq > 1E-05f * 1E-05f) return *this / std::sqrt(sq);
 *   else return ZERO;
 * (operator/ divides each component by the scalar — float32 div.)
 */
const v2normal = (a: V2): V2 => {
  const sq = v2sqMag(a);
  if (sq > NORMAL_SQ_THRESHOLD) {
    const m = f32(Math.sqrt(sq));
    return { x: f32(a.x / m), y: f32(a.y / m) };
  }
  return { x: 0, y: 0 };
};

// ── Constants (GeoManager.h) ──────────────────────────────────────

/** C++ `static constexpr std::int32_t worldSize = 10000;` (INT!) */
export const WORLD_SIZE = 10000;
/** C++ `static constexpr float waterEdge = 10500;` */
export const WATER_EDGE = 10500;
/** Terrain is sampled at this * 200; water level 30 m ⇔ 0.15 (ZoneManager). */
export const HEIGHT_SCALE = 200;

const RIVER_GRID_SIZE = 64;
const MIN_RIVER_WIDTH = 60;
const MAX_RIVER_WIDTH = 100;
const STREAMS = 3000;
const MEADOWS_MAX_DISTANCE = 5000;
const MIN_DEEP_FOREST_NOISE = f32(0.4);
const MIN_DEEP_FOREST_DISTANCE = 600;
const MAX_DEEP_FOREST_DISTANCE = 6000;
// Marsh is swamp
const MARSH_BIOME_SCALE = f32(0.001);
const MIN_MARSH_NOISE = f32(0.6);
const MIN_MARSH_DISTANCE = 2000;
const MIN_MARSH_HEIGHT = f32(0.05);
const MAX_MARSH_HEIGHT = f32(0.25);
// Heath is plains
const HEATH_BIOME_SCALE = f32(0.001);
const MIN_HEATH_NOISE = f32(0.4);
const MIN_HEATH_DISTANCE = 3000;
const MAX_HEATH_DISTANCE = 8000;
// Darklands is mistlands
const DARKLAND_BIOME_SCALE = f32(0.001);
const MIN_DARKLAND_DISTANCE = 6000;
const MAX_DARKLAND_DISTANCE = 10000;
// Mountain
const MOUNTAIN_BASE_HEIGHT_MIN = f32(0.4);
// Deep north / ashlands world-rim curves
const DEEP_NORTH_MIN_DISTANCE = 12000;
const DEEP_NORTH_Y_OFFSET = 4000;
const ASHLANDS_MIN_DISTANCE = 12000;
const ASHLANDS_Y_OFFSET = -4000;

/** C++ IZoneManager::UNITS_PER_ZONE (used by GetBiomeArea/GetBiomes). */
const UNITS_PER_ZONE = 64;

// ── River structs (GeoManager.h private structs) ──────────────────

export interface River {
  p0: V2;
  p1: V2;
  center: V2;
  widthMin: number;
  widthMax: number;
  curveWidth: number;
  curveWavelength: number;
}

/**
 * C++ RiverPoint { Vector2f p; float w; float w2 = w*w; }.
 * Stored flat (no V2 alloc) — this is the hot lookup structure.
 */
export interface RiverPoint {
  px: number;
  py: number;
  w: number;
  w2: number;
}

// ── Settings (server.yml world* flags + world version) ────────────

export interface GeoManagerSettings {
  /**
   * C++ World::m_worldGenVersion. Affects minMountainDistance (<=0: 1500),
   * minDarklandNoise / maxMarshDistance (<=1: 0.5 / 8000). Default 2.
   */
  worldGenVersion?: number;
  /** C++ VAL_SETTINGS.worldDisableDistantRivers (default false). */
  disableDistantRivers?: boolean;
  /** C++ VAL_SETTINGS.worldRiverAffectsOcean (default false). */
  riverAffectsOcean?: boolean;
  /**
   * C++ VAL_SETTINGS.worldAshlandsModernNoise (default true). Uses the
   * FastNoise-based modern Ashlands height + lava mask (Phase B5).
   */
  ashlandsModernNoise?: boolean;
}

/**
 * C++ IGeoManager. Constructing runs PostWorldInit() + Generate()
 * (lakes → rivers → streams), exactly like the C++ server at world load.
 */
export class GeoManager {
  // C++ member fields
  private offset0 = 0;
  private offset1 = 0;
  private offset2 = 0;
  private offset3 = 0;
  private offset4 = 0;
  private riverSeed = 0;
  private streamSeed = 0;
  private lakes: V2[] = [];
  private rivers: River[] = [];
  private streams: River[] = [];
  private riverPoints = new Map<string, RiverPoint[]>();

  // C++ m_cachedRiverGrid / m_cachedRiverPoints (1-entry memo; pure perf)
  private cachedGridKey = '';
  private cachedGridPoints: RiverPoint[] | null = null;

  // Version-dependent (C++ non-constexpr members mutated by PostWorldInit)
  private minMountainDistance = 1000;
  private minDarklandNoise = f32(0.4);
  private maxMarshDistance = 6000;

  /**
   * C++ m_noiseGen (std::unique_ptr<VUtils::FastNoise>) — created in
   * PostWorldInit only when worldAshlandsModernNoise is on, with the
   * client's settings: seed=0 (NOT the world seed!), frequency=0.01f
   * (f32 widened to double), octaves=2, FBM, Euclidean/Distance,
   * jitter=0.45f (float!). Null in legacy mode (GeoManager.cpp:71-85).
   */
  private readonly fastNoise: FastNoise | null = null;

  readonly settings: Required<GeoManagerSettings>;

  /**
   * @param worldSeed C++ World::m_seed — get_stable_hash(seedName) (int32).
   */
  constructor(
    readonly worldSeed: number,
    settings: GeoManagerSettings = {}
  ) {
    this.settings = {
      worldGenVersion: settings.worldGenVersion ?? 2,
      disableDistantRivers: settings.disableDistantRivers ?? false,
      riverAffectsOcean: settings.riverAffectsOcean ?? false,
      ashlandsModernNoise: settings.ashlandsModernNoise ?? true,
    };
    // C++ PostWorldInit: m_noiseGen init (GeoManager.cpp:71-85)
    if (this.settings.ashlandsModernNoise) {
      this.fastNoise = new FastNoise(0); // client uses seed=0, NOT world seed!
      this.fastNoise.setFrequency(f32(0.01)); // SetFrequency(0.01f) — f32 widened
      this.fastNoise.setFractalOctaves(2);
      // FractalType::FBM, Euclidean, Distance and jitter 0.45f are the
      // FastNoise class defaults — nothing else to set.
    }
    this.postWorldInit();
    this.generate();
  }

  /** Stats for tests/diagnostics (not in C++). */
  get lakeCount(): number {
    return this.lakes.length;
  }
  get riverCount(): number {
    return this.rivers.length;
  }
  get streamCount(): number {
    return this.streams.length;
  }
  get riverGridCount(): number {
    return this.riverPoints.size;
  }

  /** C6 test access — C++ private members (offsets are ints held in float). */
  get offsets(): readonly [number, number, number, number, number] {
    return [this.offset0, this.offset1, this.offset2, this.offset3, this.offset4];
  }
  get riverSeedValue(): number {
    return this.riverSeed;
  }
  get streamSeedValue(): number {
    return this.streamSeed;
  }
  get lakeList(): readonly V2[] {
    return this.lakes;
  }
  get riverList(): readonly River[] {
    return this.rivers;
  }
  get streamList(): readonly River[] {
    return this.streams;
  }
  get riverPointMap(): ReadonlyMap<string, readonly RiverPoint[]> {
    return this.riverPoints;
  }

  // ── C++ void IGeoManager::PostWorldInit() ───────────────────────

  private postWorldInit(): void {
    // Version-dependent mutations (worldGenVersion 2 keeps the defaults)
    if (this.settings.worldGenVersion <= 0) this.minMountainDistance = 1500;
    if (this.settings.worldGenVersion <= 1) {
      this.minDarklandNoise = f32(0.5);
      this.maxMarshDistance = 8000;
    }

    const state = new XorShiftRandom(this.worldSeed);
    // C++ calls state.range(-worldSize, worldSize) with worldSize being
    // std::int32_t — the INT32 overload wins, so offsets are INTEGERS in
    // [-10000, 9999] (not floats like in Unity). Reproduced deliberately.
    this.offset0 = state.rangeInt(-WORLD_SIZE, WORLD_SIZE);
    this.offset1 = state.rangeInt(-WORLD_SIZE, WORLD_SIZE);
    this.offset2 = state.rangeInt(-WORLD_SIZE, WORLD_SIZE);
    this.offset3 = state.rangeInt(-WORLD_SIZE, WORLD_SIZE);
    this.riverSeed = state.rangeInt(INT32_MIN, INT32_MAX);
    this.streamSeed = state.rangeInt(INT32_MIN, INT32_MAX);
    this.offset4 = state.rangeInt(-WORLD_SIZE, WORLD_SIZE);

    // (FastNoise init for modern Ashlands omitted — Phase B5.)
  }

  /**
   * C++ void IGeoManager::Generate().
   *
   * `protected`, damit ein layoutgetriebener Ableger (RegionGeo) die teure
   * Seen-/Fluss-Generierung (~40 s, hart radial) durch einen No-op ersetzen
   * kann. Achtung Subclass-Vertrag: Der Aufruf kommt aus DIESEM Konstruktor,
   * also bevor Feld-Initialisierer der Ableitung gelaufen sind — ein
   * Override darf keine eigenen Felder anfassen.
   */
  protected generate(): void {
    this.generateLakes();
    this.generateRivers();
    this.generateStreams();
  }

  // ── Lakes ───────────────────────────────────────────────────────

  /** C++ void IGeoManager::GenerateLakes() */
  private generateLakes(): void {
    const list: V2[] = [];
    for (let num = -WORLD_SIZE; num <= WORLD_SIZE; num += 128) {
      for (let num2 = -WORLD_SIZE; num2 <= WORLD_SIZE; num2 += 128) {
        // C++ compares against the FLOAT literal 0.05f — using the double
        // 0.05 here would flip the result when baseHeight == 0.05f exactly.
        if (magnitudeF(num2, num) <= WORLD_SIZE && this.getBaseHeight(num2, num) < f32(0.05)) {
          list.push(v2(num2, num));
        }
      }
    }
    this.lakes = this.mergePoints(list, 800);
  }

  /** C++ std::vector<Vector2f> IGeoManager::MergePoints(points, range) */
  private mergePoints(points: V2[], range: number): V2[] {
    const list: V2[] = [];
    while (points.length > 0) {
      let vector = points[0];
      points.shift(); // erase(begin()) — O(n) like the C++ comment notes
      while (points.length > 0) {
        const num = this.findClosest(points, vector, range);
        if (num === -1) break;
        // vector = (vector + points[num]) * 0.5f
        const sum = v2add(vector, points[num]);
        vector = v2scale(sum, 0.5);
        points[num] = points[points.length - 1];
        points.pop();
      }
      list.push(vector);
    }
    return list;
  }

  /** C++ int IGeoManager::FindClosest(points, p, maxDistance) */
  private findClosest(points: V2[], p: V2, maxDistance: number): number {
    let result = -1;
    let num = FLT_MAX;
    const maxDistSq = f32(maxDistance * maxDistance);
    for (let i = 0; i < points.length; i++) {
      if (!v2eq(points[i], p)) {
        const num2 = v2sqDistTo(p, points[i]);
        if (num2 < maxDistSq && num2 < num) {
          result = i;
          num = num2;
        }
      }
    }
    return result;
  }

  // ── Streams ─────────────────────────────────────────────────────

  /** C++ void IGeoManager::GenerateStreams() */
  private generateStreams(): void {
    const state = new XorShiftRandom(this.streamSeed);
    for (let i = 0; i < STREAMS; i++) {
      const start = this.findStreamStartPoint(state, 100, 26, 31);
      if (start === null) continue; // C++ && short-circuit: no end-point search
      const end = this.findStreamEndPoint(state, 100, 36, 44, start.p, 80, 200);
      if (end === null) continue;
      const center = v2scale(v2add(start.p, end), 0.5);
      const height = this.getGenerationHeight(center.x, center.y);
      if (height >= 26 && height <= 44) {
        const num3 = v2distTo(start.p, end); // p0.distance_to(p1)
        this.streams.push({
          p0: start.p,
          p1: end,
          center,
          widthMax: 20,
          widthMin: 20,
          curveWidth: f32(num3 / 15),
          curveWavelength: f32(num3 / 20),
        });
      }
    }
    this.renderRivers(state, this.streams);
  }

  /**
   * C++ bool IGeoManager::FindStreamStartPoint(state, iterations, minHeight,
   * maxHeight, p, starth) — returns the start point or null.
   */
  private findStreamStartPoint(
    state: XorShiftRandom,
    iterations: number,
    minHeight: number,
    maxHeight: number
  ): { p: V2; starth: number } | null {
    for (let i = 0; i < iterations; i++) {
      // C++: state.range((float)-worldSize, (float)worldSize) — FLOAT overload
      const num = state.rangeFloat(-WORLD_SIZE, WORLD_SIZE);
      const num2 = state.rangeFloat(-WORLD_SIZE, WORLD_SIZE);
      const height = this.getGenerationHeight(num, num2);
      if (height > minHeight && height < maxHeight) {
        return { p: v2(num, num2), starth: height };
      }
    }
    return null;
  }

  /**
   * C++ bool IGeoManager::FindStreamEndPoint(state, iterations, minHeight,
   * maxHeight, start, minLength, maxLength, end) — returns end or null.
   */
  private findStreamEndPoint(
    state: XorShiftRandom,
    iterations: number,
    minHeight: number,
    maxHeight: number,
    start: V2,
    minLength: number,
    maxLength: number
  ): V2 | null {
    const num = f32(f32(maxLength - minLength) / iterations);
    let num2 = maxLength;
    for (let i = 0; i < iterations; i++) {
      num2 = f32(num2 - num);
      const f = state.rangeFloat(0, f32(Math.PI * 2));
      // start + Vector2f(std::sin(f), std::cos(f)) * num2  (x=sin, y=cos!)
      const dir = v2scale(v2(f32(Math.sin(f)), f32(Math.cos(f))), num2);
      const vector = v2add(start, dir);
      const height = this.getGenerationHeight(vector.x, vector.y);
      if (height > minHeight && height < maxHeight) {
        return vector;
      }
    }
    return null;
  }

  // ── Rivers ──────────────────────────────────────────────────────

  /** C++ void IGeoManager::GenerateRivers() */
  private generateRivers(): void {
    const state = new XorShiftRandom(this.riverSeed);
    const list2 = [...this.lakes];

    while (list2.length > 1) {
      const vector = list2[0];
      // 0.4f as float32 — the baseHeight comparison in IsRiverAllowed must
      // use the exact float literal value.
      let num = this.findRandomRiverEnd(state, this.rivers, this.lakes, vector, 2000, f32(0.4), 128);
      // NOTE: the second attempt only runs when the first failed AND this
      // lake has no river yet — on success list2[0] is NOT erased (the same
      // lake can source multiple rivers). Exact C++ control flow.
      if (num === -1 && !this.haveRiver1(this.rivers, vector)) {
        num = this.findRandomRiverEnd(state, this.rivers, this.lakes, vector, 5000, f32(0.4), 128);
      }

      if (num !== -1) {
        const p1 = this.lakes[num];
        // C++ draw order: widthMax, then widthMin (RNG sequence matters!)
        const widthMax = state.rangeFloat(MIN_RIVER_WIDTH, MAX_RIVER_WIDTH);
        const widthMin = state.rangeFloat(MIN_RIVER_WIDTH, widthMax);
        const num2 = v2distTo(vector, p1);
        this.rivers.push({
          p0: vector,
          p1,
          center: v2scale(v2add(vector, p1), 0.5),
          widthMax,
          widthMin,
          curveWidth: f32(num2 / 15),
          curveWavelength: f32(num2 / 20),
        });
      } else {
        list2.shift();
      }
    }
    this.renderRivers(state, this.rivers);
  }

  /** C++ int IGeoManager::FindRandomRiverEnd(...) */
  private findRandomRiverEnd(
    state: XorShiftRandom,
    rivers: River[],
    points: V2[],
    p: V2,
    maxDistance: number,
    heightLimit: number,
    checkStep: number
  ): number {
    const list: number[] = [];
    for (let i = 0; i < points.length; i++) {
      if (
        !v2eq(points[i], p) &&
        v2distTo(p, points[i]) < maxDistance &&
        !this.haveRiver2(rivers, p, points[i]) &&
        this.isRiverAllowed(p, points[i], checkStep, heightLimit)
      ) {
        list.push(i);
      }
    }
    if (list.length === 0) return -1;
    return list[state.rangeInt(0, list.length)];
  }

  /** C++ bool IGeoManager::HaveRiver(rivers, p0) — river endpoint exists. */
  private haveRiver1(rivers: River[], p0: V2): boolean {
    for (const river of rivers) {
      if (v2eq(river.p0, p0) || v2eq(river.p1, p0)) return true;
    }
    return false;
  }

  /** C++ bool IGeoManager::HaveRiver(rivers, p0, p1) — river pair exists. */
  private haveRiver2(rivers: River[], p0: V2, p1: V2): boolean {
    for (const river of rivers) {
      if ((v2eq(river.p0, p0) && v2eq(river.p1, p1)) || (v2eq(river.p0, p1) && v2eq(river.p1, p0))) {
        return true;
      }
    }
    return false;
  }

  /** C++ bool IGeoManager::IsRiverAllowed(p0, p1, step, heightLimit) */
  private isRiverAllowed(p0: V2, p1: V2, step: number, heightLimit: number): boolean {
    const num = v2distTo(p0, p1);
    const normalized = v2normal(v2sub(p1, p0));
    let flag = true;
    const limit = f32(num - step);
    for (let num2 = step; num2 <= limit; num2 = f32(num2 + step)) {
      const vector = v2add(p0, v2scale(normalized, num2));
      const baseHeight = this.getBaseHeight(vector.x, vector.y);
      if (baseHeight > heightLimit) return false;
      // C++ float literal 0.05f (see GenerateLakes note)
      if (baseHeight > f32(0.05)) flag = false;
    }
    return !flag;
  }

  /** C++ void IGeoManager::RenderRivers(state, rivers) */
  private renderRivers(state: XorShiftRandom, rivers: River[]): void {
    const dictionary = new Map<string, RiverPoint[]>();
    for (const river of rivers) {
      const num = f32(river.widthMin / 8);
      const normalized = v2normal(v2sub(river.p1, river.p0));
      const a = v2(-normalized.y, normalized.x);
      const num2 = v2distTo(river.p0, river.p1);

      // float accumulation of num3 — emulated with f32 on every step
      for (let num3 = 0; num3 <= num2; num3 = f32(num3 + num)) {
        const num4 = f32(num3 / river.curveWavelength);
        // d = sin(num4) * sin(num4*0.63412f) * sin(num4*0.33412f) * curveWidth
        const s1 = f32(Math.sin(num4));
        const s2 = f32(Math.sin(f32(num4 * f32(0.63412))));
        const s3 = f32(Math.sin(f32(num4 * f32(0.33412))));
        const d = f32(f32(f32(s1 * s2) * s3) * river.curveWidth);
        const r = state.rangeFloat(river.widthMin, river.widthMax);
        // p = p0 + normalized * num3 + a * d
        const p = v2add(v2add(river.p0, v2scale(normalized, num3)), v2scale(a, d));
        this.addRiverPoint(dictionary, p, r);
      }
    }

    for (const [key, points] of dictionary) {
      let list = this.riverPoints.get(key);
      if (list === undefined) {
        list = [];
        this.riverPoints.set(key, list);
      }
      list.push(...points);
    }
  }

  /** C++ void IGeoManager::AddRiverPoint(riverPoints, p, r) — grid fan-out. */
  private addRiverPoint(riverPoints: Map<string, RiverPoint[]>, p: V2, r: number): void {
    const riverGrid = this.getRiverGrid(p.x, p.y);
    const num = Math.ceil(f32(r / RIVER_GRID_SIZE)); // (int)ceil(r / 64f)
    for (let i = riverGrid.y - num; i <= riverGrid.y + num; i++) {
      for (let j = riverGrid.x - num; j <= riverGrid.x + num; j++) {
        if (this.insideRiverGrid(j, i, p, r)) {
          const key = `${j},${i}`;
          let list = riverPoints.get(key);
          if (list === undefined) {
            list = [];
            riverPoints.set(key, list);
          }
          // C++ RiverPoint ctor: w2 = w * w (float32)
          list.push({ px: p.x, py: p.y, w: r, w2: f32(r * r) });
        }
      }
    }
  }

  /** C++ bool IGeoManager::InsideRiverGrid(grid, p, r) */
  private insideRiverGrid(gx: number, gy: number, p: V2, r: number): boolean {
    const bx = f32(gx * RIVER_GRID_SIZE); // (float)grid.x * riverGridSize
    const by = f32(gy * RIVER_GRID_SIZE);
    const vx = f32(p.x - bx);
    const vy = f32(p.y - by);
    const limit = f32(r + RIVER_GRID_SIZE * 0.5);
    return Math.abs(vx) < limit && Math.abs(vy) < limit;
  }

  /** C++ Vector2i IGeoManager::GetRiverGrid(wx, wy) — float32 intermediate. */
  private getRiverGrid(wx: number, wy: number): { x: number; y: number } {
    const x = Math.floor(f32(f32(wx + RIVER_GRID_SIZE * 0.5) / RIVER_GRID_SIZE));
    const y = Math.floor(f32(f32(wy + RIVER_GRID_SIZE * 0.5) / RIVER_GRID_SIZE));
    return { x, y };
  }

  /**
   * C++ void IGeoManager::GetRiverWeight(wx, wy, outWeight, outWidth).
   * Includes the 1-entry grid cache (pure memoization like the C++).
   * (Private in C++; public here for the C6 comparison harness.)
   */
  getRiverWeight(wx: number, wy: number): { weight: number; width: number } {
    const grid = this.getRiverGrid(wx, wy);
    const key = `${grid.x},${grid.y}`;

    let points: RiverPoint[] | null;
    if (key === this.cachedGridKey) {
      points = this.cachedGridPoints;
    } else {
      points = this.riverPoints.get(key) ?? null;
      this.cachedGridKey = key;
      this.cachedGridPoints = points;
    }
    if (points === null) return { weight: 0, width: 0 };
    return this.getWeight(points, wx, wy);
  }

  /** C++ void IGeoManager::GetWeight(points, wx, wy, outWeight, outWidth) */
  private getWeight(points: RiverPoint[], wx: number, wy: number): { weight: number; width: number } {
    let outWeight = 0;
    let outWidth = 0;
    let num = 0;
    let num2 = 0;

    for (const rp of points) {
      // (riverPoint.p - b).sq_magnitude() — float32
      const dx = f32(rp.px - wx);
      const dy = f32(rp.py - wy);
      const num3 = f32(f32(dx * dx) + f32(dy * dy));
      if (num3 < rp.w2) {
        const num4 = f32(Math.sqrt(num3));
        const num5 = f32(1 - f32(num4 / rp.w));
        outWeight = Math.max(num5, outWeight);
        num = f32(num + f32(rp.w * num5));
        num2 = f32(num2 + num5);
      }
    }

    if (num2 > 0) outWidth = f32(num / num2);
    return { weight: outWeight, width: outWidth };
  }

  // ── Base height / world angle ───────────────────────────────────

  /**
   * C++ float IGeoManager::WorldAngle(wx, wy):
   *   return std::sin(std::atan2(wx, wy) * 20.f);   // NOTE: atan2(x, y)!
   * float32 (atan2f/sinf approximated with fround — ~1 ulp risk).
   */
  private worldAngle(wx: number, wy: number): number {
    return f32(Math.sin(f32(f32(Math.atan2(wx, wy)) * 20)));
  }

  /**
   * C++ float IGeoManager::GetBaseHeight(wx, wy) — HEIGHTFIX-02 double
   * intermediates, float32 result. This is the master continental noise:
   * mountains, channels ("rivers" carved into base), world-edge falloff and
   * the central mountain cap.
   */
  getBaseHeight(wx: number, wy: number): number {
    let dwx = wx;
    let dwy = wy;

    const num2 = magnitudeF(wx, wy); // distance from world center (float32!)
    dwx += 100000.0 + this.offset0;
    dwy += 100000.0 + this.offset1;

    let num3 = 0.0;
    num3 +=
      perlinNoise(dwx * 0.002 * 0.5, dwy * 0.002 * 0.5) *
      perlinNoise(dwx * 0.003 * 0.5, dwy * 0.003 * 0.5) *
      1.0;
    num3 +=
      perlinNoise(dwx * 0.002 * 1.0, dwy * 0.002 * 1.0) *
      perlinNoise(dwx * 0.003 * 1.0, dwy * 0.003 * 1.0) *
      num3 *
      0.9;
    num3 +=
      perlinNoise(dwx * 0.005 * 1.0, dwy * 0.005 * 1.0) *
      perlinNoise(dwx * 0.010 * 1.0, dwy * 0.010 * 1.0) *
      0.5 *
      num3;
    num3 -= 0.07;

    const num4 = perlinNoise(dwx * 0.002 * 0.25 + 0.123, dwy * 0.002 * 0.25 + 0.15123);
    const num5 = perlinNoise(dwx * 0.002 * 0.25 + 0.321, dwy * 0.002 * 0.25 + 0.231);
    const v = Math.abs(num4 - num5);
    let num6 = 1.0 - lerpStep(0.02, 0.12, v);
    num6 *= smoothStep(744.0, 1000.0, num2);
    num3 *= 1.0 - num6;

    if (num2 > 10000.0) {
      const t = lerpStep(10000.0, WATER_EDGE, num2);
      num3 = lerp(num3, -0.2, t);
      const num7 = 10490.0;
      if (num2 > num7) {
        const t2 = lerpStep(num7, WATER_EDGE, num2);
        num3 = lerp(num3, -2.0, t2);
      }
    }

    if (num2 < this.minMountainDistance && num3 > 0.28) {
      const t3 = clamp01((num3 - 0.28) / 0.099999994);
      num3 = lerp(
        lerp(0.28, 0.38, t3),
        num3,
        lerpStep(this.minMountainDistance - 400.0, this.minMountainDistance, num2)
      );
    }
    return f32(num3);
  }

  /**
   * C++ float IGeoManager::AddRivers(wx, wy, h) — carves river channels
   * into a height value using the precomputed river point grid.
   */
  private addRivers(wx: number, wy: number, h: number): number {
    if (this.settings.disableDistantRivers) {
      const dist = magnitudeF(wx, wy);
      if (dist > WORLD_SIZE - 1000) return h;

      const biome = this.getBiome(wx, wy);
      if (biome === Biome.Ocean) return h;
      if (biome === Biome.Meadows && dist > MEADOWS_MAX_DISTANCE - 500) return h;
    }

    const { weight: num, width: v } = this.getRiverWeight(wx, wy);
    if (num <= 0) return h;

    // HEIGHTFIX-02 double intermediates
    let dh = h;
    const t = lerpStep(20.0, 60.0, v);
    const num2 = lerp(0.14, 0.12, t);
    const num3 = lerp(0.139, 0.128, t);
    if (dh > num2) {
      dh = lerp(dh, num2, num);
    }
    if (dh > num3) {
      const t2 = lerpStep(0.85, 1.0, num);
      dh = lerp(dh, num3, t2);
    }
    return f32(dh);
  }

  /**
   * C++ float IGeoManager::BaseHeightTilt(wx, wy) — slope estimate used by
   * the mountain height function. Double intermediates.
   */
  private baseHeightTilt(wx: number, wy: number): number {
    const baseHeight = this.getBaseHeight(wx - 1, wy);
    const baseHeight2 = this.getBaseHeight(wx + 1, wy);
    const baseHeight3 = this.getBaseHeight(wx, wy - 1);
    const baseHeight4 = this.getBaseHeight(wx, wy + 1);
    return f32(Math.abs(baseHeight2 - baseHeight) + Math.abs(baseHeight3 - baseHeight4));
  }

  // ── Per-biome height functions (return ~0..0.6, scaled ×200 later) ──

  /** C++ float IGeoManager::GetMarshHeight(wx, wy) — NOTE: no seed offset! */
  private getMarshHeight(wx: number, wy: number): number {
    const dwx = wx + 100000.0;
    const dwy = wy + 100000.0;
    let num = 0.137;
    const num2 =
      perlinNoise(dwx * 0.04, dwy * 0.04) * perlinNoise(dwx * 0.08, dwy * 0.08);
    num += num2 * 0.03;
    num = this.addRivers(wx, wy, f32(num));
    num += perlinNoise(dwx * 0.1, dwy * 0.1) * 0.01;
    return f32(num + perlinNoise(dwx * 0.4, dwy * 0.4) * 0.003);
  }

  /** C++ float IGeoManager::GetMeadowsHeight(wx, wy) */
  private getMeadowsHeight(wx: number, wy: number): number {
    const baseHeight = this.getBaseHeight(wx, wy);
    const dwx = wx + 100000.0 + this.offset3;
    const dwy = wy + 100000.0 + this.offset3;
    let num =
      perlinNoise(dwx * 0.01, dwy * 0.01) * perlinNoise(dwx * 0.02, dwy * 0.02);
    num +=
      perlinNoise(dwx * 0.05, dwy * 0.05) *
      perlinNoise(dwx * 0.1, dwy * 0.1) *
      num *
      0.5;
    let num2 = baseHeight;
    num2 += num * 0.1;
    const num4 = num2 - 0.15;
    const num5 = clamp01(baseHeight / 0.4);
    if (num4 > 0.0) num2 -= num4 * (1.0 - num5) * 0.75;

    num2 = this.addRivers(wx, wy, f32(num2));
    num2 += perlinNoise(dwx * 0.1, dwy * 0.1) * 0.01;
    return f32(num2 + perlinNoise(dwx * 0.4, dwy * 0.4) * 0.003);
  }

  /** C++ float IGeoManager::GetForestHeight(wx, wy) (also Mistlands-pregen) */
  private getForestHeight(wx: number, wy: number): number {
    let num = this.getBaseHeight(wx, wy);
    const dwx = wx + 100000.0 + this.offset3;
    const dwy = wy + 100000.0 + this.offset3;
    let num2 =
      perlinNoise(dwx * 0.01, dwy * 0.01) * perlinNoise(dwx * 0.02, dwy * 0.02);
    num2 +=
      perlinNoise(dwx * 0.05, dwy * 0.05) *
      perlinNoise(dwx * 0.1, dwy * 0.1) *
      num2 *
      0.5;
    num += num2 * 0.1;
    num = this.addRivers(wx, wy, f32(num));
    num += perlinNoise(dwx * 0.1, dwy * 0.1) * 0.01;
    return f32(num + perlinNoise(dwx * 0.4, dwy * 0.4) * 0.003);
  }

  /**
   * C++ float IGeoManager::GetMistlandsHeight(wx, wy, mask) — terraced.
   * Returns { height, mask } (C++ out-param).
   */
  private getMistlandsHeight(wx: number, wy: number): { height: number; mask: number } {
    let num = this.getBaseHeight(wx, wy);
    const dwx = wx + 100000.0 + this.offset3;
    const dwy = wy + 100000.0 + this.offset3;
    let num2 =
      perlinNoise(dwx * 0.02 * 0.7, dwy * 0.02 * 0.7) *
      perlinNoise(dwx * 0.04 * 0.7, dwy * 0.04 * 0.7);
    num2 +=
      perlinNoise(dwx * 0.03 * 0.7, dwy * 0.03 * 0.7) *
      perlinNoise(dwx * 0.05 * 0.7, dwy * 0.05 * 0.7) *
      num2 *
      0.5;
    num2 = num2 > 0 ? Math.pow(num2, 1.5) : num2;
    num += num2 * 0.4;
    num = this.addRivers(wx, wy, f32(num));
    const num3 = clamp01(num2 * 7.0);
    num += perlinNoise(dwx * 0.1, dwy * 0.1) * 0.03 * num3;
    num += perlinNoise(dwx * 0.4, dwy * 0.4) * 0.01 * num3;
    let num4 = 1.0 - num3 * 1.2;
    num4 -= 1.0 - lerpStep(0.1, 0.3, num3);
    const a = num + perlinNoise(dwx * 0.4, dwy * 0.4) * 0.002;
    let num5 = num;
    num5 *= 400.0;
    num5 = Math.ceil(num5);
    num5 /= 400.0;
    num = lerp(a, num5, num3);
    return { height: f32(num), mask: f32(num4) };
  }

  /** C++ float IGeoManager::GetPlainsHeight(wx, wy) (= Meadows formula) */
  private getPlainsHeight(wx: number, wy: number): number {
    const baseHeight = this.getBaseHeight(wx, wy);
    const dwx = wx + 100000.0 + this.offset3;
    const dwy = wy + 100000.0 + this.offset3;
    let num =
      perlinNoise(dwx * 0.01, dwy * 0.01) * perlinNoise(dwx * 0.02, dwy * 0.02);
    num +=
      perlinNoise(dwx * 0.05, dwy * 0.05) *
      perlinNoise(dwx * 0.1, dwy * 0.1) *
      num *
      0.5;
    let num2 = baseHeight;
    num2 += num * 0.1;
    const num4 = num2 - 0.15;
    const num5 = clamp01(baseHeight / 0.4);
    if (num4 > 0.0) num2 -= num4 * (1.0 - num5) * 0.75;

    num2 = this.addRivers(wx, wy, f32(num2));
    num2 += perlinNoise(dwx * 0.1, dwy * 0.1) * 0.01;
    return f32(num2 + perlinNoise(dwx * 0.4, dwy * 0.4) * 0.003);
  }

  /**
   * C++ float IGeoManager::GetAshlandsHeight(wx, wy, mask, cheap) —
   * LEGACY branch only (worldAshlandsModernNoise=false). The modern
   * FastNoise path (ASHLANDS_2.0) is Phase B5 and throws below.
   * NOTE: the legacy branch was NOT converted to double by HEIGHTFIX-02 —
   * it computes in float32, reproduced here.
   */
  private getAshlandsHeightLegacy(wx: number, wy: number): { height: number; mask: number } {
    const wx2 = wx;
    const wy2 = wy;
    let num = this.getBaseHeight(wx, wy);
    // wx += 100000.f + m_offset3  (float32 adds)
    wx = f32(wx + f32(100000 + this.offset3));
    wy = f32(wy + f32(100000 + this.offset3));
    // num2 is declared `float` in C++ — the double Perlin product is rounded
    // to float32 at the assignment, and that rounded value feeds the next line.
    let num2 = f32(
      perlinNoise(f32(wx * f32(0.01)), f32(wy * f32(0.01))) *
        perlinNoise(f32(wx * f32(0.02)), f32(wy * f32(0.02)))
    );
    num2 = f32(
      num2 +
        perlinNoise(f32(wx * f32(0.05)), f32(wy * f32(0.05))) *
          perlinNoise(f32(wx * f32(0.1)), f32(wy * f32(0.1))) *
          num2 *
          0.5
    );
    num = f32(num + f32(num2 * f32(0.1)));
    num = f32(num + f32(0.1)); // num += 0.1f — float literal!
    // double Perlin * float literal 0.01f/0.003f (promoted), += rounds to f32
    num = f32(num + perlinNoise(f32(wx * f32(0.1)), f32(wy * f32(0.1))) * f32(0.01));
    num = f32(num + perlinNoise(f32(wx * f32(0.4)), f32(wy * f32(0.4))) * f32(0.003));
    return { height: this.addRivers(wx2, wy2, num), mask: 0 };
  }

  /**
   * C++ float IGeoManager::GetAshlandsHeight(wx, wy, mask, cheap) —
   * MODERN branch (worldAshlandsModernNoise=true, ASHLANDS_2.0,
   * GeoManager.cpp:736-825). Double-precision intermediates with explicit
   * float32 casts exactly where C++ has them (magnitude args/results,
   * Mathf::Lerp args, MathfLikeSmoothStep internals, Fbm, mask/return).
   * Returns the lava mask (f32 of num19) in `mask`.
   */
  private getAshlandsHeightModern(
    wx: number,
    wy: number,
    cheap = false
  ): { height: number; mask: number } {
    if (!this.fastNoise) {
      // Unreachable (dispatch checks the flag); mirrors the C++ !m_noiseGen
      // guard which falls back to legacy.
      return this.getAshlandsHeightLegacy(wx, wy);
    }

    let num = wx; // double num = wx (float widened)
    let num2 = wy;
    const a = this.getBaseHeight(f32(num), f32(num2));
    const num3 = this.worldAngle(f32(num), f32(num2)) * 100.0;

    // Distance to the Ashlands rim curve — float32 magnitude, double rest
    let value =
      magnitudeF(f32(num), f32(num2 + ASHLANDS_Y_OFFSET - ASHLANDS_Y_OFFSET * 0.3)) -
      (ASHLANDS_MIN_DISTANCE + num3);
    value = Math.abs(value) / 1000.0;
    value = 1.0 - clamp01(value);
    // Client uses DUtils.MathfLikeSmoothStep (NOT SmoothStep)
    value = mathfLikeSmoothStep(0.1, 1.0, value);

    let num4 = Math.abs(num);
    num4 = 1.0 - clamp01(num4 / 7500.0);
    value *= num4;

    let num5 = magnitudeF(f32(num), f32(num2)) - 10150.0;
    num5 = 1.0 - clamp01(num5 / 600.0);

    // (double)(100000.f + m_offset3) — the inner add is float32
    num += f32(100000 + this.offset3);
    num2 += f32(100000 + this.offset3);

    // Cellular noise octaves (ridged ash rock)
    let num6 = 0.0;
    let num7 = 1.0;
    let num8 = 0.33;
    const num9 = cheap ? 2 : 5;
    for (let i = 0; i < num9; i++) {
      const cellNoise = this.fastNoise.getCellular(num * num8, num2 * num8);
      const smoothed = mathfLikeSmoothStep(0.0, 1.0, cellNoise);
      num6 += num7 * smoothed;
      num8 *= 2.0;
      num7 *= 0.5;
    }

    num6 = remap(num6, -1.0, 1.0, 0.0, 1.0);
    const num10 = mathfLerp(f32(value), f32(blendOverlay(value, num6)), 0.5);

    let num11 =
      perlinNoise(f32(num * 0.01), f32(num2 * 0.01)) *
      perlinNoise(f32(num * 0.02), f32(num2 * 0.02));
    num11 +=
      perlinNoise(f32(num * 0.05), f32(num2 * 0.05)) *
      perlinNoise(f32(num * 0.1), f32(num2 * 0.1)) *
      num11 *
      0.5;

    let num12 = mathfLerp(f32(a), f32(0.15), f32(0.75));
    num12 += num10 * 0.5;
    num12 = mathfLerp(
      f32(-1.0),
      f32(num12),
      f32(mathfLikeSmoothStep(0.0, 1.0, num5))
    );

    const num13 = 0.15; // double literal here (unlike the 0.15f above)
    let num14 = 0.0;
    let num15 = 1.0;
    let num16 = 8.0;
    const num17 = cheap ? 2 : 3;

    for (let j = 0; j < num17; j++) {
      num14 += num15 * this.fastNoise.getCellular(num * num16, num2 * num16);
      num16 *= 2.0;
      num15 *= 0.5;
    }

    num14 = remap(num14, -1.0, 1.0, 0.0, 1.0);
    num14 = clamp01(Math.pow(num14, 4.0) * 2.0);

    // SimplexFractal noise (large-scale variation)
    let simplexFractal = this.fastNoise.getSimplexFractal(num * 0.075, num2 * 0.075);
    simplexFractal = remap(simplexFractal, -1.0, 1.0, 0.0, 1.0);
    simplexFractal = Math.pow(simplexFractal, 1.4);
    num12 *= simplexFractal;

    // Lava mask base (fbm is the float32 VUtils::Math::Fbm)
    let num18 = fbm(f32(num * 0.01), f32(num2 * 0.01), 3, 2.0, 0.5);
    num18 *= clamp01(remap(value, 0.0, 0.5, 0.5, 1.0));
    num18 = lerpStep(0.7, 1.0, num18);
    num18 = Math.pow(num18, 2.0);

    let num19 = blendOverlay(num18, num14);
    num19 *= clamp01((num12 - num13 - 0.02) / 0.01);

    let x = perlinNoise(f32(num * 0.05 + 5124.0), f32(num2 * 0.05 + 5000.0));
    x = Math.pow(x, 2.0);
    x = remap(x, 0.0, 1.0, 0.01, 0.055);

    const b = Math.min(Math.max(num12 - x, num13 + 0.01), 5000.0); // std::clamp
    num12 = mathfLerp(f32(num12), f32(b), f32(num19));

    return { height: f32(num12), mask: f32(num19) };
  }

  /** C++ float IGeoManager::GetSnowMountainHeight(wx, wy) */
  private getSnowMountainHeight(wx: number, wy: number): number {
    let num = this.getBaseHeight(wx, wy);
    const num2 = this.baseHeightTilt(wx, wy);
    const dwx = wx + 100000.0 + this.offset3;
    const dwy = wy + 100000.0 + this.offset3;
    const num3 = num - 0.4;
    num += num3;
    let num4 =
      perlinNoise(dwx * 0.01, dwy * 0.01) * perlinNoise(dwx * 0.02, dwy * 0.02);
    num4 +=
      perlinNoise(dwx * 0.05, dwy * 0.05) *
      perlinNoise(dwx * 0.1, dwy * 0.1) *
      num4 *
      0.5;
    num += num4 * 0.2;
    num = this.addRivers(wx, wy, f32(num));
    num += perlinNoise(dwx * 0.1, dwy * 0.1) * 0.01;
    num += perlinNoise(dwx * 0.4, dwy * 0.4) * 0.003;
    return f32(num + perlinNoise(dwx * 0.2, dwy * 0.2) * 2.0 * num2);
  }

  /** C++ float IGeoManager::GetDeepNorthHeight(wx, wy) */
  private getDeepNorthHeight(wx: number, wy: number): number {
    let num = this.getBaseHeight(wx, wy);
    const dwx = wx + 100000.0 + this.offset3;
    const dwy = wy + 100000.0 + this.offset3;
    const num2 = Math.max(0.0, num - 0.4);
    num += num2;
    let num3 =
      perlinNoise(dwx * 0.01, dwy * 0.01) * perlinNoise(dwx * 0.02, dwy * 0.02);
    num3 +=
      perlinNoise(dwx * 0.05, dwy * 0.05) *
      perlinNoise(dwx * 0.1, dwy * 0.1) *
      num3 *
      0.5;
    num += num3 * 0.2;
    num *= 1.2;
    num = this.addRivers(wx, wy, f32(num));
    num += perlinNoise(dwx * 0.1, dwy * 0.1) * 0.01;
    return f32(num + perlinNoise(dwx * 0.4, dwy * 0.4) * 0.003);
  }

  /** C++ float IGeoManager::GetEdgeHeight(wx, wy) — world rim falloff. */
  getEdgeHeight(wx: number, wy: number): number {
    const magnitude = magnitudeF(wx, wy);
    const num = 10490.0;
    if (magnitude > num) {
      const num2 = lerpStep(num, 10500.0, magnitude);
      return f32(-2.0 * num2);
    }
    const t = lerpStep(10000.0, 10100.0, magnitude);
    let num3 = this.getBaseHeight(wx, wy);
    num3 = lerp(num3, 0.0, t);
    return this.addRivers(wx, wy, f32(num3));
  }

  /** C++ float IGeoManager::GetOceanHeight(wx, wy) */
  private getOceanHeight(wx: number, wy: number): number {
    const h = this.getBaseHeight(wx, wy);
    if (this.settings.riverAffectsOcean) {
      return this.addRivers(wx, wy, h);
    }
    return h;
  }

  // ── Biome classification ────────────────────────────────────────

  /**
   * C++ valhalla::util::Biome IGeoManager::GetBiome(float wx, float wy).
   * The decision order is significant (ashlands rim → ocean → deep north →
   * mountain → swamp → mistlands → plains → black forest → meadows).
   */
  getBiome(wx: number, wy: number): Biome {
    const magnitude = magnitudeF(wx, wy);
    const baseHeight = this.getBaseHeight(wx, wy);
    const num = f32(this.worldAngle(wx, wy) * 100);

    // bottom curve of world are ashlands
    // NOTE: 'ashlandsMinDistance + num' is a FLOAT32 addition in C++
    // (constexpr float constants) — the f32 rounding can flip borderline
    // comparisons, so it is emulated exactly.
    if (magnitudeF(wx, f32(wy + ASHLANDS_Y_OFFSET)) > f32(ASHLANDS_MIN_DISTANCE + num)) {
      return Biome.AshLands;
    }

    if (baseHeight <= f32(0.02)) return Biome.Ocean;

    // top curve of world is deep north
    if (magnitudeF(wx, f32(wy + DEEP_NORTH_Y_OFFSET)) > f32(DEEP_NORTH_MIN_DISTANCE + num)) {
      if (baseHeight > MOUNTAIN_BASE_HEIGHT_MIN) return Biome.Mountain;
      return Biome.DeepNorth;
    }

    if (baseHeight > MOUNTAIN_BASE_HEIGHT_MIN) return Biome.Mountain;

    // Biome-noise ARGUMENTS are computed in float32 in C++ (float exprs
    // promoted to double at the PerlinNoise call)
    if (
      perlinNoise(
        f32(f32(this.offset0 + wx) * MARSH_BIOME_SCALE),
        f32(f32(this.offset0 + wy) * MARSH_BIOME_SCALE)
      ) > MIN_MARSH_NOISE &&
      magnitude > MIN_MARSH_DISTANCE &&
      magnitude < this.maxMarshDistance &&
      baseHeight > MIN_MARSH_HEIGHT &&
      baseHeight < MAX_MARSH_HEIGHT
    ) {
      return Biome.Swamp;
    }

    if (
      perlinNoise(
        f32(f32(this.offset4 + wx) * DARKLAND_BIOME_SCALE),
        f32(f32(this.offset4 + wy) * DARKLAND_BIOME_SCALE)
      ) > this.minDarklandNoise &&
      magnitude > f32(MIN_DARKLAND_DISTANCE + num) &&
      magnitude < MAX_DARKLAND_DISTANCE
    ) {
      return Biome.Mistlands;
    }

    if (
      perlinNoise(
        f32(f32(this.offset1 + wx) * HEATH_BIOME_SCALE),
        f32(f32(this.offset1 + wy) * HEATH_BIOME_SCALE)
      ) > MIN_HEATH_NOISE &&
      magnitude > f32(MIN_HEATH_DISTANCE + num) &&
      magnitude < MAX_HEATH_DISTANCE
    ) {
      return Biome.Plains;
    }

    if (
      perlinNoise(
        f32(f32(this.offset2 + wx) * f32(0.001)),
        f32(f32(this.offset2 + wy) * f32(0.001))
      ) > MIN_DEEP_FOREST_NOISE &&
      magnitude > f32(MIN_DEEP_FOREST_DISTANCE + num) &&
      magnitude < MAX_DEEP_FOREST_DISTANCE
    ) {
      return Biome.BlackForest;
    }

    if (magnitude > f32(MEADOWS_MAX_DISTANCE + num)) return Biome.BlackForest;

    return Biome.Meadows;
  }

  /**
   * C++ valhalla::util::Biome IGeoManager::GetBiomes(x, z).
   *
   * ⚠ C++ QUIRK REPLICATED ON PURPOSE: the C++ code combines the five
   * samples with the LOGICAL operator `||` (not the bitwise `|` of the
   * original Unity code):
   *   return Biome(to_underlying(GetBiome(...)) || to_underlying(...) || ...);
   * `int || int` yields bool, so the result is Biome::None (0) when all
   * corners are None and Biome::Meadows (1) otherwise — NOT a biome mask.
   * Replicated 1:1 so the clone matches the reference server. (Worth
   * reviewing in the C++ code — likely a decompile typo.)
   */
  getBiomes(x: number, z: number): Biome {
    const h = UNITS_PER_ZONE / 2;
    const any =
      this.getBiome(x - h, z - h) !== Biome.None ||
      this.getBiome(x - h, z + h) !== Biome.None ||
      this.getBiome(x + h, z - h) !== Biome.None ||
      this.getBiome(x + h, z + h) !== Biome.None ||
      this.getBiome(x, z) !== Biome.None;
    return any ? Biome.Meadows : Biome.None;
  }

  /**
   * Bitwise OR of the five GetBiome() corner samples — what the ORIGINAL
   * Unity Valheim GetBiomes() returns. Provided for future use (e.g. if the
   * C++ server fixes the `||` typo); the 1:1 port above is the reference.
   */
  getBiomesMask(x: number, z: number): Biome {
    const h = UNITS_PER_ZONE / 2;
    return (
      this.getBiome(x - h, z - h) |
      this.getBiome(x - h, z + h) |
      this.getBiome(x + h, z - h) |
      this.getBiome(x + h, z + h) |
      this.getBiome(x, z)
    );
  }

  /**
   * C++ valhalla::util::BiomeArea IGeoManager::GetBiomeArea(point) —
   * Median when the biome is identical across the 8 surrounding zone
   * centers, Edge otherwise.
   */
  getBiomeArea(x: number, z: number): BiomeArea {
    const biome = this.getBiome(x, z);
    const u = UNITS_PER_ZONE;
    // C++: point - Vector3f(±U, 0, ±U) — note the flipped signs:
    // point - (-U,0,-U) = (x+U, z+U) etc.
    if (
      biome === this.getBiome(x + u, z + u) &&
      biome === this.getBiome(x - u, z + u) &&
      biome === this.getBiome(x - u, z - u) &&
      biome === this.getBiome(x + u, z - u) &&
      biome === this.getBiome(x + u, z) &&
      biome === this.getBiome(x - u, z) &&
      biome === this.getBiome(x, z + u) &&
      biome === this.getBiome(x, z - u)
    ) {
      return BiomeArea.Median;
    }
    return BiomeArea.Edge;
  }

  // ── Height queries (public API) ─────────────────────────────────

  /**
   * C++ float IGeoManager::GetHeight(wx, wy) — final terrain height in
   * meters (biome height × 200).
   */
  getHeight(wx: number, wy: number): number {
    return this.getHeightWithMask(wx, wy).height;
  }

  /**
   * C++ float IGeoManager::GetHeight(wx, wy, float &mask).
   * mask is only meaningful for Mistlands/AshLands (0 otherwise; C++ leaves
   * it unset for other biomes, callers pass a dummy).
   */
  getHeightWithMask(wx: number, wy: number): { height: number; mask: number } {
    const biome = this.getBiome(wx, wy);
    return this.getBiomeHeight(biome, wx, wy, false);
  }

  /**
   * C++ float IGeoManager::GetGenerationHeight(wx, wy) — used during
   * river/stream generation: preGeneration=true (legacy Ashlands height,
   * forest height for Mistlands, mask=0).
   */
  getGenerationHeight(wx: number, wy: number): number {
    const biome = this.getBiome(wx, wy);
    return this.getBiomeHeight(biome, wx, wy, true).height;
  }

  /**
   * C++ float IGeoManager::GetBiomeHeight(biome, wx, wy, mask, preGeneration).
   * Every case multiplies the 0..0.6-ish biome height by 200 (float32 mul).
   */
  getBiomeHeight(
    biome: Biome,
    wx: number,
    wy: number,
    preGeneration = false
  ): { height: number; mask: number } {
    switch (biome) {
      case Biome.Meadows:
        return { height: f32(this.getMeadowsHeight(wx, wy) * HEIGHT_SCALE), mask: 0 };
      case Biome.Swamp:
        return { height: f32(this.getMarshHeight(wx, wy) * HEIGHT_SCALE), mask: 0 };
      case Biome.Mountain:
        return { height: f32(this.getSnowMountainHeight(wx, wy) * HEIGHT_SCALE), mask: 0 };
      case Biome.BlackForest:
        return { height: f32(this.getForestHeight(wx, wy) * HEIGHT_SCALE), mask: 0 };
      case Biome.Plains:
        return { height: f32(this.getPlainsHeight(wx, wy) * HEIGHT_SCALE), mask: 0 };
      case Biome.AshLands:
        if (preGeneration) {
          // ASHLANDS_2.0 pregen: legacy height WITH AddRivers, double
          // intermediates (HEIGHTFIX-02), matches client
          // GetAshlandsHeightPregenerate.
          let num = this.getBaseHeight(wx, wy);
          const dwx = wx + 100000.0 + this.offset3;
          const dwy = wy + 100000.0 + this.offset3;
          let num2 =
            perlinNoise(dwx * 0.01, dwy * 0.01) *
            perlinNoise(dwx * 0.02, dwy * 0.02);
          num2 +=
            perlinNoise(dwx * 0.05, dwy * 0.05) *
            perlinNoise(dwx * 0.1, dwy * 0.1) *
            num2 *
            0.5;
          num += num2 * 0.1;
          num += 0.1;
          num += perlinNoise(dwx * 0.1, dwy * 0.1) * 0.01;
          num += perlinNoise(dwx * 0.4, dwy * 0.4) * 0.003;
          return { height: f32(this.addRivers(wx, wy, f32(num)) * HEIGHT_SCALE), mask: 0 };
        }
        if (this.settings.ashlandsModernNoise) {
          // ASHLANDS_2.0 (Phase B5): FastNoise modern height + lava mask
          const ash = this.getAshlandsHeightModern(wx, wy);
          return { height: f32(ash.height * HEIGHT_SCALE), mask: ash.mask };
        }
        return {
          height: f32(this.getAshlandsHeightLegacy(wx, wy).height * HEIGHT_SCALE),
          mask: 0,
        };
      case Biome.DeepNorth:
        return { height: f32(this.getDeepNorthHeight(wx, wy) * HEIGHT_SCALE), mask: 0 };
      case Biome.Ocean:
        return { height: f32(this.getOceanHeight(wx, wy) * HEIGHT_SCALE), mask: 0 };
      case Biome.Mistlands: {
        if (preGeneration) {
          return { height: f32(this.getForestHeight(wx, wy) * HEIGHT_SCALE), mask: 0 };
        }
        const mist = this.getMistlandsHeight(wx, wy);
        return { height: f32(mist.height * HEIGHT_SCALE), mask: mist.mask };
      }
      default:
        return { height: 0, mask: 0 };
    }
  }

  // ── Forest factor ───────────────────────────────────────────────

  /**
   * C++ float IGeoManager::GetForestFactor(pos):
   *   float d = 0.4f;
   *   return Fbm(pos * 0.01f * d, 3, 1.6f, 0.7f);
   * (Vector3f scaled by 0.01f then by d — float32 per component; Fbm uses
   * x and z.)
   */
  getForestFactor(x: number, z: number): number {
    const d = f32(0.4);
    return fbm(f32(f32(x * f32(0.01)) * d), f32(f32(z * f32(0.01)) * d), 3, f32(1.6), f32(0.7));
  }

  /**
   * C++ bool IGeoManager::InForest(pos): GetForestFactor(pos) < 1.15f —
   * compared against the FLOAT literal (differs from double 1.15 when the
   * factor equals 1.15f exactly).
   */
  inForest(x: number, z: number): boolean {
    return this.getForestFactor(x, z) < f32(1.15);
  }

  // ── Terrain delta (building support) ────────────────────────────

  /**
   * C++ void IGeoManager::GetTerrainDelta(state, center, radius, delta,
   * slopeDirection) — samples 10 random points in the circle, returns the
   * height spread and the downhill direction.
   *
   * ⚠ C++ QUIRK REPLICATED: num2 (the MAX tracker) is initialized with
   * std::numeric_limits<float>::min() — the smallest POSITIVE float
   * (1.18e-38), not the most negative one. If all sampled heights are
   * negative (e.g. ocean), num2 never updates and `b` stays at center.
   */
  getTerrainDelta(
    state: XorShiftRandom,
    center: { x: number; z: number },
    radius: number
  ): { delta: number; slopeDirection: { x: number; z: number } } {
    const num = 10;
    let num2 = 1.1754943508222875e-38; // std::numeric_limits<float>::min()
    let num3 = FLT_MAX;
    let b = center;
    let a = center;
    for (let i = 0; i < num; i++) {
      // C++: Vector2f vector = state.inside_unit_circle() * radius;  (f32)
      const v = state.insideUnitCircle();
      const vx = f32(v.x * radius);
      const vy = f32(v.y * radius);
      // C++: Vector3f vector2 = center + Vector3f(vector.x, 0, vector.y); (f32 adds)
      const vector2 = { x: f32(center.x + vx), z: f32(center.z + vy) };
      const height = this.getHeight(vector2.x, vector2.z);
      if (height < num3) {
        num3 = height;
        a = vector2;
      }
      if (height > num2) {
        num2 = height;
        b = vector2;
      }
    }
    const delta = f32(num2 - num3);
    // C++: slopeDirection = (a - b).normal() — Vector3f, but y is always 0,
    // so the 2D normal over (x, z) is identical.
    const dir = v2normal({ x: f32(a.x - b.x), y: f32(a.z - b.z) });
    return { delta, slopeDirection: { x: dir.x, z: dir.y } };
  }
}
