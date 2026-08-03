/**
 * B5 smoke test — modern Ashlands height (ASHLANDS_2.0) behind the
 * worldAshlandsModernNoise flag.
 *
 * The bit-exact end-to-end verification against the C++ golden dumps is
 * geo-compare.ts (AshLands skip removed in B5); this file only checks the
 * flag dispatch and basic output sanity:
 *  1. Legacy mode still works (no FastNoise constructed, mask = 0).
 *  2. Modern mode returns finite heights without throwing.
 *  3. The lava mask is in [0,1] and actually varies (non-zero somewhere
 *     deep in the Ashlands — it is the whole point of B5).
 *  4. preGeneration heights are identical between the two modes (C++
 *     always uses the legacy/pregen formula for river/stream generation).
 *  5. Modern ≠ legacy height somewhere (the feature actually changes the
 *     terrain — otherwise the port would be suspect).
 *
 * Run: npx tsx shared/test/b5-ashlands-modern.ts   (from the repo root)
 */

import { GeoManager } from '../src/worldgen/GeoManager.js';
import { getStableHash } from '../src/hash.js';
import { Biome } from '../src/types.js';

const SEED = getStableHash('KxSYuZquuw');

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    failures++;
  }
}

console.log('=== B5 modern Ashlands smoke test ===');

const modern = new GeoManager(SEED, { ashlandsModernNoise: true });
const legacy = new GeoManager(SEED, { ashlandsModernNoise: false });

// Sample grid on the south rim, filtered to actual AshLands biome cells
// (biome classification does not depend on the noise mode; neighboring
// cells can be Ocean/Mistlands — Mistlands has its own signed vegMask).
const points: Array<[number, number]> = [];
for (let x = -2000; x <= 2000; x += 250) {
  for (let y = -7000; y >= -9500; y -= 250) {
    if (modern.getBiome(x, y) === Biome.AshLands) points.push([x, y]);
  }
}
check('sample grid contains AshLands cells', points.length > 50, `${points.length} cells`);

// [1] Legacy mode: works, mask always 0
let legacyOk = true;
let legacyMaskZero = true;
for (const [x, y] of points) {
  const r = legacy.getHeightWithMask(x, y);
  if (!Number.isFinite(r.height)) legacyOk = false;
  if (r.mask !== 0) legacyMaskZero = false;
}
check('legacy mode: finite heights', legacyOk);
check('legacy mode: mask is 0 everywhere', legacyMaskZero);

// [2] Modern mode: works, no throw
let modernOk = true;
let maskMin = Infinity;
let maskMax = -Infinity;
let heightMin = Infinity;
let heightMax = -Infinity;
for (const [x, y] of points) {
  const r = modern.getHeightWithMask(x, y);
  if (!Number.isFinite(r.height) || !Number.isFinite(r.mask)) modernOk = false;
  maskMin = Math.min(maskMin, r.mask);
  maskMax = Math.max(maskMax, r.mask);
  heightMin = Math.min(heightMin, r.height);
  heightMax = Math.max(heightMax, r.height);
}
check('modern mode: finite heights + masks', modernOk);
check(
  'modern mode: lava mask within [0,1]',
  maskMin >= 0 && maskMax <= 1,
  `mask range [${maskMin.toFixed(6)}, ${maskMax.toFixed(6)}]`
);
check(
  'modern mode: lava mask actually varies (lava pools exist)',
  maskMax > 0.5 && maskMax - maskMin > 0.25,
  `range ${(maskMax - maskMin).toFixed(4)}, max ${maskMax.toFixed(4)}`
);
check(
  'modern mode: terrain has relief',
  heightMax - heightMin > 5,
  `height range [${heightMin.toFixed(2)}, ${heightMax.toFixed(2)}] m`
);

// [3] preGeneration identical between modes (river gen uses legacy formula)
let pregenSame = true;
for (const [x, y] of points) {
  if (modern.getGenerationHeight(x, y) !== legacy.getGenerationHeight(x, y)) {
    pregenSame = false;
    break;
  }
}
check('preGeneration height identical in both modes (C++ parity)', pregenSame);

// [4] modern differs from legacy somewhere (the feature changes terrain)
let differs = false;
for (const [x, y] of points) {
  if (modern.getHeight(x, y) !== legacy.getHeight(x, y)) {
    differs = true;
    break;
  }
}
check('modern height differs from legacy (B5 changes Ashlands terrain)', differs);

if (failures > 0) {
  console.error(`\n=== B5: ${failures} CHECK(S) FAILED ===`);
  process.exit(1);
}
console.log('\n=== B5: ALL PASSED ===');
