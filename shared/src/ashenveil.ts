/** Ashenveil v1: male replacement armor with a hood, robe and closed boots. */
export const ASHENVEIL_PARTS = [
  { id: 'ashenveil_hood', item: 'ashenveil_hood', name: 'Aschenschleier-Schattenkapuze', slot: 'kopf', equipment: 'kopf', regions: ['Head'], weight: 1 },
  { id: 'ashenveil_vest', item: 'ashenveil_vest', name: 'Aschenschleier-Brustharnisch', slot: 'oberkoerper', equipment: 'hemd', regions: ['Torso'], weight: 2 },
  { id: 'ashenveil_robe', item: 'ashenveil_robe', name: 'Aschenschleier-Kultistenrobe', slot: 'beine', equipment: 'hose', regions: ['Hips'], weight: 2 },
  { id: 'ashenveil_shoulders', item: 'ashenveil_shoulders', name: 'Aschenschleier-Dornenmantel', slot: 'schultern', equipment: 'schultern', regions: ['ArmUpperLeft', 'ArmUpperRight'], weight: 2 },
  { id: 'ashenveil_bracers', item: 'ashenveil_bracers', name: 'Aschenschleier-Runenarmschienen', slot: 'unterarme', equipment: 'unterarme', regions: ['ArmLowerLeft', 'ArmLowerRight'], weight: 1 },
  { id: 'ashenveil_gloves', item: 'ashenveil_gloves', name: 'Aschenschleier-Schattenhandschuhe', slot: 'haende', equipment: 'haende', regions: ['HandLeft', 'HandRight'], weight: .5 },
  { id: 'ashenveil_boots', item: 'ashenveil_boots', name: 'Aschenschleier-Panzerstiefel', slot: 'fuesse', equipment: 'schuhe', regions: ['LegLeft', 'LegRight'], weight: 2 },
] as const;
