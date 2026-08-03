/**
 * ZDOManager — manages all ZDOs, sector-based storage, and network sync.
 * 1:1 port of ZDOManager.h from Valhalla2.0 C++.
 *
 * C++ reference:
 *   class IZDOManager {
 *     array<ZDO::reference_set, WORLD_INNER_ZDIAMETER^2> m_objectsBySector;
 *     Map<ZoneID, ZDO::reference_set> m_objectsBySectorOuter;
 *     Map<Hash, ZDO::reference_set> m_objectsByPrefab;
 *     ZDO::unique_set m_objectsByID;
 *     ZDO::soft_set m_erasedZDOs;
 *     ZDO::soft_list m_destroySendList;
 *     uint32 m_nextUid;
 *     ...
 *   };
 */

import type { Hash, ZoneID, Vector3, Quaternion } from '@wov/shared';
import { ZDO_SEND_INTERVAL_MS, WORLD_INNER_ZDIAMETER } from '@wov/shared';
import { ZDO } from './ZDO.js';
import { ZDOID } from './ZDOID.js';
import { ZONE_SIZE } from '@wov/shared';

// ── Zone helpers ───────────────────────────────────────────────────

export function worldToZone(pos: Vector3): ZoneID {
  return {
    x: Math.floor(pos.x / ZONE_SIZE),
    y: Math.floor(pos.z / ZONE_SIZE),
  };
}

export function zoneToIndex(zone: ZoneID): number {
  const half = Math.floor(WORLD_INNER_ZDIAMETER / 2);
  const x = zone.x + half;
  const y = zone.y + half;
  if (x < 0 || x >= WORLD_INNER_ZDIAMETER || y < 0 || y >= WORLD_INNER_ZDIAMETER) {
    return -1; // outer zone
  }
  return y * WORLD_INNER_ZDIAMETER + x;
}

export function zoneKey(zone: ZoneID): string {
  return `${zone.x},${zone.y}`;
}

// ── ZDOManager ─────────────────────────────────────────────────────

export class ZDOManager {
  /** Inner sector storage: flat array indexed by zone */
  private objectsBySector: Map<number, Set<ZDO>>;

  /** Outer sector storage (zones beyond inner diameter) */
  private objectsBySectorOuter: Map<string, Set<ZDO>>;

  /** By prefab hash */
  private objectsByPrefab: Map<Hash, Set<ZDO>>;

  /** By ZDOID (primary lookup) */
  private objectsByID: Map<string, ZDO>;

  /** Recently destroyed ZDOs pending network notification */
  private destroySendList: ZDOID[];

  /** Next unique ID counter */
  private nextUid: number;

  /** Server user ID (for ZDOID ownership) */
  private serverUserId: bigint;

  /** Accumulator for send interval */
  private sendAccumulator: number;

  constructor(serverUserId: bigint) {
    this.objectsBySector = new Map();
    this.objectsBySectorOuter = new Map();
    this.objectsByPrefab = new Map();
    this.objectsByID = new Map();
    this.destroySendList = [];
    this.nextUid = 1;
    this.serverUserId = serverUserId;
    this.sendAccumulator = 0;
  }

  // ── ZDO Creation ─────────────────────────────────────────────────
  // C++ reference: IZDOManager::CreateZDO(Hash prefabHash, Vector3 pos, Quaternion rot)

  createZDO(prefabHash: Hash, position: Vector3, rotation: Quaternion = { x: 0, y: 0, z: 0, w: 1 }): ZDO {
    const zdoid = new ZDOID(this.serverUserId, this.nextUid++);
    const zdo = new ZDO(zdoid, prefabHash, position, rotation);
    zdo.zone = worldToZone(position);

    this._addToIDMap(zdo);
    this._addToSector(zdo);
    this._addToPrefabMap(zdo);

    return zdo;
  }

  /** Create a ZDO with a specific ZDOID (for loading from persistence). */
  createZDOWithID(zdoid: ZDOID, prefabHash: Hash, position: Vector3, rotation: Quaternion): ZDO {
    const zdo = new ZDO(zdoid, prefabHash, position, rotation);
    zdo.zone = worldToZone(position);
    zdo.isNew = false;
    zdo.dirty = false;

    // Update nextUid to avoid collisions
    if (zdoid.userId === this.serverUserId && zdoid.id >= this.nextUid) {
      this.nextUid = zdoid.id + 1;
    }

    this._addToIDMap(zdo);
    this._addToSector(zdo);
    this._addToPrefabMap(zdo);

    return zdo;
  }

  /**
   * Bulk-restore ZDOs from persistence snapshots (C++ ZDOManager::Load).
   * Restored ZDOs are neither dirty nor new (fromSnapshot resets both), so
   * the first sync after a restart is not a re-send storm — clients learn
   * them through the normal interest-management path. nextUid is advanced
   * past every restored server-owned id (C++ saves m_nextUid explicitly;
   * recomputing from the max loaded id is equivalent since ids are only
   * ever handed out monotonically). Returns the restored count.
   */
  restoreFromSnapshots(snapshots: ReadonlyArray<Record<string, unknown>>): number {
    let count = 0;
    for (const data of snapshots) {
      const zdo = ZDO.fromSnapshot(data);
      zdo.zone = worldToZone(zdo.position);

      if (zdo.zdoid.userId === this.serverUserId && zdo.zdoid.id >= this.nextUid) {
        this.nextUid = zdo.zdoid.id + 1;
      }

      this._addToIDMap(zdo);
      this._addToSector(zdo);
      this._addToPrefabMap(zdo);
      count++;
    }
    return count;
  }

  // ── ZDO Lookup ───────────────────────────────────────────────────

  getZDO(zdoid: ZDOID): ZDO | undefined {
    return this.objectsByID.get(zdoid.toString());
  }

  getZDOByPrefab(prefabHash: Hash): ZDO[] {
    const set = this.objectsByPrefab.get(prefabHash);
    return set ? [...set] : [];
  }

  getZDOsInZone(zone: ZoneID): ZDO[] {
    const index = zoneToIndex(zone);
    let set: Set<ZDO> | undefined;
    if (index !== -1) {
      set = this.objectsBySector.get(index);
    } else {
      set = this.objectsBySectorOuter.get(zoneKey(zone));
    }
    return set ? [...set] : [];
  }

  /** Get all ZDOs within a radius around a position. */
  getZDOsInRadius(center: Vector3, radius: number): ZDO[] {
    const results: ZDO[] = [];
    const zoneRadius = Math.ceil(radius / ZONE_SIZE) + 1;
    const centerZone = worldToZone(center);
    const radiusSqr = radius * radius;

    for (let dx = -zoneRadius; dx <= zoneRadius; dx++) {
      for (let dy = -zoneRadius; dy <= zoneRadius; dy++) {
        const zone: ZoneID = { x: centerZone.x + dx, y: centerZone.y + dy };
        const zdos = this.getZDOsInZone(zone);
        for (const zdo of zdos) {
          const ddx = zdo.position.x - center.x;
          const ddz = zdo.position.z - center.z;
          if (ddx * ddx + ddz * ddz <= radiusSqr) {
            results.push(zdo);
          }
        }
      }
    }

    return results;
  }

  get totalZDOCount(): number {
    return this.objectsByID.size;
  }

  // ── ZDO Destruction ──────────────────────────────────────────────
  // C++ reference: IZDOManager::DestroyZDO(ZDOID)

  destroyZDO(zdoid: ZDOID): boolean {
    const key = zdoid.toString();
    const zdo = this.objectsByID.get(key);
    if (!zdo) return false;

    zdo.destroyed = true;
    this._removeFromIDMap(zdo);
    this._removeFromSector(zdo);
    this._removeFromPrefabMap(zdo);
    this.destroySendList.push(zdoid);

    return true;
  }

  /** Get and clear the destroy send list (for network sync). */
  consumeDestroyList(): ZDOID[] {
    const list = this.destroySendList;
    this.destroySendList = [];
    return list;
  }

  // ── ZDO Movement (zone change) ───────────────────────────────────
  // C++ reference: IZDOManager::_InvalidateZDOZone(ZDO::reference)

  updateZDOZone(zdo: ZDO, newPosition: Vector3): void {
    const newZone = worldToZone(newPosition);
    if (newZone.x === zdo.zone.x && newZone.y === zdo.zone.y) {
      zdo.position = newPosition;
      return;
    }

    this._removeFromSector(zdo);
    zdo.position = newPosition;
    zdo.zone = newZone;
    this._addToSector(zdo);
  }

  // ── Network Sync ─────────────────────────────────────────────────
  // C++ reference: IZDOManager::SendZDOs(Peer::Ptr)
  // Called every ZDO_SEND_INTERVAL_MS

  /** Collect dirty ZDOs for a given zone set (interest management). */
  collectDirtyZDOs(zones: ZoneID[]): ZDO[] {
    const result: ZDO[] = [];
    const seen = new Set<string>();

    for (const zone of zones) {
      const zdos = this.getZDOsInZone(zone);
      for (const zdo of zdos) {
        const key = zdo.zdoid.toString();
        if (!seen.has(key) && (zdo.dirty || zdo.isNew)) {
          result.push(zdo);
          seen.add(key);
        }
      }
    }

    return result;
  }

  /** Mark ZDOs as synced after sending. */
  markSynced(zdos: ZDO[]): void {
    for (const zdo of zdos) {
      zdo.dirty = false;
      zdo.isNew = false;
    }
  }

  /** Get all ZDOs for persistence save. */
  getAllZDOs(): ZDO[] {
    return [...this.objectsByID.values()];
  }

  /** Get persistent ZDOs only (for world save). */
  getPersistentZDOs(): ZDO[] {
    return [...this.objectsByID.values()].filter(z => z.isPersistent());
  }

  // ── Internal helpers ─────────────────────────────────────────────

  private _addToIDMap(zdo: ZDO): void {
    this.objectsByID.set(zdo.zdoid.toString(), zdo);
  }

  private _removeFromIDMap(zdo: ZDO): void {
    this.objectsByID.delete(zdo.zdoid.toString());
  }

  private _addToSector(zdo: ZDO): void {
    const index = zoneToIndex(zdo.zone);
    if (index !== -1) {
      let set = this.objectsBySector.get(index);
      if (!set) {
        set = new Set();
        this.objectsBySector.set(index, set);
      }
      set.add(zdo);
    } else {
      const key = zoneKey(zdo.zone);
      let set = this.objectsBySectorOuter.get(key);
      if (!set) {
        set = new Set();
        this.objectsBySectorOuter.set(key, set);
      }
      set.add(zdo);
    }
  }

  private _removeFromSector(zdo: ZDO): void {
    const index = zoneToIndex(zdo.zone);
    if (index !== -1) {
      this.objectsBySector.get(index)?.delete(zdo);
    } else {
      this.objectsBySectorOuter.get(zoneKey(zdo.zone))?.delete(zdo);
    }
  }

  private _addToPrefabMap(zdo: ZDO): void {
    let set = this.objectsByPrefab.get(zdo.prefabHash);
    if (!set) {
      set = new Set();
      this.objectsByPrefab.set(zdo.prefabHash, set);
    }
    set.add(zdo);
  }

  private _removeFromPrefabMap(zdo: ZDO): void {
    this.objectsByPrefab.get(zdo.prefabHash)?.delete(zdo);
  }
}
