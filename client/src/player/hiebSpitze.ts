/**
 * Wann die Hand beim Schwerthieb ihre Spitze erreicht (Sekunden nach dem
 * Schlagstart) — abgeleitet aus dem Tempo, mit dem `AvatarRig` den Clip
 * wirklich abspielt, statt als feste Zahl. Läuft der Clip doppelt so schnell
 * (kürzere Hiebdauer, anderes Angriffstempo), kommt die Spitze halb so spät.
 *
 * Die Rohzeiten sind die Hand-Maxima der drei Schwerthiebe im UNGESTAUCHTEN
 * Clip (bei Tempo 2,5 gemessen als 0,28 / 0,40 / 0,68 s: 0,7 / 1,0 / 1,7 s).
 *
 * Time until the hand reaches its peak in a sword blow, derived from the
 * playback speed the rig really uses, so it moves with tempo and clip.
 */
export const HIEB_SPITZE_ROH_S: readonly number[] = [0.7, 1.0, 1.7];

/** Sekunden bis zur Spitze von Hieb `hieb` (0…) bei `speedRatio` des Clips; NaN ohne brauchbares Tempo. */
export function hiebSpitzeS(hieb: number, speedRatio: number): number {
  const roh = HIEB_SPITZE_ROH_S[hieb];
  if (roh === undefined || !(speedRatio > 0)) return NaN;
  return roh / speedRatio;
}
