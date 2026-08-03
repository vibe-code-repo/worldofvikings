/**
 * Visual Phase-C test: renders the generated world as map images (PNG).
 *
 *   worldmap-<seed>-ts.png    biome map from the TS GeoManager port
 *                             (biome colors, height shading, rivers, lakes)
 *   worldmap-<seed>-cpp.png   same rendering from the C++ export coarse grid
 *                             (geo_samples.csv, 661x661 @ 32m)
 *   worldmap-<seed>-diff.png  per-cell biome comparison (red = mismatch)
 *
 * Pure diagnostic — no game code touched. PNG writer uses node:zlib only.
 *
 * Run:  npx tsx shared/test/geo-map.ts [seedName] [size] [exportDir]
 *       defaults: KxSYuZquuw, 1250 (=> 16 m/px), ../../valheim.community/build/geo-export-run
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { getStableHash } from '../src/hash.js';
import { GeoManager } from '../src/worldgen/GeoManager.js';
import { Biome } from '../src/types.js';

const seedName = process.argv[2] ?? 'KxSYuZquuw';
const size = Number(process.argv[3] ?? 1250);
const exportDir = process.argv[4] ?? '../../valheim.community/build/geo-export-run';
const outDir = 'Docs';

// ── minimal PNG encoder (8-bit truecolor, no interlace) ───────────

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(w: number, h: number, rgb: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0; // filter: none
    rgb.copy(raw, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── map colors (Valheim-ish) ──────────────────────────────────────

type RGB = [number, number, number];
const BIOME_COLOR: Record<number, RGB> = {
  [Biome.None]: [255, 0, 255],
  [Biome.Meadows]: [104, 148, 76],
  [Biome.Swamp]: [62, 72, 58],
  [Biome.Mountain]: [214, 221, 228],
  [Biome.BlackForest]: [38, 66, 32],
  [Biome.Plains]: [170, 164, 92],
  [Biome.AshLands]: [58, 50, 52],
  [Biome.DeepNorth]: [196, 214, 228],
  [Biome.Ocean]: [44, 84, 130],
  [Biome.Mistlands]: [112, 128, 122],
};
const RIVER_COLOR: RGB = [140, 205, 235];
const LAKE_COLOR: RGB = [120, 220, 220];

/** biome + height -> pixel color (height shading, water depth). */
function shade(biome: number, height: number): RGB {
  const base = BIOME_COLOR[biome] ?? [255, 0, 255];
  if (biome === Biome.Ocean || height < 30) {
    // depth 0..~25m below water level -> brighten toward shore
    const t = Math.max(0, Math.min(1, (height - 5) / 25));
    const deep: RGB = [22, 46, 78];
    const shore: RGB = [70, 130, 175];
    return [
      Math.round(deep[0] + (shore[0] - deep[0]) * t),
      Math.round(deep[1] + (shore[1] - deep[1]) * t),
      Math.round(deep[2] + (shore[2] - deep[2]) * t),
    ];
  }
  const f = 0.74 + 0.26 * Math.max(-0.5, Math.min(1, (height - 30) / 110));
  return [
    Math.min(255, Math.round(base[0] * f)),
    Math.min(255, Math.round(base[1] * f)),
    Math.min(255, Math.round(base[2] * f)),
  ];
}

function setPx(img: Buffer, w: number, x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= w) return;
  const i = (y * w + x) * 3;
  img[i] = c[0];
  img[i + 1] = c[1];
  img[i + 2] = c[2];
}
function blendPx(img: Buffer, w: number, h: number, x: number, y: number, c: RGB, a: number): void {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 3;
  img[i] = Math.round(img[i] * (1 - a) + c[0] * a);
  img[i + 1] = Math.round(img[i + 1] * (1 - a) + c[1] * a);
  img[i + 2] = Math.round(img[i + 2] * (1 - a) + c[2] * a);
}

/** draw the river point network (disc per point, radius ~ its width). */
function drawRivers(
  img: Buffer,
  w: number,
  h: number,
  toPx: (wx: number, wy: number) => [number, number],
  pxPerMeter: number,
  points: Iterable<readonly { px: number; py: number; w: number }[]>
): void {
  for (const pts of points) {
    for (const p of pts) {
      const [cx, cy] = toPx(p.px, p.py);
      const r = Math.max(0.6, p.w * pxPerMeter * 0.55);
      const ri = Math.ceil(r);
      for (let dy = -ri; dy <= ri; dy++) {
        for (let dx = -ri; dx <= ri; dx++) {
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d <= r) blendPx(img, w, h, Math.round(cx) + dx, Math.round(cy) + dy, RIVER_COLOR, 0.65);
        }
      }
    }
  }
}

// ── 1. TS map ─────────────────────────────────────────────────────

console.log(`worldmap: seed="${seedName}" size=${size}x${size}`);
const geo = new GeoManager(getStableHash(seedName), { ashlandsModernNoise: true });

const step = 20000 / size; // meters per pixel
const img = Buffer.alloc(size * size * 3);
const t0 = performance.now();
for (let row = 0; row < size; row++) {
  const wy = 10000 - (row + 0.5) * step; // north up
  for (let col = 0; col < size; col++) {
    const wx = -10000 + (col + 0.5) * step;
    const biome = geo.getBiome(wx, wy);
    let h: number;
    try {
      h = geo.getBiomeHeight(biome, wx, wy, false).height;
    } catch {
      h = geo.getGenerationHeight(wx, wy); // AshLands modern = B5 -> legacy pregen for the picture
    }
    setPx(img, size, col, row, shade(biome, h));
  }
}
console.log(`rendered ${size * size} pixels in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

const toPxTs = (wx: number, wy: number): [number, number] => [(wx + 10000) / step, (10000 - wy) / step];
drawRivers(img, size, size, toPxTs, 1 / step, geo.riverPointMap.values());
for (const lake of geo.lakeList) {
  const [lx, ly] = toPxTs(lake.x, lake.y);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
    blendPx(img, size, size, Math.round(lx) + dx, Math.round(ly) + dy, LAKE_COLOR, 0.9);
}
// spawn marker (0,0)
const [sx, sy] = toPxTs(0, 0);
for (let d = -4; d <= 4; d++) {
  setPx(img, size, Math.round(sx) + d, Math.round(sy), [230, 60, 60]);
  setPx(img, size, Math.round(sx), Math.round(sy) + d, [230, 60, 60]);
}

const tsPath = join(outDir, `worldmap-${seedName}-ts.png`);
writeFileSync(tsPath, encodePng(size, size, img));
console.log(`wrote ${tsPath}`);

// ── 2. C++ map from export coarse grid + 3. biome diff ────────────

let cppRows: Map<string, string[]>;
try {
  const lines = readFileSync(join(exportDir, 'geo_samples.csv'), 'utf8').split('\n');
  cppRows = new Map();
  let inCoarse = false;
  for (const line of lines) {
    if (line.startsWith('# grid=coarse')) inCoarse = true;
    else if (line.startsWith('# end grid=coarse')) inCoarse = false;
    else if (inCoarse && line.length > 0 && line[0] !== 'x') {
      const p = line.split(',');
      cppRows.set(`${p[0]},${p[1]}`, p);
    }
  }
} catch {
  console.log('(no C++ export found — skipping cpp/diff images)');
  process.exit(0);
}

const HALF = 10560;
const STEP = 32;
const N = 661;
const cppImg = Buffer.alloc(N * N * 3);
const diffImg = Buffer.alloc(N * N * 3);
let biomeMismatch = 0;
let missing = 0;
for (let row = 0; row < N; row++) {
  const wy = -HALF + row * STEP;
  const pxRow = N - 1 - row; // north up
  for (let col = 0; col < N; col++) {
    const wx = -HALF + col * STEP;
    const p = cppRows.get(`${wx},${wy}`);
    if (!p) {
      missing++;
      continue;
    }
    const refBiome = Number(p[2]);
    setPx(cppImg, N, col, pxRow, shade(refBiome, Number(p[7])));
    const tsBiome = geo.getBiome(wx, wy);
    if (tsBiome !== refBiome) {
      biomeMismatch++;
      setPx(diffImg, N, col, pxRow, [255, 40, 40]);
    } else {
      setPx(diffImg, N, col, pxRow, [26, 26, 26]);
    }
  }
}
console.log(`coarse grid: ${cppRows.size} cells (${missing} missing), biome mismatches: ${biomeMismatch}`);

// rivers from the C++ export
const rpLines = readFileSync(join(exportDir, 'geo_riverpoints.csv'), 'utf8').split('\n');
const cppPts: { px: number; py: number; w: number }[] = [];
for (const line of rpLines) {
  if (line.startsWith('P,')) {
    const [px, py, w] = line.slice(2).split(',').map(Number);
    cppPts.push({ px, py, w });
  }
}
const toPxCpp = (wx: number, wy: number): [number, number] => [
  ((wx + HALF) / STEP),
  (N - 1 - (wy + HALF) / STEP),
];
drawRivers(cppImg, N, N, toPxCpp, 1 / STEP, [cppPts]);
const [csx, csy] = toPxCpp(0, 0);
for (let d = -4; d <= 4; d++) {
  setPx(cppImg, N, Math.round(csx) + d, Math.round(csy), [230, 60, 60]);
  setPx(cppImg, N, Math.round(csx), Math.round(csy) + d, [230, 60, 60]);
}

const cppPath = join(outDir, `worldmap-${seedName}-cpp.png`);
writeFileSync(cppPath, encodePng(N, N, cppImg));
const diffPath = join(outDir, `worldmap-${seedName}-diff.png`);
writeFileSync(diffPath, encodePng(N, N, diffImg));
console.log(`wrote ${cppPath}`);
console.log(`wrote ${diffPath}`);
