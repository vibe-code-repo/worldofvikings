/**
 * Golden-value tests for the Unity math ports (Phase B1/B2 verification).
 *
 * Reference data + generator semantics from the original Valhalla project
 * (Avledet, commit aafde42 "backup", include/Tests.h — the files in
 * valheim.community/data/tests/ are unchanged from that commit):
 *
 *   void Test_Random() {
 *     auto&& values = ReadFileLines("random_values.txt");
 *     // the first line is the seed
 *     VUtils::Random::State state(std::stoi(values[0]));
 *     for (int i = 0; i < 100; ++i)
 *       assert(state.Range(int32_min, int32_max) == std::stoi(values[i + 1]));
 *   }
 *
 *   void Test_Perlin() {
 *     auto&& values = ReadFileLines("perlin_values.txt");
 *     int next = 0;
 *     for (float y = -1.1f; y < 1.1f; y += .3f)
 *       for (float x = -1.1f; x < 1.1f; x += .1f) {
 *         float calc = VUtils::Math::PerlinNoise(x, y);
 *         float other = std::stof(values[next]);
 *         static constexpr float EPS = 0.0001f;
 *         assert((calc - EPS < other && calc + EPS > other));
 *         next++;
 *       }
 *   }
 *
 * Tolerance: the golden files were produced by the ORIGINAL float32 Perlin /
 * Random implementations; the current C++ server (and our port) use the
 * HEIGHTFIX-02 double-precision Perlin, so values differ by float32 rounding
 * noise (~1e-7, the original C++ test itself used EPS=1e-4). The Random test
 * must match EXACTLY (integer arithmetic).
 *
 * Run:  npx tsx shared/test/math-golden.ts [path-to-tests-dir]
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { XorShiftRandom } from '../src/worldgen/Random.js';
import { perlinNoise } from '../src/worldgen/Perlin.js';

const f32 = Math.fround;

const testsDir =
  process.argv[2] ?? 'c:/Users/Administrator/Modding/valheim.community/data/tests';

let failures = 0;

// ── 1. Random golden values (exact) ───────────────────────────────

function testRandom(): void {
  console.log('── random_values.txt ──');
  const lines = readFileSync(join(testsDir, 'random_values.txt'), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // First line is the SEED, the following 100 lines are the expected outputs
  const seed = Number.parseInt(lines[0], 10);
  const golden = lines.slice(1).map((l) => Number.parseInt(l, 10));
  console.log(`seed (line 1): ${seed}, ${golden.length} expected range(INT_MIN, INT_MAX) values`);

  const INT32_MIN = -2147483648;
  const INT32_MAX = 2147483647;

  const rng = new XorShiftRandom(seed);
  let mismatches = 0;
  for (let i = 0; i < golden.length; i++) {
    const v = rng.rangeInt(INT32_MIN, INT32_MAX);
    if (v !== golden[i]) {
      if (mismatches < 5) console.log(`  mismatch at [${i}]: got ${v}, want ${golden[i]}`);
      mismatches++;
    }
  }
  if (mismatches === 0) {
    console.log(`  OK: all ${golden.length} values match exactly`);
  } else {
    console.log(`  FAIL: ${mismatches}/${golden.length} mismatches`);
    failures++;
  }
}

// ── 2. Perlin golden values (epsilon) ─────────────────────────────

function testPerlin(): void {
  console.log('── perlin_values.txt ──');
  const golden = readFileSync(join(testsDir, 'perlin_values.txt'), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => Number.parseFloat(l));
  console.log(`${golden.length} expected values (y: -1.1 += 0.3, x: -1.1 += 0.1, f32 accumulation)`);

  // Tolerance: golden came from the float32 Perlin; our port is the current
  // C++ double-precision (HEIGHTFIX-02) variant. Anything structural (wrong
  // permutation table / constants / gradient logic) shows up > 1e-3.
  const EPS = 2e-6;

  let next = 0;
  let maxDiff = 0;
  let worstAt = '';
  // f32 accumulation of the loop variables, exactly like the C++ generator
  for (let y = f32(-1.1); y < 1.1; y = f32(y + f32(0.3))) {
    for (let x = f32(-1.1); x < 1.1; x = f32(x + f32(0.1))) {
      const calc = perlinNoise(x, y);
      const other = golden[next++];
      const d = Math.abs(calc - other);
      if (d > maxDiff) {
        maxDiff = d;
        worstAt = `(${x.toFixed(6)}, ${y.toFixed(6)})`;
      }
    }
  }

  console.log(`  evaluated ${next} points, maxDiff=${maxDiff.toExponential(3)} at ${worstAt}`);
  if (next !== golden.length) {
    console.log(`  FAIL: grid has ${next} points but file has ${golden.length} values`);
    failures++;
  } else if (maxDiff > EPS) {
    console.log(`  FAIL: maxDiff exceeds epsilon ${EPS}`);
    failures++;
  } else {
    console.log(`  OK: all ${next} values within epsilon ${EPS}`);
  }
}

// ── run ───────────────────────────────────────────────────────────

testRandom();
console.log();
testPerlin();

console.log();
if (failures === 0) {
  console.log('ALL GOLDEN TESTS PASSED');
} else {
  console.log(`${failures} test group(s) FAILED`);
  process.exit(1);
}
