/**
 * SpawnSystem (Phase G2) — server-side creature spawning + wander behavior.
 *
 * There is NO C++ reference for this system: in the original architecture
 * the owning Unity client runs the SpawnSystem (ZoneSystem.m_spawnLists),
 * the C++ server only replicates the resulting creature ZDOs. Our browser
 * architecture has no privileged client, so spawning lives server-side
 * here, driven by the AUTHORED table in shared/spawnData.ts (no vanilla
 * reference data exists — documented in Bekannte Einschränkungen #26).
 *
 * Lifecycle per update():
 *  1. Despawn: creatures with no player within despawnRadius are destroyed
 *     (destroy list auto-broadcasts at the next ZDO sync).
 *  2. Spawn rolls: one accumulator per table entry; on expiry one roll per
 *     player (chance → caps → ring anchor → gates: zone generated, biome,
 *     ground above water → group scatter → createZDO).
 *  3. Simulation: creatures with a player within simRadius run a small
 *     state machine (idle → walk to wander target; deer flee from close
 *     players). Positions integrate every tick; the ZDO data revision is
 *     bumped only every syncIntervalSec (4 Hz) — the revision compare in
 *     syncZDOs is the authoritative resend gate, so this throttles
 *     bandwidth without touching the movement granularity.
 *
 * Determinism: simTime is the only clock; inject a seeded XorShiftRandom
 * via options for reproducible tests (C++ parity: the original client-side
 * spawning is not world-deterministic either — same as randomRotation).
 *
 * Persistence: creature prefabs carry PERSISTENT in the pkg, so spawned
 * ZDOs flow into the G1 save automatically. adoptPersisted() (called after
 * loadWorld) re-registers restored creatures so they simulate/despawn
 * correctly after a restart instead of accumulating forever.
 */

import type { Hash, Vector3, Quaternion } from '@wov/shared';
import {
  GeoManager,
  RegionGeo,
  HeightmapProvider,
  XorShiftRandom,
  getStableHash,
  SPAWN_TABLE,
  SPAWN_DESPAWN_RADIUS,
  SPAWN_SIM_RADIUS,
  SPAWN_SYNC_INTERVAL_SEC,
  HEALTH_MEMBER,
  maxLeben,
  istEigenesModell,
  type SpawnEntry,
} from '@wov/shared';
import type { ZDOManager } from '../zdo/ZDOManager.js';
import type { ZDO } from '../zdo/ZDO.js';
import type { ZoneManager } from './ZoneManager.js';

export interface SpawnSystemOptions {
  /** Table override for tests (defaults to SPAWN_TABLE). */
  table?: readonly SpawnEntry[];
  /** RNG override for deterministic tests (default: time-seeded). */
  rng?: XorShiftRandom;
  despawnRadius?: number;
  simRadius?: number;
  syncIntervalSec?: number;
}

type CreatureMode = 'idle' | 'walk' | 'flee' | 'chase';

interface CreatureState {
  readonly zdo: ZDO;
  readonly entry: SpawnEntry;
  /** Wander anchor (spawn point / adoption position). */
  home: Vector3;
  mode: CreatureMode;
  /** Current walk target (walk mode). */
  target: Vector3;
  /** simTime until which the idle pause lasts. */
  idleUntil: number;
  /** Accumulator for the 4 Hz revision throttle. */
  syncAccum: number;
  /** Angriffstakt im Chase-Modus (s seit letztem Schlag). */
  attackAccum?: number;
}

/**
 * Zweite Verteidigungslinie hinter `bauSpawnTabelle()` (shared/spawnData.ts).
 *
 * Die erste Filterung sitzt dort, wo SPAWN_TABLE entsteht — das ist die
 * eine Stelle je Tabelle. Sie deckt aber nur die eine Tabelle ab: Das
 * SpawnSystem nimmt ueber `SpawnSystemOptions.table` beliebige Eintraege
 * entgegen (Tests, kuenftige Layout-Tabellen), und createZDO fragt nicht
 * nach, ob es zu dem Hash je ein Modell gab. Ein Wesen ohne Modell ist
 * fuer den Spieler eine unsichtbare Kollision, die zuschlaegt — der
 * Fehler, der am schwersten zu deuten ist.
 *
 * Nicht still: Wer eine Tabelle injiziert und nichts spawnen sieht, soll
 * im Log lesen koennen, warum.
 */
function nurEigeneModelle(tabelle: readonly SpawnEntry[]): readonly SpawnEntry[] {
  const liste = tabelle.filter((e) => istEigenesModell(e.prefab));
  const uebersprungen = tabelle.length - liste.length;
  if (uebersprungen > 0) {
    console.warn(
      `[spawns] ${uebersprungen} von ${tabelle.length} Eintraegen ohne eigenes Modell uebersprungen`
    );
  }
  return liste;
}

const TWO_PI = Math.PI * 2;
/** Arrival tolerance for wander targets (meters). */
const ARRIVE_DIST = 0.4;

export class SpawnSystem {
  private readonly table: readonly SpawnEntry[];
  private readonly rng: XorShiftRandom;
  private readonly despawnRadius: number;
  private readonly simRadius: number;
  private readonly syncIntervalSec: number;

  private readonly creatures = new Map<string, CreatureState>();
  private readonly spawnAccums: number[];
  /** Simulated seconds since construction (sole clock — no Date.now). */
  private simTime = 0;

  constructor(
    private readonly zdos: ZDOManager,
    private readonly geo: GeoManager,
    private readonly heightmaps: HeightmapProvider,
    private readonly zones: ZoneManager,
    options: SpawnSystemOptions = {}
  ) {
    this.table = nurEigeneModelle(options.table ?? SPAWN_TABLE);
    // C++ parity: time-seeded default RNG (VUtilsRandom.cpp:53-55, same as
    // location randomRotation) — tests inject a seeded one.
    this.rng = options.rng ?? new XorShiftRandom((Date.now() & 0x7fffffff) | 0);
    this.despawnRadius = options.despawnRadius ?? SPAWN_DESPAWN_RADIUS;
    this.simRadius = options.simRadius ?? SPAWN_SIM_RADIUS;
    this.syncIntervalSec = options.syncIntervalSec ?? SPAWN_SYNC_INTERVAL_SEC;
    this.spawnAccums = this.table.map(() => 0);
  }

  get creatureCount(): number {
    return this.creatures.size;
  }

  /**
   * Trefferpunkte anlegen, falls die ZDO noch keine hat.
   *
   * Warum beim Spawn und nicht erst beim ersten Treffer (so war es
   * bisher): Ohne den Member kann der Client keinen Lebensbalken zeichnen
   * — „Member fehlt" und „0 Trefferpunkte" wären sonst dasselbe. Und weil
   * jede Kreatur beim Boot durch `adoptPersisted` läuft, holt derselbe
   * Aufruf die Wesen aus älteren Saves nach.
   *
   * `getInt` liefert 0, wenn der Member fehlt — genau das ist der Fall,
   * den wir füllen wollen. Ein Wesen mit 0 Trefferpunkten gibt es nicht,
   * es wäre längst zerstört.
   */
  private stelleLebenSicher(zdo: ZDO, prefab: string): void {
    if (zdo.getInt(HEALTH_MEMBER) > 0) return;
    zdo.setInt(HEALTH_MEMBER, maxLeben(prefab));
    zdo.revision.reviseData();
    zdo.dirty = true;
  }

  /**
   * Re-register creature ZDOs restored from the world save (call after
   * loadWorld). Their spawn position becomes their wander anchor.
   */
  adoptPersisted(): void {
    for (const entry of this.table) {
      const hash = getStableHash(entry.prefab);
      for (const zdo of this.zdos.getZDOByPrefab(hash)) {
        const key = zdo.zdoid.toString();
        if (this.creatures.has(key)) continue;
        this.stelleLebenSicher(zdo, entry.prefab);
        this.creatures.set(key, {
          zdo,
          entry,
          home: { ...zdo.position },
          mode: 'idle',
          target: { ...zdo.position },
          idleUntil: 0,
          syncAccum: 0,
        });
      }
    }
  }

  /**
   * Einzelne ZDO mit synthetischem Entry adoptieren (Boss, NPC): bekommt
   * Wander-/Chase-Verhalten, ohne in der Spawn-Tabelle zu stehen.
   */
  adoptSingle(zdo: ZDO, entry: SpawnEntry): void {
    // Dieselbe Pruefung wie bei der Tabelle, und hier ist sie noetiger:
    // Bosse und Layout-NPCs kommen ueber synthetische Eintraege herein und
    // gehen an der Tabelle absichtlich vorbei. Wer hier durchkaeme, waere
    // eine unsichtbare Huelle, die den Spieler verfolgt und zuschlaegt.
    //
    // Die ZDO selbst bleibt bestehen — sie zu zerstoeren waere hier der
    // falsche Ort: Dieses System simuliert, es raeumt nicht auf. Wer den
    // Eikthyr aus der Welt nehmen will, tut das dort, wo er entsteht
    // (WovServer, Altar-Opfergabe), nicht in der Wander-KI.
    if (!istEigenesModell(entry.prefab)) {
      console.warn(
        `[spawns] '${entry.prefab}' ohne eigenes Modell — nicht adoptiert, die ZDO simuliert nicht`
      );
      return;
    }
    const key = zdo.zdoid.toString();
    if (this.creatures.has(key)) return;
    this.stelleLebenSicher(zdo, entry.prefab);
    this.creatures.set(key, {
      zdo,
      entry,
      home: { ...zdo.position },
      mode: 'idle',
      target: { ...zdo.position },
      idleUntil: 0,
      syncAccum: 0,
    });
  }

  /**
   * ZDO aus der Kreatur-Simulation entlassen (ohne sie zu zerstören).
   *
   * Nötig, weil NPC_1-ZDOs beim Boot pauschal als wandernde Kreaturen
   * adoptiert werden: Bekommt so einer per Layout eine Route, würden zwei
   * Systeme dieselbe Position schreiben und der NPC zuckte zwischen
   * Wanderziel und Wegpunkt hin und her.
   */
  entlasse(zdo: ZDO): void {
    this.creatures.delete(zdo.zdoid.toString());
  }

  update(deltaSec: number, peerPositions: readonly Vector3[]): void {
    this.simTime += deltaSec;

    if (peerPositions.length === 0) {
      // Nobody online: nothing simulates, nothing despawns (C++ parity:
      // persistent creatures simply sleep with no clients connected).
      return;
    }

    this.despawnFar(peerPositions);
    this.spawnTick(deltaSec, peerPositions);
    this.simulateTick(deltaSec, peerPositions);
  }

  // ── Despawn ──────────────────────────────────────────────────────

  private despawnFar(peerPositions: readonly Vector3[]): void {
    const rSqr = this.despawnRadius * this.despawnRadius;
    for (const [key, c] of this.creatures) {
      if (c.entry.despawns === false) continue;
      if (!this.anyPeerWithin(c.zdo.position, peerPositions, rSqr)) {
        this.zdos.destroyZDO(c.zdo.zdoid);
        this.creatures.delete(key);
      }
    }
  }

  // ── Spawning ─────────────────────────────────────────────────────

  private spawnTick(deltaSec: number, peerPositions: readonly Vector3[]): void {
    for (let i = 0; i < this.table.length; i++) {
      const entry = this.table[i];
      this.spawnAccums[i] += deltaSec;
      if (this.spawnAccums[i] < entry.spawnIntervalSec) continue;
      this.spawnAccums[i] -= entry.spawnIntervalSec;

      for (const peerPos of peerPositions) {
        if (this.rng.nextFloat() >= entry.spawnChance) continue;
        this.trySpawnAt(entry, peerPos);
      }
    }
  }

  private trySpawnAt(entry: SpawnEntry, peerPos: Vector3): void {
    // Caps: per-player area + server-wide safety
    if (this.countGlobal(entry) >= entry.globalMax) return;
    if (this.countNear(entry, peerPos, entry.countRadius) >= entry.maxPerPlayer) return;

    // Ring anchor around the player
    const angle = this.rng.rangeFloat(0, TWO_PI);
    const dist = this.rng.rangeFloat(entry.ringMin, entry.ringMax);
    const ax = peerPos.x + Math.cos(angle) * dist;
    const az = peerPos.z + Math.sin(angle) * dist;

    // Gates: zone generated, biome match, above water
    if (!this.zones.isZoneGenerated({
      x: HeightmapProvider.worldToZone(ax),
      y: HeightmapProvider.worldToZone(az),
    })) return;
    if ((this.geo.getBiome(ax, az) & entry.biomes) === 0) return;
    if (this.heightmaps.getGroundHeight(ax, az) < entry.minAltitude) return;
    // Kuratierte Region (Layout-Modus): Spawn-Liste ist exklusiv.
    if (this.geo instanceof RegionGeo) {
      const region = this.geo.regionAt(ax, az);
      if (region?.spawns && !region.spawns.includes(entry.prefab)) return;
    }

    // Group scatter around the anchor (each member re-checked for ground)
    const groupSize = this.rng.rangeInt(entry.groupSizeMin, entry.groupSizeMax + 1);
    const hash = getStableHash(entry.prefab);
    for (let m = 0; m < groupSize; m++) {
      const mx = m === 0 ? ax : ax + this.rng.rangeFloat(-entry.groupRadius, entry.groupRadius);
      const mz = m === 0 ? az : az + this.rng.rangeFloat(-entry.groupRadius, entry.groupRadius);
      const ground = this.heightmaps.getGroundHeight(mx, mz);
      if (ground < entry.minAltitude) continue;

      const yaw = this.rng.rangeFloat(0, TWO_PI);
      const rot = yawQuaternion(yaw);
      const zdo = this.zdos.createZDO(hash, { x: mx, y: ground, z: mz }, rot);
      this.stelleLebenSicher(zdo, entry.prefab);
      this.creatures.set(zdo.zdoid.toString(), {
        zdo,
        entry,
        home: { x: mx, y: ground, z: mz },
        mode: 'idle',
        target: { x: mx, y: ground, z: mz },
        idleUntil: this.simTime + this.rng.rangeFloat(entry.idleMinSec, entry.idleMaxSec),
        syncAccum: 0,
      });
    }
  }

  // ── Simulation (wander / flee) ───────────────────────────────────

  /** Kreatur greift an: Position, Schaden, Radius — verdrahtet der Server. */
  onCreatureAttack: ((pos: Vector3, damage: number, radius: number) => void) | null = null;

  private simulateTick(deltaSec: number, peerPositions: readonly Vector3[]): void {
    const simSqr = this.simRadius * this.simRadius;
    for (const [key, c] of this.creatures) {
      // Extern getötet (Spieler-Angriff): Zustand aufräumen.
      if (c.zdo.destroyed) {
        this.creatures.delete(key);
        continue;
      }
      // Cheap rest when no player is near (position untouched, bit-exact)
      const nearest = this.nearestPeer(c.zdo.position, peerPositions);
      if (!nearest || nearest.distSqr > simSqr) continue;

      const entry = c.entry;

      // Aggro (Monster): verfolgen statt fliehen; Nahdistanz → zuschlagen.
      if (!entry.flees && entry.aggro !== false) {
        if (c.mode !== 'chase' && nearest.distSqr < 20 * 20) {
          c.mode = 'chase';
        } else if (c.mode === 'chase' && nearest.distSqr > 32 * 32) {
          c.mode = 'idle';
          c.idleUntil = this.simTime + this.rng.rangeFloat(entry.idleMinSec, entry.idleMaxSec);
        }
        if (c.mode === 'chase') {
          const dist = Math.sqrt(nearest.distSqr);
          if (dist > 1.7) {
            const dx = nearest.pos.x - c.zdo.position.x;
            const dz = nearest.pos.z - c.zdo.position.z;
            this.moveStep(c, dx / dist, dz / dist, entry.runSpeed * deltaSec);
          } else {
            c.attackAccum = (c.attackAccum ?? 0) + deltaSec;
            if (c.attackAccum >= 2) {
              c.attackAccum = 0;
              this.onCreatureAttack?.(c.zdo.position, 8, 2.4);
            }
          }
          c.syncAccum += deltaSec;
          if (c.syncAccum >= this.syncIntervalSec) {
            c.syncAccum -= this.syncIntervalSec;
            c.zdo.revision.reviseData();
            c.zdo.dirty = true;
          }
          continue;
        }
      }

      // Flee gate (skittish creatures only)
      if (entry.flees) {
        if (c.mode !== 'flee' && nearest.distSqr < entry.fleeDistance * entry.fleeDistance) {
          c.mode = 'flee';
        } else if (c.mode === 'flee' && nearest.distSqr > entry.calmDistance * entry.calmDistance) {
          c.mode = 'idle';
          c.idleUntil = this.simTime + this.rng.rangeFloat(entry.idleMinSec, entry.idleMaxSec);
        }
      }

      if (c.mode === 'flee') {
        // Straight away from the nearest player
        const dx = c.zdo.position.x - nearest.pos.x;
        const dz = c.zdo.position.z - nearest.pos.z;
        const len = Math.hypot(dx, dz) || 1;
        this.moveStep(c, dx / len, dz / len, entry.runSpeed * deltaSec);
      } else if (c.mode === 'idle') {
        if (this.simTime >= c.idleUntil) {
          // New wander target around the home anchor; water targets are
          // skipped (stay idle another second and retry)
          const angle = this.rng.rangeFloat(0, TWO_PI);
          const dist = this.rng.rangeFloat(0, entry.wanderRadius);
          const tx = c.home.x + Math.cos(angle) * dist;
          const tz = c.home.z + Math.sin(angle) * dist;
          if (this.heightmaps.getGroundHeight(tx, tz) >= entry.minAltitude) {
            c.target = { x: tx, y: 0, z: tz };
            c.mode = 'walk';
          } else {
            c.idleUntil = this.simTime + 1;
          }
        }
      } else {
        // walk toward the target
        const dx = c.target.x - c.zdo.position.x;
        const dz = c.target.z - c.zdo.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= ARRIVE_DIST) {
          c.mode = 'idle';
          c.idleUntil = this.simTime + this.rng.rangeFloat(entry.idleMinSec, entry.idleMaxSec);
        } else {
          const step = Math.min(entry.walkSpeed * deltaSec, dist);
          const moved = this.moveStep(c, dx / dist, dz / dist, step);
          if (!moved) {
            // Blocked by water on all axes — give up on this target
            c.mode = 'idle';
            c.idleUntil = this.simTime + this.rng.rangeFloat(entry.idleMinSec, entry.idleMaxSec);
          }
        }
      }

      // 4 Hz revision throttle: position lives in the ZDO wire header, and
      // the revision compare in syncZDOs is the authoritative resend gate.
      c.syncAccum += deltaSec;
      if (c.syncAccum >= this.syncIntervalSec) {
        c.syncAccum -= this.syncIntervalSec;
        c.zdo.revision.reviseData();
        c.zdo.dirty = true;
      }
    }
  }

  /**
   * Integrate one movement step with water deflection: if the ground at
   * the next position is below minAltitude, try the X and Z components
   * separately (slide along the shoreline); fully blocked → no move.
   * Returns whether any movement happened.
   */
  private moveStep(c: CreatureState, dirX: number, dirZ: number, step: number): boolean {
    const p = c.zdo.position;
    const minAlt = c.entry.minAltitude;

    let nx = p.x + dirX * step;
    let nz = p.z + dirZ * step;
    if (this.heightmaps.getGroundHeight(nx, nz) >= minAlt) {
      this.applyMove(c, nx, nz, dirX, dirZ);
      return true;
    }
    // Deflect: X only
    nx = p.x + dirX * step;
    if (this.heightmaps.getGroundHeight(nx, p.z) >= minAlt) {
      this.applyMove(c, nx, p.z, dirX, 0);
      return true;
    }
    // Deflect: Z only
    nz = p.z + dirZ * step;
    if (this.heightmaps.getGroundHeight(p.x, nz) >= minAlt) {
      this.applyMove(c, p.x, nz, 0, dirZ);
      return true;
    }
    return false;
  }

  private applyMove(c: CreatureState, nx: number, nz: number, faceX: number, faceZ: number): void {
    const ground = this.heightmaps.getGroundHeight(nx, nz);
    this.zdos.updateZDOZone(c.zdo, { x: nx, y: ground, z: nz });
    if (faceX !== 0 || faceZ !== 0) {
      const yaw = Math.atan2(faceX, faceZ);
      c.zdo.rotation = yawQuaternion(yaw);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private countGlobal(entry: SpawnEntry): number {
    let n = 0;
    for (const c of this.creatures.values()) {
      if (c.entry === entry) n++;
    }
    return n;
  }

  private countNear(entry: SpawnEntry, pos: Vector3, radius: number): number {
    const rSqr = radius * radius;
    let n = 0;
    for (const c of this.creatures.values()) {
      if (c.entry !== entry) continue;
      const dx = c.zdo.position.x - pos.x;
      const dz = c.zdo.position.z - pos.z;
      if (dx * dx + dz * dz <= rSqr) n++;
    }
    return n;
  }

  private anyPeerWithin(pos: Vector3, peers: readonly Vector3[], rSqr: number): boolean {
    for (const p of peers) {
      const dx = p.x - pos.x;
      const dz = p.z - pos.z;
      if (dx * dx + dz * dz <= rSqr) return true;
    }
    return false;
  }

  private nearestPeer(
    pos: Vector3,
    peers: readonly Vector3[]
  ): { pos: Vector3; distSqr: number } | null {
    let best: { pos: Vector3; distSqr: number } | null = null;
    for (const p of peers) {
      const dx = p.x - pos.x;
      const dz = p.z - pos.z;
      const d = dx * dx + dz * dz;
      if (!best || d < best.distSqr) best = { pos: p, distSqr: d };
    }
    return best;
  }
}

/** Y-axis rotation quaternion (heading), y-up right-handed. */
function yawQuaternion(yaw: number): Quaternion {
  const half = yaw / 2;
  return { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
}
