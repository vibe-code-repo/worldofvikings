/**
 * Repariert GLB-Header: AssetRipper exportiert bei einigen Dateien ein
 * falsches buffers[0].byteLength im JSON-Chunk (0 oder zu klein). Three.js
 * toleriert das, Babylon validiert streng und lädt dann leere Buffer
 * ("Binary buffer length (0) from JSON does not match chunk length").
 *
 * Setzt byteLength auf die tatsächliche BIN-Chunk-Länge. Idempotent.
 *
 * Aufruf: node tools/fix-glb-buffer-length.mjs [modelsDir]
 * Betroffen (Stand 2026-07-26): Boar_fixed, Deer, Deer_fixed, greydwarf_fixed
 * Hinweis: assets/ ist gitignored — nach einem erneuten Asset-Import
 * dieses Script wieder laufen lassen.
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const dir = process.argv[2] ?? new URL('../assets/models', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

let fixed = 0;
let scanned = 0;
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.glb')) continue;
  scanned++;
  const p = join(dir, f);
  const buf = readFileSync(p);
  if (buf.readUInt32LE(0) !== 0x46546c67) continue; // 'glTF'
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  if (!json.buffers?.length) continue;
  const binOff = 20 + jsonLen;
  if (buf.length <= binOff + 8) continue; // kein BIN-Chunk
  const binLen = buf.readUInt32LE(binOff);
  if (json.buffers[0].byteLength === binLen) continue;

  json.buffers[0].byteLength = binLen;
  let newJson = Buffer.from(JSON.stringify(json), 'utf8');
  const pad = (4 - (newJson.length % 4)) % 4;
  if (pad) newJson = Buffer.concat([newJson, Buffer.alloc(pad, 0x20)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + newJson.length + (buf.length - binOff), 8);
  header.writeUInt32LE(newJson.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16); // 'JSON'
  writeFileSync(p, Buffer.concat([header, newJson, buf.subarray(binOff)]));
  console.log(`${f}: byteLength -> ${binLen}`);
  fixed++;
}
console.log(`scanned ${scanned}, fixed ${fixed}`);
