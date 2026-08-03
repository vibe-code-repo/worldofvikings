/**
 * Smoke test for the GeoManager port (Phase C1-C5).
 *
 * Generates the world for the reference server seed (data/server.yml:
 * seed "KxSYuZquuw") and prints generation stats plus biome/height samples.
 * Plausibility check only — the exact 1:1 verification against the C++
 * server is the C6 harness.
 *
 * Run:  npx tsx shared/test/geo-smoke.ts [seedName]
 */

import { getStableHash } from '../src/hash.js';
import { GeoManager } from '../src/worldgen/GeoManager.js';
import { Biome } from '../src/types.js';

const seedName = process.argv[2] ?? 'KxSYuZquuw';
const worldSeed = getStableHash(seedName);
console.log(`seed "${seedName}" -> worldSeed (get_stable_hash) = ${worldSeed}`);

const t0 = performance.now();
const geo = new GeoManager(worldSeed, {
  worldGenVersion: 2,
  disableDistantRivers: false,
  riverAffectsOcean: false,
  ashlandsModernNoise: true, // matches data/server.yml; only affects AshLands getHeight
});
const t1 = performance.now();

console.log(
  `generated in ${(t1 - t0).toFixed(0)} ms: ${geo.lakeCount} lakes, ` +
    `${geo.riverCount} rivers, ${geo.streamCount} streams, ${geo.riverGridCount} river grids`
);

// ── Biome histogram over a 250 m grid (whole world) ───────────────

const biomeNames: Record<number, string> = {
  [Biome.None]: 'None',
  [Biome.Meadows]: 'Meadows',
  [Biome.Swamp]: 'Swamp',
  [Biome.Mountain]: 'Mountain',
  [Biome.BlackForest]: 'BlackForest',
  [Biome.Plains]: 'Plains',
  [Biome.AshLands]: 'AshLands',
  [Biome.DeepNorth]: 'DeepNorth',
  [Biome.Ocean]: 'Ocean',
  [Biome.Mistlands]: 'Mistlands',
};

const hist = new Map<number, number>();
let ocean = 0;
let total = 0;
for (let y = -10000; y <= 10000; y += 250) {
  for (let x = -10000; x <= 10000; x += 250) {
    const b = geo.getBiome(x, y);
    hist.set(b, (hist.get(b) ?? 0) + 1);
    if (b === Biome.Ocean) ocean++;
    total++;
  }
}
console.log(`\nbiome histogram (${total} samples, 250 m grid):`);
for (const [b, n] of [...hist.entries()].sort((a, z) => z[1] - a[1])) {
  console.log(`  ${(biomeNames[b] ?? String(b)).padEnd(12)} ${String(n).padStart(6)}  (${((100 * n) / total).toFixed(1)}%)`);
}

// ── Height samples along the x-axis ───────────────────────────────

console.log('\nheight profile along y=0 (getHeight, meters; water level = 30):');
for (let x = -10000; x <= 10000; x += 1000) {
  const b = geo.getBiome(x, 0);
  let h: number | string;
  try {
    h = geo.getHeight(x, 0);
  } catch (e) {
    h = `<${(e as Error).message.split('—')[1]?.trim() ?? 'error'}>`;
  }
  console.log(
    `  (${String(x).padStart(6)}, 0)  ${(biomeNames[b] ?? String(b)).padEnd(12)} ${typeof h === 'number' ? h.toFixed(2) : h}`
  );
}

// ── Determinism check: same seed twice → identical stats ──────────

const geo2 = new GeoManager(worldSeed);
const det =
  geo2.lakeCount === geo.lakeCount &&
  geo2.riverCount === geo.riverCount &&
  geo2.streamCount === geo.streamCount &&
  geo2.riverGridCount === geo.riverGridCount;
console.log(`\ndeterminism re-run: ${det ? 'OK (identical stats)' : 'MISMATCH!'}`);
if (!det) process.exit(1);
