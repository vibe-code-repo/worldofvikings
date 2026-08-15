/**
 * ZDO — Zone Data Object.
 * 1:1 port of ZDO.h from Valhalla2.0 C++.
 *
 * C++ reference:
 *   class ZDO {
 *     class Rev { BitPack<uint32, 23, 9> m_pack; };
 *     ZDOID m_id;
 *     Hash m_prefabHash;
 *     Vector3f m_position;
 *     Quaternion m_rotation;
 *     Rev m_rev;
 *     member_map m_members;  // hash -> variant<float,vec3,quat,int,long,string,bytes>
 *     ...
 *   };
 *
 * Member types (from ZDO.h NETWORK_* constants):
 *   0=Float, 1=Vec3, 2=Quat, 3=Int, 4=Long, 5=String, 6=ByteArray
 */

import type { Hash, Vector3, Quaternion, ZoneID } from '@wov/shared';
import { ZDOID } from './ZDOID.js';
import { BitPack32 } from '../util/BitPack.js';
import { getStableHash } from '../util/Hash.js';

// ── ZDO Revision (ZDO::Rev) ────────────────────────────────────────
// C++ reference: BitPack<uint32, 23, 32-23>
//   DATA_REVISION_PACK_INDEX = 0 (23 bits)
//   OWNER_REVISION_PACK_INDEX = 1 (9 bits)

const DATA_REV_BITS = 23;
const OWNER_REV_BITS = 32 - DATA_REV_BITS; // 9

export class ZDORevision {
  private pack: BitPack32;

  constructor(dataRev = 0, ownerRev = 0) {
    this.pack = new BitPack32([DATA_REV_BITS, OWNER_REV_BITS]);
    this.pack.set(0, dataRev);
    this.pack.set(1, ownerRev);
  }

  get dataRevision(): number {
    return this.pack.get(0);
  }

  get ownerRevision(): number {
    return this.pack.get(1);
  }

  set dataRevision(v: number) {
    this.pack.set(0, v);
  }

  set ownerRevision(v: number) {
    this.pack.set(1, v);
  }

  reviseData(): void {
    this.pack.set(0, (this.dataRevision + 1) & ((1 << DATA_REV_BITS) - 1));
  }

  reviseOwner(): void {
    this.pack.set(1, (this.ownerRevision + 1) & ((1 << OWNER_REV_BITS) - 1));
  }

  get raw(): number {
    return this.pack.raw;
  }

  set raw(v: number) {
    this.pack.raw = v;
  }
}

// ── ZDO Member value types ─────────────────────────────────────────

export type ZDOMemberValue =
  | number      // Float (0) or Int (3)
  | bigint      // Long (4)
  | string      // String (5)
  | Buffer      // ByteArray (6)
  | Vector3     // Vec3 (1)
  | Quaternion; // Quat (2)

export interface ZDOMember {
  type: number; // 0-6
  value: ZDOMemberValue;
  /**
   * Datenrevision, bei der dieser Member zuletzt geschrieben wurde (D6).
   *
   * Der Peer merkt sich ohnehin schon die Datenrevision, die er zuletzt
   * bekommen hat. Damit ist „welche Member kennt dieser Peer noch nicht"
   * ein reiner Zahlenvergleich `rev > peerRev` — es braucht KEINE Kopie des
   * Member-Satzes je Peer und je ZDO (bei 50 Spielern × ein paar tausend
   * ZDOs im Sichtfeld wäre das der teuerste Speicherposten des Servers).
   *
   * Aus dem Save geladene Member starten bei 0: Ein Peer bekommt ein ZDO
   * immer erst einmal VOLLSTÄNDIG (er hat noch keinen Eintrag dafür), und
   * ab da zählt nur noch, was danach geschrieben wurde.
   */
  rev: number;
}

// ── ZDO Flags (from ZDO.h MACHINE_* / NETWORK_* constants) ─────────

export enum ZDOFlags {
  NONE = 0,
  PERSISTENT = 1 << 0,  // MACHINE_Persistent
  DISTANT = 1 << 1,     // MACHINE_Distant
  TYPE1 = 1 << 2,       // MACHINE_Type1
  TYPE2 = 1 << 3,       // MACHINE_Type2
}

// ── ZDO Class ──────────────────────────────────────────────────────

export class ZDO {
  readonly zdoid: ZDOID;
  prefabHash: Hash;
  position: Vector3;
  rotation: Quaternion;
  revision: ZDORevision;
  flags: number;

  /** Owner ZDOID (for owned objects like items in containers) */
  owner: ZDOID;

  /** Zone this ZDO currently belongs to */
  zone: ZoneID;

  /** Member data: hash -> { type, value } */
  private members: Map<number, ZDOMember>;

  /** Whether this ZDO has been modified since last sync */
  dirty: boolean;

  /** Whether this ZDO was recently created (needs full send) */
  isNew: boolean;

  /** Whether this ZDO is queued for destruction */
  destroyed: boolean;

  constructor(zdoid: ZDOID, prefabHash: Hash, position: Vector3, rotation: Quaternion) {
    this.zdoid = zdoid;
    this.prefabHash = prefabHash;
    this.position = position;
    this.rotation = rotation;
    this.revision = new ZDORevision();
    this.flags = ZDOFlags.NONE;
    this.owner = ZDOID.NONE;
    this.zone = { x: 0, y: 0 };
    this.members = new Map();
    this.dirty = true;
    this.isNew = true;
    this.destroyed = false;
  }

  // ── Member access ────────────────────────────────────────────────
  // C++ reference: ZDO::Set/Get with hash-based keys

  private memberHash(name: string): number {
    return getStableHash(name);
  }

  setFloat(name: string, value: number): void {
    this.setMember(this.memberHash(name), 0, value);
  }

  getFloat(name: string, defaultValue = 0): number {
    const m = this.members.get(this.memberHash(name));
    return m && m.type === 0 ? (m.value as number) : defaultValue;
  }

  setVec3(name: string, value: Vector3): void {
    this.setMember(this.memberHash(name), 1, value);
  }

  getVec3(name: string, defaultValue: Vector3 = { x: 0, y: 0, z: 0 }): Vector3 {
    const m = this.members.get(this.memberHash(name));
    return m && m.type === 1 ? (m.value as Vector3) : defaultValue;
  }

  setQuat(name: string, value: Quaternion): void {
    this.setMember(this.memberHash(name), 2, value);
  }

  getQuat(name: string, defaultValue: Quaternion = { x: 0, y: 0, z: 0, w: 1 }): Quaternion {
    const m = this.members.get(this.memberHash(name));
    return m && m.type === 2 ? (m.value as Quaternion) : defaultValue;
  }

  setInt(name: string, value: number): void {
    this.setMember(this.memberHash(name), 3, value);
  }

  getInt(name: string, defaultValue = 0): number {
    const m = this.members.get(this.memberHash(name));
    return m && m.type === 3 ? (m.value as number) : defaultValue;
  }

  setLong(name: string, value: bigint): void {
    this.setMember(this.memberHash(name), 4, value);
  }

  getLong(name: string, defaultValue = 0n): bigint {
    const m = this.members.get(this.memberHash(name));
    return m && m.type === 4 ? (m.value as bigint) : defaultValue;
  }

  setString(name: string, value: string): void {
    this.setMember(this.memberHash(name), 5, value);
  }

  getString(name: string, defaultValue = ''): string {
    const m = this.members.get(this.memberHash(name));
    return m && m.type === 5 ? (m.value as string) : defaultValue;
  }

  setByteArray(name: string, value: Buffer): void {
    this.setMember(this.memberHash(name), 6, value);
  }

  getByteArray(name: string): Buffer | undefined {
    const m = this.members.get(this.memberHash(name));
    return m && m.type === 6 ? (m.value as Buffer) : undefined;
  }

  // ── Generic member access ────────────────────────────────────────

  setMember(hash: number, type: number, value: ZDOMemberValue): void {
    // Erst revidieren, dann stempeln: Der Member trägt die Revision, ab der
    // er neu ist — genau die Zahl, gegen die der Delta-Versand vergleicht.
    this.revision.reviseData();
    this.members.set(hash, { type, value, rev: this.revision.dataRevision });
    this.dirty = true;
  }

  getMember(hash: number): ZDOMember | undefined {
    return this.members.get(hash);
  }

  /**
   * Revision der letzten Member-ENTFERNUNG (D6, 0 = nie).
   *
   * Ein Delta kann nur sagen „dieser Member ist neu", nicht „dieser Member
   * ist weg". Statt dafür ein zweites Drahtformat zu bauen, merkt sich das
   * ZDO den Zeitpunkt: Wer älter ist als die letzte Entfernung, bekommt
   * wieder den vollen Satz und ist damit garantiert sauber. Entfernungen
   * sind selten — ein gelegentlicher Vollstand ist billiger als die
   * Buchführung, die man sonst je Peer bräuchte.
   */
  entfernungsRevision = 0;

  removeMember(hash: number): boolean {
    const existed = this.members.delete(hash);
    if (existed) {
      this.revision.reviseData();
      this.entfernungsRevision = this.revision.dataRevision;
      this.dirty = true;
    }
    return existed;
  }

  hasMember(hash: number): boolean {
    return this.members.has(hash);
  }

  /** Iterate all members (for serialization). */
  getMembers(): ReadonlyMap<number, ZDOMember> {
    return this.members;
  }

  get memberCount(): number {
    return this.members.size;
  }

  // ── Flags ────────────────────────────────────────────────────────

  isPersistent(): boolean {
    return (this.flags & ZDOFlags.PERSISTENT) !== 0;
  }

  isDistant(): boolean {
    return (this.flags & ZDOFlags.DISTANT) !== 0;
  }

  setPersistent(value: boolean): void {
    if (value) this.flags |= ZDOFlags.PERSISTENT;
    else this.flags &= ~ZDOFlags.PERSISTENT;
  }

  setDistant(value: boolean): void {
    if (value) this.flags |= ZDOFlags.DISTANT;
    else this.flags &= ~ZDOFlags.DISTANT;
  }

  // ── Ownership ────────────────────────────────────────────────────

  setOwner(owner: ZDOID): void {
    this.owner = owner;
    this.revision.reviseOwner();
    this.dirty = true;
  }

  // ── Serialization ────────────────────────────────────────────────

  /** Convert to a plain object for network sync / persistence. */
  toSnapshot(): Record<string, unknown> {
    const members: Record<string, unknown> = {};
    for (const [hash, member] of this.members) {
      if (member.type === 6) {
        // ByteArray → base64
        members[hash.toString()] = { t: 6, v: (member.value as Buffer).toString('base64') };
      } else if (member.type === 4) {
        // Long → string
        members[hash.toString()] = { t: 4, v: (member.value as bigint).toString() };
      } else {
        members[hash.toString()] = { t: member.type, v: member.value };
      }
    }

    return {
      id: this.zdoid.toJSON(),
      prefab: this.prefabHash,
      pos: this.position,
      rot: this.rotation,
      rev: this.revision.raw,
      flags: this.flags,
      owner: this.owner.isNone() ? null : this.owner.toJSON(),
      members,
    };
  }

  /** Restore from a snapshot (persistence load). */
  static fromSnapshot(data: Record<string, unknown>): ZDO {
    const idData = data.id as { userId: string; id: number };
    const zdoid = ZDOID.fromTuple(idData.userId, idData.id);
    const zdo = new ZDO(
      zdoid,
      data.prefab as number,
      data.pos as Vector3,
      data.rot as Quaternion
    );

    zdo.revision.raw = data.rev as number;
    zdo.flags = data.flags as number;

    if (data.owner) {
      const ownerData = data.owner as { userId: string; id: number };
      zdo.owner = ZDOID.fromTuple(ownerData.userId, ownerData.id);
    }

    const members = data.members as Record<string, { t: number; v: unknown }>;
    if (members) {
      for (const [hashStr, member] of Object.entries(members)) {
        const hash = parseInt(hashStr, 10);
        let value: ZDOMemberValue;
        switch (member.t) {
          case 4: value = BigInt(member.v as string); break;
          case 6: value = Buffer.from(member.v as string, 'base64'); break;
          default: value = member.v as ZDOMemberValue; break;
        }
        // rev 0: Ein geladenes ZDO ist für JEDEN Peer neu und geht beim
        // ersten Mal vollständig raus (s. ZDOMember.rev).
        zdo.members.set(hash, { type: member.t, value, rev: 0 });
      }
    }

    zdo.dirty = false;
    zdo.isNew = false;
    return zdo;
  }
}
