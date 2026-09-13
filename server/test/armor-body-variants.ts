import assert from 'node:assert/strict';
import { canWearArmor, MALE_ARMOR_BODY, FEMALE_ARMOR_BODY, SEIDRAVEN_MALE_PARTS,
  SEIDRAVEN_FEMALE_PARTS, IRONWARD_PARTS, WILDWARDEN_PARTS, ASHENVEIL_PARTS,
  equipmentSetCatalog, findItem, ruestungZu, validArmorParts, encodeArmor, decodeArmor, Inventory } from '@wov/shared';
import { WovServer } from '../src/WovServer.js';
import { Writer } from '../src/io/Writer.js';
import { Reader } from '../src/io/Reader.js';

assert(canWearArmor(MALE_ARMOR_BODY,'wikinger/WikingerKoerper.glb'));
assert(canWearArmor(FEMALE_ARMOR_BODY,'wikingerin'));
assert(!canWearArmor(MALE_ARMOR_BODY,'wikingerin'));
assert(!canWearArmor(FEMALE_ARMOR_BODY,'wikinger'));
assert(!canWearArmor(FEMALE_ARMOR_BODY,undefined));
assert(!canWearArmor({...FEMALE_ARMOR_BODY,bodyProfile:'wov-female-v1'},'wikingerin'));
for (const part of [...IRONWARD_PARTS,...WILDWARDEN_PARTS,...ASHENVEIL_PARTS,...SEIDRAVEN_MALE_PARTS,...SEIDRAVEN_FEMALE_PARTS]) {
  const item=findItem(part.item)!;const armor=ruestungZu(part.id)!;
  assert.equal(item.bodyVariant,part.bodyVariant);assert.equal(armor.bodyProfile,part.bodyProfile);
  assert.equal(item.figure,armor.figure);
  assert(canWearArmor(item,part.figure));
  assert(!canWearArmor(item,part.figure==='wikinger'?'wikingerin':'wikinger'));
}
const catalog=equipmentSetCatalog();
const male=catalog.sets.find(s=>s.id==='seidraven_male')!;
const female=catalog.sets.find(s=>s.id==='seidraven_female')!;
assert.equal(male.familyId,female.familyId);
assert(validArmorParts(female.appearance,'wikingerin'));
assert(!validArmorParts(female.appearance,'wikinger'));
assert(!validArmorParts({...female.appearance,kopf:male.appearance.kopf},'wikingerin'));

const server=Object.create(WovServer.prototype) as any;
server.zdosVon=()=>({getZDO:()=>({setString:()=>{}})});
const peer={name:'ArmorBodyVariantTest',figur:'wikingerin',frisur:'H_02',haarfarbe:'mittelbraun',ruestung:'|',inventar:new Inventory(),sendPacketWith:()=>{}};
for(const part of [...SEIDRAVEN_MALE_PARTS,...SEIDRAVEN_FEMALE_PARTS])peer.inventar.addItem(findItem(part.item)!,1);
function equip(parts:Record<string,string>){
 const p=new Writer().writeString('H_02').writeString(parts.oberkoerper??'').writeString(parts.beine??'').writeString('mittelbraun').writeString(JSON.stringify(parts));
 server.handleSetAussehen(peer,new Reader(p.toBuffer()));
}
equip(male.appearance);assert.equal(peer.ruestung,'|','Ownership must not bypass body compatibility');
equip(female.appearance);assert.deepEqual(decodeArmor(peer.ruestung),female.appearance);
peer.figur='wikinger';server.inventarSync(peer);assert.equal(peer.ruestung,'|');
assert.equal(peer.inventar.all.length,14,'Changing body must retain, not delete, incompatible owned items');
peer.ruestung=encodeArmor(female.appearance);server.inventarSync(peer);assert.equal(peer.ruestung,'|');
console.log('PASS armor body variants: registry, mixed sets, ownership, login repair and no item deletion');
