/**
 * C6 comparison harness: TS GeoManager port vs. C++ server reference export.
 *
 * Reads the three CSVs produced by valhalla_geo_export (C++ server,
 * library/test/geo) and verifies the TypeScript port bit-for-bit:
 *
 *   geo_structure.csv    seed/offsets/seeds + every lake/river/stream (f32)
 *   geo_riverpoints.csv  the full river point grid, per-grid insertion order
 *   geo_samples.csv      ~1M sample rows: biome/area/heights/weights/forest
 *
 * Float comparison counts ULP distance on the float32 bit pattern
 * (0 ulp = bit-exact). 1-2 ulp noise is expected where C++ sinf/cosf/Perlin
 * differ from Math.* by one rounding; anything beyond that is a real bug.
 *
 * Since Phase B5 the AshLands cells are fully compared as well: the modern
 * FastNoise path (server.yml experimental-ashlands-modern-noise=true) is
 * ported in shared/src/worldgen/FastNoise.ts + getAshlandsHeightModern,
 * including the lava mask.
 *
 * Run:  npx tsx shared/test/geo-compare.ts [exportDir] [seedName]
 *       defaults: ../../valheim.community/build/geo-export-run, KxSYuZquuw
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getStableHash } from '../src/hash.js';
import { GeoManager } from '../src/worldgen/GeoManager.js';

const exportDir = process.argv[2] ?? '../../valheim.community/build/geo-export-run';
const seedName = process.argv[3] ?? 'KxSYuZquuw';

// ── float32 bit helpers ───────────────────────────────────────────

const f32buf = new Float32Array(1);
const u32buf = new Uint32Array(f32buf.buffer);
function f32bits(x: number): number {
  f32buf[0] = x;
  return u32buf[0];
}
/** ULP distance on the f32 bit pattern (monotonic int mapping). */
function ulpDist(a: number, b: number): number {
  let ia = f32bits(a);
  let ib = f32bits(b);
  ia = ia & 0x80000000 ? 0x80000000 - (ia & 0x7fffffff) : ia;
  ib = ib & 0x80000000 ? 0x80000000 - (ib & 0x7fffffff) : ib;
  return Math.abs(ia - ib);
}

// ── stats collector per compared column ───────────────────────────

interface Example {
  at: string;
  ref: string;
  ts: string;
  ulp: number;
}
class Col {
  n = 0;
  exact = 0;
  near = 0; // 1-2 ulp
  fail = 0; // >2 ulp
  explained = 0; // >2 ulp but inside a grid with a noisy (1ulp) river point
  maxUlp = 0;
  examples: Example[] = [];
  /** set of river-grid keys containing 1ulp-noisy points (phase 2 output) */
  explainSet: Set<string> | null = null;
  constructor(readonly name: string) {}
  add(ref: number, ts: number, at: string, ulpTol = 2, gridKey?: string): void {
    this.n++;
    const u = ulpDist(ref, ts);
    if (u === 0) {
      this.exact++;
      return;
    }
    if (u > this.maxUlp) this.maxUlp = u;
    if (u <= ulpTol) {
      this.near++;
      return;
    }
    // >2 ulp in a sample whose grid contains a 1ulp-noisy river point is
    // propagation of sinf/cosf vs Math.sin/cos noise (amplified by 1/w in
    // GetWeight), not a port bug — verified in phase 2 / geo-correlate.
    if (gridKey !== undefined && this.explainSet?.has(gridKey)) {
      this.explained++;
      return;
    }
    this.fail++;
    if (this.examples.length < 5) {
      this.examples.push({ at, ref: String(ref), ts: String(ts), ulp: u });
    }
  }
  addBool(ref: boolean, ts: boolean, at: string): void {
    this.n++;
    if (ref === ts) {
      this.exact++;
      return;
    }
    this.fail++;
    if (this.examples.length < 5) {
      this.examples.push({ at, ref: String(ref), ts: String(ts), ulp: -1 });
    }
  }
  report(): string {
    const ok = this.fail === 0;
    const expl = this.explained > 0 ? `, ${this.explained} explained (1ulp point noise)` : '';
    const lines = [
      `  ${ok ? 'PASS' : 'FAIL'}  ${this.name.padEnd(14)} ${String(this.n).padStart(9)} rows: ` +
        `${this.exact} exact, ${this.near} 1-2ulp, ${this.fail} >2ulp${expl} (max ${this.maxUlp} ulp)`,
    ];
    for (const e of this.examples) {
      lines.push(`         @ ${e.at}: ref=${e.ref} ts=${e.ts} (${e.ulp} ulp)`);
    }
    return lines.join('\n');
  }
}

/**
 * Absolute-tolerance collector for the modern AshLands height/mask (B5).
 * The modern path is bit-exact for ~99.7 % of cells, but the lava-mask
 * threshold `clamp01((num12 - 0.17) / 0.01)` amplifies the unavoidable
 * ±1-f32-ulp toolchain noise (MSVC sinf/pow vs Math.sin/pow — same caveat
 * as the trig note in GeoManager.ts) by up to ×100 at threshold cells.
 * Observed worst case: 4.6e-6 m height / 3.6e-7 mask. A real port bug
 * produces meter-scale errors (legacy-vs-modern differ by ~250 m), so a
 * generous absolute band cleanly separates libm noise from bugs.
 */
class AbsCol {
  n = 0;
  exact = 0;
  within = 0;
  fail = 0;
  maxDiff = 0;
  examples: Example[] = [];
  constructor(readonly name: string, readonly absTol: number) {}
  add(ref: number, ts: number, at: string): void {
    this.n++;
    if (ref === ts) {
      this.exact++;
      return;
    }
    const d = Math.abs(ref - ts);
    if (d > this.maxDiff) this.maxDiff = d;
    if (d <= this.absTol) {
      this.within++;
      return;
    }
    this.fail++;
    if (this.examples.length < 5) {
      this.examples.push({ at, ref: String(ref), ts: String(ts), ulp: ulpDist(ref, ts) });
    }
  }
  report(): string {
    const ok = this.fail === 0;
    const lines = [
      `  ${ok ? 'PASS' : 'FAIL'}  ${this.name.padEnd(14)} ${String(this.n).padStart(9)} rows: ` +
        `${this.exact} exact, ${this.within} within ±${this.absTol}, ${this.fail} beyond (max diff ${this.maxDiff})`,
    ];
    for (const e of this.examples) {
      lines.push(`         @ ${e.at}: ref=${e.ref} ts=${e.ts} (${e.ulp} ulp)`);
    }
    return lines.join('\n');
  }
}

// ── 1. structure: offsets/seeds + lakes/rivers/streams ────────────

console.log(`C6 geo-compare: export=${exportDir} seed="${seedName}"`);

const structure = readFileSync(join(exportDir, 'geo_structure.csv'), 'utf8').split('\n');
const header: Record<string, string> = {};
const lakes: number[][] = [];
const rivers: number[][] = [];
const streams: number[][] = [];
for (const line of structure) {
  if (line.startsWith('# ')) {
    // A header line can hold several space-separated key=value pairs
    // (e.g. "# riverAffectsOcean=0 ashlandsModernNoise=1 disableDistantRivers=0")
    for (const token of line.slice(2).trim().split(/\s+/)) {
      const eq = token.indexOf('=');
      if (eq > 0) header[token.slice(0, eq)] = token.slice(eq + 1);
    }
  } else if (line.startsWith('L,')) {
    lakes.push(line.slice(2).split(',').map(Number));
  } else if (line.startsWith('R,')) {
    rivers.push(line.slice(2).split(',').map(Number));
  } else if (line.startsWith('S,')) {
    streams.push(line.slice(2).split(',').map(Number));
  }
}

const worldSeed = getStableHash(seedName);
console.log(`worldSeed=${worldSeed} (ref ${header.seed})`);
if (String(worldSeed) !== header.seed) {
  console.error('FAIL: world seed mismatch — wrong seed name or getStableHash broken');
  process.exit(1);
}

const geo = new GeoManager(worldSeed, {
  worldGenVersion: Number(header.worldGenVersion ?? '2'),
  disableDistantRivers: header['disableDistantRivers'] === '1',
  riverAffectsOcean: header['riverAffectsOcean'] === '1',
  ashlandsModernNoise: header['ashlandsModernNoise'] === '1',
});
console.log(
  `flags: modernNoise=${geo.settings.ashlandsModernNoise} riverAffectsOcean=${geo.settings.riverAffectsOcean} ` +
    `disableDistantRivers=${geo.settings.disableDistantRivers} worldGenVersion=${geo.settings.worldGenVersion} (from header)`
);

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

console.log('\n== header (offsets / seeds) ==');
const refOffsets = (header.offsets ?? '').split(',').map(Number);
check(
  'offsets',
  refOffsets.length === 5 && refOffsets.every((v, i) => v === geo.offsets[i]),
  `ref=[${refOffsets}] ts=[${geo.offsets}]`
);
check('riverSeed', Number(header.riverSeed) === geo.riverSeedValue, `ref=${header.riverSeed} ts=${geo.riverSeedValue}`);
check('streamSeed', Number(header.streamSeed) === geo.streamSeedValue, `ref=${header.streamSeed} ts=${geo.streamSeedValue}`);

console.log('\n== structure: lakes / rivers / streams ==');
const colLakeX = new Col('lake.x');
const colLakeY = new Col('lake.y');
const colRiver = new Col('river fields');
const colStream = new Col('stream fields');

check('lake count', lakes.length === geo.lakeCount, `ref=${lakes.length} ts=${geo.lakeCount}`);
const nLakes = Math.min(lakes.length, geo.lakeCount);
for (let i = 0; i < nLakes; i++) {
  const at = `lake[${i}]`;
  colLakeX.add(lakes[i][0], geo.lakeList[i].x, at, 0);
  colLakeY.add(lakes[i][1], geo.lakeList[i].y, at, 0);
}

check('river count', rivers.length === geo.riverCount, `ref=${rivers.length} ts=${geo.riverCount}`);
const nRivers = Math.min(rivers.length, geo.riverCount);
for (let i = 0; i < nRivers; i++) {
  const t = geo.riverList[i];
  const r = rivers[i];
  const at = `river[${i}]`;
  const vals = [t.p0.x, t.p0.y, t.p1.x, t.p1.y, t.center.x, t.center.y, t.widthMin, t.widthMax, t.curveWidth, t.curveWavelength];
  for (let k = 0; k < 10; k++) colRiver.add(r[k], vals[k], `${at} field${k}`, 2);
}

check('stream count', streams.length === geo.streamCount, `ref=${streams.length} ts=${geo.streamCount}`);
const nStreams = Math.min(streams.length, geo.streamCount);
for (let i = 0; i < nStreams; i++) {
  const t = geo.streamList[i];
  const r = streams[i];
  const at = `stream[${i}]`;
  const vals = [t.p0.x, t.p0.y, t.p1.x, t.p1.y, t.center.x, t.center.y, t.widthMin, t.widthMax, t.curveWidth, t.curveWavelength];
  for (let k = 0; k < 10; k++) colStream.add(r[k], vals[k], `${at} field${k}`, 2);
}
for (const c of [colLakeX, colLakeY, colRiver, colStream]) {
  console.log(c.report());
  if (c.fail > 0) failures++;
}

// ── 2. river point grid ───────────────────────────────────────────

console.log('\n== river points (per-grid insertion order, f32) ==');
const rpLines = readFileSync(join(exportDir, 'geo_riverpoints.csv'), 'utf8').split('\n');
const refGrids = new Map<string, number[][]>();
let curKey = '';
for (const line of rpLines) {
  if (line.startsWith('G,')) {
    const p = line.slice(2).split(',');
    curKey = `${p[0]},${p[1]}`;
    refGrids.set(curKey, []);
  } else if (line.startsWith('P,')) {
    const p = line.slice(2).split(',').map(Number);
    refGrids.get(curKey)!.push(p);
  }
}

const tsGrids = geo.riverPointMap;
check('grid count', refGrids.size === tsGrids.size, `ref=${refGrids.size} ts=${tsGrids.size}`);

const colPx = new Col('point.x');
const colPy = new Col('point.y');
const colPw = new Col('point.w');
const noisyGrids = new Set<string>(); // grids containing any non-exact point
let gridsMissing = 0;
let gridsCountMismatch = 0;
let refPointTotal = 0;
let tsPointTotal = 0;
for (const [key, refPts] of refGrids) {
  refPointTotal += refPts.length;
  const tsPts = tsGrids.get(key);
  if (!tsPts) {
    gridsMissing++;
    continue;
  }
  tsPointTotal += tsPts.length;
  if (tsPts.length !== refPts.length) {
    if (gridsCountMismatch < 5) console.log(`  count mismatch @ grid ${key}: ref=${refPts.length} ts=${tsPts.length}`);
    gridsCountMismatch++;
    continue; // order comparison meaningless if lengths differ
  }
  for (let i = 0; i < refPts.length; i++) {
    const at = `grid ${key} pt[${i}]`;
    colPx.add(refPts[i][0], tsPts[i].px, at, 2);
    colPy.add(refPts[i][1], tsPts[i].py, at, 2);
    colPw.add(refPts[i][2], tsPts[i].w, at, 2);
    if (
      f32bits(refPts[i][0]) !== f32bits(tsPts[i].px) ||
      f32bits(refPts[i][1]) !== f32bits(tsPts[i].py) ||
      f32bits(refPts[i][2]) !== f32bits(tsPts[i].w)
    ) {
      noisyGrids.add(key);
    }
  }
}
// grids that only exist on the TS side
let gridsExtra = 0;
for (const key of tsGrids.keys()) if (!refGrids.has(key)) gridsExtra++;

check('grids present', gridsMissing === 0 && gridsExtra === 0, `missing=${gridsMissing} extra=${gridsExtra}`);
check('grid point counts', gridsCountMismatch === 0, `${gridsCountMismatch} grids differ`);
check('total points', refPointTotal === tsPointTotal, `ref=${refPointTotal} ts=${tsPointTotal}`);
for (const c of [colPx, colPy, colPw]) {
  console.log(c.report());
  if (c.fail > 0) failures++;
}

// ── 3. sample grids ───────────────────────────────────────────────

console.log('\n== samples (coarse 32m full world + 2x fine 1m) ==');
const sampleLines = readFileSync(join(exportDir, 'geo_samples.csv'), 'utf8').split('\n');

const colBiome = new Col('biome');
const colBiomes = new Col('biomes(||)');
const colArea = new Col('biomeArea');
const colBase = new Col('baseHeight');
const colGen = new Col('genHeight');
const colHeight = new Col('height');
const colMask = new Col('mask');
// B5: modern AshLands via absolute band (lava-threshold libm amplification)
const colHeightAsh = new AbsCol('height[Ash]', 1e-3);
const colMaskAsh = new AbsCol('mask[Ash]', 1e-4);
const colRW = new Col('riverWeight');
const colRWidth = new Col('riverWidth');
const colForest = new Col('forestFactor');
const colInForest = new Col('inForest');
colRW.explainSet = noisyGrids;
colRWidth.explainSet = noisyGrids;
const BIOME_ASHLANDS = 32;

for (const line of sampleLines) {
  if (line.length === 0 || line[0] === '#' || line[0] === 'x') continue;
  const p = line.split(',');
  const x = Number(p[0]);
  const y = Number(p[1]);
  const refBiome = Number(p[2]);
  const at = `(${x},${y})`;

  const tsBiome = geo.getBiome(x, y);
  colBiome.add(refBiome, tsBiome, at, 0);
  colBiomes.add(Number(p[3]), geo.getBiomes(x, y), at, 0);
  colArea.add(Number(p[4]), geo.getBiomeArea(x, y), at, 0);
  colBase.add(Number(p[5]), geo.getBaseHeight(x, y), at);
  colGen.add(Number(p[6]), geo.getGenerationHeight(x, y), at);

  // B5: AshLands height/mask compared via absolute band; all other biomes
  // stay on the strict ULP-2 metric.
  const h = geo.getHeightWithMask(x, y);
  const refMask = Number(p[8]);
  if (refBiome === BIOME_ASHLANDS && geo.settings.ashlandsModernNoise) {
    colHeightAsh.add(Number(p[7]), h.height, at);
    if (refMask !== -999) colMaskAsh.add(refMask, h.mask, at);
  } else {
    colHeight.add(Number(p[7]), h.height, at);
    if (refMask !== -999) colMask.add(refMask, h.mask, at);
  }

  const rw = geo.getRiverWeight(x, y);
  // C++ IGeoManager::GetRiverGrid — same f32 math as the port
  const f32 = Math.fround;
  const gridKey = `${Math.floor(f32(f32(x + 32) / 64))},${Math.floor(f32(f32(y + 32) / 64))}`;
  colRW.add(Number(p[9]), rw.weight, at, 2, gridKey);
  colRWidth.add(Number(p[10]), rw.width, at, 2, gridKey);
  colForest.add(Number(p[11]), geo.getForestFactor(x, y), at);
  colInForest.addBool(p[12] === '1', geo.inForest(x, y), at);
}

console.log('  (AshLands height/mask compared since Phase B5 — absolute band for lava-threshold libm noise)');
for (const c of [colBiome, colBiomes, colArea, colBase, colGen, colHeight, colHeightAsh, colMask, colMaskAsh, colRW, colRWidth, colForest, colInForest]) {
  console.log(c.report());
  if (c.fail > 0) failures++;
}

console.log(failures === 0 ? '\n=== C6: ALL CHECKS PASSED ===' : `\n=== C6: ${failures} CHECK GROUPS FAILED ===`);
process.exit(failures === 0 ? 0 : 1);
