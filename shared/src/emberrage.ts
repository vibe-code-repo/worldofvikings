import { MALE_ARMOR_BODY, FEMALE_ARMOR_BODY } from './armorCompatibility.js';
const PARTS = [
  { key:'hood', name:'Glutzorn-Spalthelm', slot:'kopf', equipment:'kopf', regions:['Head'], hideAppearance:['hair','beard','eyebrows'], weight:1 },
  { key:'vest', name:'Glutzorn-Schwarzstahlharnisch', slot:'oberkoerper', equipment:'hemd', regions:['Torso'], hideAppearance:[], weight:2 },
  { key:'robe', name:'Glutzorn-Runenschurz', slot:'beine', equipment:'hose', regions:['Hips'], hideAppearance:[], weight:2 },
  { key:'shoulders', name:'Glutzorn-Bruchschultern', slot:'schultern', equipment:'schultern', regions:['ArmUpperLeft','ArmUpperRight'], hideAppearance:[], weight:2 },
  { key:'bracers', name:'Glutzorn-Armschienen', slot:'unterarme', equipment:'unterarme', regions:['ArmLowerLeft','ArmLowerRight'], hideAppearance:[], weight:1 },
  { key:'gloves', name:'Glutzorn-Panzerhandschuhe', slot:'haende', equipment:'haende', regions:['HandLeft','HandRight'], hideAppearance:[], weight:.5 },
  { key:'boots', name:'Glutzorn-Stiefel', slot:'fuesse', equipment:'schuhe', regions:['LegLeft','LegRight'], hideAppearance:[], weight:2 },
] as const;
export const EMBERRAGE_MALE_PARTS = PARTS.map(p=>({...p,...MALE_ARMOR_BODY,id:`emberrage_male_${p.key}`,item:`emberrage_male_${p.key}`,vfxProfile:'emberrage_red' as const}));
export const EMBERRAGE_FEMALE_PARTS = PARTS.map(p=>({...p,...FEMALE_ARMOR_BODY,id:`emberrage_female_${p.key}`,item:`emberrage_female_${p.key}`,vfxProfile:'emberrage_red' as const}));
export const EMBERRAGE_PARTS = [...EMBERRAGE_MALE_PARTS,...EMBERRAGE_FEMALE_PARTS];
