/** Catalog consistency and real ownership checks, using an isolated in-memory player. */
import assert from 'node:assert/strict';
import { ASHENVEIL_PARTS, ARMOR_SLOTS, equipmentSetCatalog, findItem,
  RUESTUNG, istEigenesModell, Inventory, decodeArmor } from '@wov/shared';
import { WovServer } from '../src/WovServer.js';
import { Writer } from '../src/io/Writer.js';
import { Reader } from '../src/io/Reader.js';

const catalog = equipmentSetCatalog();
assert.equal(catalog.schemaVersion, 1);
assert.deepEqual(catalog.sets.map(set => set.id), ['ironward', 'wildwarden', 'ashenveil', 'seidraven_male', 'seidraven_female']);
const ids = new Set<string>();
for (const set of catalog.sets) {
  assert.equal(set.parts.length, 7);
  assert.equal(set.figure, set.bodyVariant === 'female' ? 'wikingerin' : 'wikinger');
  assert.deepEqual(new Set(Object.keys(set.appearance)), new Set(ARMOR_SLOTS));
  assert.equal(new Set(set.parts.flatMap(part => [...part.regions])).size, set.id === 'wildwarden' ? 10 : 11);
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
assert.equal(catalog.sets[0].parts[0].itemId, 'IronwardHelmet');
assert.equal(catalog.sets[0].parts[0].appearanceId, 'ironward_helm');
assert.deepEqual(catalog.sets[2].itemIds, ['ashenveil_hood', 'ashenveil_vest', 'ashenveil_robe',
  'ashenveil_shoulders', 'ashenveil_bracers', 'ashenveil_gloves', 'ashenveil_boots']);

const server = Object.create(WovServer.prototype) as any;
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
console.log('PASS equipment sets: 35 items, stable IDs, slots, body masks, ownership and no implicit grant');
