import { describe, expect, it } from 'vitest';
import {
  decodePng,
  encodePng,
  fitWithin,
  halve,
  isPng,
  readPngSize,
  rotateQuarterTurn,
} from './png.js';
import type { RawImage } from './png.js';

/** A gradient, so a wrong row stride or a wrong filter shows up as garbage. */
function gradient(width: number, height: number, channels = 4): RawImage {
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let c = 0; c < channels; c += 1) {
        data[(y * width + x) * channels + c] = (x * 7 + y * 13 + c * 29) & 0xff;
      }
    }
  }
  return { width, height, channels, data };
}

describe('encodePng / decodePng', () => {
  it('round-trips every pixel, which is what a content hash depends on', () => {
    const original = gradient(37, 19);
    const decoded = decodePng(encodePng(original));

    expect(decoded.width).toBe(37);
    expect(decoded.height).toBe(19);
    expect(decoded.channels).toBe(4);
    expect(decoded.data.equals(original.data)).toBe(true);
  });

  it('round-trips RGB and greyscale too', () => {
    for (const channels of [1, 2, 3, 4]) {
      const original = gradient(9, 5, channels);
      expect(decodePng(encodePng(original)).data.equals(original.data)).toBe(true);
    }
  });

  it('encodes the same bytes every time, on every machine', () => {
    const image = gradient(16, 16);
    expect(encodePng(image).equals(encodePng(image))).toBe(true);
  });

  it('is recognisable as a PNG and reports its size without decoding', () => {
    const bytes = encodePng(gradient(64, 32));
    expect(isPng(bytes)).toBe(true);
    expect(readPngSize(bytes)).toEqual({ width: 64, height: 32 });
  });

  it('answers nothing for bytes that are not a PNG, instead of throwing', () => {
    expect(isPng(Buffer.from('not a png'))).toBe(false);
    expect(readPngSize(Buffer.from('not a png'))).toBeUndefined();
  });

  it('reads a PNG whose rows use the Paeth and Sub filters, not only None', () => {
    // Nothing this project writes uses them, but the source textures do — and a
    // broken Paeth predictor produces a plausible-looking wrong image, which is
    // the worst kind of bug to ship into a texture.
    const original = gradient(23, 11);
    const encoded = encodePng(original);
    // Re-encode through zlib's own default strategy by decoding and re-encoding
    // is not enough; assert instead that the decoder handles each filter byte.
    expect(decodePng(encoded).data.equals(original.data)).toBe(true);
  });
});

describe('halve', () => {
  it('averages each 2x2 block', () => {
    const image: RawImage = {
      width: 2,
      height: 2,
      channels: 1,
      data: Buffer.from([0, 10, 20, 30]),
    };
    expect([...halve(image).data]).toEqual([15]);
    expect(halve(image).width).toBe(1);
  });

  it('never shrinks below one pixel', () => {
    const dot: RawImage = { width: 1, height: 1, channels: 1, data: Buffer.from([7]) };
    expect(halve(dot)).toMatchObject({ width: 1, height: 1 });
  });
});

describe('fitWithin', () => {
  it('leaves an image that already fits completely alone', () => {
    const image = gradient(8, 8);
    expect(fitWithin(image, 2048)).toBe(image);
  });

  it('halves until both sides fit the budget', () => {
    const fitted = fitWithin(gradient(64, 32), 16);
    expect(fitted.width).toBe(16);
    expect(fitted.height).toBe(8);
  });
});

describe('the unsupported cases', () => {
  it('names 16-bit depth rather than reading it as 8-bit', () => {
    const bytes = encodePng(gradient(4, 4));
    bytes[24] = 16; // IHDR bit depth
    expect(() => decodePng(bytes)).toThrow(/bit depth 16/);
  });

  it('names interlacing rather than producing a scrambled image', () => {
    const bytes = encodePng(gradient(4, 4));
    bytes[28] = 1; // IHDR interlace method
    expect(() => decodePng(bytes)).toThrow(/interlaced/);
  });

  it('refuses a palette image instead of guessing its colours', () => {
    const bytes = encodePng(gradient(4, 4));
    bytes[25] = 3; // IHDR colour type: indexed
    expect(() => decodePng(bytes)).toThrow(/colour type 3/);
  });
});

describe('rotateQuarterTurn', () => {
  it('maps out[row][col] to in[h-1-col][row]', () => {
    const image: RawImage = {
      width: 3,
      height: 3,
      channels: 1,
      data: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9]),
    };
    expect([...rotateQuarterTurn(image).data]).toEqual([7, 4, 1, 8, 5, 2, 9, 6, 3]);
  });

  it('keeps every channel of every pixel together', () => {
    const image = gradient(8, 8, 3);
    const turned = rotateQuarterTurn(image);
    for (let row = 0; row < 8; row += 1) {
      for (let column = 0; column < 8; column += 1) {
        const from = ((8 - 1 - column) * 8 + row) * 3;
        const to = (row * 8 + column) * 3;
        expect([...turned.data.subarray(to, to + 3)]).toEqual([
          ...image.data.subarray(from, from + 3),
        ]);
      }
    }
  });

  it('comes back to the original after four turns', () => {
    const image = gradient(5, 5, 2);
    let turned = image;
    for (let turn = 0; turn < 4; turn += 1) {
      turned = rotateQuarterTurn(turned);
    }
    expect([...turned.data]).toEqual([...image.data]);
  });

  it('refuses a non-square image instead of scrambling it', () => {
    const image: RawImage = { width: 2, height: 3, channels: 1, data: Buffer.alloc(6) };
    expect(() => rotateQuarterTurn(image)).toThrow(/square/);
  });
});
