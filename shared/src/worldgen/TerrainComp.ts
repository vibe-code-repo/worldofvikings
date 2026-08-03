/**
 * Player terrain modification — 1:1 port of Unity `TerrainComp` (the delta-based
 * system Valheim uses today, not the legacy object-based `TerrainModifier`).
 *
 * C# reference: assembly_valheim/TerrainComp.cs
 *   LevelTerrain   (:335-360)  RaiseTerrain (:362-417)
 *   SmoothTerrain  (:419-448)  PaintCleared (:450-505)
 *   ApplyToHeightmap (:242-277)
 *
 * Model: the procedural height stays untouched; every edit lives in two delta
 * grids over it. Final height per vertex is
 *
 *     clamp(genHeight + levelDelta + smoothDelta, base − 8, base + 8)
 *
 * which is why Valheim caps digging/raising at ±8 m and why the terrain snaps
 * back to the generated shape once the deltas are cleared.
 *
 * All arithmetic goes through f32 (`Math.fround`), including the C# special
 * cases (`power === 3` uses t*t*t, `power === 1` skips Mathf.Pow) — client and
 * server must produce bit-identical results, otherwise predicted and
 * authoritative terrain drift apart. Same convention as
 * `Heightmap.applyTerrainModifiers`.
 *
 * Unity differences: our `heights` are absolute world Y (Unity subtracts the
 * zone transform, which sits at y=0 anyway), and m_scale is always 1, so
 * `radius / m_scale` collapses to `radius`.
 */

import { E_WIDTH, ZONE_UNITS, type Heightmap } from './Heightmap.js';

const f32 = Math.fround;

/** C# Heightmap.c_LevelMaxDelta — level/raise cap against the generated height. */
export const LEVEL_MAX_DELTA = 8;
/** C# Heightmap.c_SmoothMaxDelta. */
export const SMOOTH_MAX_DELTA = 1;
/** C# Heightmap.AtMaxWorldLevelDepth — no more stone drops below this. */
export const AT_MAX_DEPTH = 7.95;

/**
 * Vertices per zone grid (65 × 65).
 *
 * Written out instead of `E_WIDTH * E_WIDTH` on purpose: Heightmap.ts imports
 * this module and this module imports E_WIDTH back, so evaluating it at module
 * scope would hit the temporal dead zone depending on which side loads first.
 * Inside function bodies E_WIDTH is safe — by then both modules are live.
 */
const GRID = 65 * 65;

/** C# TerrainModifier.PaintType. */
export const enum PaintType {
  Dirt = 0,
  Cultivate = 1,
  Paved = 2,
  Reset = 3,
  ClearVegetation = 4,
}

/**
 * C# TerrainOp.Settings — field order matches Settings.Serialize so the wire
 * format can mirror the original if we ever need it.
 */
export interface TerrainOpSettings {
  levelOffset: number;
  level: boolean;
  levelRadius: number;
  square: boolean;
  raise: boolean;
  raiseRadius: number;
  raisePower: number;
  raiseDelta: number;
  smooth: boolean;
  smoothRadius: number;
  smoothPower: number;
  paintCleared: boolean;
  paintHeightCheck: boolean;
  paintType: PaintType;
  paintRadius: number;
}

/**
 * C# TerrainOp.Settings field defaults. Spread this and override what a tool
 * actually enables, so a new operation never silently inherits a stale radius.
 */
export const TERRAIN_OP_DEFAULTS: TerrainOpSettings = {
  levelOffset: 0,
  level: false,
  levelRadius: 2,
  square: true,
  raise: false,
  raiseRadius: 2,
  raisePower: 0,
  raiseDelta: 0,
  smooth: false,
  smoothRadius: 2,
  smoothPower: 3,
  paintCleared: true,
  paintHeightCheck: false,
  paintType: PaintType.Dirt,
  paintRadius: 2,
};

/** C# TerrainOp.Settings.GetRadius — largest radius of the enabled operations. */
export function opRadius(s: TerrainOpSettings): number {
  let r = 0;
  if (s.level && s.levelRadius > r) r = s.levelRadius;
  if (s.raise && s.raiseRadius > r) r = s.raiseRadius;
  if (s.smooth && s.smoothRadius > r) r = s.smoothRadius;
  if (s.paintCleared && s.paintRadius > r) r = s.paintRadius;
  return r;
}

/** Index bounds touched by one operation, in zone-local vertex coordinates. */
export interface VertexRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * Per-zone edit state. Lives in `HeightmapProvider`, NOT in `Heightmap` — the
 * zone LRU evicts heightmaps freely and must never take edits with it.
 *
 * The typed arrays are allocated lazily: a comp only materializes once an
 * operation actually touches a vertex, so untouched zones cost nothing.
 */
export class TerrainComp {
  readonly zoneX: number;
  readonly zoneY: number;

  /** Bumped per applied operation — the network sync uses it as a sequence. */
  ops = 0;
  lastOpX = 0;
  lastOpY = 0;
  lastOpZ = 0;
  lastOpRadius = 0;

  private _levelDelta: Float32Array | null = null;
  private _smoothDelta: Float32Array | null = null;
  private _modifiedHeight: Uint8Array | null = null;
  /** RGBA8, 65×65. Valheim stores f32 per channel; the 0.1 paint falloff makes
   *  the mask effectively binary, so u8 halves the footprint invisibly. */
  private _paintMask: Uint8Array | null = null;
  private _modifiedPaint: Uint8Array | null = null;

  constructor(zoneX: number, zoneY: number) {
    this.zoneX = zoneX;
    this.zoneY = zoneY;
  }

  get hasHeight(): boolean {
    return this._levelDelta !== null;
  }
  get hasPaint(): boolean {
    return this._paintMask !== null;
  }
  /** True when nothing was ever written — such comps are dropped, not stored. */
  get isEmpty(): boolean {
    return this._levelDelta === null && this._paintMask === null;
  }

  /** Read-only views; null when never touched (callers must handle that). */
  get levelDelta(): Float32Array | null {
    return this._levelDelta;
  }
  get smoothDelta(): Float32Array | null {
    return this._smoothDelta;
  }
  get modifiedHeight(): Uint8Array | null {
    return this._modifiedHeight;
  }
  get paintMask(): Uint8Array | null {
    return this._paintMask;
  }
  get modifiedPaint(): Uint8Array | null {
    return this._modifiedPaint;
  }

  /** Allocates the height delta grids on first write. */
  ensureHeight(): void {
    if (this._levelDelta) return;
    this._levelDelta = new Float32Array(GRID);
    this._smoothDelta = new Float32Array(GRID);
    this._modifiedHeight = new Uint8Array(GRID);
  }

  /** Allocates the paint grids on first write (alpha starts opaque). */
  ensurePaint(): void {
    if (this._paintMask) return;
    this._paintMask = new Uint8Array(GRID * 4);
    for (let i = 3; i < this._paintMask.length; i += 4) this._paintMask[i] = 255;
    this._modifiedPaint = new Uint8Array(GRID);
  }

  /** C# Heightmap.AtMaxWorldLevelDepth — dug out as deep as the game allows. */
  atMaxDepth(index: number): boolean {
    const ld = this._levelDelta;
    return ld !== null && ld[index] <= -AT_MAX_DEPTH;
  }
}

// ── Operations ────────────────────────────────────────────────────────
//
// Every operation reads `hm.heights` — the state BEFORE the whole operation
// sequence. That matches Unity: InternalDoOperation runs Level → Raise →
// Smooth against the unchanged heightmap and only pokes it afterwards, so the
// three steps never see each other's output.

/** f32 Vector2.Distance. */
function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = f32(ax - bx);
  const dy = f32(ay - by);
  return f32(Math.sqrt(f32(f32(dx * dx) + f32(dy * dy))));
}

function clampF(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Unity Mathf.Lerp — f32 with t clamped to [0,1]. */
function mathfLerpF(a: number, b: number, t: number): number {
  const tc = t < 0 ? 0 : t > 1 ? 1 : t;
  return f32(a + f32(f32(b - a) * tc));
}

/**
 * C# TerrainComp.LevelTerrain (:335-360). Flat plateau at `wy`, NO falloff.
 * `square` skips the radial test entirely (Chebyshev box), it does not change
 * the weighting. Folds any pending smooth delta into the level delta.
 */
export function levelTerrain(
  comp: TerrainComp,
  hm: Heightmap,
  wx: number,
  wy: number,
  wz: number,
  radius: number,
  square: boolean
): VertexRect | null {
  const [cx, cy] = hm.worldToVertex(wx, wz);
  const steps = Math.ceil(radius);
  comp.ensureHeight();
  const levelDelta = comp.levelDelta!;
  const smoothDelta = comp.smoothDelta!;
  const modified = comp.modifiedHeight!;
  let touched = false;
  let x0 = E_WIDTH;
  let x1 = -1;
  let y0 = E_WIDTH;
  let y1 = -1;

  for (let i = cy - steps; i <= cy + steps; i++) {
    for (let j = cx - steps; j <= cx + steps; j++) {
      if (!square && dist2(cx, cy, j, i) > radius) continue;
      if (j < 0 || i < 0 || j >= E_WIDTH || i >= E_WIDTH) continue;

      const idx = i * E_WIDTH + j;
      const height = hm.heights[idx];
      let delta = f32(wy - height);
      delta = f32(delta + smoothDelta[idx]);
      smoothDelta[idx] = 0;
      levelDelta[idx] = clampF(f32(levelDelta[idx] + delta), -LEVEL_MAX_DELTA, LEVEL_MAX_DELTA);
      modified[idx] = 1;
      touched = true;
      if (j < x0) x0 = j;
      if (j > x1) x1 = j;
      if (i < y0) y0 = i;
      if (i > y1) y1 = i;
    }
  }
  return touched ? { x0, x1, y0, y1 } : null;
}

/**
 * C# TerrainComp.RaiseTerrain (:362-417). `delta > 0` only raises, `delta < 0`
 * only lowers. With `square` there is NO falloff at all (factor stays 1);
 * otherwise the factor is (1 − d/r)^power, and power 0 also means no falloff.
 */
export function raiseTerrain(
  comp: TerrainComp,
  hm: Heightmap,
  wx: number,
  wy: number,
  wz: number,
  radius: number,
  delta: number,
  square: boolean,
  power: number
): VertexRect | null {
  const [cx, cy] = hm.worldToVertex(wx, wz);
  const steps = Math.ceil(radius);
  comp.ensureHeight();
  const levelDelta = comp.levelDelta!;
  const smoothDelta = comp.smoothDelta!;
  const modified = comp.modifiedHeight!;
  let touched = false;
  let x0 = E_WIDTH;
  let x1 = -1;
  let y0 = E_WIDTH;
  let y1 = -1;

  for (let i = cy - steps; i <= cy + steps; i++) {
    for (let j = cx - steps; j <= cx + steps; j++) {
      if (j < 0 || i < 0 || j >= E_WIDTH || i >= E_WIDTH) continue;

      let factor = 1;
      if (!square) {
        const d = dist2(cx, cy, j, i);
        if (d > radius) continue;
        if (power > 0) {
          factor = f32(d / radius);
          factor = f32(1 - factor);
          if (power !== 1) factor = f32(Math.pow(factor, power));
        }
      }

      const idx = i * E_WIDTH + j;
      const height = hm.heights[idx];
      const rise = f32(delta * factor);
      let target = f32(wy + rise);
      if (delta < 0 && target > height) continue;
      if (delta > 0) {
        if (target < height) continue;
        const cap = f32(height + rise);
        if (target > cap) target = cap;
      }

      const diff = f32(f32(target - height) + smoothDelta[idx]);
      smoothDelta[idx] = 0;
      levelDelta[idx] = clampF(f32(levelDelta[idx] + diff), -LEVEL_MAX_DELTA, LEVEL_MAX_DELTA);
      modified[idx] = 1;
      touched = true;
      if (j < x0) x0 = j;
      if (j > x1) x1 = j;
      if (i < y0) y0 = i;
      if (i > y1) y1 = i;
    }
  }
  return touched ? { x0, x1, y0, y1 } : null;
}

/**
 * C# TerrainComp.SmoothTerrain (:419-448). Blends toward `wy` with
 * t = 1 − (d/r)^power, capped at ±1 m.
 *
 * Note: the original takes a `square` parameter and never reads it — smoothing
 * is always radial. Kept out of the signature rather than silently ignored.
 */
export function smoothTerrain(
  comp: TerrainComp,
  hm: Heightmap,
  wx: number,
  wy: number,
  wz: number,
  radius: number,
  power: number
): VertexRect | null {
  const [cx, cy] = hm.worldToVertex(wx, wz);
  const steps = Math.ceil(radius);
  comp.ensureHeight();
  const smoothDelta = comp.smoothDelta!;
  const modified = comp.modifiedHeight!;
  let touched = false;
  let x0 = E_WIDTH;
  let x1 = -1;
  let y0 = E_WIDTH;
  let y1 = -1;

  for (let i = cy - steps; i <= cy + steps; i++) {
    for (let j = cx - steps; j <= cx + steps; j++) {
      const d = dist2(cx, cy, j, i);
      if (d > radius) continue;
      if (j < 0 || i < 0 || j >= E_WIDTH || i >= E_WIDTH) continue;

      let n = f32(d / radius);
      n = power !== 3 ? f32(Math.pow(n, power)) : f32(f32(n * n) * n);
      const idx = i * E_WIDTH + j;
      const height = hm.heights[idx];
      const t = f32(1 - n);
      const diff = f32(mathfLerpF(height, wy, t) - height);
      smoothDelta[idx] = clampF(
        f32(smoothDelta[idx] + diff),
        -SMOOTH_MAX_DELTA,
        SMOOTH_MAX_DELTA
      );
      modified[idx] = 1;
      touched = true;
      if (j < x0) x0 = j;
      if (j > x1) x1 = j;
      if (i < y0) y0 = i;
      if (i > y1) y1 = i;
    }
  }
  return touched ? { x0, x1, y0, y1 } : null;
}

/**
 * C# TerrainComp.PaintCleared (:453-495). Blends the paint mask toward the
 * target colour with
 *
 *     f = (1 - clamp01(d / r))^0.1
 *
 * That exponent is what gives Valheim its hard-edged paths: at d/r = 0.9 it is
 * still ≈ 0.79, so the mask is effectively binary and only the very rim fades.
 *
 * Notes on faithfulness:
 *  - The original has NO radius test; texels outside simply get f = 0 and keep
 *    their colour. We skip them instead of writing them back unchanged — same
 *    result, but their modified flag stays clear, which keeps the save and
 *    network payload down (the original marks the whole ceil(radius) box).
 *  - Alpha is always restored. It carries the Mistlands/Ashlands vegetation
 *    mask, not paint, and must never be touched here.
 *  - The half-texel offset on x/z is the original's: mask texels sit between
 *    the height vertices.
 */
export function paintCleared(
  comp: TerrainComp,
  hm: Heightmap,
  wx: number,
  wy: number,
  wz: number,
  radius: number,
  type: PaintType,
  heightCheck: boolean
): VertexRect | null {
  if (type === PaintType.ClearVegetation) return null; // not used by TerrainComp

  const [cx, cy] = hm.worldToVertex(wx - 0.5, wz - 0.5);
  const steps = Math.ceil(radius);
  comp.ensurePaint();
  const mask = comp.paintMask!;
  const modified = comp.modifiedPaint!;

  // Target colour per paint type (C# Heightmap.m_paintMask* constants).
  let tr = 0;
  let tg = 0;
  let tb = 0;
  if (type === PaintType.Dirt) tr = 255;
  else if (type === PaintType.Cultivate) tg = 255;
  else if (type === PaintType.Paved) tb = 255;
  // Reset stays (0,0,0) — the biome blend shows through again.

  let touched = false;
  let x0 = E_WIDTH;
  let x1 = -1;
  let y0 = E_WIDTH;
  let y1 = -1;

  for (let i = cy - steps; i <= cy + steps; i++) {
    for (let j = cx - steps; j <= cx + steps; j++) {
      if (j < 0 || i < 0 || j >= E_WIDTH || i >= E_WIDTH) continue;
      const idx = i * E_WIDTH + j;
      // heightCheck: skip vertices standing above the aim point, so painting a
      // path does not climb the wall next to it.
      if (heightCheck && hm.heights[idx] > wy) continue;

      const d = dist2(cx, cy, j, i);
      const t = f32(d / radius);
      let f = f32(1 - (t < 0 ? 0 : t > 1 ? 1 : t));
      if (f <= 0) continue;
      f = f32(Math.pow(f, 0.1));

      const o = idx * 4;
      const r = mask[o];
      const g = mask[o + 1];
      const b = mask[o + 2];
      const nr = Math.round(r + (tr - r) * f);
      const ng = Math.round(g + (tg - g) * f);
      const nb = Math.round(b + (tb - b) * f);
      if (nr === r && ng === g && nb === b) continue;

      mask[o] = nr;
      mask[o + 1] = ng;
      mask[o + 2] = nb;
      // mask[o + 3] (alpha) deliberately untouched.
      modified[idx] = 1;
      touched = true;
      if (j < x0) x0 = j;
      if (j > x1) x1 = j;
      if (i < y0) y0 = i;
      if (i > y1) y1 = i;
    }
  }
  return touched ? { x0, x1, y0, y1 } : null;
}

/** Grows `into` to also cover `add`. */
function unionRect(into: VertexRect | null, add: VertexRect | null): VertexRect | null {
  if (!add) return into;
  if (!into) return { ...add };
  if (add.x0 < into.x0) into.x0 = add.x0;
  if (add.x1 > into.x1) into.x1 = add.x1;
  if (add.y0 < into.y0) into.y0 = add.y0;
  if (add.y1 > into.y1) into.y1 = add.y1;
  return into;
}

/** What one operation touched. Both may be null when it missed the zone. */
export interface OperationResult {
  /** Vertices whose height changed — the chunk mesh needs these refreshed. */
  height: VertexRect | null;
  /** Texels whose paint changed — only the mask texture needs re-uploading. */
  paint: VertexRect | null;
}

/**
 * C# TerrainComp.InternalDoOperation (:279-333) — Level → Raise → Smooth →
 * Paint, in exactly that order.
 *
 * Height and paint rects are reported separately: painting a path changes no
 * heights, and rebuilding the mesh for it would be wasted work.
 */
export function applyOperation(
  comp: TerrainComp,
  hm: Heightmap,
  wx: number,
  wy: number,
  wz: number,
  s: TerrainOpSettings
): OperationResult {
  let rect: VertexRect | null = null;
  let paintRect: VertexRect | null = null;

  if (s.level) {
    rect = unionRect(rect, levelTerrain(comp, hm, wx, f32(wy + s.levelOffset), wz, s.levelRadius, s.square));
  }
  if (s.raise) {
    rect = unionRect(
      rect,
      raiseTerrain(comp, hm, wx, wy, wz, s.raiseRadius, s.raiseDelta, s.square, s.raisePower)
    );
  }
  if (s.smooth) {
    rect = unionRect(
      rect,
      smoothTerrain(comp, hm, wx, f32(wy + s.levelOffset), wz, s.smoothRadius, s.smoothPower)
    );
  }
  if (s.paintCleared) {
    // Paint returns a mask rect, not a height rect — tracked separately so
    // applyTerrainComp() does not needlessly recompute heights for it.
    paintRect = paintCleared(comp, hm, wx, wy, wz, s.paintRadius, s.paintType, s.paintHeightCheck);
  }

  if (rect || paintRect) {
    comp.ops++;
    comp.lastOpX = wx;
    comp.lastOpY = wy;
    comp.lastOpZ = wz;
    comp.lastOpRadius = opRadius(s);
  }
  return { height: rect, paint: paintRect };
}

/** Zone-local vertex (rx, ry) → world X/Z. Mirrors Heightmap.vertexWorldX/Z. */
export function vertexWorld(comp: TerrainComp, rx: number, ry: number): [number, number] {
  return [
    comp.zoneX * ZONE_UNITS - ZONE_UNITS / 2 + rx,
    comp.zoneY * ZONE_UNITS - ZONE_UNITS / 2 + ry,
  ];
}
