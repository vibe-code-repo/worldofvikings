/**
 * PNG-Schreiber ohne Abhängigkeit (node:zlib), 8 Bit Truecolor ohne Alpha.
 * Liegt bewusst im MCP-Ordner und nicht in shared/src: der Barrel geht ins
 * Client-Bündel, und node:zlib hat dort nichts zu suchen.
 */
import { deflateSync } from 'node:zlib';

const CRC_TABELLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABELLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(typ: string, daten: Buffer): Buffer {
  const laenge = Buffer.alloc(4);
  laenge.writeUInt32BE(daten.length);
  const rumpf = Buffer.concat([Buffer.from(typ, 'ascii'), daten]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(rumpf));
  return Buffer.concat([laenge, rumpf, crc]);
}

/** RGBA-Puffer (Breite·Höhe·4 Bytes) als PNG kodieren; das Alpha wird verworfen. */
export function kodierePng(breite: number, hoehe: number, rgba: Uint8Array, stufe = 3): Buffer {
  if (rgba.length !== breite * hoehe * 4) throw new Error('kodierePng: Puffergröße passt nicht zu Breite·Höhe·4');
  const kopf = Buffer.alloc(13);
  kopf.writeUInt32BE(breite, 0);
  kopf.writeUInt32BE(hoehe, 4);
  kopf[8] = 8; // Bittiefe
  kopf[9] = 2; // Truecolor
  const zeile = 1 + breite * 3;
  const roh = Buffer.alloc(hoehe * zeile);
  for (let y = 0; y < hoehe; y++) {
    let o = y * zeile;
    roh[o++] = 0; // Filter: keiner
    for (let x = 0; x < breite; x++) {
      const i = (y * breite + x) * 4;
      roh[o++] = rgba[i];
      roh[o++] = rgba[i + 1];
      roh[o++] = rgba[i + 2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', kopf),
    chunk('IDAT', deflateSync(roh, { level: stufe })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Breite und Höhe aus dem IHDR eines PNG lesen (für Nachweise); null bei ungültiger Signatur. */
export function pngMasse(png: Uint8Array): { breite: number; hoehe: number } | null {
  const b = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { breite: b.readUInt32BE(16), hoehe: b.readUInt32BE(20) };
}
