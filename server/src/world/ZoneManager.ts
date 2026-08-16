/**
 * ZoneManager (Phase E+F) — 1:1 port of C++ IZoneManager zone population.
 *
 * C++ reference:
 *   IZoneManager::TryGenerateNearbyZones  (ZoneManager.cpp:538-558)
 *   IZoneManager::TryPollGenerateZone     (ZoneManager.cpp:575-590)
 *   IZoneManager::PopulateZone            (ZoneManager.cpp:592-609)
 *   IZoneManager::PopulateFoliage         (ZoneManager.cpp:625-819)
 *   IZoneManager::GetRandomPointInRadius  (ZoneManager.cpp:617-622)
 *   IZoneManager::GetTerrainDelta         (ZoneManager.cpp:1365-1387)
 *   IZoneManager::GetGroundData           (ZoneManager.cpp:1399-1425)
 *   IZoneManager::InsideClearArea         (ZoneManager.cpp:822-833)
 *   IZoneManager::OverlapsClearArea       (ZoneManager.cpp:835-846)
 *   IZoneManager::PostGeoInit             (ZoneManager.cpp:858-886)
 *   ::CheckSurroundingTerrain             (ZoneManager.cpp:944-974)
 *   IZoneManager::PrepareFeatures         (ZoneManager.cpp:977-1119)
 *   IZoneManager::HaveLocationInRange     (ZoneManager.cpp:1120-1133)
 *   IZoneManager::GetRandomPointInZone    (ZoneManager.cpp:1135-1142)
 *   IZoneManager::GetRandomZone           (ZoneManager.cpp:1144-1155)
 *   IZoneManager::TryGenerateFeature      (ZoneManager.cpp:1158-1234)
 *   IZoneManager::RemoveUngeneratedFeatures (ZoneManager.cpp:1237-1252)
 *   IZoneManager::GenerateFeature         (ZoneManager.cpp:1254-1331)
 *   IZoneManager::GenerateLocationProxy   (ZoneManager.cpp:1335-1343)
 *   ZDOManager::Instantiate               (ZDOManager.cpp:395-429)
 *   ZDO::SetLocalScale                    (ZDO.h:1065-1079)
 *
 * Deviations (all documented, none affect placement determinism):
 *   - C++ generates zones inline on the peer tick (blocking). We enqueue
 *     and drain with a per-tick time budget to avoid server hitches;
 *     zone SET and per-zone ORDER around each player match C++
 *     (center first, then the (NEAR+DISTANT) square).
 *   - DUNGEON-flag pieces (dungeons.enabled=true) are skipped + counted
 *     (dungeon interior generation is Phase G).
 *   - zone_ctrl / creature spawning (PopulateZone tail) is out of scope.
 *
 * Determinism notes (load-bearing for identical worlds):
 *   - rng draws happen BEFORE the placement checks, in C++ order.
 *   - rot_y uses the INT range overload (C++ `state.range(0, 360)`).
 *   - per-entry seed: (seed + zx*4271 + zy*9187 + prefabHash) with int32 wrap.
 *   - PrepareFeatures consumes GeoManager::GetTerrainDelta (10 rng draws) on
 *     EVERY candidate point that passes altitude+forest checks — even when
 *     the delta limits are 0/0 (C++ calls it unconditionally).
 *   - Location randomRotation uses a TIME-seeded rng in C++
 *     (VUtils::Random::State() default ctor, VUtilsRandom.cpp:53-55) — it is
 *     deliberately NOT world-deterministic; we mirror that with a random seed.
 */

import {
  DungeonAlgorithm,
  FOLIAGE,
  streueZone,
  FEATURES,
  RegionGeo,
  layoutBounds,
  tierAusDistanz,
  FEATURES_BY_NAME,
  PREFABS_BY_NAME,
  PrefabFlag,
  generateCampLayout,
  getDungeonByHash,
  XorShiftRandom,
  crossF,
  quatEuler,
  quatLookRotation,
  quatMul,
  quatMulVec3,
  findPrefabByHash,
  getFeatureModifierParams,
  getLocationOverride,
  getTerrainLeveling,
  getStableHash,
  HeightmapProvider,
  WATER_LEVEL,
  ZONE_UNITS,
  Biome,
  BIOME_BY_NAME,
} from '@wov/shared';
import type {
  Feature,
  Heightmap,
  GeoManager,
  Quaternion,
  Vector3,
  ZoneID,
} from '@wov/shared';
// Serverseitige Weltdaten: NICHT ueber den Barrel, sondern ueber den
// expliziten Pfad — sie tragen die Rohdaten der Weltvorlagen (Pieces bzw.
// Raum-Einrichtung) und haetten im Barrel jedes Client-Bundle aufgeblaeht.
import { getFeaturePieces } from '@wov/shared/src/featurePieces.js';
import { flattenLayout } from '@wov/shared/src/dungeonFlatten.js';
import { ZDOManager } from '../zdo/ZDOManager.js';
import type { ZDO } from '../zdo/ZDO.js';
import type { PrefabDef } from '@wov/shared';

const f32 = Math.fround;

// ── C++ ZoneManager.h constants ─────────────────────────────────────
const NEAR_ZRADIUS = 2;
const DISTANT_ZRADIUS = 2;
/** C++ WORLD_INNER_ZRADIUS = 10500 / 64 (int division!) = 164. */
const WORLD_INNER_ZRADIUS = Math.floor(10500 / 64);

/** C++ (float)(VUtils::PI * 2.0). */
const PI2_F = f32(Math.PI * 2);
/** C++ (float)(VUtils::PI / 180.0). */
const DEG2RAD_F = f32(Math.PI / 180);

/** std::numeric_limits<float>::min() — smallest POSITIVE float. */
const FLOAT_MIN_POSITIVE = 1.1754943508222875e-38;
/** std::numeric_limits<float>::max(). */
const FLOAT_MAX = 3.4028234663852886e38;
/** std::numeric_limits<float>::epsilon() * 8 (ZDO::SetLocalScale). */
const EPSILON_X8 = 1.1920928955078125e-7 * 8;

/** C++ Vector3f::FORWARD. */
const FORWARD: Vector3 = { x: 0, y: 0, z: 1 };

/** C++ LOCATION_PROXY_PREFAB (ZoneManager.h) — get_stable_hash("LocationProxy"). */
const LOCATION_PROXY_HASH = getStableHash('LocationProxy');

/** C++ (float)UNITS_PER_ZONE / 2.f — GetRandomPointInZone half-extent. */
const HALF_ZONE_F = f32(ZONE_UNITS / 2);

/** C++ GetRandomZone rejection radius (world edge). */
const FEATURE_WORLD_EDGE = 10000;

/** C++ IZoneManager::ClearArea (m_center, m_semiWidth). */
interface ClearArea {
  center: Vector3;
  radius: number;
}

/** C++ IZoneManager::Feature::Instance (feature ref + placed position). */
interface FeatureInstance {
  feature: Feature;
  pos: Vector3;
}

/** C++ ServerSettings world.* flags relevant to zone population. */
export interface ZoneManagerOptions {
  /** C++ worldFeatures — location placement (default true). */
  worldFeatures?: boolean;
  /** C++ worldVegetation — foliage placement (default true). */
  worldVegetation?: boolean;
  /** C++ experimental-location-overrides (default false). */
  locationOverrides?: boolean;
  /** C++ dungeonsEnabled — DUNGEON pieces are skipped when true (default true). */
  dungeonsEnabled?: boolean;
}

function zoneKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** C++ IZoneManager::is_inside_world_radius. */
function isInsideWorldRadius(x: number, y: number): boolean {
  return x * x + y * y < WORLD_INNER_ZRADIUS * WORLD_INNER_ZRADIUS;
}

/** C++ IZoneManager::ZoneToWorldPos — (zone.x * 64, 0, zone.y * 64). */
function zoneToWorldPos(zone: ZoneID): Vector3 {
  return { x: zone.x * ZONE_UNITS, y: 0, z: zone.y * ZONE_UNITS };
}

/** C++ Vector3f::magnitude — sqrt(x²+y²+z²), all float32. */
function mag3f(v: Vector3): number {
  return f32(Math.sqrt(f32(f32(f32(v.x * v.x) + f32(v.y * v.y)) + f32(v.z * v.z))));
}

/** C++ Vector3f::distance_to — sqrt of sq_distance_to, all float32. */
function dist3f(a: Vector3, b: Vector3): number {
  const dx = f32(a.x - b.x);
  const dy = f32(a.y - b.y);
  const dz = f32(a.z - b.z);
  return f32(Math.sqrt(f32(f32(f32(dx * dx) + f32(dy * dy)) + f32(dz * dz))));
}

/** C++ IZoneManager::GetRandomPointInRadius (ZoneManager.cpp:617-622). */
function getRandomPointInRadius(
  state: XorShiftRandom,
  center: Vector3,
  radius: number
): Vector3 {
  const f = f32(state.nextFloat() * PI2_F);
  const num = state.rangeFloat(0, radius);
  // NOTE: sinf/cosf vs Math.sin/cos — same accepted 1-ulp class as rivers.
  return {
    x: f32(center.x + f32(Math.sin(f) * num)),
    y: center.y,
    z: f32(center.z + f32(Math.cos(f) * num)),
  };
}

/** C++ IZoneManager::InsideClearArea (rectangular test, ZoneManager.cpp:822-833). */
function insideClearArea(areas: readonly ClearArea[], p: Vector3): boolean {
  for (const a of areas) {
    if (
      p.x > a.center.x - a.radius &&
      p.x < a.center.x + a.radius &&
      p.z > a.center.z - a.radius &&
      p.z < a.center.z + a.radius
    ) {
      return true;
    }
  }
  return false;
}

/** C++ IZoneManager::OverlapsClearArea (2D, ZoneManager.cpp:835-846). */
function overlapsClearArea(
  areas: readonly ClearArea[],
  p: Vector3,
  radius: number
): boolean {
  for (const a of areas) {
    // VUtils::Math::sq_distance_to (float math)
    const dx = f32(p.x - a.center.x);
    const dz = f32(p.z - a.center.z);
    const d = f32(f32(dx * dx) + f32(dz * dz));
    const rd = f32(a.radius + radius);
    if (d < f32(rd * rd)) return true;
  }
  return false;
}

export class ZoneManager {
  /** C++ m_generatedZones. */
  private readonly generated = new Set<string>();
  /** Enqueued but not yet generated (budget deferral). */
  private readonly pending = new Set<string>();
  private readonly queue: ZoneID[] = [];

  /** C++ m_generatedFeatures — keyed by WorldToZonePos(instance pos). */
  private readonly generatedFeatures = new Map<string, FeatureInstance>();
  /** C++ PostGeoInit ran (features placed). */
  private featuresPrepared = false;

  private readonly worldFeatures: boolean;
  private readonly worldVegetation: boolean;
  private readonly locationOverrides: boolean;
  private readonly dungeonsEnabled: boolean;

  /**
   * Phase G hook: a location materialized a DUNGEON piece (DG_* prefab).
   * Wired to DungeonManager.registerEntrance by the server; the ZoneManager
   * stays free of dungeon knowledge.
   */
  onDungeonPiece:
    | ((
        featureName: string,
        dgPrefabHash: number,
        zoneKey: string,
        pos: Vector3,
        seed: number
      ) => void)
    | null = null;

  /**
   * Layout-Modus (Kartengenerierungs-Umbau, Phase 3): gesetzt, wenn die
   * Welt aus einem WorldLayout kommt. Dann gelten Regions- statt
   * Radial-Regeln — Zonenfenster aus der Layout-Bbox, keine
   * Weltzentrums-Distanzen, Kuratierung je Region.
   */
  private readonly regionGeo: RegionGeo | null;
  /** Zonenfenster des Layouts (inkl. Falloff-/Küstenrand), nur Layout-Modus. */
  private readonly layoutZonen: { minX: number; minY: number; maxX: number; maxY: number } | null =
    null;
  /** Bitmaske aller im Layout vorkommenden Biome (+ Ozean), nur Layout-Modus. */
  private readonly layoutBiomeMask: number | null = null;

  constructor(
    private readonly geo: GeoManager,
    private readonly heightmaps: HeightmapProvider,
    private readonly zdos: ZDOManager,
    /** C++ GeoManager()->GetSeed() = getStableHash(worldSeed). */
    private readonly seed: number,
    options: ZoneManagerOptions = {}
  ) {
    this.worldFeatures = options.worldFeatures ?? true;
    this.worldVegetation = options.worldVegetation ?? true;
    this.locationOverrides = options.locationOverrides ?? false;
    this.dungeonsEnabled = options.dungeonsEnabled ?? true;
    this.regionGeo = geo instanceof RegionGeo ? geo : null;
    if (this.regionGeo) {
      const b = layoutBounds(this.regionGeo.layout);
      const rand = 1024; // Falloff + Küstenrauschen + eine Zone Luft
      this.layoutZonen = {
        minX: Math.floor((b.minX - rand) / ZONE_UNITS),
        minY: Math.floor((b.minZ - rand) / ZONE_UNITS),
        maxX: Math.ceil((b.maxX + rand) / ZONE_UNITS),
        maxY: Math.ceil((b.maxZ + rand) / ZONE_UNITS),
      };
      let maske = Biome.Ocean as number;
      for (const region of this.regionGeo.layout.regions) {
        maske |= BIOME_BY_NAME.get(region.biome) ?? 0;
      }
      this.layoutBiomeMask = maske;
    }
  }

  /**
   * Ob eine Zone überhaupt generiert wird. Radialwelt: der klassische
   * Innenradius. Layout-Welt: die Layout-Bbox — offene See außerhalb
   * bleibt ungeneriert (keine Vegetation, keine Locations; die Karte darf
   * unbegrenzt wachsen, ohne dass hier Kosten entstehen).
   */
  private zoneErlaubt(x: number, y: number): boolean {
    if (this.layoutZonen) {
      return (
        x >= this.layoutZonen.minX &&
        x <= this.layoutZonen.maxX &&
        y >= this.layoutZonen.minY &&
        y <= this.layoutZonen.maxY
      );
    }
    return isInsideWorldRadius(x, y);
  }

  get generatedZoneCount(): number {
    return this.generated.size;
  }

  isZoneGenerated(zone: ZoneID): boolean {
    return this.generated.has(zoneKey(zone.x, zone.y));
  }

  /** Generated zones for the world save (C++ ZoneManager::Save zone list). */
  getGeneratedZones(): Array<[number, number]> {
    return [...this.generated].map((key) => {
      const sep = key.indexOf(',');
      return [Number(key.slice(0, sep)), Number(key.slice(sep + 1))] as [number, number];
    });
  }

  /**
   * Restore generated zones from a world save (C++ ZoneManager::Load zone
   * list). Marking the zones generated is what prevents re-generation —
   * the zone's objects come back from the save's ZDO section instead, so
   * nothing duplicates. But two generation-time side effects live OUTSIDE
   * the ZDO set and must be replayed here:
   *  - F4 terrain modifiers of booked feature instances in those zones
   *    (otherwise pieces float on slopes again after a restart), and
   *  - unique-feature bookkeeping (Haldor): prepareFeatures re-books every
   *    instance deterministically on boot; the instances removed at
   *    generation time must be re-removed or a second unique location
   *    could spawn.
   */
  restoreGeneratedZones(zones: ReadonlyArray<readonly [number, number]>): void {
    const restored = new Set<string>();
    for (const [x, y] of zones) {
      this.generated.add(zoneKey(x, y));
      restored.add(zoneKey(x, y));
    }
    // Snapshot the instances — removeUngeneratedFeatures mutates the map.
    for (const inst of [...this.generatedFeatures.values()]) {
      const zx = HeightmapProvider.worldToZone(inst.pos.x);
      const zy = HeightmapProvider.worldToZone(inst.pos.z);
      if (!restored.has(zoneKey(zx, zy))) continue;
      this.registerTerrainModifier(inst.feature, inst.pos);
      if (inst.feature.unique) {
        this.removeUngeneratedFeatures(inst.feature);
      }
    }
  }

  /**
   * Server-tick entry point: enqueue missing zones around every peer
   * (C++ TryGenerateNearbyZones per peer), then drain with a time budget
   * (C++ blocks inline; we spread over ticks to avoid hitches).
   * Returns the number of zones generated this call.
   */
  update(peerPositions: readonly Vector3[], budgetMs = 12): number {
    for (const pos of peerPositions) {
      this.enqueueNearbyZones(pos);
    }

    // G-POP: cull stale entries + sort nearest-first every tick. The old FIFO
    // kept generating zones behind a fast-moving player before the ones
    // ahead, and there is no content dependency on generation order (each
    // zone's content is seeded per-zone).
    if (peerPositions.length > 0 && this.queue.length > 1) {
      const pz = peerPositions.map(
        (p) => [HeightmapProvider.worldToZone(p.x), HeightmapProvider.worldToZone(p.z)] as const
      );
      const num = NEAR_ZRADIUS + DISTANT_ZRADIUS + 1; // keep a 1-zone buffer
      const minD2 = (x: number, y: number): number => {
        let best = Infinity;
        for (const [px, py] of pz) {
          const d = (x - px) * (x - px) + (y - py) * (y - py);
          if (d < best) best = d;
        }
        return best;
      };
      // In-place cull (queue is readonly): drop zones no peer is near anymore
      for (let i = this.queue.length - 1; i >= 0; i--) {
        const z = this.queue[i];
        let keep = false;
        for (const [px, py] of pz) {
          if (Math.max(Math.abs(z.x - px), Math.abs(z.y - py)) <= num) {
            keep = true;
            break;
          }
        }
        if (!keep) {
          this.pending.delete(zoneKey(z.x, z.y));
          this.queue.splice(i, 1);
        }
      }
      if (this.queue.length > 1) {
        this.queue.sort((a, b) => minD2(a.x, a.y) - minD2(b.x, b.y));
      }
    }

    let generated = 0;
    const deadline = Date.now() + budgetMs;
    while (this.queue.length > 0) {
      if (Date.now() >= deadline) break;
      const zone = this.queue.shift()!;
      this.pending.delete(zoneKey(zone.x, zone.y));
      if (this.generateZone(zone)) generated++;
    }
    return generated;
  }

  /**
   * C++ IZoneManager::TryGenerateNearbyZones (ZoneManager.cpp:538-558):
   * center zone first, then the full (NEAR+DISTANT) square, z outer / x inner.
   * C++ polls+generates inline; we enqueue in the same order.
   */
  private enqueueNearbyZones(refPoint: Vector3): void {
    const zx = HeightmapProvider.worldToZone(refPoint.x);
    const zy = HeightmapProvider.worldToZone(refPoint.z);

    const tryEnqueue = (x: number, y: number): void => {
      // C++ TryPollGenerateZone guard: is_inside_world_radius && !generated
      // (im Layout-Modus: Layout-Bbox statt Weltradius, s. zoneErlaubt)
      if (!this.zoneErlaubt(x, y)) return;
      const key = zoneKey(x, y);
      if (this.generated.has(key) || this.pending.has(key)) return;
      this.pending.add(key);
      this.queue.push({ x, y });
    };

    // Prioritize center zone
    tryEnqueue(zx, zy);

    const num = NEAR_ZRADIUS + DISTANT_ZRADIUS;
    for (let z = zy - num; z <= zy + num; z++) {
      for (let x = zx - num; x <= zx + num; x++) {
        if (x === zx && z === zy) continue;
        tryEnqueue(x, z);
      }
    }
  }

  /**
   * C++ GenerateZoneBlocking / TryPollGenerateZone success path:
   * mark generated, PopulateZone (ZoneManager.cpp:592-609):
   * features (worldFeatures) → foliage (worldVegetation) → zone_ctrl
   * (worldCreatures — creature system out of scope).
   * Returns false when the zone was already generated.
   */
  private generateZone(zone: ZoneID): boolean {
    const key = zoneKey(zone.x, zone.y);
    if (this.generated.has(key)) return false;
    this.generated.add(key);
    const heightmap = this.heightmaps.getZone(zone.x, zone.y);
    const clearAreas = this.worldFeatures ? this.tryGenerateFeature(zone) : [];
    if (this.worldFeatures) {
      // INVARIANTE: Vegetation steht NIE auf Terrain, das ein Location-
      // Modifier verändert (Ebnung + Glättungsband). C++ kennt das Problem
      // nicht, weil es Höhen nie anfasst — unser F4-Leveling schon, und
      // gebackene Vegetations-y brechen, sobald sich der Boden darunter
      // nachträglich hebt oder senkt. Zwei Löcher stopft dieser Block:
      //  1. NACHBARZONEN: Der Modifier einer Location wird erst beim
      //     Generieren IHRER Zone registriert, sein Band reicht aber bis
      //     zu ~32 m in die Nachbarzone. Generierte die früher, schwebten
      //     dort Bäume ("Haus am Strand", 2026-08-02). Die Ausschlusszonen
      //     kommen deshalb aus den GEBUCHTEN Instanzen der 3×3-Umgebung —
      //     gebucht ist beim Serverstart alles, lange vor jeder Zone.
      //  2. RADIUS: Der Ausschluss deckt den GESAMTEN Einfluss
      //     (levelRadius + smoothRadius), nicht nur die clearArea.
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const inst = this.generatedFeatures.get(zoneKey(zone.x + dx, zone.y + dz));
          if (!inst) continue;
          const leveling = getTerrainLeveling(inst.feature);
          if (!leveling) continue;
          clearAreas.push({
            center: { ...inst.pos },
            radius: leveling.levelRadius + leveling.smoothRadius,
          });
        }
      }
    }
    if (this.worldVegetation) {
      this.populateFoliage(heightmap, clearAreas);
    }
    return true;
  }

  /**
   * C++ ZDOManager::Instantiate prefab-flag handling (ZDOManager.cpp:395-429):
   * SYNC_INITIAL_SCALE ⇒ SetLocalScale(m_localScale, allowIdentity=false).
   */
  private applyInitialScale(zdo: ZDO, prefab: PrefabDef | undefined): void {
    if (!prefab || (prefab.flags & PrefabFlag.SYNC_INITIAL_SCALE) === 0n) return;
    const ls = prefab.localScale;
    if (Math.abs(ls.x - ls.y) < EPSILON_X8 && Math.abs(ls.y - ls.z) < EPSILON_X8) {
      if (Math.abs(ls.x - 1) > EPSILON_X8) {
        zdo.setFloat('scaleScalar', ls.x);
      }
    } else {
      zdo.setVec3('scale', ls);
    }
  }

  /**
   * Streut die Vegetation einer Zone und legt sie als ZDOs ab.
   *
   * Die Rechnung selbst steht seit 08/2026 in
   * `shared/src/worldgen/streuung.ts` — sie wird vom Editor-Testflug
   * mitbenutzt, der offline laeuft und deshalb keinen ZoneManager hat.
   * Hier bleibt nur, was serverseitig ist: aus jedem Fund ein ZDO machen.
   *
   * Dass der Umzug nichts veraendert hat, prueft
   * `server/test/e2-vegetation.ts` ueber BIT-gleiche ZDO-Abzuege.
   */
  private populateFoliage(heightmap: Heightmap, clearAreas: ClearArea[]): void {
    streueZone(
      {
        seed: this.seed,
        geo: this.geo,
        heightmaps: this.heightmaps,
        regionGeo: this.regionGeo,
      },
      heightmap,
      clearAreas,
      (fund) => {
        // C++ ZDOManager::Instantiate(prefab, pos) + SetRotation
        const zdo = this.zdos.createZDO(fund.prefabHash, fund.position, fund.rotation);

        // C++ Instantiate: SYNC_INITIAL_SCALE ⇒ SetLocalScale (ZDO.h:1065)
        const prefab = PREFABS_BY_NAME.get(fund.prefabName)!;
        this.applyInitialScale(zdo, prefab);

        // C++: only written when the random scale differs from the
        // prefab default; allowIdentity=true writes even scale==1.
        if (fund.scale !== prefab.localScale.x) {
          zdo.setFloat('scaleScalar', fund.scale);
        }
      }
    );
  }

  /**
   * C++ IZoneManager::GetTerrainDelta (ZoneManager.cpp:1365-1387) —
   * 10 random samples, RAW GeoManager height (not the heightmap).
   * Returns max − min (slopeDirection out-param unused by foliage).
   */
  private getTerrainDelta(
    state: XorShiftRandom,
    center: Vector3,
    radius: number
  ): number {
    let num2 = FLOAT_MIN_POSITIVE;
    let num3 = FLOAT_MAX;
    for (let i = 0; i < 10; i++) {
      const v = state.insideUnitCircle();
      // Vector2f * radius, then center + Vector3f(v.x, 0, v.y) — f32 ops
      const px = f32(center.x + f32(v.x * radius));
      const pz = f32(center.z + f32(v.y * radius));
      const groundHeight = this.geo.getHeight(px, pz);
      if (groundHeight < num3) num3 = groundHeight;
      if (groundHeight > num2) num2 = groundHeight;
    }
    return f32(num2 - num3);
  }

  // ════════════════════════════════════════════════════════════════
  //  Phase F — Locations (features.pkg placement + generation)
  // ════════════════════════════════════════════════════════════════

  /**
   * C++ IZoneManager::PostGeoInit (ZoneManager.cpp:858-886) — runs ONCE at
   * server start, before any zone generates. Places all feature instances
   * into m_generatedFeatures (they materialize per-zone in TryGenerateFeature).
   */
  /**
   * Placement-Cache (Review-Punkt 14): Das Ergebnis von prepareFeatures ist
   * deterministisch (Seed + Layout + Feature-Tabelle) — es bei jedem Boot
   * neu zu würfeln kostete im Layout-Modus Minuten. Export/Import erlauben
   * dem Server, den Stand als Datei zu cachen.
   */
  exportFeatures(): Array<{ key: string; feature: string; pos: Vector3 }> {
    return [...this.generatedFeatures.entries()].map(([key, inst]) => ({
      key,
      feature: inst.feature.name,
      pos: inst.pos,
    }));
  }

  /** true = Cache übernommen, prepareFeatures wird übersprungen. */
  importFeatures(eintraege: Array<{ key: string; feature: string; pos: Vector3 }>): boolean {
    if (this.generatedFeatures.size > 0 || this.featuresPrepared) return false;
    for (const e of eintraege) {
      const feature = FEATURES_BY_NAME.get(e.feature);
      if (!feature) continue; // Feature-Tabelle hat sich geändert → Rest egal
      this.generatedFeatures.set(e.key, { feature, pos: e.pos });
    }
    this.featuresPrepared = true;
    console.log(`[WoV] Location placement aus Cache: ${this.generatedFeatures.size} Instanzen`);
    return true;
  }

  prepareFeatures(): void {
    // C++: "Will be empty if world failed to load"
    if (this.generatedFeatures.size > 0 || this.featuresPrepared) return;

    // Der StartTemple ist der Weltspawn der RADIALWELT: Sie kennt keinen
    // anderen Startpunkt, C++ setzt den Spieler auf den Tempelsockel.
    // Deshalb stand hier eine harte Ausnahme, und fuer die Radialwelt ist
    // sie weiterhin die richtige Frage — fehlt der Tempel, erscheinen dort
    // alle Spieler ersatzweise am Ursprung, der offener Ozean sein kann.
    //
    // Zur WARNUNG herabgestuft, aus zwei Gruenden:
    //  - Im Layout-Modus prueft sie ins Leere. Der Startpunkt kommt dort
    //    aus dem Weltdokument (WovServer.weltSpawn), der Tempel spielt
    //    keine Rolle; deshalb schweigt sie in diesem Modus ganz.
    //  - Seit die Feature-Tabelle gegen die Whitelist gefiltert wird, ist
    //    sie leer, die Ausnahme schluege also bei JEDEM Start zu.
    //    WovServer.ts ruft prepareFeatures ohne try/catch und die
    //    systemd-Unit traegt Restart=always — daraus wuerde eine
    //    Neustartschleife, deren Ursache im Log nur als abgebrochener
    //    Stacktrace steht.
    //
    // VERWORFEN: die Pruefung ersatzlos streichen. Dann verschwaende der
    // einzige Hinweis darauf, dass einer Radialwelt der Spawnpunkt fehlt.
    const startTemple = FEATURES_BY_NAME.get('StartTemple');
    if (!startTemple && !this.regionGeo) {
      console.warn(
        '[WoV] Weltspawn-Feature StartTemple fehlt — die Radialwelt hat damit keinen ' +
          'eigenen Startpunkt, Spieler erscheinen am Weltursprung.'
      );
    }

    if (!this.worldFeatures) {
      console.warn('[WoV] Location generation is disabled');
      if (startTemple) this.prepareFeature(startTemple);
    } else {
      const t0 = Date.now();
      // FEATURES is in pkg order (C++ m_features, presorted by priority)
      for (const feature of FEATURES) {
        this.prepareFeature(feature);
      }
      console.log(
        `[WoV] Location placement took ${Date.now() - t0}ms (${this.generatedFeatures.size} locations prepared)`
      );
    }
    this.featuresPrepared = true;
  }

  /**
   * C++ IZoneManager::PrepareFeatures (ZoneManager.cpp:977-1119) — place all
   * instances of ONE feature. rng: one State(seed + feature.m_hash) per
   * feature, consumed in exact C++ order (zone draws, then per-point draws,
   * then the unconditional 10-sample terrain delta per surviving point).
   */
  private prepareFeature(feature: Feature): void {
    // Layout-Modus: Features, deren Biome im Layout schlicht nicht
    // existieren, sofort überspringen — sonst verbrennen sie ALLE
    // spawnAttempts an Biom-Ablehnungen (gemessen: 618 s statt 114 s
    // Placement, weil Mistlands/Ashlands/DeepNorth-Quoten ins Leere liefen).
    if (this.layoutBiomeMask !== null && (feature.biome & this.layoutBiomeMask) === 0) {
      return;
    }
    // C++ CountNrOfLocation inlined: count already-placed instances of this
    // feature (always 0 here — each feature is prepared exactly once).
    let spawnedLocations = 0;
    for (const inst of this.generatedFeatures.values()) {
      if (inst.feature.hash === feature.hash) spawnedLocations++;
    }

    let errLocations = 0;
    let errCenterDistances = 0;
    let errNoneBiomes = 0;
    let errBiomeArea = 0;
    let errAltitude = 0;
    let errForestFactor = 0;
    let errSimilarLocation = 0;
    let errTerrainDelta = 0;
    let errSurrounding = 0;

    const state = new XorShiftRandom((this.seed + feature.hash) | 0);
    const locationRadius = Math.max(feature.exteriorRadius, feature.interiorRadius);

    // LOCATION_OVERRIDES (only active with experimental-location-overrides)
    const override = this.locationOverrides ? getLocationOverride(feature.name) : null;
    const effectiveMinAltitude =
      override && override.minAltitude >= 0 ? override.minAltitude : feature.minAltitude;

    let range = feature.centerFirst ? feature.minDistance : FEATURE_WORLD_EDGE;

    for (let a = 0; a < feature.spawnAttempts && spawnedLocations < feature.quantity; a++) {
      const randomZone = this.getRandomZone(state, range);
      if (feature.centerFirst) range++;

      if (this.generatedFeatures.has(zoneKey(randomZone.x, randomZone.y))) {
        errLocations++;
        continue;
      }

      const zonePos = zoneToWorldPos(randomZone);
      const biomeArea = this.geo.getBiomeArea(zonePos.x, zonePos.z);

      if ((feature.biomeArea & biomeArea) === 0) {
        errBiomeArea++;
        continue;
      }

      pointLoop: for (let i = 0; i < 20; i++) {
        const point = this.getRandomPointInZone(state, randomZone, locationRadius);

        // Weltzentrums-Distanzen sind ein Radialwelt-Konzept — im
        // Layout-Modus ersetzt die Kuratierung je Region die Progression.
        if (!this.regionGeo) {
          const magnitude = mag3f(point);
          if (
            (feature.minDistance !== 0 && magnitude < feature.minDistance) ||
            (feature.maxDistance !== 0 && magnitude > feature.maxDistance)
          ) {
            errCenterDistances++;
            continue;
          }
        }

        const biome = this.geo.getBiome(point.x, point.z);
        if ((biome & feature.biome) === 0) {
          errNoneBiomes++;
          continue;
        }

        // Kuratierte Region: Führt sie eine Location-Liste, dürfen dort
        // AUSSCHLIESSLICH diese Features entstehen. Sonst greift die
        // Progressionsstufe: `tier` ersetzt die Weltzentrums-Distanzen der
        // Radialwelt (Review-Punkt 32) — ohne sie stünden Bosskammern
        // gleichberechtigt neben Startdörfern.
        if (this.regionGeo) {
          const region = this.regionGeo.regionAt(point.x, point.z);
          if (region?.locations) {
            if (!region.locations.includes(feature.name)) {
              errCenterDistances++;
              continue;
            }
          } else if (region?.tier !== undefined && tierAusDistanz(feature.minDistance) > region.tier) {
            errCenterDistances++;
            continue;
          }
        }

        point.y = this.geo.getHeight(point.x, point.z);
        const waterDiff = f32(point.y - WATER_LEVEL);
        if (waterDiff < effectiveMinAltitude || waterDiff > feature.maxAltitude) {
          errAltitude++;
          continue;
        }

        if (feature.inForest) {
          const forestFactor = this.geo.getForestFactor(point.x, point.z);
          if (
            forestFactor < feature.forestTresholdMin ||
            forestFactor > feature.forestTresholdMax
          ) {
            errForestFactor++;
            continue;
          }
        }

        // C++ calls GeoManager::GetTerrainDelta UNCONDITIONALLY here —
        // the 10 rng draws happen even when the delta limits are 0/0.
        const delta = this.getTerrainDelta(state, point, feature.exteriorRadius);
        if (delta > feature.maxTerrainDelta || delta < feature.minTerrainDelta) {
          errTerrainDelta++;
          continue;
        }

        // LOCATION_OVERRIDES: surrounding terrain check (anti-island)
        if (override && override.surroundingCheck.enabled && feature.exteriorRadius > 0) {
          const checkRadius = f32(feature.exteriorRadius * override.surroundingCheck.radiusMultiplier);
          if (
            !this.checkSurroundingTerrain(
              point,
              checkRadius,
              effectiveMinAltitude,
              override.surroundingCheck.samplePoints,
              override.surroundingCheck.minValidPoints
            )
          ) {
            errSurrounding++;
            continue;
          }
        }

        if (
          feature.minDistanceFromSimilar <= 0 ||
          !this.haveLocationInRange(feature, point)
        ) {
          const zone: ZoneID = {
            x: HeightmapProvider.worldToZone(point.x),
            y: HeightmapProvider.worldToZone(point.z),
          };
          this.generatedFeatures.set(zoneKey(zone.x, zone.y), {
            feature,
            pos: { ...point },
          });
          spawnedLocations++;
          break pointLoop;
        }
        errSimilarLocation++;
      }
    }

    if (spawnedLocations < feature.quantity) {
      console.warn(
        `[WoV] Failed to place all ${feature.name}, placed ${spawnedLocations}/${feature.quantity} ` +
          `(zone=${errLocations} dist=${errCenterDistances} biome=${errNoneBiomes} area=${errBiomeArea} ` +
          `alt=${errAltitude} forest=${errForestFactor} similar=${errSimilarLocation} ` +
          `delta=${errTerrainDelta} surrounding=${errSurrounding})`
      );
    }
  }

  /**
   * C++ IZoneManager::GetRandomZone (ZoneManager.cpp:1144-1155).
   * num = (int)range / 64 (integer division); zone coords drawn with the INT
   * range overload; rejected while the zone-center magnitude ≥ 10000.
   */
  private getRandomZone(state: XorShiftRandom, range: number): ZoneID {
    // Layout-Modus: gleichverteilt über das Layout-Zonenfenster — die Welt
    // hat kein Zentrum mehr; Ozean-Treffer sortiert der Biom-Check des
    // Aufrufers aus (offene See ist im Fenster bewusst enthalten, damit
    // Küsten-Locations wie Wracks eine Chance haben).
    if (this.layoutZonen) {
      const z = this.layoutZonen;
      return {
        x: state.rangeInt(z.minX, z.maxX + 1),
        y: state.rangeInt(z.minY, z.maxY + 1),
      };
    }
    const num = Math.trunc(Math.trunc(range) / ZONE_UNITS);
    let zone: ZoneID;
    do {
      // (float) state.range(-num, num) — int overload; num=0 ⇒ no rng draw
      const x = state.rangeInt(-num, num);
      const y = state.rangeInt(-num, num);
      zone = { x, y };
    } while (mag3f(zoneToWorldPos(zone)) >= FEATURE_WORLD_EDGE);
    return zone;
  }

  /**
   * C++ IZoneManager::GetRandomPointInZone (ZoneManager.cpp:1135-1142).
   * num = 32.f; x/z = range(-num + locationRadius, num - locationRadius)
   * (float overload — NOT swapped when inverted); pos = zone*64 + (x, 0, z).
   */
  private getRandomPointInZone(
    state: XorShiftRandom,
    zone: ZoneID,
    locationRadius: number
  ): Vector3 {
    const pos = zoneToWorldPos(zone);
    const min = f32(-HALF_ZONE_F + locationRadius);
    const max = f32(HALF_ZONE_F - locationRadius);
    const x = state.rangeFloat(min, max);
    const z = state.rangeFloat(min, max);
    return { x: f32(pos.x + x), y: 0, z: f32(pos.z + z) };
  }

  /**
   * C++ IZoneManager::HaveLocationInRange (ZoneManager.cpp:1120-1133) —
   * true when an instance of the same feature (or same non-empty group) is
   * within minDistanceFromSimilar (3D float distance).
   */
  private haveLocationInRange(feature: Feature, p: Vector3): boolean {
    for (const inst of this.generatedFeatures.values()) {
      if (
        (inst.feature.hash === feature.hash ||
          (feature.group !== '' && feature.group === inst.feature.group)) &&
        dist3f(inst.pos, p) < feature.minDistanceFromSimilar
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * C++ ::CheckSurroundingTerrain (ZoneManager.cpp:944-974) — count samples
   * on the perimeter circle whose height clears minAltitude (anti-island
   * check from location-overrides).
   */
  private checkSurroundingTerrain(
    center: Vector3,
    radius: number,
    minAltitude: number,
    numSamples: number,
    minValidPoints: number
  ): boolean {
    let validPoints = 0;
    for (let i = 0; i < numSamples; i++) {
      // C++: (2.0f * 3.14159265f * i) / numSamples — f32 throughout
      const angle = f32(f32(f32(2 * 3.14159265) * i) / numSamples);
      const checkX = f32(center.x + f32(radius * f32(Math.cos(angle))));
      const checkZ = f32(center.z + f32(radius * f32(Math.sin(angle))));
      const height = this.geo.getHeight(checkX, checkZ);
      const waterDiff = f32(height - WATER_LEVEL);
      if (waterDiff >= minAltitude) validPoints++;
    }
    return validPoints >= minValidPoints;
  }

  /**
   * C++ IZoneManager::TryGenerateFeature (ZoneManager.cpp:1158-1234) —
   * materialize the feature instance booked for this zone (if any).
   * Returns the ClearAreas for PopulateFoliage.
   */
  private tryGenerateFeature(zone: ZoneID): ClearArea[] {
    const clearAreas: ClearArea[] = [];
    const inst = this.generatedFeatures.get(zoneKey(zone.x, zone.y));
    if (!inst) return clearAreas;

    const feature = inst.feature;
    const position: Vector3 = { ...inst.pos };

    // m_snapToWater is Mistlands only
    if (feature.snapToWater) position.y = WATER_LEVEL;

    // [HEIGHTFIX-04]: m_clearArea ⇒ exteriorRadius; else terrain_modifiers.yml
    // level_radius (prevents vegetation inside terrain-modified areas).
    if (feature.clearArea) {
      clearAreas.push({ center: { ...position }, radius: feature.exteriorRadius });
    } else {
      const mod = getFeatureModifierParams(feature.name);
      if (mod) {
        clearAreas.push({ center: { ...position }, radius: mod.radius });
      }
    }

    // F4: terrain leveling — see registerTerrainModifier.
    this.registerTerrainModifier(feature, position);

    let rot: Quaternion = { x: 0, y: 0, z: 0, w: 1 };
    // Phase G: Locations mit DUNGEON-Piece bleiben unrotiert — ihre
    // sichtbare Eingangs-Hülle wird als separates ZDO mit Identitäts-
    // Rotation gespawnt (DungeonManager.spawnEntranceHull, auch für längst
    // generierte Zonen beim Boot), und rotierte Spawner/Tore stünden sonst
    // schief zur Hülle. Die Rotation war ohnehin zeit-geseedet, also nie
    // welt-deterministisch — es geht keine Reproduzierbarkeit verloren.
    const hatDungeonPiece =
      this.dungeonsEnabled &&
      getFeaturePieces(feature.name).some((p) => {
        const def = findPrefabByHash(p.prefabHash);
        return def !== undefined && (def.flags & PrefabFlag.DUNGEON) !== 0n;
      });
    if (feature.randomRotation && !hatDungeonPiece) {
      // C++ VUtils::Random::State() default ctor is TIME-seeded
      // (VUtilsRandom.cpp:53-55) — location rotation is deliberately NOT
      // world-deterministic in C++ either; mirror with a random seed.
      const n = new XorShiftRandom((Math.random() * 0x100000000) | 0).rangeInt(0, 16);
      rot = quatEuler(0, f32(n * 22.5), 0);
    }

    const seed = (this.seed + Math.imul(zone.x, 4271) + Math.imul(zone.y, 9187)) | 0;
    this.generateFeature(feature, seed, position, rot);

    console.log(
      `[WoV] Placed '${feature.name}' in zone ${zone.x},${zone.y} ` +
        `(${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`
    );

    // Remove all other Haldor locations, etc...
    if (feature.unique) {
      this.removeUngeneratedFeatures(feature);
    }

    // iconPlaced ⇒ SendLocationIcons — client map protocol is Phase G.

    return clearAreas;
  }

  /**
   * F4 terrain leveling (Unity TerrainModifier parity — the C++ server
   * does NOT level terrain; without this pieces float up to ~5m on
   * slopes). Called from tryGenerateFeature at GENERATION time:
   * booked-but-removed unique features (Haldor) never register a modifier,
   * and same-zone foliage placed right after already sees the leveled
   * ground. Target = booked geo height + levelOffset, so pieces and
   * plateau stay consistent. Also replayed by restoreGeneratedZones on
   * world load — loaded zones skip generateZone, so without the replay
   * pieces would float again after every restart.
   */
  private registerTerrainModifier(feature: Feature, position: Vector3): void {
    const leveling = getTerrainLeveling(feature);
    if (!leveling) return;
    this.heightmaps.addTerrainModifier({
      x: position.x,
      z: position.z,
      targetHeight: f32(position.y + leveling.levelOffset),
      levelRadius: leveling.levelRadius,
      smoothRadius: leveling.smoothRadius,
      smoothPower: leveling.smoothPower,
      square: leveling.square,
    });
  }

  /**
   * C++ IZoneManager::GenerateFeature (ZoneManager.cpp:1254-1331) —
   * instantiate all pieces + the LocationProxy ZDO.
   *
   * NOTE: C++ creates State(seed) but only dungeon generation consumes it;
   * RandomSpawn chances are parsed but never rolled — ALL pieces spawn.
   */
  private generateFeature(
    feature: Feature,
    seed: number,
    pos: Vector3,
    rot: Quaternion
  ): void {
    const override = this.locationOverrides ? getLocationOverride(feature.name) : null;
    const snapToTerrain = override?.snapToTerrain ?? false;

    let skippedDungeons = 0;
    for (const piece of getFeaturePieces(feature.name)) {
      const prefab = findPrefabByHash(piece.prefabHash);

      // pieceWorldPos = pos + rot * piece.m_pos (f32 adds)
      const rotated = quatMulVec3(rot, piece.pos);
      const pieceWorldPos: Vector3 = {
        x: f32(pos.x + rotated.x),
        y: f32(pos.y + rotated.y),
        z: f32(pos.z + rotated.z),
      };

      // C++: dungeonsEnabled && DUNGEON flag ⇒ DungeonManager. Phase G:
      // the DG_* piece itself never spawns — instead the hook registers a
      // world entrance mapped to a dungeon instance document. The hook gets
      // the FEATURE position (ground level), not the piece position: DG
      // pieces sit at +5000 y inside the location prefab, and the entrance
      // (map marker, enter radius, hull) belongs at the location.
      // When dungeons are disabled C++ spawns the piece normally.
      if (
        this.dungeonsEnabled &&
        prefab &&
        (prefab.flags & PrefabFlag.DUNGEON) !== 0n
      ) {
        // Camps (CampRadial: Dörfer, Farmen, GoblinCamp, Ruinen-Cluster)
        // sind OBERWELT-Strukturen: hier direkt generieren und als ZDOs
        // spawnen — Gebäude schmiegen sich einzeln ans Gelände. Interior-
        // Dungeons laufen weiter über den Instanz-Hook.
        const dgDef = getDungeonByHash(piece.prefabHash);
        if (dgDef && dgDef.algorithm === DungeonAlgorithm.CampRadial) {
          this.spawnCamp(dgDef, seed, pieceWorldPos, feature.name);
          continue;
        }

        skippedDungeons++;
        if (this.onDungeonPiece) {
          const zx = HeightmapProvider.worldToZone(pos.x);
          const zy = HeightmapProvider.worldToZone(pos.z);
          this.onDungeonPiece(feature.name, piece.prefabHash, zoneKey(zx, zy), pos, seed);
        }
        continue;
      }

      // SNAP_TO_TERRAIN override: ground height + feature-local y offset
      if (snapToTerrain) {
        pieceWorldPos.y = f32(
          this.geo.getHeight(pieceWorldPos.x, pieceWorldPos.z) + piece.pos.y
        );
      }

      const zdo = this.zdos.createZDO(piece.prefabHash, pieceWorldPos, quatMul(rot, piece.rot));
      this.applyInitialScale(zdo, prefab);
    }

    if (skippedDungeons > 0) {
      console.log(
        `[WoV] '${feature.name}': ${skippedDungeons} dungeon piece(s) skipped (Phase G)`
      );
    }

    // GenerateLocationProxy (ZoneManager.cpp:1335-1343) — carries the
    // location hash + zone seed for client-side location model generation.
    const proxy = this.zdos.createZDO(LOCATION_PROXY_HASH, { ...pos }, rot);
    this.applyInitialScale(proxy, findPrefabByHash(LOCATION_PROXY_HASH));
    proxy.setInt('location', feature.hash);
    proxy.setInt('seed', seed);
  }

  /**
   * C++ IZoneManager::RemoveUngeneratedFeatures (ZoneManager.cpp:1237-1252) —
   * unique features: drop booked instances whose zone isn't generated yet.
   */
  private removeUngeneratedFeatures(feature: Feature): void {
    let count = 0;
    for (const [key, inst] of this.generatedFeatures) {
      if (inst.feature.hash !== feature.hash) continue;
      const zx = HeightmapProvider.worldToZone(inst.pos.x);
      const zy = HeightmapProvider.worldToZone(inst.pos.z);
      if (!this.generated.has(zoneKey(zx, zy))) {
        this.generatedFeatures.delete(key);
        count++;
      }
    }
    console.log(`[WoV] Removed ${count} unplaced '${feature.name}'`);
  }

  /** Camp generieren und als ZDOs spawnen (Gebäude schmiegen sich ans Gelände). */
  private spawnCamp(
    dgDef: NonNullable<ReturnType<typeof getDungeonByHash>>,
    seed: number,
    origin: Vector3,
    featureName: string
  ): void {
    const layout = generateCampLayout(
      dgDef,
      seed,
      origin,
      (x, z) => {
        const y = this.heightmaps.getGroundHeight(x, z);
        const dx =
          this.heightmaps.getGroundHeight(x + 0.5, z) - this.heightmaps.getGroundHeight(x - 0.5, z);
        const dz =
          this.heightmaps.getGroundHeight(x, z + 0.5) - this.heightmaps.getGroundHeight(x, z - 0.5);
        return { y, normalY: 1 / Math.hypot(dx, 1, dz) };
      },
      WATER_LEVEL
    );
    let campZdos = 0;
    for (const item of flattenLayout(layout, dgDef.name)) {
      const zdo = this.zdos.createZDO(item.prefabHash, item.pos, item.rot);
      this.applyInitialScale(zdo, findPrefabByHash(item.prefabHash));
      campZdos++;
    }
    console.log(
      `[WoV] Camp '${dgDef.name}' @ '${featureName}': ` +
        `${layout.rooms.length} Gebäude, ${campZdos} ZDOs`
    );
  }

  /**
   * Boot-Backfill (Phase G): Camps in BEREITS generierten Zonen nachziehen —
   * die liefen vor dem Camp-Generator durch generateFeature und haben ihre
   * DG-Pieces nur übersprungen. Erkannt wird über vorhandene Gebäude-Hüllen
   * im Lagerradius (die sind persistent); einmal gebaute Camps werden also
   * nie doppelt gespawnt. NACH loadWorld aufrufen (ZDO-ID-Vergabe).
   */
  backfillCamps(): number {
    let built = 0;
    for (const [key, inst] of this.generatedFeatures) {
      if (!this.generated.has(key)) continue;
      for (const piece of getFeaturePieces(inst.feature.name)) {
        const dgDef = getDungeonByHash(piece.prefabHash);
        if (!dgDef || dgDef.algorithm !== DungeonAlgorithm.CampRadial) continue;
        const origin: Vector3 = {
          x: f32(inst.pos.x + piece.pos.x),
          y: f32(inst.pos.y + piece.pos.y),
          z: f32(inst.pos.z + piece.pos.z),
        };
        const roomHashes = new Set(dgDef.rooms.map((r) => r.hash));
        const vorhanden = this.zdos
          .getZDOsInRadius(origin, dgDef.campRadiusMax + 8)
          .some((z) => roomHashes.has(z.prefabHash));
        if (vorhanden) continue;
        const [zx, zy] = key.split(',').map(Number);
        const seed = (this.seed + Math.imul(zx, 4271) + Math.imul(zy, 9187)) | 0;
        this.spawnCamp(dgDef, seed, origin, inst.feature.name);
        built++;
      }
    }
    if (built > 0) console.log(`[WoV] Camp-Backfill: ${built} Lager nachgezogen`);
    return built;
  }

  /** Test/diagnostic access: booked feature instance for a zone. */
  getFeatureInstance(zone: ZoneID): { name: string; pos: Vector3 } | undefined {
    const inst = this.generatedFeatures.get(zoneKey(zone.x, zone.y));
    return inst ? { name: inst.feature.name, pos: { ...inst.pos } } : undefined;
  }

  /** Test/diagnostic access: all booked feature instances (unsorted). */
  getFeatureInstances(): Array<{ zone: ZoneID; name: string; pos: Vector3 }> {
    const out: Array<{ zone: ZoneID; name: string; pos: Vector3 }> = [];
    for (const [key, inst] of this.generatedFeatures) {
      const [x, y] = key.split(',').map(Number);
      out.push({ zone: { x, y }, name: inst.feature.name, pos: { ...inst.pos } });
    }
    return out;
  }

  /** Test/diagnostic access: number of booked feature instances. */
  get preparedFeatureCount(): number {
    return this.generatedFeatures.size;
  }
}
