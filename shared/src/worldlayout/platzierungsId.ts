/**
 * Stable ids of placements (editor stage E1).
 *
 * A placement used to be addressed by `layoutKennung` (prefab + rounded
 * position). That key changes when the object is moved over a rounding
 * boundary, is shared by objects standing in the same metre, and made two
 * branches that each append a placement collide in git. Every placement now
 * carries an `id` of its own: same format as region ids, unique inside the
 * document, never derived from the position again once it is written.
 *
 * Documents written before the field existed are migrated by DERIVING the id
 * (`platzierungsIdBasis`) — deterministic, so the migration is repeatable and
 * running it twice changes nothing.
 */

import type { PlacementDef } from './types.js';

/** Shape of every id in a layout document (regions, rivers, lakes, routes, placements). */
export const ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;

/**
 * Two placements at most this far apart (m) with identical fields are the same
 * object entered twice (1 cm; the document itself rounds to 1 mm).
 */
export const GLEICHER_ORT_M = 0.01;

/** Longest prefab part of a derived id; leaves room for both coordinates and a `-NNNN` suffix inside 64 characters. */
const PREFAB_TEIL_MAX = 40;

/**
 * Id derived from prefab and rounded position, WITHOUT the collision suffix:
 * `beech1_140_-22`. The prefab part is lower-case, cut down to `[a-z0-9-]`;
 * `_` separates the parts so a negative sign cannot be mistaken for one.
 */
export function platzierungsIdBasis(p: { prefab: string; x: number; z: number }): string {
  let teil = p.prefab
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, PREFAB_TEIL_MAX)
    .replace(/-+$/, '');
  if (teil === '') teil = 'object';
  const ganz = (v: number): number => (Number.isFinite(v) ? Math.round(v) + 0 : 0); // `+ 0` turns -0 into 0
  return `${teil}_${ganz(p.x)}_${ganz(p.z)}`;
}

/** First free id `basis`, `basis-2`, `basis-3` … */
function freieId(basis: string, belegt: ReadonlySet<string>): string {
  if (!belegt.has(basis)) return basis;
  for (let n = 2; ; n++) {
    const id = `${basis}-${n}`;
    if (!belegt.has(id)) return id;
  }
}

/**
 * Fresh id for a placement that is about to be added to `layout` (editor tools,
 * MCP, tests): unique against every id already in the document. The result is
 * stable — write it into the entry; do not compute it again later.
 */
export function neuePlatzierungsId(
  layout: { readonly placements?: ReadonlyArray<{ readonly id?: string }> },
  p: { prefab: string; x: number; z: number }
): string {
  const belegt = new Set<string>();
  for (const q of layout.placements ?? []) if (typeof q.id === 'string') belegt.add(q.id);
  return freieId(platzierungsIdBasis(p), belegt);
}

/** Do these two entries say the same thing (every field but the id equal, position within 1 cm)? */
export function gleicherInhalt(a: PlacementDef, b: PlacementDef): boolean {
  return (
    a.prefab === b.prefab &&
    Math.hypot(a.x - b.x, a.z - b.z) <= GLEICHER_ORT_M + 1e-9 &&
    a.yaw === b.yaw &&
    a.scale === b.scale &&
    a.route === b.route &&
    a.einebnen === b.einebnen &&
    // `npc` is built by the sanitizer in a fixed field order, so text equality is value equality.
    JSON.stringify(a.npc) === JSON.stringify(b.npc)
  );
}

/** Code-unit order: independent of locale, so every machine writes the same bytes. */
function nachId(a: PlacementDef, b: PlacementDef): number {
  return a.id! < b.id! ? -1 : a.id! > b.id! ? 1 : 0;
}

const zahlVergleich = (a: number | undefined, b: number | undefined): number =>
  a === b ? 0 : a === undefined ? -1 : b === undefined ? 1 : a < b ? -1 : 1;

/**
 * Total order over ALL fields of an entry that has no id yet: prefab name as
 * written (upper and lower case count), x, z, yaw, then the remaining fields.
 * Deriving ids and folding duplicates in this order makes the result independent
 * of where the entries happen to stand in the document: two objects on one spot
 * get their `-2` suffix by what they are, not by which one was listed first.
 */
function kanonisch(a: PlacementDef, b: PlacementDef): number {
  if (a.prefab !== b.prefab) return a.prefab < b.prefab ? -1 : 1;
  const rest = (p: PlacementDef): string => JSON.stringify([p.scale ?? null, p.route ?? null, p.einebnen ?? null, p.npc ?? null]);
  const ra = rest(a);
  const rb = rest(b);
  return (
    zahlVergleich(a.x, b.x) || zahlVergleich(a.z, b.z) || zahlVergleich(a.yaw, b.yaw) || (ra === rb ? 0 : ra < rb ? -1 : 1)
  );
}

export interface PlatzierungenNormalisiert {
  /** Every entry with a unique `id`, sorted by `id`. */
  placements: PlacementDef[];
  /** One line per exact duplicate that was folded into another entry. */
  zusammengefasst: string[];
}

/**
 * Brings a list of already validated placements into the stored form:
 *   1. exact duplicates (all fields equal, position within 1 cm) become ONE entry;
 *   2. explicit ids that are unique are kept (first occurrence wins);
 *   3. every other entry gets a derived id, collisions get `-2`, `-3` … in canonical order of the
 *      entries themselves (see `kanonisch`), NOT in document order;
 *   4. the list is sorted by id (two appends at different places of the list merge in git;
 *      two that sort next to each other still conflict).
 *
 * Two entries whose explicit ids differ are never duplicates, however alike
 * they are: someone gave them separate identities on purpose.
 * Idempotent: a second run over the result returns the same list.
 */
export function platzierungenNormalisieren(eingabe: readonly PlacementDef[]): PlatzierungenNormalisiert {
  const behalten: PlacementDef[] = [];
  const nachPrefab = new Map<string, PlacementDef[]>();
  const zusammengefasst: string[] = [];
  // Entries that bring an id keep the document order (the first of two equal ids wins); the
  // id-less ones come in canonical order, so folding keeps the same representative wherever
  // the entries stood.
  const reihenfolge = [...eingabe.filter((e) => e.id !== undefined), ...eingabe.filter((e) => e.id === undefined).sort(kanonisch)];
  for (const roh of reihenfolge) {
    const e: PlacementDef = { ...roh };
    const kandidaten = nachPrefab.get(e.prefab);
    const gleich = kandidaten?.find(
      (k) => gleicherInhalt(k, e) && (k.id === undefined || e.id === undefined || k.id === e.id)
    );
    if (gleich) {
      if (gleich.id === undefined && e.id !== undefined) gleich.id = e.id;
      zusammengefasst.push(`${e.prefab} @(${e.x}, ${e.z})`);
      continue;
    }
    behalten.push(e);
    if (kandidaten) kandidaten.push(e);
    else nachPrefab.set(e.prefab, [e]);
  }
  const belegt = new Set<string>();
  for (const e of behalten) {
    if (e.id === undefined) continue;
    if (belegt.has(e.id)) delete e.id;
    else belegt.add(e.id);
  }
  for (const e of behalten.filter((e) => e.id === undefined).sort(kanonisch)) {
    e.id = freieId(platzierungsIdBasis(e), belegt);
    belegt.add(e.id);
  }
  // `id` first in every entry: the layout text is easier to read and merge that way.
  const placements = behalten.map((e) => idZuerst(e)).sort(nachId);
  return { placements, zusammengefasst };
}

function idZuerst(e: PlacementDef): PlacementDef {
  const { id, ...rest } = e;
  return { id: id!, ...rest };
}

/**
 * Folded duplicates are reported by `pruefeLayout`, but the sanitizer returns
 * a plain `WorldLayout`. The lines travel beside it, keyed by the object, and
 * are gone as soon as the layout is copied — a notice, not data.
 */
const zusammengefasstJeLayout = new WeakMap<object, readonly string[]>();

export function merkeZusammengefasst(layout: object, zeilen: readonly string[]): void {
  if (zeilen.length > 0) zusammengefasstJeLayout.set(layout, zeilen);
}

/** Duplicates the sanitizer folded when it produced exactly this layout object (empty otherwise). */
export function zusammengefassteDuplikate(layout: object): readonly string[] {
  return zusammengefasstJeLayout.get(layout) ?? [];
}
