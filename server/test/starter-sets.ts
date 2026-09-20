import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CHARACTER_CLASSES, EQUIPMENT_SETS, Inventory, findItem, isCharacterClass, starterSetForClass } from '@wov/shared';
import { grantStarterSet } from '../src/konto/StarterSet.js';
import { Kontendatenbank } from '../src/konto/Kontendatenbank.js';

// Every valid class starts in Plainhide, in the variant that fits the figure. The class sets are earned later, never granted here.
const PLAINHIDE_ITEMS = ['shoulders', 'vest', 'bracers', 'robe', 'boots'];
const CLASS_SET_ITEMS = EQUIPMENT_SETS.filter(set => !('starter' in set)).flatMap(set => set.parts.map(part => part.item));
for (const classId of CHARACTER_CLASSES) for (const [figure, setId, sex] of [['wikinger', 'plainhide_male', 'male'], ['wikingerin', 'plainhide_female', 'female']]) {
  const label = `${classId}/${figure}`;
  const inventory = new Inventory();
  inventory.addItem(findItem('Hammer')!, 1);
  const set = starterSetForClass(classId, figure!)!;
  assert.equal(set.id, setId, label);
  assert.deepEqual(set.parts.map(part => part.item), PLAINHIDE_ITEMS.map(key => `plainhide_${sex}_${key}`), label);
  // A partial administrative grant must not produce duplicate pieces.
  inventory.addItem(findItem(set.parts[0]!.item)!, 1);
  const marker = grantStarterSet(inventory, classId, figure!, '');
  assert.equal(marker, setId, label);
  for (const part of set.parts) assert.equal(inventory.countOf(part.item), 1, `${label}: ${part.item}`);
  assert.equal(inventory.countOf('Hammer'), 1);
  assert(inventory.all.every(item => !item.equipped));
  assert.equal(inventory.all.length, 6, `${label}: hammer plus five pieces, nothing else`);
  for (const name of CLASS_SET_ITEMS) assert.equal(inventory.countOf(name), 0, `${label}: the class set piece ${name} must not be granted`);
  // Drop one piece, serialize/reload as a world restart would, and log in.
  inventory.removeItem(inventory.all.find(item => item.shared.name === set.parts[0]!.item)!);
  const restarted = new Inventory();
  restarted.load(JSON.parse(JSON.stringify(inventory.serialize())));
  const before = restarted.serialize();
  assert.equal(grantStarterSet(restarted, classId, figure!, marker), marker);
  assert.deepEqual(restarted.serialize(), before, 'Relog never replaces sold/dropped starter items');
}

// Existing characters: whoever carries a marker keeps exactly what they have and gets nothing new, whichever family the marker names.
for (const marker of ['ironward', 'ashenveil', 'wildwarden', 'seidraven_male', 'seidraven_female', 'emberrage_male', 'emberrage_female', 'plainhide_male', 'plainhide_female']) {
  for (const [classId, figure] of [['krieger', 'wikinger'], ['berserker', 'wikingerin'], ['', 'wikinger']]) {
    const inventory = new Inventory();
    inventory.addItem(findItem('Hammer')!, 1);
    const before = inventory.serialize();
    assert.equal(grantStarterSet(inventory, classId!, figure!, marker), marker);
    assert.deepEqual(inventory.serialize(), before, `${marker}: nothing is added to a character that already got its start`);
  }
}
// The figure changes after the grant: the marker still wins, so no second grant and no removal.
{
  const inventory = new Inventory();
  const marker = grantStarterSet(inventory, 'berserker', 'wikinger', '');
  assert.equal(marker, 'plainhide_male');
  const before = inventory.serialize();
  assert.equal(grantStarterSet(inventory, 'berserker', 'wikingerin', marker), marker);
  assert.deepEqual(inventory.serialize(), before, 'A figure change neither re-grants nor removes');
}
// No usable class or figure: nothing is granted, the marker stays empty so the delivery is retried later.
for (const [classId, figure] of [['', 'wikinger'], ['', 'wikingerin'], ['invalid', 'wikinger'], ['admin', 'wikingerin'], ['krieger', ''], ['krieger', 'unknown']]) {
  const inventory = new Inventory();
  assert.equal(starterSetForClass(classId!, figure!), undefined);
  assert.equal(grantStarterSet(inventory, classId!, figure!, ''), '');
  assert.equal(inventory.all.length, 0);
}
assert(!isCharacterClass('admin'));
assert(!isCharacterClass({ classId: 'seherin' }));
// The real first login: the standard start kit is in the bag before the delivery, and five more pieces must fit.
{
  const inventory = new Inventory();
  for (const [name, count] of [['Hammer', 1], ['AxeFlint', 1], ['Hoe', 1], ['PickaxeAntler', 1], ['Cultivator', 1], ['Wood', 12], ['Stone', 30], ['SwordNorth', 1]] as const) {
    assert.equal(inventory.addItem(findItem(name)!, count), 0, name);
  }
  assert.equal(grantStarterSet(inventory, 'berserker', 'wikingerin', ''), 'plainhide_female', 'Plainhide fits next to the standard start kit');
}
// A full bag: atomic, with the delivery still pending. Exactly five free slots deliver the five pieces.
const full = new Inventory();
while (full.addItem(findItem('Hammer')!, 1) === 0) { /* Fill the bag. */ }
const original = full.serialize();
assert.equal(grantStarterSet(full, 'seherin', 'wikingerin', ''), '');
assert.deepEqual(full.serialize(), original, 'Full bag is unchanged, with delivery still pending');
for (const item of [...full.all].slice(0, 4)) full.removeItem(item);
const fourFree = full.serialize();
assert.equal(grantStarterSet(full, 'seherin', 'wikingerin', ''), '', 'Four free slots are one short: nothing is delivered');
assert.deepEqual(full.serialize(), fourFree, 'A short bag is left untouched, not half filled');
full.removeItem([...full.all][0]!);
assert.equal(grantStarterSet(full, 'seherin', 'wikingerin', ''), 'plainhide_female');

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
console.log('PASS starter sets: Plainhide for all nine classes and both figures, no class sets, marker wins, persistence, no duplicate grants, full-bag atomicity and old-account migration');
