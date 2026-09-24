/**
 * freiflaechen.ts — clear areas the scatter keeps free under placements.
 * Freiflächen, die die Streuung unter Platzierungen freihält.
 *
 * ONE function for the server (`ZoneManager.generateZone`) and the editor
 * preview (`BewuchsVorschau`): a preview with its own areas would show a
 * world the server does not produce.
 *
 * Shape: a CIRCLE around the placement point (`kreis`), tested against the
 * plant CENTRE only — a trunk or crown may still overhang the edge.
 * A rotated box is covered by the circle through its farthest corner: the
 * placement yaw is not known to every caller, and a circle over-clears a
 * long thin object (a jetty) a little rather than leaving a corner planted.
 *
 * Radius per placement, in this order:
 *  1. `einebnen` — the plateau radius the placement already declares; the
 *     scatter must not stand on ground that is levelled anyway. Never below
 *     `FREIFLAECHE_VORGABE`: a tiny plateau must not clear less than none.
 *  2. Footprint from the shared hull helper (`huellenAufloeser`: store
 *     catalogue, upload registry) or, for own models without a hull, the
 *     prefab's `renderScale` width: farthest corner of the box from the
 *     placement point, times the placement scale.
 *  3. `FREIFLAECHE_VORGABE` (1.5 m) when no hull is known: about the
 *     footprint of a crate or a small prop, so a tree cannot stand inside
 *     it, yet the scatter around it stays practically untouched.
 * A hull narrower than `FREIFLAECHE_MIN` (0.75 m) is raised to it, so a
 * thin post still keeps plant trunks off its base.
 * The result is clamped to `FREIFLAECHE_MAX` (100 m, the largest `einebnen`
 * `sanitizeWorldLayout` allows); non-finite numbers are ignored.
 */
import type { ClearArea } from '../worldgen/streuung.js';
import { PREFABS_BY_NAME } from '../prefabs.js';
import { huellenAufloeser, type Huelle, type HuellenAufloeser } from '../weltbau/huelle.js';
import type { PlacementDef, WorldLayout } from './types.js';

export const FREIFLAECHE_VORGABE = 1.5;
export const FREIFLAECHE_MIN = 0.75;
export const FREIFLAECHE_MAX = 100;
/** Zone edge in metres; the zone centre is `zone * ZONE_EDGE`. */
const ZONE_EDGE = 64;

const endlich = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Hull lookup used for the radius: the shared resolver, and for prefabs it
 * does not know (own models such as rocks) a square box from `renderScale`.
 * One instance caches per prefab — create a new one when uploads change.
 */
export function freiflaechenHuellen(): HuellenAufloeser {
  const basis = huellenAufloeser();
  return (prefab) => {
    const h = basis(prefab);
    if (h) return h;
    const w = PREFABS_BY_NAME.get(prefab)?.renderScale?.w;
    if (!endlich(w) || w <= 0) return null;
    const huelle: Huelle = {
      fest: true, mitteX: 0, mitteZ: 0, halbX: w / 2, halbZ: w / 2, minY: 0, maxY: 0, gebaeude: false, quelle: 'extern',
    };
    return huelle;
  };
}

function radiusFuer(p: PlacementDef, huellen: HuellenAufloeser): number {
  if (endlich(p.einebnen) && p.einebnen > 0) {
    return Math.min(FREIFLAECHE_MAX, Math.max(FREIFLAECHE_VORGABE, p.einebnen));
  }
  const h = huellen(p.prefab);
  if (!h) return FREIFLAECHE_VORGABE;
  const skala = endlich(p.scale) && p.scale > 0 ? p.scale : 1;
  const ex = Math.abs(h.mitteX) + h.halbX;
  const ez = Math.abs(h.mitteZ) + h.halbZ;
  const r = Math.hypot(ex, ez) * skala;
  if (Number.isNaN(r)) return FREIFLAECHE_VORGABE;
  return Math.min(FREIFLAECHE_MAX, Math.max(FREIFLAECHE_MIN, r));
}

/** Clear areas of all placements of a layout (empty without placements). */
export function freiflaechenAusPlatzierungen(
  layout: { placements?: readonly PlacementDef[] } | Pick<WorldLayout, 'placements'>,
  huellen: HuellenAufloeser = freiflaechenHuellen()
): ClearArea[] {
  const out: ClearArea[] = [];
  for (const p of layout.placements ?? []) {
    if (!endlich(p.x) || !endlich(p.z)) continue;
    out.push({ center: { x: p.x, y: 0, z: p.z }, radius: radiusFuer(p, huellen), kreis: true });
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
