/**
 * Phase G smoke test — dungeon generator + document sanitizer.
 *
 *  1. Determinism: same (dungeon, seed) → identical layout.
 *  2. Different seeds → different layouts (the RNG actually steers).
 *  3. Every interior dungeon generates at least minRooms/4 rooms and the
 *     start room is an entrance room whose entrance connector sits at the
 *     origin.
 *  4. Overlap sanity: non-endcap room boxes (inset like the generator)
 *     never overlap.
 *  5. All placed rooms/doors reference defs of the base dungeon.
 *  6. sanitizeDungeonDocument round-trips a generated document unchanged
 *     and rejects garbage.
 *
 * Run: npx tsx shared/test/dungeon-generator.ts   (from the repo root)
 */

import {
  DUNGEONS,
  DungeonAlgorithm,
  generateDungeonLayout,
  sanitizeDungeonDocument,
  DUNGEON_DOCUMENT_VERSION,
} from '../src/index.js';
import { quatMulVec3 } from '../src/worldgen/Math3d.js';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
  }
}

const INTERIOR = DUNGEONS.filter(
  (d) => d.algorithm === DungeonAlgorithm.Dungeon && d.name !== 'DG_Hildir_PlainsFortress'
);

for (const dungeon of INTERIOR) {
  console.log(`\n${dungeon.name}:`);

  const a = generateDungeonLayout(dungeon, 42);
  const b = generateDungeonLayout(dungeon, 42);
  check('deterministic', JSON.stringify(a) === JSON.stringify(b));

  const c = generateDungeonLayout(dungeon, 43);
  check('seed varies layout', JSON.stringify(a) !== JSON.stringify(c));

  // minRooms is only a soft lower bound for early abort (DvergrBoss stops
  // via requiredRooms long before its huge minRooms) — cap the expectation.
  check(
    'enough rooms',
    a.rooms.length >= Math.max(2, Math.min(16, Math.floor(dungeon.minRooms / 4))),
    `${a.rooms.length} rooms`
  );

  const roomsByName = new Map(dungeon.rooms.map((r) => [r.name, r]));
  check(
    'all rooms from kit',
    a.rooms.every((r) => roomsByName.has(r.room))
  );

  const startDef = roomsByName.get(a.rooms[0].room)!;
  check('start room is entrance', startDef.entrance, a.rooms[0].room);

  const entranceConn = startDef.connections.find((cn) => cn.entrance)!;
  const start = a.rooms[0];
  const connWorld = {
    x: start.pos.x + quatMulVec3(start.rot, entranceConn.localPos).x,
    y: start.pos.y + quatMulVec3(start.rot, entranceConn.localPos).y,
    z: start.pos.z + quatMulVec3(start.rot, entranceConn.localPos).z,
  };
  const dist = Math.hypot(connWorld.x, connWorld.y, connWorld.z);
  check('entrance connector at origin', dist < 0.01, `dist=${dist.toFixed(4)}`);

  // Overlap sanity between non-endcap rooms (same inset as the generator).
  let overlaps = 0;
  const placed = a.rooms
    .map((r) => ({ def: roomsByName.get(r.room)!, pos: r.pos, rot: r.rot }))
    .filter((r) => !r.def.endCap && r.def.size.x !== 0 && r.def.size.z !== 0);
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const s1 = quatMulVec3(placed[i].rot, placed[i].def.size);
      const s2 = quatMulVec3(placed[j].rot, placed[j].def.size);
      const h1 = { x: Math.abs(s1.x) / 2 - 0.1, y: s1.y / 2 - 0.1, z: Math.abs(s1.z) / 2 - 0.1 };
      const h2 = { x: Math.abs(s2.x) / 2 - 0.1, y: s2.y / 2 - 0.1, z: Math.abs(s2.z) / 2 - 0.1 };
      const p1 = placed[i].pos;
      const p2 = placed[j].pos;
      const overlap =
        p1.x - h1.x < p2.x + h2.x &&
        p1.x + h1.x > p2.x - h2.x &&
        p1.y - h1.y < p2.y + h2.y &&
        p1.y + h1.y > p2.y - h2.y &&
        p1.z - h1.z < p2.z + h2.z &&
        p1.z + h1.z > p2.z - h2.z;
      if (overlap) overlaps++;
    }
  }
  check('no room overlaps', overlaps === 0, `${overlaps} overlapping pairs`);

  const doorHashes = new Set(dungeon.doorTypes.map((d) => d.prefabHash));
  check(
    'doors from kit',
    a.doors.every((d) => doorHashes.has(d.prefabHash)),
    `${a.doors.length} doors`
  );
}

console.log('\nsanitizeDungeonDocument:');
const fc = INTERIOR.find((d) => d.name === 'DG_ForestCrypt')!;
const layout = generateDungeonLayout(fc, 7);
const doc = {
  version: DUNGEON_DOCUMENT_VERSION,
  id: 'test-crypt-1',
  name: 'Testkrypta',
  base: 'DG_ForestCrypt',
  mode: 'generated' as const,
  seed: 7,
  zoneSize: 64,
  layout,
};
const sanitized = sanitizeDungeonDocument(JSON.parse(JSON.stringify(doc)));
check('round-trip ok', sanitized !== null);
check(
  'round-trip preserves rooms',
  sanitized !== null && sanitized.layout.rooms.length === layout.rooms.length
);
check(
  'round-trip preserves doors',
  sanitized !== null && sanitized.layout.doors.length === layout.doors.length
);
check('rejects bad id', sanitizeDungeonDocument({ ...doc, id: '../etc/passwd' }) === null);
check('rejects unknown base', sanitizeDungeonDocument({ ...doc, base: 'DG_Nope' }) === null);
check(
  'drops unknown rooms',
  (() => {
    const hacked = JSON.parse(JSON.stringify(doc));
    hacked.layout.rooms.push({ room: 'cave_new_corridor01', pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0, w: 1 }, placeOrder: 0, seed: 0 });
    const s = sanitizeDungeonDocument(hacked);
    return s !== null && s.layout.rooms.length === layout.rooms.length;
  })()
);

if (failures > 0) {
  console.error(`\n${failures} FAILURES`);
  process.exit(1);
}
console.log('\nAll dungeon generator checks passed.');
