/**
 * freiflaechen.ts — clear areas the scatter keeps free under placements.
 * Freiflächen, die die Streuung unter Platzierungen freihält.
 *
 * ONE function for the server (`ZoneManager.generateZone`) and the editor
 * preview (`BewuchsVorschau`): a preview with its own areas would show a
 * world the server does not produce.
 *
 * Radius per placement, in this order:
 *  1. `einebnen` — the plateau radius the placement already declares; the
 *     scatter must not stand on ground that is levelled anyway.
 *  2. Footprint from the catalogue hull box: the larger horizontal
 *     half-extent of the box (x and z, mirror-safe), taken diagonally
 *     because the placement may be rotated, times the placement scale.
 *  3. `FREIFLAECHE_VORGABE` (1.5 m) when the prefab has no hull box: about
 *     the footprint of a crate or a small prop, so a tree cannot stand
 *     inside it, yet the scatter around it stays practically untouched.
 * A hull box narrower than `FREIFLAECHE_MIN` (0.75 m) is raised to it, so a
 * thin post still keeps plant trunks off its base.
 */
import type { ClearArea } from '../worldgen/streuung.js';
import type { StoreBounds } from '../storeKatalog.js';
import type { PlacementDef, WorldLayout } from './types.js';

export const FREIFLAECHE_VORGABE = 1.5;
export const FREIFLAECHE_MIN = 0.75;
/** Zone edge in metres; the zone centre is `zone * ZONE_EDGE`. */
const ZONE_EDGE = 64;

/** Catalogue lookup: prefab name → hull box (file space; only |x| and |z| are used). */
export type FreiflaechenKatalog = ReadonlyMap<string, StoreBounds>;

function radiusFuer(p: PlacementDef, katalog: FreiflaechenKatalog): number {
  if (typeof p.einebnen === 'number' && Number.isFinite(p.einebnen) && p.einebnen > 0) {
    return p.einebnen;
  }
  const box = katalog.get(p.prefab);
  if (!box) return FREIFLAECHE_VORGABE;
  const skala = typeof p.scale === 'number' && Number.isFinite(p.scale) && p.scale > 0 ? p.scale : 1;
  const hx = Math.max(Math.abs(box.min[0]), Math.abs(box.max[0]));
  const hz = Math.max(Math.abs(box.min[2]), Math.abs(box.max[2]));
  return Math.max(FREIFLAECHE_MIN, Math.hypot(hx, hz) * skala);
}

/** Clear areas of all placements of a layout (empty without placements). */
export function freiflaechenAusPlatzierungen(
  layout: Pick<WorldLayout, 'placements'>,
  katalog: FreiflaechenKatalog
): ClearArea[] {
  const out: ClearArea[] = [];
  for (const p of layout.placements ?? []) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
    out.push({ center: { x: p.x, y: 0, z: p.z }, radius: radiusFuer(p, katalog) });
  }
  return out;
}

/**
 * The areas that can touch a zone (same list for server and preview; the
 * margin covers a plant radius, so dropping the rest changes no result).
 */
export function freiflaechenFuerZone(
  alle: readonly ClearArea[],
  zoneX: number,
  zoneY: number
): ClearArea[] {
  const cx = zoneX * ZONE_EDGE;
  const cz = zoneY * ZONE_EDGE;
  const reach = ZONE_EDGE / 2 + 16;
  return alle.filter(
    (a) =>
      Math.abs(a.center.x - cx) <= reach + a.radius && Math.abs(a.center.z - cz) <= reach + a.radius
  );
}
