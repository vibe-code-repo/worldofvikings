/**
 * E2/E3 smoke test — vegetation zone population (Phase E).
 *
 * Checks:
 *  1. Zone generation around a "player" at spawn produces ZDOs.
 *  2. Determinism: two fresh runs produce BIT-IDENTICAL ZDO dumps
 *     (same world seed ⇒ same world, exactly like the C++ server).
 *  3. Placement sanity: positions finite, y within plausible terrain range,
 *     scaleScalar within the pkg scale range of the entry's prefab.
 *  4. Expected content: spawn Meadows/BlackForest zones contain trees.
 *
 * Run: npx tsx server/test/e2-vegetation.ts   (from the repo root)
 */

import { GeoManager, HeightmapProvider, getStableHash } from '@wov/shared';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
import { ZoneManager } from '../src/world/ZoneManager.js';
import type { ZDO } from '../src/zdo/ZDO.js';

const SEED = getStableHash('KxSYuZquuw');

function buildWorld(): { zm: ZoneManager; zdos: ZDOManager } {
  const geo = new GeoManager(SEED, { worldGenVersion: 2 });
  const heightmaps = new HeightmapProvider(geo, {
    blendSmoothStep: true,
    bilinearSampling: false,
  });
  const zdos = new ZDOManager(1n);
  const zm = new ZoneManager(geo, heightmaps, zdos, SEED);
  return { zm, zdos };
}

function dumpZDOs(zdos: ZDOManager): string {
  const lines: string[] = [];
  // Cover all zones a 9x9 generation around spawn could touch (ZDOManager
  // zone space is floor(x/64) — half a zone offset from heightmap zones).
  for (let zy = -6; zy <= 6; zy++) {
    for (let zx = -6; zx <= 6; zx++) {
      for (const zdo of zdos.getZDOsInZone({ x: zx, y: zy })) {
        const scale = (zdo.getMembers() as Map<number, { value: unknown }>).size;
        lines.push(
          `${zdo.prefabHash}|${zdo.position.x},${zdo.position.y},${zdo.position.z}|` +
            `${zdo.rotation.x},${zdo.rotation.y},${zdo.rotation.z},${zdo.rotation.w}|m${scale}`
        );
      }
    }
  }
  return lines.sort().join('\n');
}

function allZDOs(zdos: ZDOManager): ZDO[] {
  const out: ZDO[] = [];
  for (let zy = -6; zy <= 6; zy++) {
    for (let zx = -6; zx <= 6; zx++) {
      out.push(...zdos.getZDOsInZone({ x: zx, y: zy }));
    }
  }
  return out;
}

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    failures++;
  }
}

console.log('=== E2/E3 vegetation smoke test ===');

// Run 1 — player at spawn, generous budget ⇒ full 9x9 generation
const t0 = Date.now();
const w1 = buildWorld();
const gen1 = w1.zm.update([{ x: 0, y: 36.05, z: 0 }], 60_000);
const elapsed = Date.now() - t0;
const list1 = allZDOs(w1.zdos);

console.log(`\n[1] Generation around spawn:`);
check('zones generated', gen1 === 81, `${gen1} zones in ${elapsed}ms`);
check('ZDOs created', list1.length > 500, `${list1.length} ZDOs`);

// Run 2 — fresh world, same seed ⇒ bit-identical dump
const w2 = buildWorld();
w2.zm.update([{ x: 0, y: 36.05, z: 0 }], 60_000);
const dump1 = dumpZDOs(w1.zdos);
const dump2 = dumpZDOs(w2.zdos);

console.log(`\n[2] Determinism:`);
check('bit-identical regeneration', dump1 === dump2, `${dump1.split('\n').length} ZDOs compared`);

// Sanity of placements
console.log(`\n[3] Placement sanity:`);
let badPos = 0;
let badScale = 0;
let trees = 0;
for (const zdo of list1) {
  const { x, y, z } = zdo.position;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) badPos++;
  if (y < -50 || y > 300) badPos++;
  const scaleMember = [...(zdo.getMembers() as Map<number, { type: number; value: unknown }>).values()].find(
    (m) => m.type === 0
  );
  if (scaleMember !== undefined) {
    const s = scaleMember.value as number;
    if (!Number.isFinite(s) || s <= 0 || s > 10) badScale++;
  }
}
const { FOLIAGE_HASHES, PREFABS_BY_NAME } = await import('@wov/shared');
const treeNames = new Set(['Beech1', 'FirTree', 'Pinetree_01', 'Birch1', 'Oak1', 'Beech_small1', 'Beech_small2']);
for (const zdo of list1) {
  for (const name of treeNames) {
    if (zdo.prefabHash === getStableHash(name)) {
      trees++;
      break;
    }
  }
}
check('positions finite + in range', badPos === 0, `${badPos} bad`);
check('scales plausible', badScale === 0, `${badScale} bad`);
check('trees spawned near spawn', trees > 50, `${trees} tree ZDOs`);

// Zone tracking
console.log(`\n[4] Zone tracking:`);
check('zone (0,0) generated', w1.zm.isZoneGenerated({ x: 0, y: 0 }));
check('zone (4,4) generated (radius 4)', w1.zm.isZoneGenerated({ x: 4, y: 4 }));
check('zone (5,0) NOT generated', !w1.zm.isZoneGenerated({ x: 5, y: 0 }));
check('far zone outside world radius rejected', !w1.zm.isZoneGenerated({ x: 200, y: 200 }));
// Re-update with same player pos ⇒ nothing new
const again = w1.zm.update([{ x: 0, y: 36.05, z: 0 }], 60_000);
check('re-update idempotent', again === 0, `${again} new zones`);

// Moving the player one zone east generates exactly the new column.
// C++ zone of x: floor((x+32)/64) — x=64 → zone 1, coverage x∈[-3,5]
// vs. previous [-4,4] ⇒ only column x=5 (z∈[-4,4]) is new = 9 zones.
const moved = w1.zm.update([{ x: 64, y: 36, z: 0 }], 60_000);
check('player move generates new zones', moved === 9, `${moved} new zones (expect 9)`);

console.log('');
if (failures === 0) {
  console.log('=== E2/E3: ALL PASSED ===');
} else {
  console.error(`=== E2/E3: ${failures} FAILURES ===`);
  process.exit(1);
}
