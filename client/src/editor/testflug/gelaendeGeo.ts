/**
 * Puts the live hand-correction layer (`DeltaKarte`) into the running ground of
 * the flight. `RegionGeo` builds its `HoehenKorrekturField` once from the
 * layout it is given and has no public way to replace it (T1 did not need one:
 * the server restarts). The flight must show a stroke at once, so this module is
 * the ONE place that swaps that field for a live view of the layer.
 *
 * Bringt die Handkorrektur-Ebene in das laufende Gelände. `RegionGeo` baut das
 * Feld einmal aus dem Layout und bietet keinen öffentlichen Tausch; diese
 * eine Stelle ersetzt es durch eine lebende Sicht auf die Ebene.
 *
 * The swap reaches a private field. Two guards keep that honest: the field
 * must still be a `HoehenKorrekturField` (else nothing is swapped and the
 * caller says so), and `client/test/gelaende-pinsel.ts` proves the swapped
 * ground bit-equal to a freshly compiled geo, so a rename or a changed formula
 * in shared turns that test red instead of silently drifting.
 * A public `RegionGeo.korrekturErsetzen()` in shared would replace this file;
 * that is a change outside the card's paths and reported as such.
 *
 * The view answers exactly like `HoehenKorrekturField.delta` (cm × 0.01, f32),
 * so flight and server compute the same height for the same layer.
 */
import { HoehenKorrekturField, RegionGeo } from '@wov/shared';
import type { DeltaKarte } from './gelaendePinsel';

/** What `RegionGeo` asks of its correction field. */
interface KorrekturSicht {
  readonly isEmpty: boolean;
  delta(zx: number, zz: number, index: number): number;
}

/**
 * Installs a live view of `karte` into `geo`. Returns `false` when `geo` is not
 * a `RegionGeo` with the expected field (nothing changed then). Calling it again
 * with another layer replaces the view; the ORIGINAL field is remembered so
 * `entferneKorrekturSicht` can put it back.
 */
export function installiereKorrekturSicht(geo: unknown, karte: DeltaKarte): boolean {
  if (!(geo instanceof RegionGeo)) return false;
  const innen = geo as unknown as { korrektur: unknown; __korrekturOriginal?: unknown };
  if (innen.__korrekturOriginal === undefined) {
    if (!(innen.korrektur instanceof HoehenKorrekturField)) return false;
    innen.__korrekturOriginal = innen.korrektur;
  }
  const sicht: KorrekturSicht = {
    get isEmpty() {
      return karte.punktzahl === 0;
    },
    delta: (zx, zz, index) => karte.deltaM(zx, zz, index),
  };
  innen.korrektur = sicht;
  return true;
}

/** Puts the original field back (tests; the flight never needs it). */
export function entferneKorrekturSicht(geo: unknown): void {
  const innen = geo as { korrektur: unknown; __korrekturOriginal?: unknown };
  if (innen.__korrekturOriginal !== undefined) {
    innen.korrektur = innen.__korrekturOriginal;
    delete innen.__korrekturOriginal;
  }
}
