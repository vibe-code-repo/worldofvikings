/**
 * Player terrain modification — TerrainComp parity checks.
 *
 * Covers the properties that make Valheim's terraforming feel the way it does,
 * and the two failure modes that are easy to introduce and hard to spot later:
 *
 *  1. Level produces a flat plateau at exactly the requested height.
 *  2. Raise falls off monotonically and never exceeds the requested delta.
 *  3. Digging saturates at exactly base − 8 m (c_LevelMaxDelta), no drift.
 *  4. Smooth deltas stay inside ±1 m (c_SmoothMaxDelta).
 *  5. ZONE SEAM: an operation on a zone border must write the shared edge
 *     vertex identically in BOTH zones. This fails if applyTerrainOp uses
 *     worldToZone(x ± reach) — see the comment there.
 *  6. baseHeights stays pristine (the D1 golden tests depend on it).
 *  7. Edits survive zone cache eviction (comps live in the provider).
 *
 * Run: npx tsx shared/test/terrain-comp.ts   (from the repo root)
 */

import {
  GeoManager,
  HeightmapProvider,
  E_WIDTH,
  ZONE_UNITS,
  LEVEL_MAX_DELTA,
  SMOOTH_MAX_DELTA,
  getStableHash,
  type TerrainOpSettings,
} from '../src/index.js';

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

function makeProvider(): HeightmapProvider {
  return new HeightmapProvider(new GeoManager(SEED));
}

/** Settings skeleton — every test enables just the operation it needs. */
function op(partial: Partial<TerrainOpSettings>): TerrainOpSettings {
  return {
    levelOffset: 0,
    level: false,
    levelRadius: 2,
    square: false,
    raise: false,
    raiseRadius: 2,
    raisePower: 3,
    raiseDelta: 0,
    smooth: false,
    smoothRadius: 2,
    smoothPower: 3,
    paintCleared: false,
    paintHeightCheck: false,
    paintType: 0,
    paintRadius: 2,
    ...partial,
  };
}

// ── 1. Level: flat plateau, exact ─────────────────────────────────
console.log('── level ──');
{
  const p = makeProvider();
  // Centre of zone (0,0) is world (0,0).
  const target = p.getGroundHeight(0, 0) + 1.5;
  p.applyTerrainOp(0, target, 0, op({ level: true, levelRadius: 3 }));

  const hm = p.getZone(0, 0);
  let allExact = true;
  let worst = 0;
  // Vertex (32,32) is world (0,0); sample well inside the radius.
  for (let ry = 31; ry <= 33; ry++) {
    for (let rx = 31; rx <= 33; rx++) {
      const h = hm.heights[ry * E_WIDTH + rx];
      const d = Math.abs(h - target);
      if (d > worst) worst = d;
      if (h !== Math.fround(target)) allExact = false;
    }
  }
  check('plateau is exactly the target height', allExact, `maxDiff=${worst.toExponential(2)}`);

  // Outside levelRadius + 1 nothing may move.
  const far = hm.heights[32 * E_WIDTH + 40];
  const farBase = hm.baseHeights[32 * E_WIDTH + 40];
  check('far field untouched', far === farBase, `${far} vs ${farBase}`);
}

// ── 2. Raise: monotone falloff, capped at delta ───────────────────
console.log('── raise ──');
{
  const p = makeProvider();
  const ground = p.getGroundHeight(0, 0);
  const delta = 1;
  p.applyTerrainOp(0, ground, 0, op({ raise: true, raiseRadius: 4, raiseDelta: delta, raisePower: 3 }));

  const hm = p.getZone(0, 0);
  const base = hm.baseHeights;
  const rises: number[] = [];
  for (let d = 0; d <= 4; d++) rises.push(hm.heights[32 * E_WIDTH + (32 + d)] - base[32 * E_WIDTH + (32 + d)]);

  let monotone = true;
  for (let i = 1; i < rises.length; i++) if (rises[i] > rises[i - 1] + 1e-6) monotone = false;
  check('falloff decreases with distance', monotone, rises.map((r) => r.toFixed(3)).join(' → '));
  check('peak does not exceed delta', rises[0] <= delta + 1e-6, `peak=${rises[0].toFixed(4)}`);
  check('raise only lifts, never lowers', rises.every((r) => r >= -1e-6));
}

// ── 3. Digging saturates at exactly −8 m ──────────────────────────
console.log('── level max delta ──');
{
  const p = makeProvider();
  // Dig far below the ground, repeatedly — must clamp, not drift.
  for (let i = 0; i < 20; i++) {
    const ground = p.getGroundHeight(0, 0);
    p.applyTerrainOp(0, ground - 4, 0, op({ level: true, levelRadius: 2 }));
  }
  const hm = p.getZone(0, 0);
  const i0 = 32 * E_WIDTH + 32;
  const expected = Math.fround(hm.baseHeights[i0] - LEVEL_MAX_DELTA);
  check('saturates at base − 8 exactly', hm.heights[i0] === expected, `${hm.heights[i0]} vs ${expected}`);

  const comp = p.getTerrainComp(0, 0)!;
  check('levelDelta clamped to −8', comp.levelDelta![i0] === -LEVEL_MAX_DELTA, `${comp.levelDelta![i0]}`);
  check('atMaxLevelDepth reports true', p.atMaxLevelDepth(0, 0));
}

// ── 4. Smooth stays within ±1 m ───────────────────────────────────
console.log('── smooth max delta ──');
{
  const p = makeProvider();
  for (let i = 0; i < 20; i++) {
    const ground = p.getGroundHeight(0, 0);
    p.applyTerrainOp(0, ground + 5, 0, op({ smooth: true, smoothRadius: 3, smoothPower: 3 }));
  }
  const comp = p.getTerrainComp(0, 0)!;
  let inRange = true;
  for (let i = 0; i < comp.smoothDelta!.length; i++) {
    if (Math.abs(comp.smoothDelta![i]) > SMOOTH_MAX_DELTA + 1e-6) inRange = false;
  }
  check('smoothDelta stays within ±1', inRange);
}

// ── 5. Zone seam — the regression this whole formula exists for ───
console.log('── zone seam ──');
{
  // World x = 32 is the border between zone 0 ([-32,32]) and zone 1 ([32,96]).
  // Both own that column of vertices: rx=64 in zone 0, rx=0 in zone 1.
  const p = makeProvider();
  const ground = p.getGroundHeight(32, 0);
  const affected = p.applyTerrainOp(32, ground - 3, 0, op({ level: true, levelRadius: 2.5 }));

  const touchesBoth =
    affected.some(([zx]) => zx === 0) && affected.some(([zx]) => zx === 1);
  check('operation reaches both bordering zones', touchesBoth, `zones=${JSON.stringify(affected)}`);

  const left = p.getZone(0, 0);
  const right = p.getZone(1, 0);
  let seamOk = true;
  let firstBad = '';
  for (let ry = 0; ry < E_WIDTH; ry++) {
    const a = left.heights[ry * E_WIDTH + (E_WIDTH - 1)];
    const b = right.heights[ry * E_WIDTH + 0];
    if (a !== b) {
      seamOk = false;
      if (!firstBad) firstBad = `ry=${ry}: ${a} vs ${b}`;
    }
  }
  check('shared edge vertices are bit-identical', seamOk, firstBad || 'all 65 rows match');

  // Same check on the Z border, where the operation spans zones vertically.
  const p2 = makeProvider();
  const g2 = p2.getGroundHeight(0, 32);
  p2.applyTerrainOp(0, g2 - 3, 32, op({ level: true, levelRadius: 2.5 }));
  const bottom = p2.getZone(0, 0);
  const top = p2.getZone(0, 1);
  let seamZOk = true;
  for (let rx = 0; rx < E_WIDTH; rx++) {
    if (bottom.heights[(E_WIDTH - 1) * E_WIDTH + rx] !== top.heights[0 * E_WIDTH + rx]) seamZOk = false;
  }
  check('shared edge vertices match on the Z border too', seamZOk);
}

// ── 6. baseHeights must stay pristine ─────────────────────────────
console.log('── baseHeights pristine ──');
{
  const p = makeProvider();
  const before = Float32Array.from(p.getZone(0, 0).baseHeights);
  p.applyTerrainOp(0, p.getGroundHeight(0, 0) - 5, 0, op({ level: true, levelRadius: 4 }));
  const after = p.getZone(0, 0).baseHeights;
  let same = true;
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) same = false;
  check('baseHeights unchanged by edits', same);
}

// ── 7. Edits survive zone cache eviction ──────────────────────────
console.log('── cache eviction ──');
{
  // Tiny LRU so a couple of lookups evict zone (0,0).
  const p = new HeightmapProvider(new GeoManager(SEED), {}, 4);
  const target = p.getGroundHeight(0, 0) - 2;
  p.applyTerrainOp(0, target, 0, op({ level: true, levelRadius: 3 }));
  const dug = p.getZone(0, 0).heights[32 * E_WIDTH + 32];

  // Touch enough other zones to push (0,0) out.
  for (let i = 1; i <= 8; i++) p.getZone(i * 3, i * 5);
  check('zone was actually evicted', p.cachedZoneCount <= 4, `cached=${p.cachedZoneCount}`);

  const again = p.getZone(0, 0).heights[32 * E_WIDTH + 32];
  check('edit reapplied after rebuild', again === dug, `${again} vs ${dug}`);
}

// ── 8. Only genuinely touched zones keep state ────────────────────
console.log('── comp hygiene ──');
{
  // applyTerrainOp walks a bounding box of zones, which is deliberately
  // generous. Zones whose vertices all fall outside the radius must not be
  // left holding an empty comp — it would be serialized and broadcast for
  // nothing, once per zone, forever.
  //
  // Small radius right next to the x=32 border: the box spans zone 0 and 1,
  // but no vertex of zone 1 is within reach.
  const p = makeProvider();
  const ground = p.getGroundHeight(31, 0);
  const affected = p.applyTerrainOp(31, ground - 1, 0, op({ level: true, levelRadius: 0.4 }));
  const comps = [...p.listTerrainComps()];

  check(
    'one comp per affected zone, no strays',
    comps.length === affected.length,
    `comps=${comps.length}, affected=${affected.length}`
  );
  check(
    'comps sit exactly on the affected zones',
    comps.every((c) => affected.some(([zx, zy]) => zx === c.zoneX && zy === c.zoneY)),
    JSON.stringify(affected)
  );
}

// ── 9. raise(delta=0) behaves like the original ───────────────────
console.log('── raise delta 0 ──');
{
  // Documenting a real Valheim quirk rather than asserting a nicer behaviour:
  // RaiseTerrain has no early-out for delta === 0. Both direction guards test
  // `delta < 0` and `delta > 0`, so zero falls through and the vertex is set
  // to worldPos.y — i.e. it acts as a level, not as a no-op.
  const p = makeProvider();
  const target = p.getGroundHeight(0, 0) + 2;
  p.applyTerrainOp(0, target, 0, op({ raise: true, raiseRadius: 2, raiseDelta: 0 }));
  const h = p.getZone(0, 0).heights[32 * E_WIDTH + 32];
  check('raise with delta 0 levels to the target height', h === Math.fround(target), `${h} vs ${target}`);
}

console.log('');
if (failures === 0) {
  console.log('=== ALL TERRAIN-COMP TESTS PASSED ===');
} else {
  console.error(`=== ${failures} TERRAIN-COMP TEST(S) FAILED ===`);
  process.exit(1);
}
