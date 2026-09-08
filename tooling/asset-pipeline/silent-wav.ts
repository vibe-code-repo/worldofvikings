/**
 * The one stand-in every private audio row points at (ADR-0064).
 *
 * ADR-0015 gives each private *mesh* its own placeholder because a box has to
 * have the right hull to be an honest stand-in. A sound has no hull, so all
 * audio rows share one file, exactly as 47 texture rows already share
 * `placeholders/textures/unavailable.png`.
 *
 * WAV rather than Ogg, and written by hand rather than by an encoder: a valid
 * silent WAV is a 44-byte RIFF header followed by zeroes, so the repository
 * needs no audio encoder linked into it to produce the one binary it commits.
 */

/** Bytes of the canonical PCM WAV header, before the sample data. */
export const WAV_HEADER_BYTES = 44;

/** What the committed placeholder is: long enough to load, too short to hum. */
export const SILENCE_SECONDS = 0.1;
export const SILENCE_SAMPLE_RATE = 48_000;

/**
 * A mono 16-bit PCM WAV of pure silence.
 *
 * @param seconds duration; rounded down to a whole sample.
 * @param sampleRate frames per second.
 */
export function silentWav(seconds = SILENCE_SECONDS, sampleRate = SILENCE_SAMPLE_RATE): Uint8Array {
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerFrame = (channels * bitsPerSample) / 8;
  const frames = Math.floor(seconds * sampleRate);
  const dataBytes = frames * bytesPerFrame;

  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true); // everything after this field
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM format chunk length
  view.setUint16(20, 1, true); // 1 = uncompressed PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerFrame, true); // byte rate
  view.setUint16(32, bytesPerFrame, true); // block align
  view.setUint16(34, bitsPerSample, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  // The samples themselves are already zero, which is what silence is.

  return new Uint8Array(buffer);
}
