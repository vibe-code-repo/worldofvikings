/**
 * Phase G smoke test — DungeonManager (documents, entrances, instances).
 *
 * Checks:
 *  1. createGenerated persists a document with a stable ID; reload from a
 *     fresh manager sees the same document (disk round-trip through the
 *     sanitizer).
 *  2. getOrCreateInstance materializes ZDOs in the instance band (room
 *     shells + net views + doors), all in the instance's slot volume,
 *     far outside the playable world.
 *  3. Two instances occupy different slots (no interest overlap: origins
 *     ≥ DUNGEON_INSTANCE_SPACING apart).
 *  4. destroyInstance removes every materialized ZDO and frees the slot.
 *  5. upsertDocument (editor path) sanitizes garbage away and tears down
 *     the live instance so the next enter sees the new layout.
 *  6. registerEntrance auto-creates a deterministic document and keeps an
 *     existing assignment on repeat calls; assignEntrance reassigns.
 *
 * Run: npx tsx server/test/g5-dungeons.ts   (from the repo root)
 */

import { rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  DUNGEON_INSTANCE_SPACING,
  DUNGEON_INSTANCE_X_BASE,
  getStableHash,
  isInDungeonBand,
} from '@wov/shared';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
import { DungeonManager } from '../src/world/dungeon/DungeonManager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DUNGEONS_DIR = resolve(__dirname, 'tmp-g5-dungeons');

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
  }
}

rmSync(DUNGEONS_DIR, { recursive: true, force: true });

const zdos = new ZDOManager(1n);
const mgr = new DungeonManager(zdos, DUNGEONS_DIR);
mgr.load();

// ── 1. Document round-trip ─────────────────────────────────────────
console.log('\nDocuments:');
const doc = mgr.createGenerated('DG_ForestCrypt', 4242);
check('createGenerated', doc !== null, doc?.id);
check('layout stored', (doc?.layout.rooms.length ?? 0) > 5, `${doc?.layout.rooms.length} rooms`);

const mgr2 = new DungeonManager(zdos, DUNGEONS_DIR);
mgr2.load();
const reloaded = mgr2.getDocument(doc!.id);
check('disk round-trip', reloaded !== null && reloaded !== undefined);
check(
  'round-trip identical layout',
  JSON.stringify(reloaded?.layout) === JSON.stringify(doc!.layout)
);

// ── 2. Instance materialization ────────────────────────────────────
console.log('\nInstances:');
const before = zdos.totalZDOCount;
const inst = mgr.getOrCreateInstance(doc!.id);
check('instance created', inst !== null);
const created = zdos.totalZDOCount - before;
check('ZDOs materialized', created > doc!.layout.rooms.length, `${created} ZDOs`);
check('instance in band', isInDungeonBand(inst!.origin.x));

const near = zdos.getZDOsInRadius(inst!.origin, DUNGEON_INSTANCE_SPACING / 2);
check('all ZDOs near origin', near.length === created, `${near.length}/${created}`);

const roomHash = getStableHash(doc!.layout.rooms[0].room);
check(
  'room shell ZDO exists',
  near.some((z) => z.prefabHash === roomHash)
);

// ── 3. Slot separation ─────────────────────────────────────────────
const doc2 = mgr.createGenerated('DG_SunkenCrypt', 777);
const inst2 = mgr.getOrCreateInstance(doc2!.id);
check(
  'slots separated',
  Math.abs(inst2!.origin.z - inst!.origin.z) >= DUNGEON_INSTANCE_SPACING &&
    inst2!.origin.x === DUNGEON_INSTANCE_X_BASE
);
check('same instance reused', mgr.getOrCreateInstance(doc!.id) === inst);

// ── 4. Destroy ─────────────────────────────────────────────────────
console.log('\nTeardown:');
mgr.destroyInstance(doc!.id);
const afterDestroy = zdos.getZDOsInRadius(inst!.origin, DUNGEON_INSTANCE_SPACING / 2);
check('ZDOs destroyed', afterDestroy.length === 0, `${afterDestroy.length} left`);
const inst3 = mgr.getOrCreateInstance(doc!.id);
check('slot reused after destroy', inst3!.slot === inst!.slot);

// ── 5. Editor upsert ───────────────────────────────────────────────
console.log('\nEditor upsert:');
check('garbage rejected', mgr.upsertDocument({ id: 'x', base: 'nope' }) === null);
const edited = JSON.parse(JSON.stringify(doc));
edited.layout.rooms = edited.layout.rooms.slice(0, 5);
edited.mode = 'custom';
const upserted = mgr.upsertDocument(edited);
check('edited accepted', upserted !== null && upserted.layout.rooms.length === 5);
check('live instance torn down', mgr.getInstance(doc!.id) === undefined);

// ── 6. Entrances ───────────────────────────────────────────────────
console.log('\nEntrances:');
const dgHash = getStableHash('DG_ForestCrypt');
const e1 = mgr.registerEntrance('Crypt2', dgHash, '10,-7', { x: 640, y: 30, z: -448 }, 1234);
check('entrance registered', e1 !== null, e1?.dungeonId);
// Documents are LAZY: nothing on disk until the first enter.
check('no eager document', e1 !== null && mgr.getDocument(e1.dungeonId) === undefined);
const lazyInst = e1 ? mgr.getOrCreateInstance(e1.dungeonId) : null;
check('lazy document on first enter', lazyInst !== null && mgr.getDocument(e1!.dungeonId) !== undefined);
if (e1) mgr.destroyInstance(e1.dungeonId);
const e1again = mgr.registerEntrance('Crypt2', dgHash, '10,-7', { x: 640, y: 30, z: -448 }, 1234);
check('repeat keeps assignment', e1again?.dungeonId === e1?.dungeonId);
// Proximity dedupe: a second registration 10 m away (piece pos vs feature
// pos across a zone border) resolves to the SAME entrance.
const e1near = mgr.registerEntrance('Crypt2', dgHash, '9,-7', { x: 630, y: 30, z: -448 }, 99);
check('proximity dedupe', e1near?.dungeonId === e1?.dungeonId);
check('assign override', mgr.assignEntrance('10,-7', doc!.id));
check(
  'nearest entrance lookup',
  mgr.findEntranceNear({ x: 642, y: 0, z: -450 }, 16)?.dungeonId === doc!.id
);
const camps = mgr.registerEntrance('GoblinCamp2', getStableHash('DG_GoblinCamp'), '5,5', { x: 320, y: 10, z: 320 }, 1);
check('camps not instanced', camps === null);

// Backfill: booked locations become entrances (batched, one save) and the
// change hook fires exactly once.
let hookFired = 0;
mgr.onEntrancesChanged = () => hookFired++;
const added = mgr.backfillFromFeatures(
  [
    { zoneKey: '50,50', featureName: 'Crypt3', dgPrefabHash: dgHash, pos: { x: 3200, y: 20, z: 3200 } },
    { zoneKey: '51,50', featureName: 'Crypt4', dgPrefabHash: dgHash, pos: { x: 3264, y: 20, z: 3200 } },
    { zoneKey: '10,-7', featureName: 'Crypt2', dgPrefabHash: dgHash, pos: { x: 640, y: 30, z: -448 } },
  ],
  42
);
check('backfill adds new only', added === 2, `${added} added`);
check('backfill hook fired once', hookFired === 1);
// e1 ('10,-7') + 2 aus dem Backfill; die Dedupe-Registrierung und die
// Camps erzeugen keine Einträge.
check('backfill entrances listed', mgr.listEntrances().length === 3, `${mgr.listEntrances().length}`);

// Eingangs-Hüllen: GEGENPROBE seit der Umstellung auf eigene Modelle
// (16.08.2026). Alle zehn Namen in ENTRANCE_HULL_MODELS — Crypt2/3/4,
// SunkenCrypt4, MountainCave02 … — sind Valheim-Exporte und stehen nicht
// in EIGENE_MODELLE. spawnEntranceHull() weist sie deshalb ab.
//
// Vorher prüfte dieser Abschnitt, dass drei Hüllen entstehen. Die
// Erwartung ist durch die Entscheidung überholt, die PRÜFUNG aber nicht
// wertlos: Sie ist jetzt der Wächter dagegen, dass sich über den
// Dungeon-Pfad doch wieder fremde Geometrie in die Welt schiebt. Sobald
// es eigene Eingangsmodelle gibt, kehrt sich der Test wieder um.
console.log('\nEntrance hulls (Gegenprobe):');
const hulls = mgr.spawnAllEntranceHulls();
check('keine Hülle ohne eigenes Modell', hulls === 0, `${hulls}`);
check('Wiederholung bleibt bei null', mgr.spawnAllEntranceHulls() === 0);
const hullZdos = zdos.getZDOsInRadius({ x: 640, y: 30, z: -448 }, 8);
check(
  'keine Hüllen-ZDO am Eingang',
  !hullZdos.some((z) => z.prefabHash === getStableHash('Crypt2'))
);

rmSync(DUNGEONS_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} FAILURES`);
  process.exit(1);
}
console.log('\nAll dungeon manager checks passed.');
