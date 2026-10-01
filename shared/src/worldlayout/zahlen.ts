/**
 * The two number rules of the world sanitizer that other modules must share instead of copying:
 * `klemm` (clamp, fallback for non-numbers) and `koordinate` (finite number inside the world frame,
 * rounded to the millimetre). The kit sanitizer (`bausatz/`) uses them for position, angle and scale so a kit
 * part is treated exactly like the placement it replaces. DOM-free, no imports besides the frame constant.
 */

import { LAYOUT_MAX_EXTENT } from './types.js';

export function klemm(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function koordinate(v: unknown): number | null {
  // Nur eine ZAHL ist eine Koordinate: `Number(null)` und `Number('')` sind 0
  // und hätten einen Eintrag mit `"x": null` still an den Ursprung gesetzt.
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > LAYOUT_MAX_EXTENT) return null;
  const n = v;
  // Auf Millimeter runden — stabilisiert JSON-Roundtrips und Kompilierung.
  return Math.round(n * 1000) / 1000;
}
