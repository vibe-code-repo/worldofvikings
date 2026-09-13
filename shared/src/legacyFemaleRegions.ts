/** Must match the fitted legacy armor lining's triangle partition. */
export function legacyFemaleRegionForBone(bone: string): string {
  if (/^L_(Index|Ring|Thumb|Hand)/.test(bone)) return 'HandLeft';
  if (/^R_(Index|Ring|Thumb|Hand)/.test(bone)) return 'HandRight';
  for (const [side, word] of [['L', 'Left'], ['R', 'Right']]) {
    if (bone === `${side}_Upperarm`) return `ArmUpper${word}`;
    if (bone === `${side}_Forearm`) return `ArmLower${word}`;
    if (new RegExp(`^${side}_(Calf|Foot|Toe)`).test(bone)) return `Leg${word}`;
  }
  if (['Head', 'Head_End', 'NeckTwist01'].includes(bone)) return 'Head';
  if (['Waist', 'Spine01', 'Spine02', 'L_Clavicle', 'R_Clavicle'].includes(bone)) return 'Torso';
  return 'Hips';
}
