import { MALE_ARMOR_BODY, FEMALE_ARMOR_BODY } from './armorCompatibility.js';

/** Gravethorn: thorned plate armor with red glowing seams (the Berserker set). Only the helm hides hair, beard and eyebrows. */
const PARTS = [
  { key: 'hood', name: 'Gravethorn Helm', slot: 'kopf', equipment: 'kopf', regions: ['Head'], hideAppearance: ['hair', 'beard', 'eyebrows'], weight: 1 },
  { key: 'vest', name: 'Gravethorn Cuirass', slot: 'oberkoerper', equipment: 'hemd', regions: ['Torso'], hideAppearance: [], weight: 2 },
  { key: 'robe', name: 'Gravethorn Tassets', slot: 'beine', equipment: 'hose', regions: ['Hips'], hideAppearance: [], weight: 2 },
  { key: 'shoulders', name: 'Gravethorn Pauldrons', slot: 'schultern', equipment: 'schultern', regions: ['ArmUpperLeft', 'ArmUpperRight'], hideAppearance: [], weight: 2 },
  { key: 'bracers', name: 'Gravethorn Bracers', slot: 'unterarme', equipment: 'unterarme', regions: ['ArmLowerLeft', 'ArmLowerRight'], hideAppearance: [], weight: 1 },
  { key: 'gloves', name: 'Gravethorn Gauntlets', slot: 'haende', equipment: 'haende', regions: ['HandLeft', 'HandRight'], hideAppearance: [], weight: .5 },
  { key: 'boots', name: 'Gravethorn Greaves', slot: 'fuesse', equipment: 'schuhe', regions: ['LegLeft', 'LegRight'], hideAppearance: [], weight: 2 },
] as const;

export const GRAVETHORN_MALE_PARTS = PARTS.map(p => ({ ...p, ...MALE_ARMOR_BODY, id: `gravethorn_male_${p.key}`, item: `gravethorn_male_${p.key}`, vfxProfile: 'gravethorn_red' as const }));
export const GRAVETHORN_FEMALE_PARTS = PARTS.map(p => ({ ...p, ...FEMALE_ARMOR_BODY, id: `gravethorn_female_${p.key}`, item: `gravethorn_female_${p.key}`, vfxProfile: 'gravethorn_red' as const }));
export const GRAVETHORN_PARTS = [...GRAVETHORN_MALE_PARTS, ...GRAVETHORN_FEMALE_PARTS];
