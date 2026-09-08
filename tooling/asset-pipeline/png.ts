/**
 * The smallest PNG codec that does the one job the import pipeline needs:
 * bring a texture down to the size budget (spec §38, `MAX_TEXTURE_SIZE`).
 *
 * **Why hand-written rather than `sharp` or `jimp`.** The alternative to
 * resizing is shipping 4096×4096 textures, which the project's own performance
 * rule forbids, or dropping the ten rock prefabs that share one — so resizing
 * has to happen somewhere. `sharp` is a native module with a platform-specific
 * binary; adding it would put a compile step between a contributor and
 * `pnpm install` for a tool most contributors never run (agent rules 12 and 18).
 * What is actually needed is narrow: 8-bit, non-interlaced PNG, halved by a box
 * filter. `node:zlib` does the hard half.
 *
 * **What it deliberately does not do.** 16-bit samples, interlacing, palettes,
 * tRNS, gamma and colour-profile chunks: all rejected with a message rather
 * than mishandled. A texture this cannot read is a texture a person should
 * look at, not one a script should silently approximate.
 */
import { deflateSync, inflateSync } from 'node:zlib';

/** The project's texture budget: browsers pay for these in RAM (spec §38). */
export const MAX_TEXTURE_SIZE = 2048;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A decoded image: 8 bits per sample, `channels` samples per pixel. */
export interface RawImage {
  readonly width: number;
  readonly height: number;
  /** 1 grey, 2 grey+alpha, 3 RGB, 4 RGBA. */
  readonly channels: number;
  /** `width * height * channels` bytes, row-major, top row first. */
  readonly data: Buffer;
}

/** Whether these bytes even claim to be a PNG. */
export function isPng(bytes: Buffer): boolean {
  return bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE);
}

/** The dimensions from the IHDR header, without decoding the pixels. */
export function readPngSize(bytes: Buffer): { width: number; height: number } | undefined {
  if (!isPng(bytes) || bytes.length < 24) {
    return undefined;
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const CHANNELS_BY_COLOR_TYPE = new Map<number, number>([
  [0, 1], // greyscale
  [2, 3], // truecolour
  [4, 2], // greyscale + alpha
  [6, 4], // truecolour + alpha
]);

/** Decodes a PNG. Throws, with a reason, on anything outside the narrow subset. */
export function decodePng(bytes: Buffer): RawImage {
  if (!isPng(bytes)) {
    throw new Error('not a PNG');
  }

  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];

  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length; // length + type + data + CRC

    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const bitDepth = body[8];
      const colorType = body[9];
      const interlace = body[12];
      if (bitDepth !== 8) {
        throw new Error(`PNG bit depth ${String(bitDepth)} is not supported (only 8)`);
      }
      if (interlace !== 0) {
        throw new Error('interlaced PNG is not supported');
      }
      const decoded = CHANNELS_BY_COLOR_TYPE.get(colorType ?? -1);
      if (decoded === undefined) {
        throw new Error(`PNG colour type ${String(colorType)} is not supported`);
      }
      channels = decoded;
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (width === 0 || height === 0 || channels === 0) {
    throw new Error('PNG has no usable IHDR');
  }

  const raw = inflateSync(Buffer.concat(idat));
  return { width, height, channels, data: unfilter(raw, width, height, channels) };
}

/**
 * Reverses the per-scanline filters (PNG spec §9). Each row is prefixed with
 * one filter byte; the predictors reference the pixel to the left (`a`), the
 * row above (`b`) and above-left (`c`).
 */
function unfilter(raw: Buffer, width: number, height: number, channels: number): Buffer {
  const stride = width * channels;
  const expected = height * (stride + 1);
  if (raw.length < expected) {
    throw new Error(`PNG data is short: ${String(raw.length)} bytes, expected ${String(expected)}`);
  }

  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const from = y * (stride + 1) + 1;
    const to = y * stride;
    const above = (y - 1) * stride;

    for (let x = 0; x < stride; x += 1) {
      const value = raw[from + x] ?? 0;
      const a = x >= channels ? (out[to + x - channels] ?? 0) : 0;
      const b = y > 0 ? (out[above + x] ?? 0) : 0;
      const c = y > 0 && x >= channels ? (out[above + x - channels] ?? 0) : 0;
      let restored: number;
      switch (filter) {
        case 0:
          restored = value;
          break;
        case 1:
          restored = value + a;
          break;
        case 2:
          restored = value + b;
          break;
        case 3:
          restored = value + ((a + b) >> 1);
          break;
        case 4:
          restored = value + paeth(a, b, c);
          break;
        default:
          throw new Error(`unknown PNG filter type ${String(filter)} on row ${String(y)}`);
      }
      out[to + x] = restored & 0xff;
    }
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  return pb <= pc ? b : c;
}

/**
 * Halves an image with a 2×2 box filter.
 *
 * A box filter and not something sharper on purpose: it is exactly reproducible
 * across machines and Node versions, which a manifest full of content hashes
 * needs. An odd dimension drops its last row or column rather than duplicating
 * it — a one-pixel edge on a 4096 px texture is not worth a special case.
 */
export function halve(image: RawImage): RawImage {
  const width = Math.max(1, image.width >> 1);
  const height = Math.max(1, image.height >> 1);
  const { channels } = image;
  const out = Buffer.alloc(width * height * channels);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        let sum = 0;
        for (let dy = 0; dy < 2; dy += 1) {
          for (let dx = 0; dx < 2; dx += 1) {
            const sy = Math.min(image.height - 1, y * 2 + dy);
            const sx = Math.min(image.width - 1, x * 2 + dx);
            sum += image.data[(sy * image.width + sx) * channels + channel] ?? 0;
          }
        }
        out[(y * width + x) * channels + channel] = Math.round(sum / 4);
      }
    }
  }
  return { width, height, channels, data: out };
}

/** Halves repeatedly until both sides fit inside `maxSize`. */
export function fitWithin(image: RawImage, maxSize = MAX_TEXTURE_SIZE): RawImage {
  let current = image;
  while (current.width > maxSize || current.height > maxSize) {
    current = halve(current);
  }
  return current;
}

const COLOR_TYPE_BY_CHANNELS = new Map<number, number>([
  [1, 0],
  [2, 4],
  [3, 2],
  [4, 6],
]);

/**
 * Mirrors an image top to bottom: `out[row][col] = in[h-1-row][col]`.
 *
 * A control map's axes are not the axes the ground is sampled on, and *which*
 * turn or mirror closes that gap is measured rather than assumed — see
 * `terrain-import.ts` for the measurement and ADR-0043 for the result. Two
 * placements were shipped before this one and both landed the cliff channel on
 * ground of ordinary steepness, which still looks like a landscape, which is
 * why neither was seen: the anti-diagonal mirror of ADR-0020 scores 0.64 and
 * the quarter turn of ADR-0043 scores 1.84, against a tile whose own 95th
 * percentile is 2.38 and this mirror's 4.28. The quarter turn was right for the
 * ground as it was then read; ADR-0059 turned the ground onto the world's axes
 * and the map has to follow it. Pure and exact: pixels are moved, never
 * resampled, so a splat weight is never blurred into its neighbour and the
 * import stays byte-for-byte reproducible.
 */
export function mirrorVertically(image: RawImage): RawImage {
  const { width, height, channels, data } = image;
  const out = Buffer.alloc(data.length);
  const stride = width * channels;
  for (let row = 0; row < height; row += 1) {
    const from = (height - 1 - row) * stride;
    data.copy(out, row * stride, from, from + stride);
  }
  return { width, height, channels, data: out };
}

/**
 * Encodes a PNG with filter type 0 on every row.
 *
 * No filter search: the result has to be byte-identical on every machine, and
 * the pipeline's own hashes are what would notice if it were not. Compression
 * level 9 is fixed for the same reason.
 */
export function encodePng(image: RawImage): Buffer {
  const colorType = COLOR_TYPE_BY_CHANNELS.get(image.channels);
  if (colorType === undefined) {
    throw new Error(`cannot encode ${String(image.channels)} channels as PNG`);
  }
  const stride = image.width * image.channels;
  const raw = Buffer.alloc(image.height * (stride + 1));
  for (let y = 0; y < image.height; y += 1) {
    raw[y * (stride + 1)] = 0;
    image.data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method: adaptive
  ihdr[12] = 0; // interlace: none

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, body: Buffer): Buffer {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'latin1');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
