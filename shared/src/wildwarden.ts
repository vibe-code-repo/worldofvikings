/** Wildwarden v3: foliage armor with an attachment-only crown on the male rig. */
export const WILDWARDEN_PARTS = [
  { id: 'wildwarden_crown', item: 'wildwarden_crown', name: 'Waldhüter-Geweihkrone', slot: 'kopf', equipment: 'kopf', regions: [], hideAppearance: [], weight: 1 },
  { id: 'wildwarden_vest', item: 'wildwarden_vest', name: 'Waldhüter-Rindenwams', slot: 'oberkoerper', equipment: 'hemd', regions: ['Torso'], hideAppearance: [], weight: 2 },
  { id: 'wildwarden_robe', item: 'wildwarden_robe', name: 'Waldhüter-Waldrobe', slot: 'beine', equipment: 'hose', regions: ['Hips'], hideAppearance: [], weight: 2 },
  { id: 'wildwarden_mantle', item: 'wildwarden_mantle', name: 'Waldhüter-Blattschultern', slot: 'schultern', equipment: 'schultern', regions: ['ArmUpperLeft', 'ArmUpperRight'], hideAppearance: [], weight: 1 },
  { id: 'wildwarden_bracers', item: 'wildwarden_bracers', name: 'Waldhüter-Wurzelarmschienen', slot: 'unterarme', equipment: 'unterarme', regions: ['ArmLowerLeft', 'ArmLowerRight'], hideAppearance: [], weight: 1 },
  { id: 'wildwarden_gloves', item: 'wildwarden_gloves', name: 'Waldhüter-Lederhandschuhe', slot: 'haende', equipment: 'haende', regions: ['HandLeft', 'HandRight'], hideAppearance: [], weight: .5 },
  { id: 'wildwarden_boots', item: 'wildwarden_boots', name: 'Waldhüter-Wanderstiefel', slot: 'fuesse', equipment: 'schuhe', regions: ['LegLeft', 'LegRight'], hideAppearance: [], weight: 1 },
] as const;
