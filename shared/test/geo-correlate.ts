/**
 * One-off: correlate the riverWeight/riverWidth sample mismatches with
 * 1-ulp river point position noise (Math.sin/cos vs sinf/cosf).
 * Expectation: every failing sample sits in a grid that contains a
 * non-bit-exact point -> propagation, not a port bug.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getStableHash } from '../src/hash.js';
import { GeoManager } from '../src/worldgen/GeoManager.js';

const exportDir = process.argv[2] ?? '../../valheim.community/build/geo-export-run';
const f32buf = new Float32Array(1);
const u32buf = new Uint32Array(f32buf.buffer);
const bits = (x: number) => {
  f32buf[0] = x;
  return u32buf[0];
};

const geo = new GeoManager(getStableHash('KxSYuZquuw'), { ashlandsModernNoise: true });

const rpLines = readFileSync(join(exportDir, 'geo_riverpoints.csv'), 'utf8').split('\n');
const noisyGrids = new Set<string>();
const cursor: Record<string, number> = {};
let curKey = '';
for (const line of rpLines) {
  if (line.startsWith('G,')) {
    curKey = line.slice(2).split(',').slice(0, 2).join(',');
    continue;
  }
  if (!line.startsWith('P,')) continue;
  const [px, py, w] = line.slice(2).split(',').map(Number);
  const tsPts = geo.riverPointMap.get(curKey)!;
  // find this point by index — but we only know the grid here; re-scan all
  // (points were verified in insertion order in geo-compare; redo cheaply:
  //  match by w (bit-exact everywhere) is ambiguous, so track an index)
  // Simpler: count-based cursor per grid.
  const idx = (cursor[curKey] = (cursor[curKey] ?? 0) + 1) - 1;
  const t = tsPts[idx];
  if (bits(px) !== bits(t.px) || bits(py) !== bits(t.py) || bits(w) !== bits(t.w)) {
    noisyGrids.add(curKey);
    console.log(`noisy point @ grid ${curKey} idx ${idx}: ref=(${px},${py},${w}) ts=(${t.px},${t.py},${t.w})`);
  }
}

const gridOf = (wx: number, wy: number) => {
  const f32 = Math.fround;
  const gx = Math.floor(f32(f32(wx + 32) / 64));
  const gy = Math.floor(f32(f32(wy + 32) / 64));
  return `${gx},${gy}`;
};

console.log('\nnoisy grids:', [...noisyGrids].join('  '));
for (const [x, y] of [
  [-2528, -7840],
  [-2560, 1920],
  [0, 4800],
  [-2624, 1984],
]) {
  const key = gridOf(x, y);
  console.log(`sample (${x},${y}) -> grid ${key}: ${noisyGrids.has(key) ? 'CONTAINS noisy point(s) -> propagation OK' : 'NO noisy point -> REAL BUG?'}`);
}
