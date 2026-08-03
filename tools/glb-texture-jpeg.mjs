#!/usr/bin/env node
/**
 * glb-texture-jpeg — kodiert eingebettete PNG-Texturen einer GLB nach JPEG um.
 *
 * WARUM: Der Charakter-Export vom 2026-07-30 (`clone_4.glb`) bringt seine
 * Basisfarbtextur als PNG mit — 2048×2048 und damit 6,53 MB von 7,11 MB
 * Dateigröße. Dieselbe Textur lag im vorigen Export als JPEG bei 1,15 MB.
 * Für eine Figur, die der Browser beim Betreten der Welt nachlädt, ist das
 * der Unterschied zwischen sofort da und sekundenlang unsichtbar.
 *
 * Umkodiert wird nur, was sich lohnt: Bilder mit Transparenz bleiben
 * unangetastet, denn JPEG kennt keinen Alphakanal — eine Normal- oder
 * Maskentextur würde dabei still zerstört.
 *
 *   node tools/glb-texture-jpeg.mjs assets/models/PlayerAvatar.glb [--qualitaet 92]
 *
 * Ohne `--out` wird die Datei an Ort und Stelle ersetzt; die Vorlage
 * bleibt als `<name>.png.bak` liegen.
 */
import fs from 'node:fs';
import sharp from 'sharp';

const argv = process.argv.slice(2);
let datei = null, out = null, qualitaet = 92;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--out') out = argv[++i];
  else if (argv[i] === '--qualitaet') qualitaet = Number(argv[++i]);
  else datei = argv[i];
}
if (!datei) {
  console.error('Nutzung: node tools/glb-texture-jpeg.mjs <datei.glb> [--out ziel.glb] [--qualitaet 92]');
  process.exit(1);
}

const buf = fs.readFileSync(datei);
let off = 12, json = null, bin = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off), typ = buf.readUInt32LE(off + 4);
  const d = buf.subarray(off + 8, off + 8 + len);
  if (typ === 0x4e4f534a) json = JSON.parse(d.toString('utf8'));
  else if (typ === 0x004e4942) bin = Buffer.from(d);
  off += 8 + len;
}
if (!json || !bin) throw new Error(`${datei}: kein vollständiges GLB`);

const bilder = (json.images ?? []).filter((im) => im.mimeType === 'image/png' && im.bufferView !== undefined);
if (!bilder.length) {
  console.log('Keine eingebetteten PNG-Bilder — nichts zu tun.');
  process.exit(0);
}

// Neue Bilddaten erzeugen, bevor der Binärteil umgebaut wird.
const ersatz = new Map(); // bufferView-Index -> Buffer
for (const im of bilder) {
  const bv = json.bufferViews[im.bufferView];
  const roh = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
  const meta = await sharp(roh).metadata();
  // Ein Alphakanal allein ist kein Hinderungsgrund — Exporte schleppen ihn
  // oft mit, ohne ein einziges durchsichtiges Pixel. Entscheidend ist, ob
  // er tatsächlich Werte unter 255 enthält; nur dann ginge beim Umkodieren
  // Information verloren.
  if (meta.hasAlpha) {
    const stats = await sharp(roh).stats();
    const alpha = stats.channels[stats.channels.length - 1];
    if (alpha.min < 255) {
      console.log(`  Bild (bufferView ${im.bufferView}): ${meta.width}×${meta.height} — echte ` +
                  `Transparenz (Alpha ab ${alpha.min}), übersprungen`);
      continue;
    }
    console.log(`  Bild (bufferView ${im.bufferView}): Alphakanal durchgehend opak, wird verworfen`);
  }
  const neu = await sharp(roh).flatten().jpeg({ quality: qualitaet, mozjpeg: true }).toBuffer();
  console.log(`  Bild (bufferView ${im.bufferView}): ${meta.width}×${meta.height}, ` +
              `${(bv.byteLength / 1024 / 1024).toFixed(2)} MB → ${(neu.length / 1024 / 1024).toFixed(2)} MB`);
  ersatz.set(im.bufferView, neu);
  im.mimeType = 'image/jpeg';
}
if (!ersatz.size) { console.log('Nichts umkodiert.'); process.exit(0); }

// Binärteil neu aufbauen. Die bufferViews behalten ihre Reihenfolge, nur
// Versatz und Länge verschieben sich — deshalb wird alles neu gesetzt.
const stuecke = [];
let laenge = 0;
const sortiert = json.bufferViews
  .map((bv, i) => ({ bv, i }))
  .sort((a, b) => (a.bv.byteOffset ?? 0) - (b.bv.byteOffset ?? 0));
for (const { bv, i } of sortiert) {
  const daten = ersatz.get(i) ?? bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
  bv.byteOffset = laenge;
  bv.byteLength = daten.length;
  stuecke.push(daten);
  laenge += daten.length;
  const pad = (4 - (laenge % 4)) % 4;
  if (pad) { stuecke.push(Buffer.alloc(pad)); laenge += pad; }
}
const neuBin = Buffer.concat(stuecke, laenge);
json.buffers = [{ byteLength: neuBin.length }];

const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
const jsonChunk = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
const gesamt = 12 + 8 + jsonChunk.length + 8 + neuBin.length;
const ausgabe = Buffer.alloc(gesamt);
ausgabe.writeUInt32LE(0x46546c67, 0);
ausgabe.writeUInt32LE(2, 4);
ausgabe.writeUInt32LE(gesamt, 8);
ausgabe.writeUInt32LE(jsonChunk.length, 12);
ausgabe.writeUInt32LE(0x4e4f534a, 16);
jsonChunk.copy(ausgabe, 20);
const p = 20 + jsonChunk.length;
ausgabe.writeUInt32LE(neuBin.length, p);
ausgabe.writeUInt32LE(0x004e4942, p + 4);
neuBin.copy(ausgabe, p + 8);

const ziel = out ?? datei;
if (!out) fs.copyFileSync(datei, `${datei}.png.bak`);
fs.writeFileSync(ziel, ausgabe);
console.log(`${ziel}: ${(buf.length / 1024 / 1024).toFixed(2)} MB → ${(gesamt / 1024 / 1024).toFixed(2)} MB`);
