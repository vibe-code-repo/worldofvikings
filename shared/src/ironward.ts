/** Versioned equipment contract. Assets are generated outside the repository. */
export const IRONWARD_PARTS = [
  { id: 'ironward_helm', item: 'IronwardHelmet', name: 'Ironward-Helm', slot: 'kopf', equipment: 'kopf', regions: ['Head'], weight: 1.5 },
  { id: 'ironward_brust', item: 'IronwardCuirass', name: 'Ironward-Brustpanzer', slot: 'oberkoerper', equipment: 'hemd', regions: ['Torso'], weight: 4 },
  { id: 'ironward_hose', item: 'IronwardLeggings', name: 'Ironward-Beinschutz', slot: 'beine', equipment: 'hose', regions: ['Hips'], weight: 3 },
  { id: 'ironward_schultern', item: 'IronwardPauldrons', name: 'Ironward-Schulterschutz', slot: 'schultern', equipment: 'schultern', regions: ['ArmUpperLeft', 'ArmUpperRight'], weight: 2 },
  { id: 'ironward_arme', item: 'IronwardBracers', name: 'Ironward-Armschienen', slot: 'unterarme', equipment: 'unterarme', regions: ['ArmLowerLeft', 'ArmLowerRight'], weight: 1 },
  { id: 'ironward_handschuhe', item: 'IronwardGauntlets', name: 'Ironward-Handschuhe', slot: 'haende', equipment: 'haende', regions: ['HandLeft', 'HandRight'], weight: 1 },
  { id: 'ironward_stiefel', item: 'IronwardBoots', name: 'Ironward-Panzerstiefel', slot: 'fuesse', equipment: 'schuhe', regions: ['LegLeft', 'LegRight'], weight: 2 },
] as const;
