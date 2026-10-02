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

export function chunk(typ, daten) {
  const kopf = Buffer.alloc(8);
  kopf.writeUInt32BE(daten.length, 0);
  kopf.write(typ, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([kopf.subarray(4), daten])), 0);
  return Buffer.concat([kopf, daten, crc]);
}

/** PNG aus beliebigen Chunks (Kennung + Daten), mit richtigen Längen und Prüfsummen. */
export function pngAusChunks(chunks) {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks.map(([t, d]) => chunk(t, d))]);
}

/** IHDR-Daten für ein RGBA-Bild der Grösse b×h. */
export function ihdr(b, h) {
  const d = Buffer.alloc(13);
  d.writeUInt32BE(b, 0);
  d.writeUInt32BE(h, 4);
  d[8] = 8;
  d[9] = 6;
  return d;
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

/**
 * Ausgangs-GLB: ein Dreieck, Bild als bufferView 0, Material `materialName`.
 * `o` baut gezielt kaputte Varianten (alles optional):
 *   png          anderes eingebettetes Bild
 *   positionen   9 Floats statt (0,0,0, 1,0,0, 0,1,seed); die Hüllbox bleibt [0,0,0]..[1,1,seed]
 *   indizes      Indexliste (Uint16) statt 0,1,2
 *   posAnzahl    Anzahl im POSITION-Accessor statt 3
 *   viewPlus     bufferView der Positionen um so viele Byte zu lang
 *   puffer       buffers[0].byteLength statt der echten Länge
 *   version      GLB-Version im Kopf statt 2
 *   binKuerzer   BIN-Chunk-Länge im Kopf um so viele Byte kleiner (Datei und Gesamtlänge unverändert)
 */
export function exportGlb(materialName, seed = 1, o = {}) {
  const png = o.png ?? pngKlein(seed);
  const posWerte = o.positionen ?? [0, 0, 0, 1, 0, 0, 0, 1, seed];
  const pos = Buffer.alloc(36);
  posWerte.forEach((v, i) => pos.writeFloatLE(v, i * 4));
  const ind = o.indizes ?? [0, 1, 2];
  const idx = Buffer.alloc(Math.ceil((ind.length * 2) / 4) * 4);
  ind.forEach((v, i) => idx.writeUInt16LE(v, i * 2));
  const pad = Buffer.alloc((4 - (png.length % 4)) % 4);
  const bin = Buffer.concat([png, pad, pos, idx]);
  const geo = png.length + pad.length;
  const glb = glbSchreiben(
    {
      asset: { version: '2.0' },
      buffers: [{ byteLength: o.puffer ?? bin.length }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: png.length },
        { buffer: 0, byteOffset: geo, byteLength: 36 + (o.viewPlus ?? 0) },
        { buffer: 0, byteOffset: geo + 36, byteLength: ind.length * 2 },
      ],
      accessors: [
        { bufferView: 1, componentType: 5126, count: o.posAnzahl ?? 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, seed] },
        { bufferView: 2, componentType: 5123, count: ind.length, type: 'SCALAR' },
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
  if (o.version !== undefined) glb.writeUInt32LE(o.version, 4);
  if (o.binKuerzer) {
    const binKopf = 20 + glb.readUInt32LE(12);
    glb.writeUInt32LE(glb.readUInt32LE(binKopf) - o.binKuerzer, binKopf);
  }
  return glb;
}
