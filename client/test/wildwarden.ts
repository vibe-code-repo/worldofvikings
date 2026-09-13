/** Slot contract, save round-trip, inventory replacement and body restoration. */
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { WILDWARDEN_PARTS, ARMOR_SLOTS, encodeArmor, decodeArmor, validArmorParts, appearancePath, ruestungZu, findItem, Inventory, slotDef, istEigenesModell } from '@wov/shared';
import { updateArmorVisibility, verifyArmorSkin } from '../src/player/armorVisibility.js';
import { Equipment } from '../src/player/Equipment.js';

const parts = Object.fromEntries(WILDWARDEN_PARTS.map(p => [p.slot, p.id]));
assert.equal(WILDWARDEN_PARTS.length, 7);
assert.equal(new Set(WILDWARDEN_PARTS.flatMap(p => [...p.regions])).size, 11);
assert.equal(ARMOR_SLOTS.length, 7);
assert.deepEqual(decodeArmor(encodeArmor(parts)), parts);
assert.deepEqual(decodeArmor('|'), {});
assert.equal(encodeArmor({ oberkoerper: 'leder_bh', beine: 'leder_shorts' }), 'leder_bh|leder_shorts');
assert.deepEqual(decodeArmor('||broken-json'), {});
assert(validArmorParts(parts, 'wikinger'));
assert(!validArmorParts(parts, 'wikingerin'));
for (const bad of [null, [], { kopf: 'wildwarden_vest' }, { kopf: '../../escape' }, { foo: '' }, { kopf: 1 }]) assert(!validArmorParts(bad));
const engine = new NullEngine(); const scene = new Scene(engine);
const meshes = WILDWARDEN_PARTS.flatMap(p => p.regions.map(r => new Mesh(`clone:Chr_${r}_Male_00`, scene)));
const armorMesh = new Mesh('WoV_Wildwarden_Head', scene);
for (const p of WILDWARDEN_PARTS) {
  const item = findItem(p.item)!;
  assert(item); assert.equal(item.ruestungsteil, p.id); assert.equal(slotDef(item.ausruestung)?.teilSlot, p.slot);
  const file = appearancePath(ruestungZu(p.id)!.datei);
  assert(istEigenesModell(file));
  updateArmorVisibility([...meshes, armorMesh], [file]);
  for (const mesh of meshes) assert.equal(mesh.isEnabled(), !p.regions.some(r => mesh.name === `clone:Chr_${r}_Male_00`));
  assert(armorMesh.isEnabled());
}
updateArmorVisibility(meshes, WILDWARDEN_PARTS.map(p => appearancePath(ruestungZu(p.id)!.datei)));
assert(meshes.every(m => !m.isEnabled()));
updateArmorVisibility(meshes, []); assert(meshes.every(m => m.isEnabled()));
assert.throws(() => verifyArmorSkin(null, null, 'wildwarden/wildwarden_crown'));
const inventory = new Inventory();
const equipment = new Equipment(inventory, {} as never, {} as never);
for (const p of WILDWARDEN_PARTS) { inventory.addItem(findItem(p.item)!, 1); equipment.equip(inventory.all.at(-1)!); }
const snapshot = inventory.serialize(); inventory.load(snapshot); equipment.syncWithInventory();
assert.deepEqual(equipment.aussehen(), parts);
assert([...equipment.belegung.values()].every(i => inventory.all.includes(i)));
equipment.toggle(inventory.all.find(i => i.shared.name === 'wildwarden_crown')!);
assert(!equipment.imSlot('kopf'));
inventory.load(snapshot.filter(i => i.name !== 'wildwarden_gloves')); equipment.syncWithInventory();
assert(!equipment.imSlot('haende'));
scene.dispose(); engine.dispose();
console.log('PASS Wildwarden: seven item slots, serialization, filtering, replacement masks and inventory snapshots');
