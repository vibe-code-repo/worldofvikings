/**
 * One-off diagnostic: list ZDOs near world origin from the G1 save.
 * Usage: npx tsx tools/dump-spawn-zdos.ts
 */
import { readFileSync } from 'fs';
import { gunzipSync, brotliDecompressSync, unzipSync, zstdDecompressSync } from 'node:zlib';
import { findPrefabByHash } from '../shared/src/index.js';

const PATH = 'server/data/worlds/world.db.zst';
const raw = readFileSync(PATH);

// try the known decompressors in order (zstd first — the G1 envelope)
let json: any = null;
for (const fn of [zstdDecompressSync, gunzipSync, brotliDecompressSync, unzipSync] as const) {
  try {
    json = JSON.parse((fn as any)(raw).toString('utf-8'));
    break;
  } catch {
    /* next */
  }
}
if (!json) {
  console.error('decompression failed — unknown envelope');
  process.exit(1);
}

console.log('save keys:', Object.keys(json));

// G1 envelope: top-level 'zdos' (persisted ZDOs, flat) + 'zones' metadata
const zdoList: any[] = Array.isArray(json.zdos)
  ? json.zdos
  : json.zdos
    ? Object.values(json.zdos)
    : [];
console.log('persisted zdos:', zdoList.length);
if (zdoList.length) console.log('sample:', JSON.stringify(zdoList[0]).slice(0, 300));

const RADIUS = Number(process.argv[2] ?? 45);
const FILTER = process.argv[3] ?? ''; // substring filter on prefab name
let shown = 0;
for (const zdo of zdoList) {
  const p = zdo.position ?? zdo.pos ?? {};
  const d = Math.hypot(p.x ?? 0, p.z ?? 0);
  if (d > RADIUS) continue;
  const def = findPrefabByHash(zdo.prefabHash ?? zdo.prefab);
  if (FILTER && !(def?.name ?? '').toLowerCase().includes(FILTER.toLowerCase())) continue;
  console.log(
    `d=${d.toFixed(1).padStart(5)} hash=${String(zdo.prefabHash ?? zdo.prefab).padStart(12)} ` +
    `name=${def?.name ?? '???'} pos=(${(p.x ?? 0).toFixed(1)}, ${(p.y ?? 0).toFixed(1)}, ${(p.z ?? 0).toFixed(1)}) ` +
    `members=${JSON.stringify(zdo.members ?? {})}`
  );
  shown++;
}
console.log(`--- ${shown} persisted ZDOs within ${RADIUS}m of origin`);
