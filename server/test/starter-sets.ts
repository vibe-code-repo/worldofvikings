import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Inventory, findItem, isCharacterClass, starterSetForClass } from '@wov/shared';
import { grantStarterSet } from '../src/konto/StarterSet.js';
import { Kontendatenbank } from '../src/konto/Kontendatenbank.js';

for (const [classId, figure, setId] of [
  ['krieger', 'wikinger', 'ironward'], ['hexer', 'wikinger', 'ashenveil'],
  ['druide', 'wikinger', 'wildwarden'], ['seherin', 'wikinger', 'seidraven_male'],
  ['seherin', 'wikingerin', 'seidraven_female'],
  ['berserker', 'wikinger', 'emberrage_male'],
  ['berserker', 'wikingerin', 'emberrage_female'],
]) {
  const inventory = new Inventory();
  inventory.addItem(findItem('Hammer')!, 1);
  const set = starterSetForClass(classId!, figure!)!;
  assert.equal(set.id, setId);
  // A partial administrative grant must not produce duplicate pieces.
  inventory.addItem(findItem(set.parts[0]!.item)!, 1);
  const marker = grantStarterSet(inventory, classId!, figure!, '');
  assert.equal(marker, setId);
  for (const part of set.parts) assert.equal(inventory.countOf(part.item), 1);
  assert.equal(inventory.countOf('Hammer'), 1);
  assert(inventory.all.every(item => !item.equipped));
  // Drop one piece, serialize/reload as a world restart would, and log in.
  inventory.removeItem(inventory.all.find(item => item.shared.name === set.parts[0]!.item)!);
  const restarted = new Inventory();
  restarted.load(JSON.parse(JSON.stringify(inventory.serialize())));
  const before = restarted.serialize();
  assert.equal(grantStarterSet(restarted, classId!, figure!, marker), marker);
  assert.deepEqual(restarted.serialize(), before, 'Relog never replaces sold/dropped starter items');
}
for (const [classId, figure] of [['', 'wikinger'], ['jaeger', 'wikinger'], ['krieger', 'wikingerin'], ['invalid', 'wikinger']]) {
  const inventory = new Inventory();
  assert.equal(grantStarterSet(inventory, classId!, figure!, ''), '');
  assert.equal(inventory.all.length, 0);
}
assert(!isCharacterClass('admin'));
assert(!isCharacterClass({ classId: 'seherin' }));
const full = new Inventory();
while (full.addItem(findItem('Hammer')!, 1) === 0) { /* Fill the bag. */ }
const original = full.serialize();
assert.equal(grantStarterSet(full, 'seherin', 'wikingerin', ''), '');
assert.deepEqual(full.serialize(), original, 'Full bag is unchanged, with delivery still pending');
for (const item of [...full.all].slice(0, 7)) full.removeItem(item);
assert.equal(grantStarterSet(full, 'seherin', 'wikingerin', ''), 'seidraven_female');

const dir = mkdtempSync(join(tmpdir(), 'wov-starter-'));
const path = join(dir, 'accounts.db');
try {
  let db = new Kontendatenbank(path);
  const account = db.kontoAnlegen('StarterTest', 'starter@example.invalid', 'test-only');
  assert(account.ok);
  const result = db.charakterAnlegen(account.konto.id, 'StarterSeer', {
    figur: 'wikingerin', frisur: 'H_02', haarfarbe: 'mittelbraun', ober: '', beine: '', klasse: 'seherin',
  });
  assert(result.ok);
  const playerId = result.charakter.spielerId;
  db.schliessen();
  db = new Kontendatenbank(path);
  assert.equal(db.charakterZuSpielerId(playerId)?.klasse, 'seherin');
  db.schliessen();
  // Simulate the actual pre-feature database schema and exercise migration.
  const old = new DatabaseSync(path);
  old.exec('ALTER TABLE charaktere DROP COLUMN klasse'); old.close();
  db = new Kontendatenbank(path);
  assert.equal(db.charakterZuSpielerId(playerId)?.klasse, '', 'Existing characters are not assigned a guessed class');
  db.schliessen();
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log('PASS starter sets: all seven variants, persistence, no duplicate grants, full-bag atomicity and old-account migration');
