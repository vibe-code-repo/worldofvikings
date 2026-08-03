/**
 * Binary Reader — 1:1 port of DataStream.h (Reader) from Valhalla2.0 C++.
 *
 * Reads primitive types, strings, byte arrays, Vector3, Quaternion
 * from a little-endian binary buffer.
 *
 * C++ reference:
 *   template<class T> requires std::is_arithmetic_v<T>
 *   struct Streamer<T> { ... internal_read_bytes ... };
 *
 *   Varint encoding for int32 (ZigZag + LEB128).
 */

import { Stream } from './Stream.js';
import type { Vector3, Quaternion } from '@wov/shared';

export class Reader extends Stream {
  constructor(buf?: Buffer) {
    super(buf);
  }

  // ── Primitive reads ──────────────────────────────────────────────

  readBool(): boolean {
    this.checkOffset(1);
    const v = this.buf.readUInt8(this.pos);
    this.pos += 1;
    return v !== 0;
  }

  readInt8(): number {
    this.checkOffset(1);
    const v = this.buf.readInt8(this.pos);
    this.pos += 1;
    return v;
  }

  readUInt8(): number {
    this.checkOffset(1);
    const v = this.buf.readUInt8(this.pos);
    this.pos += 1;
    return v;
  }

  readInt16(): number {
    this.checkOffset(2);
    const v = this.buf.readInt16LE(this.pos);
    this.pos += 2;
    return v;
  }

  readUInt16(): number {
    this.checkOffset(2);
    const v = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }

  readInt32(): number {
    this.checkOffset(4);
    const v = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }

  readUInt32(): number {
    this.checkOffset(4);
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }

  readInt64(): bigint {
    this.checkOffset(8);
    const v = this.buf.readBigInt64LE(this.pos);
    this.pos += 8;
    return v;
  }

  readUInt64(): bigint {
    this.checkOffset(8);
    const v = this.buf.readBigUInt64LE(this.pos);
    this.pos += 8;
    return v;
  }

  readFloat32(): number {
    this.checkOffset(4);
    const v = this.buf.readFloatLE(this.pos);
    this.pos += 4;
    return v;
  }

  readFloat64(): number {
    this.checkOffset(8);
    const v = this.buf.readDoubleLE(this.pos);
    this.pos += 8;
    return v;
  }

  // ── Varint (ZigZag + LEB128) ─────────────────────────────────────
  // C++ reference: Reader::read_varint()

  readVarInt(): number {
    let result = 0;
    let shift = 0;
    let byte: number;

    do {
      this.checkOffset(1);
      byte = this.buf.readUInt8(this.pos);
      this.pos += 1;
      result |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);

    // ZigZag decode: (n >>> 1) ^ -(n & 1)
    return (result >>> 1) ^ -(result & 1);
  }

  // ── String ───────────────────────────────────────────────────────
  // C++ reference: Streamer<T> for char-value_type containers
  //   write_varint(length) + raw bytes

  readString(): string {
    const len = this.readVarInt();
    if (len === 0) return '';
    this.checkOffset(len);
    const str = this.buf.toString('utf-8', this.pos, this.pos + len);
    this.pos += len;
    return str;
  }

  // ── Byte array ───────────────────────────────────────────────────

  readBytes(): Buffer {
    const len = this.readVarInt();
    this.checkOffset(len);
    const slice = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return Buffer.from(slice); // copy
  }

  readFixedBytes(length: number): Buffer {
    this.checkOffset(length);
    const slice = this.buf.subarray(this.pos, this.pos + length);
    this.pos += length;
    return Buffer.from(slice);
  }

  // ── Composite types ──────────────────────────────────────────────

  readVector3(): Vector3 {
    return {
      x: this.readFloat32(),
      y: this.readFloat32(),
      z: this.readFloat32(),
    };
  }

  readQuaternion(): Quaternion {
    return {
      x: this.readFloat32(),
      y: this.readFloat32(),
      z: this.readFloat32(),
      w: this.readFloat32(),
    };
  }

  // ── Hash (int32) ─────────────────────────────────────────────────

  readHash(): number {
    return this.readInt32();
  }

  // ── Generic read by type tag (for ZDO members) ───────────────────

  readByTypeTag(tag: number): number | bigint | string | Buffer | Vector3 | Quaternion {
    switch (tag) {
      case 0: return this.readFloat32();   // Float
      case 1: return this.readVector3();   // Vec3
      case 2: return this.readQuaternion(); // Quat
      case 3: return this.readInt32();     // Int
      case 4: return this.readInt64();     // Long
      case 5: return this.readString();    // String
      case 6: return this.readBytes();     // ByteArray
      default: throw new Error(`Unknown ZDO member type tag: ${tag}`);
    }
  }
}
