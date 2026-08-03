/**
 * BitPack — compile-time bitfield packing.
 * 1:1 port of BitPack.h from Valhalla2.0 C++.
 *
 * C++ reference:
 *   template<typename T, std::size_t... Bits>
 *   class BitPack {
 *     T m_value;
 *     get<I>() / set<I>(value)
 *   };
 *
 * Used by:
 *   - ZDOID: BitPack<uint32, USERID_BITS, ID_BITS>
 *   - ZDO::Rev: BitPack<uint32, 23, 9> (data revision, owner revision)
 *   - Peer::m_pack: BitPack<uint8, 1, 1, 1, 5> (visible, gated, ...)
 *
 * This TS version stores the packed value in a number (32-bit) or bigint (64-bit).
 */

export class BitPack32 {
  private value: number;
  private readonly bitWidths: readonly number[];
  private readonly offsets: number[];
  private readonly masks: number[];

  constructor(bitWidths: readonly number[], initialValue = 0) {
    this.bitWidths = bitWidths;
    this.offsets = [];
    this.masks = [];

    let offset = 0;
    for (const width of bitWidths) {
      this.offsets.push(offset);
      this.masks.push((1 << width) - 1);
      offset += width;
    }

    if (offset > 32) {
      throw new Error(`BitPack32 total bits ${offset} exceeds 32`);
    }

    this.value = initialValue >>> 0;
  }

  get raw(): number {
    return this.value >>> 0;
  }

  set raw(v: number) {
    this.value = v >>> 0;
  }

  get(index: number): number {
    if (index < 0 || index >= this.bitWidths.length) {
      throw new RangeError(`BitPack index ${index} out of range [0, ${this.bitWidths.length})`);
    }
    return (this.value >>> this.offsets[index]) & this.masks[index];
  }

  set(index: number, fieldValue: number): void {
    if (index < 0 || index >= this.bitWidths.length) {
      throw new RangeError(`BitPack index ${index} out of range [0, ${this.bitWidths.length})`);
    }
    const mask = this.masks[index];
    const offset = this.offsets[index];
    const clamped = (fieldValue & mask) >>> 0;
    this.value = ((this.value & ~(mask << offset)) | (clamped << offset)) >>> 0;
  }

  equals(other: BitPack32): boolean {
    return this.value === other.value;
  }
}

/**
 * 64-bit BitPack for fields that exceed 32 bits (e.g. Prefab flags).
 */
export class BitPack64 {
  private value: bigint;
  private readonly bitWidths: readonly number[];
  private readonly offsets: number[];
  private readonly masks: bigint[];

  constructor(bitWidths: readonly number[], initialValue = 0n) {
    this.bitWidths = bitWidths;
    this.offsets = [];
    this.masks = [];

    let offset = 0;
    for (const width of bitWidths) {
      this.offsets.push(offset);
      this.masks.push((1n << BigInt(width)) - 1n);
      offset += width;
    }

    if (offset > 64) {
      throw new Error(`BitPack64 total bits ${offset} exceeds 64`);
    }

    this.value = BigInt.asUintN(64, initialValue);
  }

  get raw(): bigint {
    return this.value;
  }

  set raw(v: bigint) {
    this.value = BigInt.asUintN(64, v);
  }

  get(index: number): bigint {
    return (this.value >> BigInt(this.offsets[index])) & this.masks[index];
  }

  set(index: number, fieldValue: bigint): void {
    const mask = this.masks[index];
    const offset = BigInt(this.offsets[index]);
    const clamped = BigInt.asUintN(64, fieldValue) & mask;
    this.value = BigInt.asUintN(64, (this.value & ~(mask << offset)) | (clamped << offset));
  }
}
