import { MALE_ARMOR_BODY, FEMALE_ARMOR_BODY } from './armorCompatibility.js';

/**
 * Plainhide: the plain leather clothing every new character starts in.
 * Five pieces on purpose: there is no hood and no gloves, so the head and both hands stay
 * the player's own body (skin tone, face, hair). The regions no piece replaces are FREE_REGIONS.
 */
const PARTS = [
  { key: 'shoulders', name: 'Plainhide Sleeves', slot: 'schultern', equipment: 'schultern', regions: ['ArmUpperLeft', 'ArmUpperRight'], hideAppearance: [], weight: .5 },
  { key: 'vest', name: 'Plainhide Tunic', slot: 'oberkoerper', equipment: 'hemd', regions: ['Torso'], hideAppearance: [], weight: 1 },
  { key: 'bracers', name: 'Plainhide Wraps', slot: 'unterarme', equipment: 'unterarme', regions: ['ArmLowerLeft', 'ArmLowerRight'], hideAppearance: [], weight: .5 },
  { key: 'robe', name: 'Plainhide Trousers', slot: 'beine', equipment: 'hose', regions: ['Hips'], hideAppearance: [], weight: 1 },
  { key: 'boots', name: 'Plainhide Shoes', slot: 'fuesse', equipment: 'schuhe', regions: ['LegLeft', 'LegRight'], hideAppearance: [], weight: 1 },
] as const;

/** Body regions no Plainhide piece replaces: they are never masked. */
export const PLAINHIDE_FREE_REGIONS = ['Head', 'HandLeft', 'HandRight'] as const;

export const PLAINHIDE_MALE_PARTS = PARTS.map(p => ({ ...p, ...MALE_ARMOR_BODY, id: `plainhide_male_${p.key}`, item: `plainhide_male_${p.key}` }));
export const PLAINHIDE_FEMALE_PARTS = PARTS.map(p => ({ ...p, ...FEMALE_ARMOR_BODY, id: `plainhide_female_${p.key}`, item: `plainhide_female_${p.key}` }));
export const PLAINHIDE_PARTS = [...PLAINHIDE_MALE_PARTS, ...PLAINHIDE_FEMALE_PARTS];
