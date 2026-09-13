/** Cosmetic attachments are independent of replaced body regions. Missing policy hides nothing. */
export const APPEARANCE_ATTACHMENTS = {
  frisur: 'hair', bart: 'beard', augenbraue: 'eyebrows',
} as const;
export type AppearanceFeature = typeof APPEARANCE_ATTACHMENTS[keyof typeof APPEARANCE_ATTACHMENTS];
export interface AppearancePolicy {
  readonly hideAppearance?: readonly AppearanceFeature[];
}

/** Hide wins across mixed equipment. Call only with successfully loaded, currently selected items. */
export function hiddenAppearance(parts: readonly AppearancePolicy[]): ReadonlySet<AppearanceFeature> {
  return new Set(parts.flatMap(part => part.hideAppearance ?? []));
}
