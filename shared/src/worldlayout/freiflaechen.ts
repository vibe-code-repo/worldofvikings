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
 * The circle covers the object in EVERY rotation: radius = half the longest
 * horizontal edge of the hull plus the horizontal offset of the hull centre
 * from the origin (times the placement scale). That is the same sum the
 * test-flight plinth uses; NOT the diagonal of the box, which over-clears a
 * round or long object (a burial mound: 30 m instead of 22 m).
 *
 * Radius per placement, in this order:
 *  1. `einebnen` — the plateau radius the placement already declares; the
 *     scatter must not stand on ground that is levelled anyway. Never below
 *     `FREIFLAECHE_VORGABE`: a tiny plateau must not clear less than none.
 *  2. Hull: shared hull helper (`huellenAufloeser`: store catalogue, upload
 *     registry), then the manifest hull of own models (`assets/manifest.json`
 *     — server reads it from disk, client fetches it), and only without a
 *     manifest entry the prefab's `renderScale` width (placeholder box, half
 *     the edge).
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
import { manifestHuellen, type ManifestModell } from '../weltbau/manifest.js';
import type { PlacementDef, WorldLayout } from './types.js';
import { sanitizeWorldLayout } from './sanitize.js';

export const FREIFLAECHE_VORGABE = 1.5;
export const FREIFLAECHE_MIN = 0.75;
export const FREIFLAECHE_MAX = 100;
/** Zone edge in metres; the zone centre is `zone * ZONE_EDGE`. */
const ZONE_EDGE = 64;

const endlich = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Hull lookup used for the radius: the shared resolver, then the manifest
 * hull of own models, and for prefabs without a manifest entry a square box
 * from `renderScale`. One instance caches per prefab — create a new one when
 * uploads or the manifest change. Server and client must pass the SAME
 * manifest, or preview and server clear different areas.
 */
export function freiflaechenHuellen(
  manifest?: ReadonlyMap<string, ManifestModell> | null
): HuellenAufloeser {
  const basis = huellenAufloeser();
  const ausManifest = manifest && manifest.size > 0 ? manifestHuellen(manifest) : null;
  return (prefab) => {
    const h = basis(prefab) ?? ausManifest?.(prefab) ?? null;
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
  const r = (Math.max(h.halbX, h.halbZ) + Math.hypot(h.mitteX, h.mitteZ)) * skala;
  if (Number.isNaN(r)) return FREIFLAECHE_VORGABE;
  return Math.min(FREIFLAECHE_MAX, Math.max(FREIFLAECHE_MIN, r));
}

/**
 * Placements as the server sees them: through the same `sanitizeWorldLayout`
 * (clamps `scale` 0.2–5 and `einebnen` 1–100, drops bad entries, merges
 * duplicates). For a caller that holds RAW placements (the test-flight draft
 * from local storage). Anything the sanitizer rejects yields an empty list.
 */
export function platzierungenBereinigt(roh: unknown): PlacementDef[] {
  if (!Array.isArray(roh)) return [];
  const l = sanitizeWorldLayout({ version: 1, name: 'x', continents: [], regions: [], placements: roh });
  return l?.placements ? [...l.placements] : [];
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
