/** Ashenveil v1: male replacement armor with a hood, robe and closed boots. */
import { MALE_ARMOR_BODY } from './armorCompatibility.js';
export const ASHENVEIL_PARTS = ([
  { id: 'ashenveil_hood', item: 'ashenveil_hood', name: 'Aschenschleier-Schattenkapuze', slot: 'kopf', equipment: 'kopf', regions: ['Head'], hideAppearance: ['hair', 'beard', 'eyebrows'], weight: 1 },
  { id: 'ashenveil_vest', item: 'ashenveil_vest', name: 'Aschenschleier-Brustharnisch', slot: 'oberkoerper', equipment: 'hemd', regions: ['Torso'], hideAppearance: [], weight: 2 },
  { id: 'ashenveil_robe', item: 'ashenveil_robe', name: 'Aschenschleier-Kultistenrobe', slot: 'beine', equipment: 'hose', regions: ['Hips'], hideAppearance: [], weight: 2 },
  { id: 'ashenveil_shoulders', item: 'ashenveil_shoulders', name: 'Aschenschleier-Dornenmantel', slot: 'schultern', equipment: 'schultern', regions: ['ArmUpperLeft', 'ArmUpperRight'], hideAppearance: [], weight: 2 },
  { id: 'ashenveil_bracers', item: 'ashenveil_bracers', name: 'Aschenschleier-Runenarmschienen', slot: 'unterarme', equipment: 'unterarme', regions: ['ArmLowerLeft', 'ArmLowerRight'], hideAppearance: [], weight: 1 },
  { id: 'ashenveil_gloves', item: 'ashenveil_gloves', name: 'Aschenschleier-Schattenhandschuhe', slot: 'haende', equipment: 'haende', regions: ['HandLeft', 'HandRight'], hideAppearance: [], weight: .5 },
  { id: 'ashenveil_boots', item: 'ashenveil_boots', name: 'Aschenschleier-Panzerstiefel', slot: 'fuesse', equipment: 'schuhe', regions: ['LegLeft', 'LegRight'], hideAppearance: [], weight: 2 },
] as const).map(part => ({ ...part, ...MALE_ARMOR_BODY }));
