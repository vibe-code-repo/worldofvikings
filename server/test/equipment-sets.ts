/** Catalog consistency and real ownership checks, using an isolated in-memory player. */
import assert from 'node:assert/strict';
import { ASHENVEIL_PARTS, ARMOR_SLOTS, equipmentSetCatalog, findItem,
  RUESTUNG, istEigenesModell, Inventory, decodeArmor, EQUIPMENT_SETS, CLASS_EQUIPMENT_FAMILIES } from '@wov/shared';
import { WovServer } from '../src/WovServer.js';
import { Writer } from '../src/io/Writer.js';
import { Reader } from '../src/io/Reader.js';

const catalog = equipmentSetCatalog();
assert.equal(catalog.schemaVersion, 1);
// The served JSON must equal the object: no key with the value undefined (a set without a class has no `classId`).
assert.deepEqual(JSON.parse(JSON.stringify(catalog)), catalog, 'The catalog must survive its own JSON round trip');
assert.deepEqual(catalog.sets.map(set => set.id), ['ironward', 'wildwarden', 'ashenveil', 'seidraven_male', 'seidraven_female', 'emberrage_male', 'emberrage_female',
  'plainhide_male', 'plainhide_female', 'gravethorn_male', 'gravethorn_female', 'crowshade_male', 'crowshade_female']);
const BODY_REGIONS = ['Head', 'Torso', 'Hips', 'ArmUpperLeft', 'ArmUpperRight', 'ArmLowerLeft', 'ArmLowerRight', 'HandLeft', 'HandRight', 'LegLeft', 'LegRight'];
const ids = new Set<string>();
let totalItems = 0;
for (const set of catalog.sets) {
  // Plainhide has five pieces (no hood, no gloves); every other set has seven.
  const plainhide = set.familyId === 'plainhide';
  assert.equal(set.parts.length, plainhide ? 5 : 7, set.id);
  totalItems += set.parts.length;
  assert.equal(set.figure, set.bodyVariant === 'female' ? 'wikingerin' : 'wikinger');
  assert.deepEqual(new Set(Object.keys(set.appearance)), new Set(plainhide ? ARMOR_SLOTS.filter(slot => slot !== 'kopf' && slot !== 'haende') : ARMOR_SLOTS));
  const replaced = new Set(set.parts.flatMap(part => [...part.regions]));
  assert.equal(replaced.size, plainhide ? 8 : set.id === 'wildwarden' ? 10 : 11);
  // The free regions of a set are exactly the body regions none of its pieces replaces (only sets that declare them).
  if ('freeRegions' in set) assert.deepEqual([...set.freeRegions!].sort(), BODY_REGIONS.filter(region => !replaced.has(region)).sort(), `${set.id}: free regions`);
  else assert(!plainhide, `${set.id}: a five-piece set must name its free regions`);
  assert.deepEqual(set.itemIds, set.parts.map(part => part.itemId));
  for (const part of set.parts) {
    assert(!ids.has(part.itemId), `Duplicate item: ${part.itemId}`); ids.add(part.itemId);
    const item = findItem(part.itemId)!;
    assert(item, part.itemId);
    assert.equal(item.ruestungsteil, part.appearanceId);
    assert.equal(item.ausruestung, part.equipmentSlot);
    assert.equal(item.icon + '.png', part.icon);
    const armor = RUESTUNG.find(entry => entry.id === part.appearanceId)!;
    assert.equal(armor.datei + '.glb', part.model);
    assert.equal(armor.slot, part.appearanceSlot);
    assert.equal(armor.figure, set.figure);
    assert.deepEqual(armor.regions, part.regions);
    assert(istEigenesModell(armor.datei));
  }
}
// Additive catalog fields: `starter` only on Plainhide, the class of a family from CLASS_EQUIPMENT_FAMILIES, a web fit for every female set.
assert.deepEqual(catalog.sets.filter(set => 'starter' in set).map(set => set.id), ['plainhide_male', 'plainhide_female']);
assert.deepEqual(catalog.sets.map(set => [set.id, set.classId]), [
  ['ironward', 'krieger'], ['wildwarden', 'druide'], ['ashenveil', 'hexer'], ['seidraven_male', 'seherin'], ['seidraven_female', 'seherin'],
  ['emberrage_male', 'runenmagier'], ['emberrage_female', 'runenmagier'], ['plainhide_male', undefined], ['plainhide_female', undefined],
  ['gravethorn_male', 'berserker'], ['gravethorn_female', 'berserker'], ['crowshade_male', 'jaeger'], ['crowshade_female', 'jaeger']]);
assert.equal(CLASS_EQUIPMENT_FAMILIES.berserker, 'gravethorn');
assert.equal(CLASS_EQUIPMENT_FAMILIES.jaeger, 'crowshade');
for (const set of catalog.sets) for (const part of set.parts) {
  assert.equal(part.previewModel, set.figure === 'wikingerin' ? `armor/${part.model}` : part.model, `${part.itemId}: preview model`);
  assert.equal(part.previewBodyProfile, set.figure === 'wikingerin' ? 'wov-female-v1' : 'wov-male-v1');
}
// Item names and appearance policy from the register, not from the builder's placeholder file.
const hoods = catalog.sets.filter(set => set.familyId === 'gravethorn').map(set => set.parts.filter(part => part.hideAppearance.length).map(part => [part.itemId, [...part.hideAppearance]]));
assert.deepEqual(hoods, [[['gravethorn_male_hood', ['hair', 'beard', 'eyebrows']]], [['gravethorn_female_hood', ['hair', 'beard', 'eyebrows']]]]);
assert(catalog.sets.filter(set => set.familyId === 'plainhide').every(set => set.parts.every(part => part.hideAppearance.length === 0 && !('vfxProfile' in part))));
// Crowshade: only the mask hides hair, beard and eyebrows, and nothing glows (no vfxProfile key at all).
assert.deepEqual(catalog.sets.filter(set => set.familyId === 'crowshade').map(set => set.parts.filter(part => part.hideAppearance.length).map(part => [part.itemId, [...part.hideAppearance]])),
  [[['crowshade_male_hood', ['hair', 'beard', 'eyebrows']]], [['crowshade_female_hood', ['hair', 'beard', 'eyebrows']]]]);
assert(catalog.sets.filter(set => set.familyId === 'crowshade').every(set => set.parts.every(part => !('vfxProfile' in part))));
assert.deepEqual(EQUIPMENT_SETS.find(set => set.id === 'crowshade_male')!.parts.map(part => part.name),
  ['Crowshade Mask', 'Crowshade Jerkin', 'Crowshade Coat', 'Crowshade Pauldrons', 'Crowshade Bracers', 'Crowshade Claws', 'Crowshade Boots']);
assert(catalog.sets.filter(set => set.familyId === 'gravethorn').every(set => set.parts.every(part => 'vfxProfile' in part && part.vfxProfile === 'gravethorn_red')));
assert.deepEqual(EQUIPMENT_SETS.find(set => set.id === 'plainhide_male')!.parts.map(part => part.name), ['Plainhide Sleeves', 'Plainhide Tunic', 'Plainhide Wraps', 'Plainhide Trousers', 'Plainhide Shoes']);
assert.deepEqual(EQUIPMENT_SETS.find(set => set.id === 'gravethorn_female')!.parts.map(part => part.name),
  ['Gravethorn Helm', 'Gravethorn Cuirass', 'Gravethorn Tassets', 'Gravethorn Pauldrons', 'Gravethorn Bracers', 'Gravethorn Gauntlets', 'Gravethorn Greaves']);
// The slot and region table of the two new families, written out (not derived from the register): appearance slot, inventory slot, regions.
const SLOT_TABLE: Record<string, Record<string, [string, string, string[]]>> = {
  plainhide: { shoulders: ['schultern', 'schultern', ['ArmUpperLeft', 'ArmUpperRight']], vest: ['oberkoerper', 'hemd', ['Torso']],
    bracers: ['unterarme', 'unterarme', ['ArmLowerLeft', 'ArmLowerRight']], robe: ['beine', 'hose', ['Hips']], boots: ['fuesse', 'schuhe', ['LegLeft', 'LegRight']] },
  gravethorn: { hood: ['kopf', 'kopf', ['Head']], shoulders: ['schultern', 'schultern', ['ArmUpperLeft', 'ArmUpperRight']], vest: ['oberkoerper', 'hemd', ['Torso']],
    bracers: ['unterarme', 'unterarme', ['ArmLowerLeft', 'ArmLowerRight']], gloves: ['haende', 'haende', ['HandLeft', 'HandRight']], robe: ['beine', 'hose', ['Hips']],
    boots: ['fuesse', 'schuhe', ['LegLeft', 'LegRight']] },
  crowshade: { hood: ['kopf', 'kopf', ['Head']], shoulders: ['schultern', 'schultern', ['ArmUpperLeft', 'ArmUpperRight']], vest: ['oberkoerper', 'hemd', ['Torso']],
    bracers: ['unterarme', 'unterarme', ['ArmLowerLeft', 'ArmLowerRight']], gloves: ['haende', 'haende', ['HandLeft', 'HandRight']], robe: ['beine', 'hose', ['Hips']],
    boots: ['fuesse', 'schuhe', ['LegLeft', 'LegRight']] },
};
for (const set of catalog.sets.filter(entry => entry.familyId in SLOT_TABLE)) {
  const table = SLOT_TABLE[set.familyId]!;
  assert.deepEqual(set.parts.map(part => part.itemId).sort(), Object.keys(table).map(key => `${set.familyId}_${set.bodyVariant}_${key}`).sort(), `${set.id}: items`);
  for (const [key, [appearanceSlot, equipmentSlot, regions]] of Object.entries(table)) {
    const part = set.parts.find(entry => entry.itemId === `${set.familyId}_${set.bodyVariant}_${key}`)!;
    assert.deepEqual([part.appearanceSlot, part.equipmentSlot, [...part.regions]], [appearanceSlot, equipmentSlot, regions], `${part.itemId}: slots and regions`);
    assert.equal(findItem(part.itemId)!.ausruestung, equipmentSlot, `${part.itemId}: inventory slot`);
  }
}
assert.equal(catalog.sets[0].parts[0].itemId, 'IronwardHelmet');
assert.equal(catalog.sets[0].parts[0].appearanceId, 'ironward_helm');
assert.deepEqual(catalog.sets[2].itemIds, ['ashenveil_hood', 'ashenveil_vest', 'ashenveil_robe',
  'ashenveil_shoulders', 'ashenveil_bracers', 'ashenveil_gloves', 'ashenveil_boots']);

const server = Object.create(WovServer.prototype) as {
  zdosVon: () => { getZDO: () => { setString: () => void } };
  handleSetAussehen: (peer: unknown, reader: Reader) => void;
};
server.zdosVon = () => ({ getZDO: () => ({ setString: () => {} }) });
const peer = { name: 'EquipmentCatalogTest', figur: 'wikinger', frisur: 'H_01', haarfarbe: 'mittelbraun',
  ruestung: '|', inventar: new Inventory(), sendPacketWith: () => {} };
const equip = (appearance: Record<string, string>) => {
  const packet = new Writer().writeString('H_01').writeString(appearance.oberkoerper ?? '').writeString(appearance.beine ?? '')
    .writeString('mittelbraun').writeString(JSON.stringify(appearance));
  server.handleSetAussehen(peer, new Reader(packet.toBuffer()));
};
equip(catalog.sets[2].appearance);
assert.equal(peer.ruestung, '|', 'Registration alone must not bypass ownership');
assert.equal(peer.inventar.all.length, 0, 'An appearance request must not grant items');
for (const part of ASHENVEIL_PARTS) peer.inventar.addItem(findItem(part.item)!, 1);
equip(catalog.sets[2].appearance);
assert.deepEqual(decodeArmor(peer.ruestung), catalog.sets[2].appearance);
assert(peer.inventar.all.every(item => item.equipped));
equip({});
assert.equal(peer.ruestung, '|');
assert(peer.inventar.all.every(item => !item.equipped));

// The two new families follow the same rules: ownership is enforced, the body must fit, a five-piece set leaves head and hands alone.
for (const set of catalog.sets.filter(entry => ['plainhide', 'gravethorn', 'crowshade'].includes(entry.familyId))) {
  const other = { ...peer, name: `EquipmentCatalogTest-${set.id}`, figur: set.figure, ruestung: '|', inventar: new Inventory() };
  const wear = (appearance: Record<string, string>) => {
    const packet = new Writer().writeString('H_01').writeString(appearance.oberkoerper ?? '').writeString(appearance.beine ?? '')
      .writeString('mittelbraun').writeString(JSON.stringify(appearance));
    server.handleSetAussehen(other, new Reader(packet.toBuffer()));
  };
  wear(set.appearance);
  assert.equal(other.ruestung, '|', `${set.id}: registration alone must not bypass ownership`);
  assert.equal(other.inventar.all.length, 0);
  for (const itemId of set.itemIds) other.inventar.addItem(findItem(itemId)!, 1);
  wear(set.appearance);
  assert.deepEqual(decodeArmor(other.ruestung), set.appearance, `${set.id}: owned set equips completely`);
  assert(other.inventar.all.every(item => item.equipped));
  assert.equal(decodeArmor(other.ruestung).kopf === undefined, set.familyId === 'plainhide', `${set.id}: only Plainhide leaves the head slot empty`);
  // The other body's set of the same family must be refused even when owned.
  const foreign = catalog.sets.find(entry => entry.familyId === set.familyId && entry.id !== set.id)!;
  for (const itemId of foreign.itemIds) other.inventar.addItem(findItem(itemId)!, 1);
  wear(foreign.appearance);
  assert.deepEqual(decodeArmor(other.ruestung), set.appearance, `${set.id}: the ${foreign.id} pieces must not replace the fitted ones`);
}
assert.equal(totalItems, 87);
console.log('PASS equipment sets: 87 items in 13 sets, stable IDs, slots, body masks, free regions, ownership and no implicit grant');
