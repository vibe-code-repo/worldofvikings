/**
 * Binary Stream base class.
 * 1:1 port of DataStream.h (Stream) from Valhalla2.0 C++ server.
 *
 * All data is little-endian (matching the C++ static_assert).
 */

export class Stream {
  protected buf: Buffer;
  protected pos: number;

  constructor(buf?: Buffer) {
    this.buf = buf ?? Buffer.alloc(0);
    this.pos = 0;
  }

  isValidPos(pos: number): boolean {
    return pos >= 0 && pos <= this.buf.length;
  }

  isValidOffset(offset: number): boolean {
    return this.isValidPos(this.pos + offset);
  }

  checkPos(pos: number): void {
    if (!this.isValidPos(pos)) {
      throw new RangeError(`Stream position out of bounds: ${pos} (size: ${this.buf.length})`);
    }
  }

  checkOffset(offset: number): void {
    if (!this.isValidOffset(offset)) {
      throw new RangeError(
        `Stream offset out of bounds: ${offset} at pos ${this.pos} (size: ${this.buf.length})`
      );
    }
  }

  getPos(): number {
    return this.pos;
  }

  setPos(pos: number): void {
    this.checkPos(pos);
    this.pos = pos;
  }

  seek(offset: number): void {
    this.checkOffset(offset);
    this.pos += offset;
  }

  unsafeSetPos(pos: number): void {
    this.pos = pos;
  }

  unsafeSeek(offset: number): void {
    this.pos += offset;
  }

  empty(): boolean {
    return this.buf.length === 0;
  }

  size(): number {
    return this.buf.length;
  }

  remaining(): number {
    return this.buf.length - this.pos;
  }

  data(): Buffer {
    return this.buf;
  }

  getBuffer(): Buffer {
    return this.buf;
  }
}
