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
 * The circle is deliberately TIGHT: radius = half the longest horizontal edge
 * of the hull plus the horizontal offset of the hull centre from the origin
 * (times the placement scale). It covers the inscribed ellipse in every
 * rotation, but NOT the corners of a boxy hull: a plant centre can stand in a
 * corner. That is the same sum the test-flight plinth uses and it is chosen
 * on purpose — the diagonal of the box over-clears a round or long object
 * (a burial mound: 30 m instead of 22 m), and the plinth was already
 * criticised as "levelled too much".
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
 * The manifest hull is in FILE space; the game scales it by the prefab's
 * `localScale` (own models are often normalised to about 1 m and grown by it:
 * KiPine3 x12, Surtr x9). Rule as in the game: a placement without a scale
 * (scale 1) takes the prefab's `localScale`; with scale != 1 the placement
 * scale REPLACES it (`layoutAbgleich.ts` `sollSkala`: `scaleScalar` only when
 * scale != 1; `Kollisionswelt.skalierung` / `EntityManager.composeZdoWorld`:
 * `scale`, else `scaleScalar`, else `localScale`). Store and upload hulls are
 * already in metres and only get the placement scale.
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
import { sanitizeWorldLayout, platzierungenEinzeln } from './sanitize.js';

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

/** Same threshold as `layoutAbgleich.ts` (`TOLERANZ.skala`): scale within it counts as 1. */
const SKALA_TOLERANZ = 1e-3;

function radiusFuer(p: PlacementDef, huellen: HuellenAufloeser): number {
  if (endlich(p.einebnen) && p.einebnen > 0) {
    return Math.min(FREIFLAECHE_MAX, Math.max(FREIFLAECHE_VORGABE, p.einebnen));
  }
  const h = huellen(p.prefab);
  if (!h) return FREIFLAECHE_VORGABE;
  const skala = endlich(p.scale) && p.scale > 0 ? p.scale : 1;
  let fx = skala;
  let fz = skala;
  if (h.quelle === 'manifest' && Math.abs(skala - 1) <= SKALA_TOLERANZ) {
    const ls = PREFABS_BY_NAME.get(p.prefab)?.localScale;
    if (ls && endlich(ls.x) && ls.x > 0 && endlich(ls.z) && ls.z > 0) {
      fx = ls.x;
      fz = ls.z;
    }
  }
  const r = Math.max(h.halbX * fx, h.halbZ * fz) + Math.hypot(h.mitteX * fx, h.mitteZ * fz);
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

/**
 * Like `platzierungenBereinigt`, but WITHOUT the duplicate folding: the same
 * per-entry clamps (`platzierungenEinzeln`), O(n). Equal entries give equal
 * circles, so folding changes no clear area; only the cost differs (the
 * folding is quadratic per prefab: 20 ms at 2000 placements). For the preview
 * that re-reads the draft every 250 ms while an object is dragged.
 * Known difference (accepted, rare): two entries of the same prefab WITHOUT
 * ids that lie less than 1 cm apart (but not at the same point) are one entry
 * on the server, which keeps the one with the smaller x, and two circles
 * here. Their circles differ by up to 1 cm; where a plant sits within that
 * margin of a circle edge the server and the preview scatter differently, and
 * because each placed plant shifts the scatter of the ones after it, this can
 * re-roll the whole zone (up to about 9 plants) instead of just an edge.
 * Identical points (distance 0) give the same circle and are harmless.
 */
export function platzierungenFuerFreiflaechen(roh: unknown): PlacementDef[] {
  return platzierungenEinzeln(roh);
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
