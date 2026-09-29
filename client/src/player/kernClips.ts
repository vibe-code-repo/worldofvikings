/**
 * The 20 core clips added to both body models on 2026-09-29 (death, getting up, hit
 * reactions, knock-down, stooping, chest, doors, button). None of them is a movement
 * STATE: AvatarRig must keep them out of the idle/walk/run classification (the door clips
 * travel 2.4 m and would be taken for the run cycle) and plays them only on demand.
 */
export const KERN_CLIPS: readonly string[] = [
  'tod_vorn', 'tod_hinten', 'aufstehen_vorn', 'aufstehen_hinten',
  'treffer_vorn_links', 'treffer_vorn_rechts', 'treffer_hinten_links', 'treffer_hinten_rechts',
  'treffer_schwer', 'rueckstoss', 'umgeworfen', 'aufrappeln', 'betaeubt',
  'aufheben', 'buecken_runter', 'buecken_hoch', 'truhe_oeffnen', 'tuer_links', 'tuer_rechts', 'knopf',
];

const KERN_MENGE = new Set(KERN_CLIPS);

export function istKernClip(name: string): boolean {
  return KERN_MENGE.has(name);
}
