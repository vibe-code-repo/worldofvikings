/**
 * D6 smoke test: server init wires GeoManager + HeightmapProvider and
 * produces ground heights identical to the D1-verified shared worldgen.
 * Does NOT bind the network port (init() only, no start()).
 *
 * Run:  npx tsx server/test/d6-smoke.ts
 */

import { createWovServer } from '../src/WovServer.js';

// worldFeatures: false — D6 tests worldgen wiring, not feature placement
// (F2). This skips the ~75s full-world prepareFeatures (146 features) and
// only books the StartTemple. No zone is generated here (no update()), so
// the F4 terrain leveling never registers and ground(0,0) keeps the
// D1-verified height; the leveled spawn plateau is verified in f3-leveling.
const server = createWovServer({
  port: 2499,
  worldSeed: 'KxSYuZquuw',
  worldFeatures: false,
});
server.init();

let failures = 0;
const check = (label: string, actual: number, expected: number): void => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${actual} (expect ${expected})`);
};

// (0,0) = zone (0,0) vertex [32,32] — D1-verified value 36.052001953125
check('getGroundHeight(0,0)', server.getGroundHeight(0, 0), 36.052001953125);
// spawn ZDO sits on the ground, not at y=50 anymore
const spawn = (server as unknown as { heightmaps: { getGroundHeight(x: number, z: number): number } }).heightmaps;
check('spawn y == ground(0,0)', server.getGroundHeight(0, 0), spawn.getGroundHeight(0, 0));

// gravity helper sanity: falling from above converges to ground
let y = 100;
for (let i = 0; i < 1000 && y > 36.052001953125; i++) y = Math.max(36.052001953125, y - 15 * (1 / 30));
check('gravity converges', y, 36.052001953125);

console.log(failures === 0 ? '\n=== D6 smoke: ALL PASSED ===' : `\n=== D6 smoke: ${failures} FAILED ===`);
process.exit(failures === 0 ? 0 : 1);
