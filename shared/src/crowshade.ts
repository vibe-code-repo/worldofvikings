import { MALE_ARMOR_BODY, FEMALE_ARMOR_BODY } from './armorCompatibility.js';

/** Crowshade: dark hunter armor with silver-edged crow feathers (the Jaeger set). It does not glow. Only the mask hides hair, beard and eyebrows. */
const PARTS = [
  { key: 'hood', name: 'Crowshade Mask', slot: 'kopf', equipment: 'kopf', regions: ['Head'], hideAppearance: ['hair', 'beard', 'eyebrows'], weight: 1 },
  { key: 'vest', name: 'Crowshade Jerkin', slot: 'oberkoerper', equipment: 'hemd', regions: ['Torso'], hideAppearance: [], weight: 2 },
  { key: 'robe', name: 'Crowshade Coat', slot: 'beine', equipment: 'hose', regions: ['Hips'], hideAppearance: [], weight: 2 },
  { key: 'shoulders', name: 'Crowshade Pauldrons', slot: 'schultern', equipment: 'schultern', regions: ['ArmUpperLeft', 'ArmUpperRight'], hideAppearance: [], weight: 2 },
  { key: 'bracers', name: 'Crowshade Bracers', slot: 'unterarme', equipment: 'unterarme', regions: ['ArmLowerLeft', 'ArmLowerRight'], hideAppearance: [], weight: 1 },
  { key: 'gloves', name: 'Crowshade Claws', slot: 'haende', equipment: 'haende', regions: ['HandLeft', 'HandRight'], hideAppearance: [], weight: .5 },
  { key: 'boots', name: 'Crowshade Boots', slot: 'fuesse', equipment: 'schuhe', regions: ['LegLeft', 'LegRight'], hideAppearance: [], weight: 2 },
] as const;

export const CROWSHADE_MALE_PARTS = PARTS.map(p => ({ ...p, ...MALE_ARMOR_BODY, id: `crowshade_male_${p.key}`, item: `crowshade_male_${p.key}`, textKey: `inhalt.item.crowshade_${p.key}` }));
export const CROWSHADE_FEMALE_PARTS = PARTS.map(p => ({ ...p, ...FEMALE_ARMOR_BODY, id: `crowshade_female_${p.key}`, item: `crowshade_female_${p.key}`, textKey: `inhalt.item.crowshade_${p.key}` }));
export const CROWSHADE_PARTS = [...CROWSHADE_MALE_PARTS, ...CROWSHADE_FEMALE_PARTS];
