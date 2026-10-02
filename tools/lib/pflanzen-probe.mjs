/*
  Test-Hilfe für Blumen und Farn (Store-Labor): baut selbstgebaute
  Ausgangsdateien, die `store-pflanzen-quellen.mjs` streng genug
  akzeptiert: ein gültiges Mini-PNG (Chunk-Längen und CRC stimmen) und eine
  GLB mit einem Dreieck, Bild eingebettet. `seed` macht Dateien
  unterscheidbar (Bild und Hüllbox).

  Test helper: builds small but structurally valid export files.
*/
import { deflateSync } from 'node:zlib';
import { crc32, glbSchreiben } from '../store-pflanzen-quellen.mjs';

function chunk(typ, daten) {
  const kopf = Buffer.alloc(8);
  kopf.writeUInt32BE(daten.length, 0);
  kopf.write(typ, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([kopf.subarray(4), daten])), 0);
  return Buffer.concat([kopf, daten, crc]);
}

/** Gültiges 4×4-RGBA-PNG, Inhalt hängt von `seed` ab. */
export function pngKlein(seed) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(4, 0);
  ihdr.writeUInt32BE(4, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const zeilen = Buffer.alloc(4 * (1 + 16));
  for (let i = 0; i < zeilen.length; i++) zeilen[i] = i % 17 === 0 ? 0 : (i * 7 + seed * 31) & 255;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(zeilen)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Export-GLB: ein Dreieck, Bild als bufferView 0, Material `materialName`. */
export function exportGlb(materialName, seed = 1) {
  const png = pngKlein(seed);
  const pos = Buffer.alloc(36);
  [0, 0, 0, 1, 0, 0, 0, 1, seed].forEach((v, i) => pos.writeFloatLE(v, i * 4));
  const idx = Buffer.from([0, 0, 1, 0, 2, 0, 0, 0]);
  const pad = Buffer.alloc((4 - (png.length % 4)) % 4);
  const bin = Buffer.concat([png, pad, pos, idx]);
  const geo = png.length + pad.length;
  return glbSchreiben(
    {
      asset: { version: '2.0' },
      buffers: [{ byteLength: bin.length }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: png.length },
        { buffer: 0, byteOffset: geo, byteLength: 36 },
        { buffer: 0, byteOffset: geo + 36, byteLength: 6 },
      ],
      accessors: [
        { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, seed] },
        { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
      materials: [{ name: materialName, pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
      images: [{ bufferView: 0, mimeType: 'image/png' }],
      textures: [{ source: 0 }],
      nodes: [{ name: 'Probe', mesh: 0 }],
      scenes: [{ nodes: [0] }],
    },
    bin
  );
}
