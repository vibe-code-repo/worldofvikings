/**
 * Binary Writer — 1:1 port of DataStream.h (Writer) from Valhalla2.0 C++.
 *
 * Writes primitive types, strings, byte arrays, Vector3, Quaternion
 * to a little-endian binary buffer with auto-growth.
 *
 * C++ reference:
 *   Writer::internal_write_bytes(char const*, size_t)
 *   Writer::write_varint(int32)  — ZigZag + LEB128
 *   Streamer<T> for arithmetic, string, Vector3, Quaternion
 */

import { Stream } from './Stream.js';
import type { Vector3, Quaternion } from '@wov/shared';

const INITIAL_CAPACITY = 256;

export class Writer extends Stream {
  constructor(initialCapacity: number = INITIAL_CAPACITY) {
    super(Buffer.allocUnsafe(initialCapacity));
  }

  // ── Internal helpers ─────────────────────────────────────────────

  private ensureCapacity(bytesNeeded: number): void {
    const required = this.pos + bytesNeeded;
    if (required <= this.buf.length) return;

    let newCap = this.buf.length * 2;
    while (newCap < required) newCap *= 2;

    const newBuf = Buffer.allocUnsafe(newCap);
    this.buf.copy(newBuf, 0, 0, this.pos);
    this.buf = newBuf;
  }

  private writeRawBytes(src: Buffer, offset: number, length: number): void {
    this.ensureCapacity(length);
    src.copy(this.buf, this.pos, offset, offset + length);
    this.pos += length;
  }

  // ── Primitive writes ─────────────────────────────────────────────

  writeBool(value: boolean): this {
    this.ensureCapacity(1);
    this.buf.writeUInt8(value ? 1 : 0, this.pos);
    this.pos += 1;
    return this;
  }

  writeInt8(value: number): this {
    this.ensureCapacity(1);
    this.buf.writeInt8(value, this.pos);
    this.pos += 1;
    return this;
  }

  writeUInt8(value: number): this {
    this.ensureCapacity(1);
    this.buf.writeUInt8(value & 0xff, this.pos);
    this.pos += 1;
    return this;
  }

  writeInt16(value: number): this {
    this.ensureCapacity(2);
    this.buf.writeInt16LE(value, this.pos);
    this.pos += 2;
    return this;
  }

  writeUInt16(value: number): this {
    this.ensureCapacity(2);
    this.buf.writeUInt16LE(value, this.pos);
    this.pos += 2;
    return this;
  }

  writeInt32(value: number): this {
    this.ensureCapacity(4);
    this.buf.writeInt32LE(value, this.pos);
    this.pos += 4;
    return this;
  }

  writeUInt32(value: number): this {
    this.ensureCapacity(4);
    this.buf.writeUInt32LE(value >>> 0, this.pos);
    this.pos += 4;
    return this;
  }

  writeInt64(value: bigint): this {
    this.ensureCapacity(8);
    this.buf.writeBigInt64LE(value, this.pos);
    this.pos += 8;
    return this;
  }

  writeUInt64(value: bigint): this {
    this.ensureCapacity(8);
    this.buf.writeBigUInt64LE(value, this.pos);
    this.pos += 8;
    return this;
  }

  writeFloat32(value: number): this {
    this.ensureCapacity(4);
    this.buf.writeFloatLE(value, this.pos);
    this.pos += 4;
    return this;
  }

  writeFloat64(value: number): this {
    this.ensureCapacity(8);
    this.buf.writeDoubleLE(value, this.pos);
    this.pos += 8;
    return this;
  }

  // ── Varint (ZigZag + LEB128) ─────────────────────────────────────
  // C++ reference: Writer::write_varint(int32)

  writeVarInt(value: number): this {
    // ZigZag encode: (n << 1) ^ (n >> 31)
    let zigzag = ((value << 1) ^ (value >> 31)) >>> 0;

    do {
      this.ensureCapacity(1);
      const byte = zigzag & 0x7f;
      zigzag >>>= 7;
      this.buf.writeUInt8(zigzag ? byte | 0x80 : byte, this.pos);
      this.pos += 1;
    } while (zigzag);

    return this;
  }

  // ── String ───────────────────────────────────────────────────────
  // C++ reference: Streamer<T> for char containers
  //   write_varint(length) + raw UTF-8 bytes

  writeString(value: string): this {
    if (value.length === 0) {
      this.writeVarInt(0);
      return this;
    }
    const encoded = Buffer.from(value, 'utf-8');
    this.writeVarInt(encoded.length);
    this.writeRawBytes(encoded, 0, encoded.length);
    return this;
  }

  // ── Byte array ───────────────────────────────────────────────────

  writeBytes(value: Buffer | Uint8Array): this {
    const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
    this.writeVarInt(buf.length);
    this.writeRawBytes(buf, 0, buf.length);
    return this;
  }

  writeFixedBytes(value: Buffer | Uint8Array): this {
    const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
    this.writeRawBytes(buf, 0, buf.length);
    return this;
  }

  // ── Composite types ──────────────────────────────────────────────

  writeVector3(v: Vector3): this {
    this.writeFloat32(v.x);
    this.writeFloat32(v.y);
    this.writeFloat32(v.z);
    return this;
  }

  writeQuaternion(q: Quaternion): this {
    this.writeFloat32(q.x);
    this.writeFloat32(q.y);
    this.writeFloat32(q.z);
    this.writeFloat32(q.w);
    return this;
  }

  // ── Hash (int32) ─────────────────────────────────────────────────

  writeHash(hash: number): this {
    return this.writeInt32(hash);
  }

  // ── Generic write by type tag (for ZDO members) ──────────────────

  writeByTypeTag(tag: number, value: unknown): this {
    switch (tag) {
      case 0: return this.writeFloat32(value as number);
      case 1: return this.writeVector3(value as Vector3);
      case 2: return this.writeQuaternion(value as Quaternion);
      case 3: return this.writeInt32(value as number);
      case 4: return this.writeInt64(value as bigint);
      case 5: return this.writeString(value as string);
      case 6: return this.writeBytes(value as Buffer);
      default: throw new Error(`Unknown ZDO member type tag: ${tag}`);
    }
  }

  /**
   * Bereits geschriebene Bytes. NICHT `size()` der Basisklasse verwenden —
   * die meldet die Kapazität des (verdoppelnd wachsenden) Puffers, nicht
   * den Inhalt. Das Bandbreitenbudget des ZDO-Syncs (D6) misst hiergegen.
   */
  get geschrieben(): number {
    return this.pos;
  }

  /**
   * Einen bereits geschriebenen int32 nachträglich setzen.
   *
   * Der ZDO-Sync schreibt die Satzanzahl VOR die Sätze, kennt sie aber erst,
   * wenn das Bandbreitenbudget aufgebraucht ist. Ein Platzhalter plus
   * Nachtrag spart den zweiten Writer und damit eine Vollkopie des Pakets
   * je Peer und Tick.
   */
  patchInt32(offset: number, value: number): this {
    if (offset < 0 || offset + 4 > this.pos) {
      throw new RangeError(`patchInt32 ausserhalb des Geschriebenen: ${offset}/${this.pos}`);
    }
    this.buf.writeInt32LE(value, offset);
    return this;
  }

  // ── Finalize ─────────────────────────────────────────────────────
  // C++ reference: Writer::serialize() returns vector<char>(buf)

  toBuffer(): Buffer {
    return Buffer.from(this.buf.subarray(0, this.pos));
  }

  /**
   * Static convenience: serialize values into a Buffer.
   * C++ reference: Writer::serialize(var1, var2, ...)
   */
  static serialize(writeFn: (w: Writer) => void): Buffer {
    const w = new Writer();
    writeFn(w);
    return w.toBuffer();
  }
}
