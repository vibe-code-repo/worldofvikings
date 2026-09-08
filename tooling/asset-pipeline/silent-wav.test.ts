import { describe, expect, it } from 'vitest';
import { SILENCE_SAMPLE_RATE, SILENCE_SECONDS, WAV_HEADER_BYTES, silentWav } from './silent-wav.js';

function text(bytes: Uint8Array, offset: number, length: number): string {
  return new TextDecoder().decode(bytes.subarray(offset, offset + length));
}

function u32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset).getUint32(offset, true);
}

function u16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset).getUint16(offset, true);
}

describe('silentWav', () => {
  const wav = silentWav();

  it('is a RIFF/WAVE file with a PCM format chunk', () => {
    expect(text(wav, 0, 4)).toBe('RIFF');
    expect(text(wav, 8, 4)).toBe('WAVE');
    expect(text(wav, 12, 4)).toBe('fmt ');
    expect(u32(wav, 16)).toBe(16);
    expect(u16(wav, 20)).toBe(1); // uncompressed PCM
    expect(text(wav, 36, 4)).toBe('data');
  });

  it('declares the sizes it actually has, or a decoder reads past the end', () => {
    expect(wav.byteLength).toBe(WAV_HEADER_BYTES + u32(wav, 40));
    expect(u32(wav, 4)).toBe(wav.byteLength - 8);
  });

  it('is mono 16-bit at 48 kHz, with a matching byte rate and block align', () => {
    expect(u16(wav, 22)).toBe(1);
    expect(u32(wav, 24)).toBe(SILENCE_SAMPLE_RATE);
    expect(u16(wav, 34)).toBe(16);
    expect(u16(wav, 32)).toBe(2); // block align: one 16-bit frame
    expect(u32(wav, 28)).toBe(SILENCE_SAMPLE_RATE * 2);
  });

  it('is silence, not merely short', () => {
    expect(wav.subarray(WAV_HEADER_BYTES).every((byte) => byte === 0)).toBe(true);
  });

  it('stays far under the 20 KB this repository accepts for a binary', () => {
    expect(wav.byteLength).toBe(WAV_HEADER_BYTES + SILENCE_SECONDS * SILENCE_SAMPLE_RATE * 2);
    expect(wav.byteLength).toBeLessThan(20 * 1024);
  });

  it('writes the same bytes every time, so the manifest hash is stable', () => {
    expect(silentWav()).toEqual(silentWav());
  });
});
