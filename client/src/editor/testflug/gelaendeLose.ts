/**
 * Which placements follow the ground when a terrain stroke moves it (decision E2 = a, card T3).
 * DOM-free: the lock rule of `gelaendeSperre.ts` decides, this file only asks it.
 *
 * Welche Platzierungen mit dem Boden wandern, wenn ein Strich ihn bewegt.
 *
 * ── What is "loose"? ────────────────────────────────────────────────
 * A placement is LOOSE when the brush does not protect it: it has no plinth (`einebnen`) and it is no
 * building (`gebaeudeRadius` = null: neither a modular part nor a big solid body, see the lock). That is
 * exactly the complement of the lock circles, so what the brush may walk over is what moves with
 * the ground and nothing is both: crates, barrels, stones, trees, small props, NPCs. A placement
 * holds no height (`x`, `z` only; the flight puts it on `getGroundHeight` when it draws it), so
 * "moving along" = drawing the loose ones again after the stroke, buildings and plinths are NOT
 * redrawn and keep what they show. The same redraw after undo puts them back: one step, both.
 *
 * Only placements near a changed vertex are redrawn (`MARGE_M` around the zone box of each change).
 */
import { gebaeudeRadius, type SperrKatalog, type SperrPlatzierung } from './gelaendeSperre';
import type { Aenderung } from './gelaendePinsel';

/** Redraw margin around a changed vertex: the object sits on the interpolated ground between vertices. */
export const MARGE_M = 1;

/** True when the placement follows the ground (no plinth, no building). */
export function istLose(p: SperrPlatzierung, k: SperrKatalog): boolean {
  if (typeof p.einebnen === 'number' && p.einebnen > 0) return false;
  return gebaeudeRadius(p, k) === null;
}

/** Bounding boxes of the changed vertices, one per zone (scattered changes must not become one giant box). */
export function aenderungsKaesten(aenderungen: readonly Aenderung[]): Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> {
  const jeZone = new Map<string, { minX: number; maxX: number; minZ: number; maxZ: number }>();
  for (const a of aenderungen) {
    const wx = a.zx * 64 - 32 + (a.index % 64);
    const wz = a.zz * 64 - 32 + Math.floor(a.index / 64);
    const key = `${a.zx},${a.zz}`;
    const b = jeZone.get(key);
    if (!b) jeZone.set(key, { minX: wx, maxX: wx, minZ: wz, maxZ: wz });
    else {
      if (wx < b.minX) b.minX = wx;
      if (wx > b.maxX) b.maxX = wx;
      if (wz < b.minZ) b.minZ = wz;
      if (wz > b.maxZ) b.maxZ = wz;
    }
  }
  return [...jeZone.values()];
}

/** List positions of ALL placements within `MARGE_M` of a changed vertex box (loose or not: for undo, redo, takeover). */
export function platzierungenNahe(platzierungen: readonly SperrPlatzierung[] | undefined, aenderungen: readonly Aenderung[]): number[] {
  const kaesten = aenderungsKaesten(aenderungen);
  const aus: number[] = [];
  (platzierungen ?? []).forEach((p, i) => {
    if (kaesten.some((b) => p.x >= b.minX - MARGE_M && p.x <= b.maxX + MARGE_M && p.z >= b.minZ - MARGE_M && p.z <= b.maxZ + MARGE_M)) aus.push(i);
  });
  return aus;
}

/**
 * List positions (in `platzierungen`) of the loose placements that lie within `MARGE_M` of a changed
 * vertex box. Without `aenderungen` (nothing known) every loose placement is returned.
 */
export function loseIndizes(
  platzierungen: readonly SperrPlatzierung[] | undefined,
  k: SperrKatalog,
  aenderungen?: readonly Aenderung[]
): number[] {
  const kaesten = aenderungen ? aenderungsKaesten(aenderungen) : null;
  const aus: number[] = [];
  (platzierungen ?? []).forEach((p, i) => {
    if (!istLose(p, k)) return;
    if (kaesten && !kaesten.some((b) => p.x >= b.minX - MARGE_M && p.x <= b.maxX + MARGE_M && p.z >= b.minZ - MARGE_M && p.z <= b.maxZ + MARGE_M)) return;
    aus.push(i);
  });
  return aus;
}
