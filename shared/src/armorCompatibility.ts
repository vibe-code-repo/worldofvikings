/** Geometry compatibility is stricter than a character's male/female label. */
export type ArmorBodyVariant = 'male' | 'female';
export type ArmorBodyProfile = 'wov-male-v1' | 'legacy-female-v1' | 'wov-female-v1';
export interface ArmorBodyPolicy {
  readonly bodyVariant?: ArmorBodyVariant;
  readonly bodyProfile?: ArmorBodyProfile;
  readonly figure?: string;
}
/** Runtime effect an armor set asks for; the client picks the emissive materials that belong to the profile. */
export type ArmorVfxProfile = 'emberrage_red' | 'gravethorn_red';
export const MALE_ARMOR_BODY ={ bodyVariant: 'male', bodyProfile: 'wov-male-v1', figure: 'wikinger' } as const;
export const FEMALE_ARMOR_BODY = { bodyVariant: 'female', bodyProfile: 'legacy-female-v1', figure: 'wikingerin' } as const;

export function armorBodyForFigure(value: string | undefined) {
  switch (value?.replace(/\.glb$/i, '')) {
    case 'wikinger': case 'wikinger/WikingerKoerper': return MALE_ARMOR_BODY;
    case 'wikingerin': case 'wikingerin/WikingerinKoerper': return FEMALE_ARMOR_BODY;
    default: return undefined;
  }
}

/** Unknown targets fail closed for fitted armor; unrelated unrestricted items are unchanged. */
export function canWearArmor(policy: ArmorBodyPolicy, figure: string | undefined): boolean {
  if (!policy.bodyVariant && !policy.bodyProfile && !policy.figure) return true;
  const body = armorBodyForFigure(figure);
  return !!body && (!policy.figure || policy.figure === body.figure)
    && (!policy.bodyVariant || policy.bodyVariant === body.bodyVariant)
    && (!policy.bodyProfile || policy.bodyProfile === body.bodyProfile);
}
