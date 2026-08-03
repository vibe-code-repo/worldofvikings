/**
 * D1 verification: TS Heightmap (zone grid build) vs. C++ reference export.
 *
 * Reads geo_zones.csv (real IHeightmapBuilder::Build from the C++ server)
 * and compares the TS HeightmapProvider output bit-for-bit:
 * corner biomes (exact), 65x65 baseHeights (f32 ULP), 64x64 vegMask (f32 ULP).
 *
 * Zones whose corner biomes include AshLands are skipped: the C++ export
 * ran with ashlandsModernNoise=true (FastNoise, Phase B5) while the game
 * port builds zones with the legacy path until B5 lands.
 *
 * Run:  npx tsx shared/test/heightmap-compare.ts [exportDir] [seedName]
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getStableHash } from '../src/hash.js';
import { GeoManager } from '../src/worldgen/GeoManager.js';
import { HeightmapProvider } from '../src/worldgen/Heightmap.js';
import { Biome } from '../src/types.js';

const exportDir = process.argv[2] ?? '../../valheim.community/build/geo-export-run';
const seedName = process.argv[3] ?? 'KxSYuZquuw';

const f32buf = new Float32Array(1);
const u32buf = new Uint32Array(f32buf.buffer);
function f32bits(x: number): number {
  f32buf[0] = x;
  return u32buf[0];
}
function ulpDist(a: number, b: number): number {
  let ia = f32bits(a);
  let ib = f32bits(b);
  ia = ia & 0x80000000 ? 0x80000000 - (ia & 0x7fffffff) : ia;
  ib = ib & 0x80000000 ? 0x80000000 - (ib & 0x7fffffff) : ib;
  return Math.abs(ia - ib);
}

interface RefZone {
  zx: number;
  zy: number;
  biomes: number[];
  heights: number[];
  mask: number[];
}

const lines = readFileSync(join(exportDir, 'geo_zones.csv'), 'utf8').split('\n');
const zones: RefZone[] = [];
let cur: RefZone | null = null;
for (const line of lines) {
  if (line.startsWith('Z,')) {
    const p = line.slice(2).split(',');
    cur = { zx: Number(p[0]), zy: Number(p[1]), biomes: p.slice(2).map(Number), heights: [], mask: [] };
    zones.push(cur);
  } else if (line.startsWith('H,')) {
    cur!.heights.push(...line.slice(2).split(',').map(Number));
  } else if (line.startsWith('M,')) {
    cur!.mask.push(...line.slice(2).split(',').map(Number));
  }
}
console.log(`heightmap-compare: ${zones.length} reference zones from ${exportDir}`);

// game settings (server.yml; ashlands legacy until B5 — see file header)
const geo = new GeoManager(getStableHash(seedName), {
  worldGenVersion: 2,
  disableDistantRivers: false,
  riverAffectsOcean: false,
  ashlandsModernNoise: false,
});
const provider = new HeightmapProvider(geo, { blendSmoothStep: true, bilinearSampling: false });

let failures = 0;
let skipped = 0;
for (const z of zones) {
  const label = `zone (${z.zx},${z.zy})`;
  if (z.biomes.includes(Biome.AshLands)) {
    console.log(`  SKIP  ${label} — AshLands corner biome (modern FastNoise = Phase B5)`);
    skipped++;
    continue;
  }

  // C++ BUG (HeightmapBuilder.cpp:195): the single-biome fast path declares
  // `float mask;` UNINITIALIZED and stores it as vegMask. GetBiomeHeight only
  // writes the mask for Mistlands (+AshLands), so for single-biome zones of
  // any other biome the exported vegMask is non-deterministic stack garbage.
  // The multi-biome path initializes mask1..4 = 0 — TS matches that.
  const singleBiomeNoMask =
    z.biomes.every((b) => b === z.biomes[0]) &&
    z.biomes[0] !== Biome.Mistlands &&
    z.biomes[0] !== Biome.AshLands;

  const hm = provider.getZone(z.zx, z.zy);

  let ok = true;
  const cbRef = z.biomes;
  const cbTs = hm.cornerBiomes as number[];
  if (cbRef.some((b, i) => b !== cbTs[i])) {
    console.log(`  FAIL  ${label} cornerBiomes: ref=[${cbRef}] ts=[${cbTs}]`);
    ok = false;
  }
  if (z.heights.length !== 65 * 65 || z.mask.length !== 64 * 64) {
    console.log(`  FAIL  ${label} ref sizes wrong: heights=${z.heights.length} mask=${z.mask.length}`);
    failures++;
    continue;
  }

  let hExact = 0,
    hNear = 0,
    hFail = 0,
    hMaxUlp = 0;
  let worst = '';
  for (let i = 0; i < 4225; i++) {
    const u = ulpDist(z.heights[i], hm.baseHeights[i]);
    if (u === 0) hExact++;
    else if (u <= 2) hNear++;
    else {
      hFail++;
      if (u > hMaxUlp) {
        hMaxUlp = u;
        worst = ` [${i % 65},${(i / 65) | 0}] ref=${z.heights[i]} ts=${hm.baseHeights[i]}`;
      }
    }
  }
  let mExact = 0,
    mNear = 0,
    mFail = 0;
  if (!singleBiomeNoMask) {
    for (let i = 0; i < 4096; i++) {
      const u = ulpDist(z.mask[i], hm.vegMask[i]);
      if (u === 0) mExact++;
      else if (u <= 2) mNear++;
      else mFail++;
    }
  }

  if (hFail > 0 || mFail > 0) ok = false;
  const mPart = singleBiomeNoMask
    ? ' | vegMask: skipped (C++ uninitialized `float mask;` — UB garbage, see header)'
    : ` | vegMask: ${mExact} exact, ${mNear} 1-2ulp, ${mFail} >2ulp`;
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(14)} heights: ${hExact} exact, ${hNear} 1-2ulp, ${hFail} >2ulp` +
      mPart +
      (hFail ? worst : '')
  );
  if (!ok) failures++;
}

// nearest-vertex sanity: (0,0) must equal the zone vertex 32,32 height
const g00 = provider.getGroundHeight(0, 0);
const v00 = provider.getZone(0, 0).baseHeights[32 * 65 + 32];
console.log(`\nsanity: getGroundHeight(0,0)=${g00} (zone vertex [32,32]=${v00}, expect equal)`);
if (g00 !== v00) failures++;

console.log(
  failures === 0
    ? `\n=== D1: ALL ZONES PASSED (${zones.length - skipped} compared, ${skipped} skipped B5) ===`
    : `\n=== D1: ${failures} ZONES FAILED ===`
);
process.exit(failures === 0 ? 0 : 1);
