/**
 * Phase D1/D2 — per-zone heightmap, 1:1 port of the C++ server terrain grid.
 *
 * C++ reference:
 *   IHeightmapBuilder::Build   (HeightmapBuilder.cpp:146-239) — 65×65 vertex
 *     grid per 64m zone, corner-biome blending with SmoothStep (server.yml
 *     experimental-biome-blend-smoothstep=true) or linear t, HEIGHTFIX-02
 *     double-precision intermediates, f32 store, vegMask (Mistlands mask).
 *   Heightmap::GetWorldHeight  (Heightmap.cpp:514-577) — nearest-vertex when
 *     experimental-bilinear-height-sampling=false (our server.yml), else
 *     triangle-barycentric interpolation (HEIGHTFIX-01/02).
 *   Heightmap::GetWorldHeightRaycast (Heightmap.cpp:598-697) — Möller-Trumbore
 *     for exact Unity Physics.Raycast parity (vegetation placement).
 *   IZoneManager::WorldToZonePos / ZoneToWorldPos (ZoneManager.cpp:1472-1485),
 *   Heightmap::WorldToVertex (Heightmap.cpp:960-965).
 *
 * Zone vertex (rx, ry) maps to world (zoneX*64-32+rx, zoneY*64-32+ry);
 * neighboring zones share their edge vertices (E_WIDTH = UNITS+1 overlap),
 * so there are no seams.
 */

import { GeoManager } from './GeoManager.js';
import { Biome, BiomeArea } from '../types.js';
import type { Vector3 } from '../types.js';
import { crossF, normalF } from './Math3d.js';
import { TerrainComp, applyOperation, opRadius } from './TerrainComp.js';
import type { TerrainOpSettings, VertexRect } from './TerrainComp.js';

const f32 = Math.fround;

/** C++ IZoneManager::UNITS_PER_ZONE */
export const ZONE_UNITS = 64;
/** C++ Heightmap::E_WIDTH */
export const E_WIDTH = ZONE_UNITS + 1;
/** C++ IZoneManager::WATER_LEVEL */
export const WATER_LEVEL = 30;

export interface HeightmapSettings {
  /** server.yml experimental-biome-blend-smoothstep (default true). */
  blendSmoothStep?: boolean;
  /** server.yml experimental-bilinear-height-sampling (default false). */
  bilinearSampling?: boolean;
}

/**
 * Terrain leveling modifier (Unity TerrainModifier::LevelTerrain, Phase F4).
 * The C++ reference server does NOT level terrain under locations (its
 * TerrainModifier.cpp only feeds ClearArea params) — in original Valheim the
 * leveling is a Unity client behavior. We bake it into `Heightmap.heights`
 * on BOTH server (ground truth) and client (rendering) with identical math,
 * so locations sit on a flat plateau instead of floating on slopes.
 * Parameters come from terrain_modifiers.yml / the clearArea rule
 * (shared/locationConfig.ts getTerrainLeveling).
 */
export interface TerrainLeveling {
  /** World X of the modifier origin (location center). */
  readonly x: number;
  /** World Z of the modifier origin (location center). */
  readonly z: number;
  /** Plateau height: booked origin y + levelOffset (f32). */
  readonly targetHeight: number;
  /** Fully leveled radius (Unity m_levelRadius). */
  readonly levelRadius: number;
  /** Blend band width outside levelRadius (Unity m_smoothRadius). */
  readonly smoothRadius: number;
  /** Blend curve exponent (Unity m_smoothPower). */
  readonly smoothPower: number;
  /** Square (Chebyshev) instead of radial distance (Unity m_levelSquare). */
  readonly square: boolean;
}

/** C++ VUtils::Math::SmoothStep(double, double, double) — plain double math. */
function smoothStepD(pMin: number, pMax: number, pX: number): number {
  const num = Math.min(1, Math.max(0, (pX - pMin) / (pMax - pMin)));
  return num * num * (3 - 2 * num);
}

/** C++ VUtils::Math::Lerp(double, double, double) = a + (b - a) * t. */
function lerpD(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * C++ Heightmap (one 64×64 m zone). Holds the built grid; player digging
 * remains out of scope. Location terrain leveling (Phase F4, Unity
 * TerrainModifier parity) is baked at build into `heights`; `baseHeights`
 * stays pristine (D1 golden tests, oceanDepth — C++ m_baseHeights).
 */
export class Heightmap {
  readonly zoneX: number;
  readonly zoneY: number;
  /** C++ m_cornerBiomes[4]: (x,z), (x+64,z), (x,z+64), (x+64,z+64). */
  cornerBiomes!: [Biome, Biome, Biome, Biome]; // assigned in build()
  /** C++ m_baseHeights — 65×65, row-major [ry * 65 + rx], f32, UNMODIFIED. */
  readonly baseHeights = new Float32Array(E_WIDTH * E_WIDTH);
  /**
   * Final heights = baseHeights + baked terrain leveling (F4). All height
   * queries read this array. Identical to baseHeights when no modifier
   * touches the zone.
   */
  readonly heights = new Float32Array(E_WIDTH * E_WIDTH);
  /** C++ m_vegMask (Mistlands mask) — 64×64, row-major, f32. */
  readonly vegMask = new Float32Array(ZONE_UNITS * ZONE_UNITS);
  /**
   * C++ m_oceanDepth[4] (Heightmap::Regenerate, Heightmap.cpp:87-92):
   * max(0, WATER_LEVEL − corner vertex height), corners
   * [0]=(0,64) [1]=(64,64) [2]=(64,0) [3]=(0,0) in local vertex coords.
   */
  readonly oceanDepth = new Float32Array(4);
  /**
   * Snapshot of `heights` before any player edit (= base + baked location
   * leveling). Allocated lazily on the first applyTerrainComp() call, so zones
   * nobody ever digs cost nothing extra.
   */
  private genHeights: Float32Array | null = null;

  constructor(
    geo: GeoManager,
    zoneX: number,
    zoneY: number,
    settings: HeightmapSettings = {},
    /** F4: terrain leveling modifiers overlapping this zone (baked into heights). */
    mods?: readonly TerrainLeveling[]
  ) {
    this.zoneX = zoneX;
    this.zoneY = zoneY;
    this.build(geo, settings.blendSmoothStep ?? true);

    // C++ Regenerate corner depths — from PRISTINE baseHeights (C++ parity:
    // the C++ server never levels, so its m_baseHeights drives this too)
    this.oceanDepth[0] = Math.max(0, WATER_LEVEL - this.baseHeights[64 * E_WIDTH + 0]);
    this.oceanDepth[1] = Math.max(0, WATER_LEVEL - this.baseHeights[64 * E_WIDTH + 64]);
    this.oceanDepth[2] = Math.max(0, WATER_LEVEL - this.baseHeights[0 * E_WIDTH + 64]);
    this.oceanDepth[3] = Math.max(0, WATER_LEVEL - this.baseHeights[0]);

    // F4: final heights = base + baked leveling (Unity TerrainModifier)
    this.heights.set(this.baseHeights);
    if (mods && mods.length > 0) this.applyTerrainModifiers(mods);
  }

  /** World position of vertex (rx, ry) — C++ baseWorldPos + (rx, ry). */
  vertexWorldX(rx: number): number {
    return this.zoneX * ZONE_UNITS - ZONE_UNITS / 2 + rx;
  }
  vertexWorldZ(ry: number): number {
    return this.zoneY * ZONE_UNITS - ZONE_UNITS / 2 + ry;
  }

  /** C++ IHeightmapBuilder::Build (HeightmapBuilder.cpp:146-239). */
  private build(geo: GeoManager, blendSmoothStep: boolean): void {
    // C++ baseWorldPos = ZoneToWorldPos(zone) + (-32, 0, -32)
    const baseX = this.zoneX * ZONE_UNITS - ZONE_UNITS / 2;
    const baseZ = this.zoneY * ZONE_UNITS - ZONE_UNITS / 2;

    const b1 = geo.getBiome(baseX, baseZ);
    const b2 = geo.getBiome(baseX + ZONE_UNITS, baseZ);
    const b3 = geo.getBiome(baseX, baseZ + ZONE_UNITS);
    const b4 = geo.getBiome(baseX + ZONE_UNITS, baseZ + ZONE_UNITS);
    this.cornerBiomes = [b1, b2, b3, b4];

    const sameBiome = b1 === b2 && b1 === b3 && b1 === b4;

    for (let ry = 0; ry < E_WIDTH; ry++) {
      // [HEIGHTFIX-02] double intermediates
      const worldY = baseZ + ry;
      const ty = blendSmoothStep ? smoothStepD(0, 1, ry / ZONE_UNITS) : ry / ZONE_UNITS;

      for (let rx = 0; rx < E_WIDTH; rx++) {
        const worldX = baseX + rx;
        const tx = blendSmoothStep ? smoothStepD(0, 1, rx / ZONE_UNITS) : rx / ZONE_UNITS;

        let mistlandsMask = 0;
        let height: number;

        if (sameBiome) {
          // slight optimization case (C++ line 194-198)
          const r = geo.getBiomeHeight(b1, worldX, worldY, false);
          height = r.height;
          mistlandsMask = r.mask;
        } else {
          const r1 = geo.getBiomeHeight(b1, worldX, worldY, false);
          const r2 = geo.getBiomeHeight(b2, worldX, worldY, false);
          const r3 = geo.getBiomeHeight(b3, worldX, worldY, false);
          const r4 = geo.getBiomeHeight(b4, worldX, worldY, false);

          // this does nothing if no biomes are mistlands
          const c1 = lerpD(r1.mask, r2.mask, tx);
          const c2 = lerpD(r3.mask, r4.mask, tx);
          mistlandsMask = lerpD(c1, c2, ty);

          // double precision biome height blending
          const h1 = lerpD(r1.height, r2.height, tx);
          const h2 = lerpD(r3.height, r4.height, tx);
          height = lerpD(h1, h2, ty);
        }

        this.baseHeights[ry * E_WIDTH + rx] = f32(height);
        if (rx < ZONE_UNITS && ry < ZONE_UNITS) {
          this.vegMask[ry * ZONE_UNITS + rx] = f32(mistlandsMask);
        }
      }
    }
  }

  // ── Terrain leveling (Phase F4) ─────────────────────────────────

  /**
   * Unity TerrainModifier::LevelTerrain, baked into `heights` (f32 math):
   * inside levelRadius the terrain is set to targetHeight; in the band
   * [levelRadius, levelRadius+smoothRadius) it blends with
   * t = clamp01((dist−levelRadius)/smoothRadius)^smoothPower and
   * h = lerp(target, h, t). Modifiers apply sequentially in registration
   * order (later ones see already-leveled heights — Unity behavior when
   * two modifiers overlap).
   */
  private applyTerrainModifiers(mods: readonly TerrainLeveling[]): void {
    const baseX = this.zoneX * ZONE_UNITS - ZONE_UNITS / 2;
    const baseZ = this.zoneY * ZONE_UNITS - ZONE_UNITS / 2;
    for (const mod of mods) {
      const reach = mod.levelRadius + mod.smoothRadius;
      const rx0 = Math.max(0, Math.ceil(mod.x - reach - baseX));
      const rx1 = Math.min(E_WIDTH - 1, Math.floor(mod.x + reach - baseX));
      const ry0 = Math.max(0, Math.ceil(mod.z - reach - baseZ));
      const ry1 = Math.min(E_WIDTH - 1, Math.floor(mod.z + reach - baseZ));
      for (let ry = ry0; ry <= ry1; ry++) {
        const dz = f32(baseZ + ry - mod.z);
        for (let rx = rx0; rx <= rx1; rx++) {
          const dx = f32(baseX + rx - mod.x);
          const dist = mod.square
            ? Math.max(Math.abs(dx), Math.abs(dz))
            : f32(Math.sqrt(f32(f32(dx * dx) + f32(dz * dz))));
          const i = ry * E_WIDTH + rx;
          if (dist <= mod.levelRadius) {
            this.heights[i] = mod.targetHeight;
            continue;
          }
          const delta = f32(dist - mod.levelRadius);
          if (delta >= mod.smoothRadius) continue;
          let t = f32(delta / mod.smoothRadius);
          t = f32(Math.pow(t, mod.smoothPower));
          this.heights[i] = f32(mod.targetHeight + f32(f32(this.heights[i] - mod.targetHeight) * t));
        }
      }
    }
  }

  // ── Player terrain modification ─────────────────────────────────

  /**
   * C# TerrainComp.ApplyToHeightmap (:242-277) — folds the player edit deltas
   * into `heights`:
   *
   *   heights[i] = clamp(genHeights[i] + levelDelta[i] + smoothDelta[i],
   *                      baseHeights[i] − 8, baseHeights[i] + 8)
   *
   * `baseHeights` is never written, which keeps the D1 golden tests and
   * oceanDepth on the pristine generated terrain.
   *
   * Pass `rect` to refresh only the vertices an operation touched; without it
   * the whole 65×65 grid is recomputed (used when a zone is rebuilt or a full
   * snapshot arrives from the server).
   */
  applyTerrainComp(comp: TerrainComp, rect?: VertexRect): void {
    const levelDelta = comp.levelDelta;
    const smoothDelta = comp.smoothDelta;
    if (!levelDelta || !smoothDelta) return;

    // First edit on this zone: remember the generated shape so later edits
    // stay relative to it instead of accumulating on their own output.
    if (!this.genHeights) this.genHeights = new Float32Array(this.heights);
    const gen = this.genHeights;

    const x0 = rect ? Math.max(0, rect.x0) : 0;
    const x1 = rect ? Math.min(E_WIDTH - 1, rect.x1) : E_WIDTH - 1;
    const y0 = rect ? Math.max(0, rect.y0) : 0;
    const y1 = rect ? Math.min(E_WIDTH - 1, rect.y1) : E_WIDTH - 1;

    for (let ry = y0; ry <= y1; ry++) {
      for (let rx = x0; rx <= x1; rx++) {
        const i = ry * E_WIDTH + rx;
        const ld = levelDelta[i];
        const sd = smoothDelta[i];
        if (ld === 0 && sd === 0) {
          this.heights[i] = gen[i];
          continue;
        }
        const b = this.baseHeights[i];
        const v = f32(f32(gen[i] + ld) + sd);
        this.heights[i] = Math.min(f32(b + 8), Math.max(f32(b - 8), v));
      }
    }
  }

  // ── Vegetation helpers (Phase E) ────────────────────────────────

  /** C++ Heightmap::WorldToVertex (Heightmap.cpp:960-965). */
  worldToVertex(wx: number, wz: number): [number, number] {
    return [
      Math.floor(wx - this.zoneX * ZONE_UNITS + 0.5) + ZONE_UNITS / 2,
      Math.floor(wz - this.zoneY * ZONE_UNITS + 0.5) + ZONE_UNITS / 2,
    ];
  }

  /** C++ Heightmap::HaveBiome (Heightmap.cpp:161-167) — corner bit check. */
  haveBiome(biome: Biome): boolean {
    return (
      (this.cornerBiomes[0] & biome) !== 0 ||
      (this.cornerBiomes[1] & biome) !== 0 ||
      (this.cornerBiomes[2] & biome) !== 0 ||
      (this.cornerBiomes[3] & biome) !== 0
    );
  }

  /** C++ Heightmap::IsBiomeEdge / GetBiomeArea (Heightmap.cpp:222-236). */
  getBiomeArea(): BiomeArea {
    const b = this.cornerBiomes;
    return b[0] !== b[1] || b[0] !== b[2] || b[0] !== b[3] ? BiomeArea.Edge : BiomeArea.Median;
  }

  /**
   * C++ Heightmap::GetBiome (Heightmap.cpp:183-219) — zone-local weighted
   * corner-biome blend (NOT the GeoManager world biome): each corner votes
   * with (sqrt(2) − dist)³, highest weight wins. All float32.
   */
  getBiome(wx: number, wz: number): Biome {
    const b = this.cornerBiomes;
    if (b[0] === b[1] && b[0] === b[2] && b[0] === b[3]) return b[0];

    // WorldToNormalizedHM (f32)
    const x = f32(f32((wx - this.zoneX * ZONE_UNITS) / ZONE_UNITS) + 0.5);
    const z = f32(f32((wz - this.zoneY * ZONE_UNITS) / ZONE_UNITS) + 0.5);

    // Distance(x, z, rx, ry) = (sqrt(2) − |d|)³ — f32 like C++ (double sqrt(2) minus float, stored float)
    const dist = (rx: number, ry: number): number => {
      const dx = f32(x - rx);
      const dy = f32(z - ry);
      const m = f32(Math.sqrt(f32(f32(dx * dx) + f32(dy * dy))));
      const num4 = f32(1.4142135623730951 - m);
      return f32(f32(num4 * num4) * num4);
    };

    const weights = new Float32Array(10);
    weights[31 - Math.clz32(b[0])] = f32(weights[31 - Math.clz32(b[0])] + dist(0, 0));
    weights[31 - Math.clz32(b[1])] = f32(weights[31 - Math.clz32(b[1])] + dist(1, 0));
    weights[31 - Math.clz32(b[2])] = f32(weights[31 - Math.clz32(b[2])] + dist(0, 1));
    weights[31 - Math.clz32(b[3])] = f32(weights[31 - Math.clz32(b[3])] + dist(1, 1));

    let biome = Biome.None;
    let weight = 1.17549435e-38; // std::numeric_limits<float>::min()
    for (let j = 0; j < 10; j++) {
      if (weights[j] > weight) {
        biome = 1 << j;
        weight = weights[j];
      }
    }
    return biome;
  }

  /** C++ Heightmap::GetVegetationMask (Heightmap.cpp:924-932). */
  getVegetationMask(wx: number, wz: number): number {
    // WorldToVertex(worldPos − (0.5, 0, 0.5)) == floor(rel) + 32
    const vx = Math.floor(wx - this.zoneX * ZONE_UNITS) + ZONE_UNITS / 2;
    const vy = Math.floor(wz - this.zoneY * ZONE_UNITS) + ZONE_UNITS / 2;
    // C++ has no bounds check here; in-zone positions give [0,64). Clamp to
    // avoid NaN where C++ would be UB.
    const cx = Math.min(Math.max(vx, 0), ZONE_UNITS - 1);
    const cy = Math.min(Math.max(vy, 0), ZONE_UNITS - 1);
    return this.vegMask[cy * ZONE_UNITS + cx];
  }

  /** C++ Heightmap::GetOceanDepth (Heightmap.cpp:116-127). */
  getOceanDepth(wx: number, wz: number): number {
    const [vx, vy] = this.worldToVertex(wx, wz);
    const t = f32(vx / ZONE_UNITS);
    const t2 = f32(vy / ZONE_UNITS);
    // VUtils::Mathf::Lerp clamps t to [0,1] (Unity Mathf.Lerp)
    const a = mathfLerpF(this.oceanDepth[3], this.oceanDepth[2], t);
    const b = mathfLerpF(this.oceanDepth[0], this.oceanDepth[1], t);
    return mathfLerpF(a, b, t2);
  }

  /**
   * C++ Heightmap::GetWorldHeight nearest-vertex against THIS zone only;
   * null when the vertex is out of bounds (C++ returns false).
   * F4: reads the leveled `heights` (terrain under locations is flattened).
   */
  private getHeightNearest(wx: number, wz: number): number | null {
    const [vx, vy] = this.worldToVertex(wx, wz);
    if (vx < 0 || vy < 0 || vx >= E_WIDTH || vy >= E_WIDTH) return null;
    return this.heights[vy * E_WIDTH + vx];
  }

  /**
   * C++ Heightmap::GetWorldNormal (Heightmap.cpp:461-494): samples the
   * nearest-vertex height at p, p+1x (fallback −1x), p+1z (fallback −1z),
   * normal = (b−a)×(c−a) normalized, flipped upward. Null when p itself is
   * out of bounds (C++ returns false).
   */
  getWorldNormal(wx: number, wz: number): Vector3 | null {
    const ha = this.getHeightNearest(wx, wz);
    if (ha === null) return null;

    let bx = wx + 1;
    let hb = this.getHeightNearest(bx, wz);
    if (hb === null) {
      bx = wx - 1;
      hb = this.getHeightNearest(bx, wz)!;
    }
    let cz = wz + 1;
    let hc = this.getHeightNearest(wx, cz);
    if (hc === null) {
      cz = wz - 1;
      hc = this.getHeightNearest(wx, cz)!;
    }

    // b -= a; c -= a (f32 vector math)
    const b: Vector3 = { x: f32(bx - wx), y: f32(hb - ha), z: 0 };
    const c: Vector3 = { x: 0, y: f32(hc - ha), z: f32(cz - wz) };

    const n = normalF(crossF(b, c));
    // flip back up if it points below the horizon
    return n.y < 0 ? { x: f32(-n.x), y: f32(-n.y), z: f32(-n.z) } : n;
  }
}

/** VUtils::Mathf::Lerp — f32 with t clamped to [0,1] (Unity Mathf.Lerp). */
function mathfLerpF(a: number, b: number, t: number): number {
  const tc = Math.min(1, Math.max(0, t));
  return f32(a + f32(f32(b - a) * tc));
}

/**
 * Zones an operation changed, split by what changed. Painting a path touches
 * no heights, so the client can re-upload the mask without rebuilding meshes.
 */
export interface TerrainOpEffect {
  heights: Array<[number, number]>;
  paint: Array<[number, number]>;
}

/**
 * Zone cache + world-space height queries (C++ IHeightmapManager + Heightmap).
 * Shared by server (ground truth) and client (rendering + prediction).
 */
export class HeightmapProvider {
  private readonly settings: Required<HeightmapSettings>;
  private readonly zones = new Map<string, Heightmap>();
  /** F4: terrain leveling modifiers per overlapped zone key ("zx,zy"). */
  private readonly mods = new Map<string, TerrainLeveling[]>();
  /**
   * Player terrain edits per zone key. Deliberately NOT stored on `Heightmap`:
   * the zone LRU below evicts heightmaps freely, and edits must survive that.
   */
  private readonly comps = new Map<string, TerrainComp>();

  constructor(
    readonly geo: GeoManager,
    settings: HeightmapSettings = {},
    /** LRU cap — one zone is ~33 KB, 512 zones ≈ 17 MB. */
    readonly maxCachedZones = 512
  ) {
    this.settings = {
      blendSmoothStep: settings.blendSmoothStep ?? true,
      bilinearSampling: settings.bilinearSampling ?? false,
    };
  }

  /** C++ IZoneManager::WorldToZonePos (per axis). */
  static worldToZone(w: number): number {
    return Math.floor((w + ZONE_UNITS / 2) / ZONE_UNITS);
  }

  get cachedZoneCount(): number {
    return this.zones.size;
  }

  /**
   * F4: register a terrain leveling modifier (location spawn, Unity
   * TerrainModifier parity). Drops all overlapped zones from the cache so
   * they rebuild with the modifier baked in. Returns the affected zone
   * coordinates (client: chunks to rebuild).
   */
  addTerrainModifier(mod: TerrainLeveling): Array<[number, number]> {
    const reach = mod.levelRadius + mod.smoothRadius;
    const zx0 = HeightmapProvider.worldToZone(mod.x - reach);
    const zx1 = HeightmapProvider.worldToZone(mod.x + reach);
    const zy0 = HeightmapProvider.worldToZone(mod.z - reach);
    const zy1 = HeightmapProvider.worldToZone(mod.z + reach);
    const affected: Array<[number, number]> = [];
    for (let zy = zy0; zy <= zy1; zy++) {
      for (let zx = zx0; zx <= zx1; zx++) {
        const key = `${zx},${zy}`;
        const list = this.mods.get(key);
        if (list) list.push(mod);
        else this.mods.set(key, [mod]);
        this.zones.delete(key); // force rebuild with the modifier baked
        affected.push([zx, zy]);
      }
    }
    return affected;
  }

  // ── Player terrain modification ─────────────────────────────────

  /** Existing edit state of a zone; `create` allocates one on demand. */
  getTerrainComp(zoneX: number, zoneY: number, create = false): TerrainComp | undefined {
    const key = `${zoneX},${zoneY}`;
    let comp = this.comps.get(key);
    if (!comp && create) {
      comp = new TerrainComp(zoneX, zoneY);
      this.comps.set(key, comp);
    }
    return comp;
  }

  /** Server: everything that needs saving. */
  listTerrainComps(): IterableIterator<TerrainComp> {
    return this.comps.values();
  }

  /** Install a comp received from the server / loaded from disk. */
  restoreTerrainComp(comp: TerrainComp): void {
    const key = `${comp.zoneX},${comp.zoneY}`;
    this.comps.set(key, comp);
    const hm = this.zones.get(key);
    if (hm) hm.applyTerrainComp(comp);
  }

  /** Client-side eviction (ring cleanup). Never call for zones near a player. */
  dropTerrainComp(zoneX: number, zoneY: number): void {
    this.comps.delete(`${zoneX},${zoneY}`);
  }

  /**
   * Apply one tool operation. Shared by client (prediction) and server (truth)
   * so both produce bit-identical terrain. Returns the zones whose heights
   * changed — the client rebuilds exactly those chunks.
   *
   * The operation is applied to EVERY overlapping zone. Neighbouring zones
   * share their edge vertices, so missing one leaves that vertex un-deltaed on
   * one side and the terrain tears open along the zone border.
   */
  applyTerrainOp(
    wx: number,
    wy: number,
    wz: number,
    settings: TerrainOpSettings
  ): TerrainOpEffect {
    // Use ceil(radius), not radius: the operation loops over ±ceil(radius)
    // vertices, so it can reach one metre further than the nominal radius.
    //
    // And note this is NOT worldToZone(x ± reach) like addTerrainModifier
    // does. Zone zx covers [zx*64 − 32, zx*64 + 32]; when x − reach lands
    // exactly on a zone border (32 + 64k), worldToZone already reports the
    // next zone and the previous one silently keeps its old height on the
    // shared edge vertex. Large location radii hide that, tool radii do not.
    const reach = Math.ceil(opRadius(settings));
    const half = ZONE_UNITS / 2;
    const zx0 = Math.ceil((wx - reach - half) / ZONE_UNITS);
    const zx1 = Math.floor((wx + reach + half) / ZONE_UNITS);
    const zy0 = Math.ceil((wz - reach - half) / ZONE_UNITS);
    const zy1 = Math.floor((wz + reach + half) / ZONE_UNITS);

    const heights: Array<[number, number]> = [];
    const paint: Array<[number, number]> = [];
    for (let zy = zy0; zy <= zy1; zy++) {
      for (let zx = zx0; zx <= zx1; zx++) {
        const key = `${zx},${zy}`;
        const existed = this.comps.has(key);
        const hm = this.getZone(zx, zy);
        const comp = this.getTerrainComp(zx, zy, true)!;
        const res = applyOperation(comp, hm, wx, wy, wz, settings);
        if (!res.height && !res.paint) {
          // The bounding box overlapped but nothing actually fell inside the
          // radius. Drop the comp we just created — an empty one would still be
          // saved and synced. A comp that was already there stays untouched.
          if (!existed) this.comps.delete(key);
          continue;
        }
        if (res.height) {
          hm.applyTerrainComp(comp, res.height);
          heights.push([zx, zy]);
        }
        if (res.paint) paint.push([zx, zy]);
      }
    }
    return { heights, paint };
  }

  /** C# Heightmap.IsCleared — dirt, cultivated or paved paint on this spot. */
  isCleared(wx: number, wz: number): boolean {
    const comp = this.comps.get(
      `${HeightmapProvider.worldToZone(wx)},${HeightmapProvider.worldToZone(wz)}`
    );
    const mask = comp?.paintMask;
    if (!mask) return false;
    const hm = this.getZoneAt(wx, wz);
    // Half-texel offset, same as PaintCleared writes it.
    const [vx, vy] = hm.worldToVertex(wx - 0.5, wz - 0.5);
    if (vx < 0 || vy < 0 || vx >= E_WIDTH || vy >= E_WIDTH) return false;
    const i = (vy * E_WIDTH + vx) * 4;
    return mask[i] > 127 || mask[i + 1] > 127 || mask[i + 2] > 127;
  }

  /** C# Heightmap.IsCultivated — green channel only (farmable soil). */
  isCultivated(wx: number, wz: number): boolean {
    const comp = this.comps.get(
      `${HeightmapProvider.worldToZone(wx)},${HeightmapProvider.worldToZone(wz)}`
    );
    const mask = comp?.paintMask;
    if (!mask) return false;
    const hm = this.getZoneAt(wx, wz);
    const [vx, vy] = hm.worldToVertex(wx - 0.5, wz - 0.5);
    if (vx < 0 || vy < 0 || vx >= E_WIDTH || vy >= E_WIDTH) return false;
    return mask[(vy * E_WIDTH + vx) * 4 + 1] > 127;
  }

  /** C# Heightmap.AtMaxWorldLevelDepth — dug as deep as the game allows. */
  atMaxLevelDepth(wx: number, wz: number): boolean {
    const comp = this.comps.get(
      `${HeightmapProvider.worldToZone(wx)},${HeightmapProvider.worldToZone(wz)}`
    );
    if (!comp) return false;
    const hm = this.getZoneAt(wx, wz);
    const [vx, vy] = hm.worldToVertex(wx, wz);
    if (vx < 0 || vy < 0 || vx >= E_WIDTH || vy >= E_WIDTH) return false;
    return comp.atMaxDepth(vy * E_WIDTH + vx);
  }

  /** Get (or build) the heightmap of a zone. LRU-cached. */
  getZone(zoneX: number, zoneY: number): Heightmap {
    const key = `${zoneX},${zoneY}`;
    let hm = this.zones.get(key);
    if (hm) {
      // LRU touch (Map preserves insertion order)
      this.zones.delete(key);
      this.zones.set(key, hm);
      return hm;
    }
    hm = new Heightmap(this.geo, zoneX, zoneY, this.settings, this.mods.get(key));
    const comp = this.comps.get(key);
    if (comp) hm.applyTerrainComp(comp);
    this.zones.set(key, hm);
    if (this.zones.size > this.maxCachedZones) {
      const oldest = this.zones.keys().next().value!;
      this.zones.delete(oldest);
    }
    return hm;
  }

  getZoneAt(wx: number, wz: number): Heightmap {
    return this.getZone(HeightmapProvider.worldToZone(wx), HeightmapProvider.worldToZone(wz));
  }

  /**
   * C++ Heightmap::GetWorldHeight. Nearest-vertex (server.yml
   * bilinear=false) or HEIGHTFIX-01/02 triangle interpolation.
   * F4: reads the leveled `heights` (terrain under locations is flattened).
   */
  getGroundHeight(wx: number, wz: number): number {
    const hm = this.getZoneAt(wx, wz);
    if (!this.settings.bilinearSampling) {
      // C++ WorldToVertex: rel to zone center, floor(v + 0.5) + 32
      const vx = Math.floor(wx - hm.zoneX * ZONE_UNITS + 0.5) + ZONE_UNITS / 2;
      const vy = Math.floor(wz - hm.zoneY * ZONE_UNITS + 0.5) + ZONE_UNITS / 2;
      if (vx < 0 || vy < 0 || vx >= E_WIDTH || vy >= E_WIDTH) return 0;
      return hm.heights[vy * E_WIDTH + vx];
    }

    // [HEIGHTFIX-02] double-precision triangle-barycentric interpolation
    let fx = wx - hm.zoneX * ZONE_UNITS + ZONE_UNITS / 2;
    let fz = wz - hm.zoneY * ZONE_UNITS + ZONE_UNITS / 2;
    if (fx < 0 || fz < 0 || fx >= E_WIDTH || fz >= E_WIDTH) return 0;
    fx = Math.min(Math.max(fx, 0), E_WIDTH - 1);
    fz = Math.min(Math.max(fz, 0), E_WIDTH - 1);
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const x1 = Math.min(x0 + 1, E_WIDTH - 1);
    const z1 = Math.min(z0 + 1, E_WIDTH - 1);
    const tx = fx - x0;
    const tz = fz - z0;
    const h00 = hm.heights[z0 * E_WIDTH + x0];
    const h10 = hm.heights[z0 * E_WIDTH + x1];
    const h01 = hm.heights[z1 * E_WIDTH + x0];
    const h11 = hm.heights[z1 * E_WIDTH + x1];
    // T1 (v00, v01, v10) below the diagonal, T2 (v10, v01, v11) above
    return tx + tz < 1
      ? h00 + tx * (h10 - h00) + tz * (h01 - h00)
      : h11 + (1 - tx) * (h01 - h11) + (1 - tz) * (h10 - h11);
  }

  /**
   * C++ Heightmap::GetWorldHeightRaycast (HEIGHTFIX-03) — Möller-Trumbore
   * against the collision triangles T1=(v00,v01,v10), T2=(v10,v01,v11),
   * ray straight down from y=10000. Used for vegetation placement (Phase E).
   */
  getGroundHeightRaycast(wx: number, wz: number): number {
    const hm = this.getZoneAt(wx, wz);
    let fx = wx - hm.zoneX * ZONE_UNITS + ZONE_UNITS / 2;
    let fz = wz - hm.zoneY * ZONE_UNITS + ZONE_UNITS / 2;
    if (fx < 0 || fz < 0 || fx >= E_WIDTH || fz >= E_WIDTH) return 0;
    fx = Math.min(Math.max(fx, 0), E_WIDTH - 1 - 0.0001);
    fz = Math.min(Math.max(fz, 0), E_WIDTH - 1 - 0.0001);

    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const x1 = Math.min(x0 + 1, E_WIDTH - 1);
    const z1 = Math.min(z0 + 1, E_WIDTH - 1);
    const baseX = hm.zoneX * ZONE_UNITS - ZONE_UNITS / 2;
    const baseZ = hm.zoneY * ZONE_UNITS - ZONE_UNITS / 2;

    const v00 = [baseX + x0, hm.heights[z0 * E_WIDTH + x0], baseZ + z0];
    const v10 = [baseX + x1, hm.heights[z0 * E_WIDTH + x1], baseZ + z0];
    const v01 = [baseX + x0, hm.heights[z1 * E_WIDTH + x0], baseZ + z1];
    const v11 = [baseX + x1, hm.heights[z1 * E_WIDTH + x1], baseZ + z1];

    const origin = [wx, 10000, wz];
    const dir = [0, -1, 0];
    const EPSILON = 1e-7;

    const intersect = (v0: number[], v1: number[], v2: number[]): number | null => {
      const edge1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
      const edge2 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
      // h = dir × edge2
      const h = [
        dir[1] * edge2[2] - dir[2] * edge2[1],
        dir[2] * edge2[0] - dir[0] * edge2[2],
        dir[0] * edge2[1] - dir[1] * edge2[0],
      ];
      const a = edge1[0] * h[0] + edge1[1] * h[1] + edge1[2] * h[2];
      if (a > -EPSILON && a < EPSILON) return null;
      const f = 1 / a;
      const s = [origin[0] - v0[0], origin[1] - v0[1], origin[2] - v0[2]];
      const u = f * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]);
      if (u < 0 || u > 1) return null;
      // q = s × edge1
      const q = [
        s[1] * edge1[2] - s[2] * edge1[1],
        s[2] * edge1[0] - s[0] * edge1[2],
        s[0] * edge1[1] - s[1] * edge1[0],
      ];
      const v = f * (dir[0] * q[0] + dir[1] * q[1] + dir[2] * q[2]);
      if (v < 0 || u + v > 1) return null;
      const t = f * (edge2[0] * q[0] + edge2[1] * q[1] + edge2[2] * q[2]);
      return t > EPSILON ? t : null;
    };

    const t1 = intersect(v00, v01, v10); // T1
    const t2 = intersect(v10, v01, v11); // T2
    if (t1 !== null && t2 !== null) return 10000 - Math.min(t1, t2);
    if (t1 !== null) return 10000 - t1;
    if (t2 !== null) return 10000 - t2;
    return this.getGroundHeight(wx, wz); // edge-case fallback like C++
  }
}
