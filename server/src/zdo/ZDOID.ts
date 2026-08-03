/**
 * ZDOID — Zone Data Object Identifier.
 * 1:1 port of ZDOID.h from Valhalla2.0 C++.
 *
 * C++ reference:
 *   class ZDOID {
 *     BitPack<uint32, USERID_BITS, ID_BITS> m_pack;
 *     static array<int64, capacity> INDEXED_USERID;
 *     ...
 *   };
 *
 * The ZDOID packs a UserID index and an ID into a single uint32.
 * UserIDs are stored in a static indexed array to save bits.
 * The first 4 indices are reserved for "bit sharing" (ordinal values).
 */

import type { UserID } from '@wov/shared';

// Number of bits for the UserID index field
const USERID_BITS = 10; // supports up to 1024 indexed user IDs
const ID_BITS = 32 - USERID_BITS; // 22 bits for the object ID
const BIT_SHARING = 4; // first 4 indices reserved for ordinal bit sharing

export class ZDOID {
  /** Static indexed UserID table (matches C++ INDEXED_USERID) */
  private static INDEXED_USERID: bigint[] = new Array(1 << USERID_BITS).fill(0n);

  /** Packed value: [userIDIndex: USERID_BITS][id: ID_BITS] */
  private packed: number;

  static readonly NONE = new ZDOID(0n, 0);

  constructor(userId: UserID = 0n, id = 0) {
    if (userId === 0n && id === 0) {
      this.packed = 0;
    } else {
      const index = ZDOID._getUserIdIndex(userId);
      this.packed = ((index << ID_BITS) | (id & ((1 << ID_BITS) - 1))) >>> 0;
    }
  }

  /** Create from a pre-packed uint32 value (for deserialization). */
  static fromPacked(packed: number): ZDOID {
    const z = new ZDOID(0n, 0);
    z.packed = packed >>> 0;
    return z;
  }

  /** Create from [userIdString, id] tuple (for JSON deserialization). */
  static fromTuple(userIdStr: string, id: number): ZDOID {
    return new ZDOID(BigInt(userIdStr), id);
  }

  // ── Static UserID indexing ───────────────────────────────────────

  private static _getUserIdIndex(userId: bigint): number {
    if (userId === 0n) return 0;

    for (let i = BIT_SHARING; i < ZDOID.INDEXED_USERID.length; i++) {
      if (ZDOID.INDEXED_USERID[i] === 0n) {
        ZDOID.INDEXED_USERID[i] = userId;
        return i;
      } else if (ZDOID.INDEXED_USERID[i] === userId) {
        return i;
      }
    }

    throw new Error('ZDOID: UserID index pool exhaustion — server restart required');
  }

  private static _getUserIdByIndex(index: number): bigint {
    if (index < ZDOID.INDEXED_USERID.length) {
      return ZDOID.INDEXED_USERID[index];
    }
    throw new Error(`ZDOID: user id by index ${index} not found`);
  }

  /** Reset the static UserID table (for testing / server restart). */
  static resetUserIdTable(): void {
    ZDOID.INDEXED_USERID.fill(0n);
  }

  // ── Accessors ────────────────────────────────────────────────────

  get userIdIndex(): number {
    return (this.packed >>> ID_BITS) & ((1 << USERID_BITS) - 1);
  }

  get userId(): bigint {
    return ZDOID._getUserIdByIndex(this.userIdIndex);
  }

  get id(): number {
    const rawId = this.packed & ((1 << ID_BITS) - 1);
    const sharing = this.userIdIndex;
    if (sharing < BIT_SHARING) {
      // Borrow extended bits from sharing index
      return (rawId | (sharing << ID_BITS)) >>> 0;
    }
    return rawId;
  }

  get packedValue(): number {
    return this.packed >>> 0;
  }

  // ── Comparison ───────────────────────────────────────────────────

  equals(other: ZDOID): boolean {
    return this.packed === other.packed;
  }

  isNone(): boolean {
    return this.packed === 0;
  }

  /** For use as Map/Set key. */
  toString(): string {
    return `${this.userId}:${this.id}`;
  }

  toJSON(): { userId: string; id: number } {
    return { userId: this.userId.toString(), id: this.id };
  }

  // ── Hash for Map/Set usage ───────────────────────────────────────

  hashCode(): number {
    return this.packed;
  }
}
