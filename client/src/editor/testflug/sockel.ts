/**
 * sockel.ts — the flat circle (`einebnen`) the test flight puts under a placed building.
 * Der Sockel-Kreis (`einebnen`), den der Testflug unter ein gesetztes Bauwerk legt.
 *
 * Pure and DOM-free so a test can send the value to the real operations service.
 */
import { PLATZIERUNG_EINEBNEN_MAX } from '@wov/shared/src/worldlayout/sanitize.js';

/**
 * Half of the LONGEST extent plus one metre, scaled with the chosen size. A circle of that radius covers the building
 * in EVERY turn, because `w` already is the longest horizontal edge (a √2 for the square's diagonal was too generous for
 * long buildings: the Gravemound, 42.6 × 29.4 m, got 31 m instead of 22 m).
 *
 * Capped at `PLATZIERUNG_EINEBNEN_MAX` (100), the same limit the operations service and the sanitizer enforce: above
 * it the service refuses the whole Vorgang with 422 (`feld: "einebnen"`), and the building could not be placed at all
 * (Gravemound from ×4.65, cave domes from ×4.13, terrain tiles already at ×1). Capped, the flat circle is smaller than
 * the building's half width for those and the ground under the far edge stays as it is.
 */
export function sockelRadiusFuer(w: number, scale: number): number {
  return Math.min(PLATZIERUNG_EINEBNEN_MAX, Math.round((w * scale) / 2 + 1));
}
