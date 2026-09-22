/** Produce integration metadata from actual exports; never register items or edit inventories. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root=process.argv[2];
const slots={hood:['kopf','kopf'],shoulders:['schultern','schultern'],vest:['oberkoerper','hemd'],
  bracers:['unterarme','unterarme'],gloves:['haende','haende'],robe:['beine','hose'],boots:['fuesse','schuhe']};
const sets=['Male','Female'].map(variant=>{
  const equipment=JSON.parse(readFileSync(join(root,variant,'equipment.json')));
  const manifest=JSON.parse(readFileSync(join(root,variant,'game-ready/manifest.json')));
  const id='emberrage_'+variant.toLowerCase();
  return {id,familyId:'emberrage',name:'Glutzorn',class:'Berserker',version:1,
    bodyVariant:equipment.bodyVariant,bodyProfile:equipment.bodyProfile,figure:equipment.figure,
    itemIds:equipment.parts.map(p=>p.item),parts:equipment.parts.map(p=>{
      const key=p.item.split('_').at(-1),[appearanceSlot,equipmentSlot]=slots[key];
      const file=manifest.items.find(i=>i.item===p.item);
      return {itemId:p.item,appearanceId:p.item,name:p.label.replace('Spalthelmer','Spalthelm'),
        appearanceSlot,equipmentSlot,bodyVariant:p.bodyVariant,bodyProfile:p.bodyProfile,figure:p.figure,
        regions:p.regions,hideAppearance:p.hideAppearance,vfxProfile:'emberrage_red',
        model:`emberrage/${p.item}.glb`,icon:p.item+'.png',source:`${variant}/game-ready/${file.file}`,sha256:file.sha256};
    })};
});
writeFileSync(join(root,'equipment-sets.json'),JSON.stringify({schemaVersion:1,status:'prepared_not_registered',sets},null,2)+'\n');
writeFileSync(join(root,'vfx-profile.json'),JSON.stringify({id:'emberrage_red',color:'red',
  exported:'KHR_materials_emissive_strength on skinned fracture/rune geometry',
  optionalAdapter:'tools/web/emberrage-glow.ts',effect:'selective GlowLayer',pulseHz:.6,
  intensityRange:[.375,.525],ownership:'equipped meshes only; update on equip/unequip, dispose with character',
  runtimeIntegrated:false,particleSystem:false,preview:'Blender fog-glow compositor'},null,2)+'\n');
console.log('Prepared two variants, fourteen IDs and the red effect profile; no game mutation');
