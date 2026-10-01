/**
 * Lock circles of the terrain brush (decision E2 = a, card T2): under a
 * levelled plinth (`einebnen`) and under a building the brush does nothing and
 * its circle turns red. Loose objects (trees, rocks, small props) are NOT
 * locked; carrying them along with the ground is card T3.
 *
 * Sperrkreise des Geländepinsels: Unter einem Sockel (`einebnen`) und unter
 * einem Gebäude wirkt der Pinsel nicht, sein Kreis wird rot. Lose Objekte
 * sperren nicht (Mitwandern ist T3).
 *
 * ── What is a "building"? ───────────────────────────────────────────
 * Two kinds. (A) A modular PART (`istBauteil`): a prefab with the `PIECE` flag
 * (the hammer's pieces: wood wall, floor, roof, door, …) or a store piece of the
 * building group (`sm-bld-`). Always locked, at any size (2 m walls are the
 * point) and without the size rule below. (B) A whole building or a big solid
 * object; the catalogue has no category for it, so the rule is built from what
 * it does have, and it is the same rule the game uses for "you cannot walk
 * through it":
 *   1. the prefab has a solid collision body in the game (`fest`), AND
 *   2. it is not natural (no tree, log, breakable rock, plant, pickable, drop
 *      flag; not a foliage prefab), AND
 *   3. its footprint is at least `GEBAEUDE_MIN_M` (3 m): a barrel or a cart is
 *      a prop that may sit a little crooked, a house, a palisade section or a
 *      boat hull is not.
 * Footprint = larger of width/depth of the model box (uploads: the registry
 * box × base scale; built-in prefabs: `renderScale.w`) × the placement's scale.
 * The lock circle has the radius of half the box diagonal (the yaw is not
 * known to the lock and a house rotated by 45° reaches that far) plus
 * `SPERR_RAND_M`, so a stroke cannot touch the corner of a wall.
 */
import { PrefabFlag } from '@wov/shared';
import type { PrefabDef } from '@wov/shared';

export const GEBAEUDE_MIN_M = 3;
export const SPERR_RAND_M = 0.5;

const NATUERLICH =
  PrefabFlag.TREE_BASE |
  PrefabFlag.TREE_LOG |
  PrefabFlag.DESTRUCTIBLE |
  PrefabFlag.MINE_ROCK_5 |
  PrefabFlag.PLANT |
  PrefabFlag.PICKABLE |
  PrefabFlag.PICKABLE_ITEM |
  PrefabFlag.ITEM_DROP;

/** The parts of a placement the lock needs (a subset of `EntwurfEintrag`). */
export interface SperrPlatzierung {
  prefab: string;
  x: number;
  z: number;
  scale?: number;
  einebnen?: number;
}

/** What the lock asks the catalogue; injected so the rule runs without a scene, a registry or a model. */
export interface SperrKatalog {
  def(prefab: string): PrefabDef | undefined;
  /** Solid body in the game (`istFesterKoerperImSpiel`), upload choice included. */
  fest(prefab: string): boolean;
  /** Foliage prefab (a tree or bush the vegetation system scatters). */
  vegetation(prefab: string): boolean;
  /** Box of an uploaded model (registry entry), if the prefab is one. */
  upload(prefab: string): { breite: number; tiefe: number; grundskala?: number } | undefined;
}

export interface SperrKreis {
  x: number;
  z: number;
  r: number;
  art: 'sockel' | 'gebaeude';
  prefab: string;
}

/** Width × depth of the model box in metres (before the placement scale); `null` when the catalogue does not know it. */
function grundflaeche(p: string, k: SperrKatalog): { b: number; t: number } | null {
  const up = k.upload(p);
  if (up) {
    const g = typeof up.grundskala === 'number' && Number.isFinite(up.grundskala) && up.grundskala > 0 ? up.grundskala : 1;
    return { b: up.breite * g, t: up.tiefe * g };
  }
  const w = k.def(p)?.renderScale.w;
  return typeof w === 'number' && w > 0 ? { b: w, t: w } : null;
}

/** Radius of the lock circle of a building placement, or `null` when it is not a building. */
export function gebaeudeRadius(p: SperrPlatzierung, k: SperrKatalog): number | null {
  if (k.vegetation(p.prefab)) return null;
  const def = k.def(p.prefab);
  if (def && (def.flags & NATUERLICH) !== 0n) return null;
  const teil = istBauteil(def, p.prefab);
  // A building PART is locked whatever its size and whether or not the flight gives it a solid body:
  // a house built of 2 m walls, floors and roofs must not tear apart when the ground under one piece moves.
  if (!teil && !k.fest(p.prefab)) return null;
  const g = grundflaeche(p.prefab, k) ?? (teil ? { b: 1, t: 1 } : null);
  if (!g) return null;
  const s = typeof p.scale === 'number' && p.scale > 0 ? p.scale : 1;
  const breite = g.b * s;
  const tiefe = g.t * s;
  if (!teil && Math.max(breite, tiefe) < GEBAEUDE_MIN_M) return null;
  return Math.hypot(breite, tiefe) / 2 + SPERR_RAND_M;
}

/** The store names its building pieces with this segment (`sm-bld-`); the catalogue sorts them into the group „Gebäude“. */
const STORE_GEBAEUDE = /-sm-bld-/;

/**
 * A modular building part: a prefab with the `PIECE` flag (what the hammer builds and
 * `PieceTable.BAU_PREFABS` lists: wall, floor, roof, door, …) or a store piece of the
 * building group (`environment-sm-bld-house-floor-…`, `-roof-…`, `-wall-peak-…`).
 * Both are properties of the prefab itself, not of its size.
 */
export function istBauteil(def: PrefabDef | undefined, prefab: string): boolean {
  if (def && (def.flags & PrefabFlag.PIECE) !== 0n) return true;
  return STORE_GEBAEUDE.test(prefab);
}

/** All lock circles of a draft's placements: one per plinth, one per building (a plinth building gets both). */
export function sperrKreise(platzierungen: readonly SperrPlatzierung[] | undefined, k: SperrKatalog): SperrKreis[] {
  const aus: SperrKreis[] = [];
  for (const p of platzierungen ?? []) {
    if (typeof p.einebnen === 'number' && p.einebnen > 0) aus.push({ x: p.x, z: p.z, r: p.einebnen, art: 'sockel', prefab: p.prefab });
    const r = gebaeudeRadius(p, k);
    if (r !== null) aus.push({ x: p.x, z: p.z, r, art: 'gebaeude', prefab: p.prefab });
  }
  return aus;
}

/** True when the vertex at (x, z) lies inside a lock circle (undo/redo must not change it). */
export function punktGesperrt(kreise: readonly SperrKreis[], x: number, z: number): boolean {
  return kreise.some((c) => Math.hypot(c.x - x, c.z - z) < c.r);
}

/** The first lock circle the brush circle (centre, radius) touches, or `null`. */
export function gesperrtDurch(kreise: readonly SperrKreis[], x: number, z: number, radius: number): SperrKreis | null {
  for (const c of kreise) if (Math.hypot(c.x - x, c.z - z) < c.r + radius) return c;
  return null;
}
