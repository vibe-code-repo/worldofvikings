/**
 * @wov/ui — framework-free UI primitives shared by the game HUD (plain DOM)
 * and the editor shell (React).
 *
 * Phase 0 only ships the design tokens both apps already use for their
 * placeholder screens, so that the game and the editor do not drift apart.
 */

/** Colour and spacing tokens for the placeholder screens. */
export const tokens = {
  colorBackground: '#0e1116',
  colorSurface: '#171c24',
  colorText: '#e6e9ef',
  colorAccent: '#c8a45c',
  fontStack: "'Segoe UI', system-ui, -apple-system, sans-serif",
  radius: '6px',
} as const;

/** Joins class names, dropping falsy entries. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(' ');
}
