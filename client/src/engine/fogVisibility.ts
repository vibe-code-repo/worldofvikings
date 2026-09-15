import { sichtweite } from '@wov/shared/src/lookProfil.js';
/** Babylon fog modes: NONE=0, EXP=1, EXP2=2, LINEAR=3. */
export function fogVisibilityDistance(enabled: boolean, mode: number, density: number, start: number, end: number): number {
  if (!enabled || mode === 0) return Infinity;
  if (mode === 3) return end > start ? sichtweite('linear', 0, 0.1, start, end) : Infinity;
  if (mode === 1 || mode === 2) return sichtweite(mode === 1 ? 'exp' : 'exp2', density, 0.1);
  return Infinity;
}
