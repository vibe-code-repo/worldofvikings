import { MALE_ARMOR_BODY, FEMALE_ARMOR_BODY } from './armorCompatibility.js';

const PARTS = [
  { key: 'hood', name: 'Seidraven-Runenhelm', slot: 'kopf', equipment: 'kopf', regions: ['Head'], hideAppearance: ['hair', 'beard', 'eyebrows'], weight: 1 },
  { key: 'vest', name: 'Seidraven-Lamellenharnisch', slot: 'oberkoerper', equipment: 'hemd', regions: ['Torso'], hideAppearance: [], weight: 2 },
  { key: 'robe', name: 'Seidraven-Runenschurz', slot: 'beine', equipment: 'hose', regions: ['Hips'], hideAppearance: [], weight: 2 },
  { key: 'shoulders', name: 'Seidraven-Rabenlichtschultern', slot: 'schultern', equipment: 'schultern', regions: ['ArmUpperLeft', 'ArmUpperRight'], hideAppearance: [], weight: 2 },
  { key: 'bracers', name: 'Seidraven-Runenarmschienen', slot: 'unterarme', equipment: 'unterarme', regions: ['ArmLowerLeft', 'ArmLowerRight'], hideAppearance: [], weight: 1 },
  { key: 'gloves', name: 'Seidraven-Handschuhe', slot: 'haende', equipment: 'haende', regions: ['HandLeft', 'HandRight'], hideAppearance: [], weight: .5 },
  { key: 'boots', name: 'Seidraven-Runenstiefel', slot: 'fuesse', equipment: 'schuhe', regions: ['LegLeft', 'LegRight'], hideAppearance: [], weight: 2 },
] as const;

export const SEIDRAVEN_MALE_PARTS = PARTS.map(p => ({ ...p, ...MALE_ARMOR_BODY,
  id: `seidraven_male_${p.key}`, item: `seidraven_male_${p.key}` }));
export const SEIDRAVEN_FEMALE_PARTS = PARTS.map(p => ({ ...p, ...FEMALE_ARMOR_BODY,
  id: `seidraven_female_${p.key}`, item: `seidraven_female_${p.key}` }));
export const SEIDRAVEN_PARTS = [...SEIDRAVEN_MALE_PARTS, ...SEIDRAVEN_FEMALE_PARTS];
