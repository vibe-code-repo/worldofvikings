/**
 * Operations on the world document: small changes per object instead of the
 * whole document.
 *
 * ── Why this exists ──────────────────────────────────────────────────
 * Every tool used to write the WHOLE world document (POST /api/worldlayout),
 * so two people changing two different objects still collided (409 on the
 * whole document). An operation names ONE object and carries what the writer
 * saw (`vorher`) and what it wants (`nachher`). The service applies it to
 * whatever is on disk NOW: it stands if that one object is still as the
 * writer saw it, no matter what happened to the other objects.
 *
 * ── The vocabulary ───────────────────────────────────────────────────
 *  - Op:      `setze` (create), `aendere` (replace), `entferne` (delete) of
 *             one entry, addressed by collection + `id`.
 *  - Vorgang: a list of ops that stands or falls together — all or nothing.
 *             One undo step is one Vorgang.
 *  - `wende`:      apply a Vorgang to a layout (pure, returns a new layout).
 *  - `invertiere`: the Vorgang that takes it back (for undo).
 *  - `verschmelze`: fold two consecutive Vorgaenge into one (a drag is many
 *                  small changes of one object, but ONE undo step).
 *
 * ── Rules ────────────────────────────────────────────────────────────
 *  - An op stands only if the current entry equals `vorher`, compared in
 *    canonical form (the sanitizer's output), so an insignificant difference
 *    in number formatting or key order is not a conflict. For `setze` the
 *    entry with that id must not exist yet.
 *  - Conflicts are collected over the WHOLE Vorgang (`ids`), not just the
 *    first; nothing is applied when there is one.
 *  - The result always runs through the sanitizer. A Vorgang whose result
 *    would exceed a limit (more than 2,000 placements, ...) or would lose an
 *    entry to the sanitizer is an ERROR, never a silent cut.
 *  - `index` is a position HINT: where a `setze` inserts (default: the end)
 *    and where an `entferne` took the entry from. It is what lets an undo put
 *    an entry back where it was (region order is the z-order). It never
 *    decides whether an op stands; ids do. Within a Vorgang it is relative to
 *    the list at the moment the op runs, ops run in order.
 *
 * Pure and DOM-free: no file access, so the editor can use the same code to
 * build ops and to predict what the service will do. The file side lives in
 * admin/src/routen/weltOps.ts.
 */
import { sanitizeWorldLayout } from './sanitize.js';
import { WORLD_LAYOUT_VERSION, type WorldLayout } from './types.js';

export const OP_COLLECTIONS = ['placements', 'regions', 'routes', 'rivers', 'lakes', 'continents'] as const;
export type OpCollection = (typeof OP_COLLECTIONS)[number];
export type OpKind = 'setze' | 'aendere' | 'entferne';

/** One entry of a collection: whatever the sanitizer lets through, plus its `id`. */
export type OpEntry = { id: string; [field: string]: unknown };

export interface Op {
  art: OpKind;
  sammlung: OpCollection;
  id: string;
  /** The whole entry as the writer saw it. Absent for `setze`. */
  vorher?: OpEntry;
  /** The whole entry as it should be. Absent for `entferne`. */
  nachher?: OpEntry;
  /** Position hint, see the header. Ignored for `aendere`. */
  index?: number;
}

export interface Vorgang {
  vorgangId: string;
  ops: Op[];
}

/** Same shape as `sanitizeWorldLayout`; injectable so a test can stand in for a newer sanitizer. */
export type LayoutSanitizer = (eingabe: unknown) => WorldLayout | null;

/**
 * How many entries the sanitizer keeps per collection (`MAX_*` and the
 * `slice(0, n)` calls in sanitize.ts). Named here a second time so an
 * overflow is reported BEFORE the sanitizer cuts silently.
 */
export const OP_LIMITS: Readonly<Record<OpCollection, number>> = {
  placements: 2000,
  regions: 512,
  routes: 256,
  rivers: 256,
  lakes: 256,
  continents: 32,
};

/** A Vorgang with more ops than this is refused; a drag is merged long before. */
export const MAX_OPS_PER_VORGANG = 5000;

/** Same pattern as the sanitizer's `ID_RE` (not exported there). */
const ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;
const VORGANG_ID_RE = /^[A-Za-z0-9._:~-]{1,128}$/;
const INDEX_MAX = 1_000_000;

export type WendeErgebnis =
  | { ok: true; layout: WorldLayout }
  | {
      ok: false;
      art: 'konflikt';
      /** The ids whose op did not stand (unique, in order of appearance). */
      ids: string[];
      /** The same with the collection, for ids that occur in two collections. */
      stellen: { sammlung: OpCollection; id: string }[];
    }
  | { ok: false; art: 'grenze'; sammlung: OpCollection; anzahl: number; grenze: number; message: string }
  | { ok: false; art: 'ungueltig'; message: string };

export type VorgangPruefung = { ok: true; vorgang: Vorgang } | { ok: false; message: string };

const istObjekt = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The entries of one collection of a layout (empty when the optional list is absent). */
export function eintraegeVon(layout: WorldLayout, sammlung: OpCollection): readonly OpEntry[] {
  return ((layout as unknown as Record<string, unknown>)[sammlung] as readonly OpEntry[] | undefined) ?? [];
}

/**
 * Check the SHAPE of an untrusted Vorgang and return a clean copy (only the
 * known fields, entries cloned). Says nothing about whether the ops stand;
 * that is `wende`'s business.
 */
export function pruefeVorgang(eingabe: unknown): VorgangPruefung {
  if (!istObjekt(eingabe)) return { ok: false, message: 'Vorgang muss ein Objekt sein' };
  if (typeof eingabe.vorgangId !== 'string' || !VORGANG_ID_RE.test(eingabe.vorgangId)) {
    return { ok: false, message: 'vorgangId fehlt oder ist ungültig (1–128 Zeichen aus A–Z a–z 0–9 . _ : ~ -)' };
  }
  if (!Array.isArray(eingabe.ops) || eingabe.ops.length === 0) {
    return { ok: false, message: 'ops muss eine nichtleere Liste sein' };
  }
  if (eingabe.ops.length > MAX_OPS_PER_VORGANG) {
    return { ok: false, message: `ops: ${eingabe.ops.length} Operationen — mehr als ${MAX_OPS_PER_VORGANG} nimmt ein Vorgang nicht auf` };
  }
  const ops: Op[] = [];
  for (const [i, roh] of eingabe.ops.entries()) {
    const wo = `ops[${i}]`;
    if (!istObjekt(roh)) return { ok: false, message: `${wo}: kein Objekt` };
    const art = roh.art;
    if (art !== 'setze' && art !== 'aendere' && art !== 'entferne') {
      return { ok: false, message: `${wo}: art muss setze, aendere oder entferne sein` };
    }
    const sammlung = OP_COLLECTIONS.find((s) => s === roh.sammlung);
    if (!sammlung) return { ok: false, message: `${wo}: unbekannte sammlung` };
    const id = roh.id;
    if (typeof id !== 'string' || !ID_RE.test(id)) return { ok: false, message: `${wo}: id fehlt oder ist ungültig` };
    const op: Op = { art, sammlung, id };
    for (const feld of ['vorher', 'nachher'] as const) {
      const eintrag = roh[feld];
      const verlangt = feld === 'vorher' ? art !== 'setze' : art !== 'entferne';
      if (!verlangt) {
        if (eintrag !== undefined && eintrag !== null) return { ok: false, message: `${wo}: ${art} hat kein ${feld}` };
        continue;
      }
      if (!istObjekt(eintrag)) return { ok: false, message: `${wo}: ${art} braucht ${feld} als Objekt` };
      if (eintrag.id !== id) return { ok: false, message: `${wo}: ${feld}.id stimmt nicht mit id "${id}" überein` };
      op[feld] = structuredClone(eintrag) as OpEntry;
    }
    if (roh.index !== undefined && roh.index !== null) {
      if (typeof roh.index !== 'number' || !Number.isInteger(roh.index) || roh.index < 0 || roh.index > INDEX_MAX) {
        return { ok: false, message: `${wo}: index muss eine ganze Zahl von 0 bis ${INDEX_MAX} sein` };
      }
      op.index = roh.index;
    }
    ops.push(op);
  }
  return { ok: true, vorgang: { vorgangId: eingabe.vorgangId, ops } };
}

/**
 * One entry in canonical form: the sanitizer's output for a document that
 * holds only this entry. `null` when the sanitizer drops it (or changes its id).
 */
function kanonisch(sammlung: OpCollection, eintrag: OpEntry, san: LayoutSanitizer): OpEntry | null {
  const klein = san({ version: WORLD_LAYOUT_VERSION, name: 'op', [sammlung]: [eintrag] });
  if (!klein) return null;
  const liste = eintraegeVon(klein, sammlung);
  const e = liste.length === 1 ? liste[0] : undefined;
  return e && e.id === eintrag.id ? e : null;
}

/**
 * Apply a Vorgang to a layout. Returns the new layout, or why not. Nothing
 * is mutated; the input layout is not touched.
 */
export function wende(layout: WorldLayout, eingabe: unknown, san: LayoutSanitizer = sanitizeWorldLayout): WendeErgebnis {
  const geprueft = pruefeVorgang(eingabe);
  if (!geprueft.ok) return { ok: false, art: 'ungueltig', message: geprueft.message };
  const { ops } = geprueft.vorgang;

  // What does not depend on the current state comes first: an entry the
  // sanitizer would drop makes the whole Vorgang invalid (422), whatever the
  // document looks like. `vorher` is different: a `vorher` that is not even
  // a valid entry can never equal the current one, that is a conflict.
  const nachherKanon = new Map<Op, OpEntry>();
  const vorherText = new Map<Op, string | null>();
  for (const [i, op] of ops.entries()) {
    if (op.nachher) {
      const k = kanonisch(op.sammlung, op.nachher, san);
      if (!k) return { ok: false, art: 'ungueltig', message: `ops[${i}]: ${op.sammlung} "${op.id}": nachher ist kein gültiger Eintrag` };
      nachherKanon.set(op, k);
    }
    if (op.vorher) {
      const k = kanonisch(op.sammlung, op.vorher, san);
      vorherText.set(op, k ? JSON.stringify(k) : null);
    }
  }

  // The current state, canonical: a layout that came from anywhere else than
  // the sanitizer is compared as the sanitizer would see it.
  const basis = san(layout);
  if (!basis) return { ok: false, art: 'ungueltig', message: 'Ausgangsdokument ist kein gültiges Weltdokument' };

  const arbeit = new Map<OpCollection, OpEntry[]>();
  const liste = (s: OpCollection): OpEntry[] => {
    let l = arbeit.get(s);
    if (!l) {
      l = [...eintraegeVon(basis, s)];
      arbeit.set(s, l);
    }
    return l;
  };
  const stellen: { sammlung: OpCollection; id: string }[] = [];
  const konflikt = (op: Op): void => {
    if (!stellen.some((s) => s.sammlung === op.sammlung && s.id === op.id)) stellen.push({ sammlung: op.sammlung, id: op.id });
  };

  for (const op of ops) {
    const l = liste(op.sammlung);
    const pos = l.findIndex((e) => e.id === op.id);
    const aktuell = pos >= 0 ? l[pos] : undefined;
    if (op.art === 'setze') {
      if (aktuell) {
        konflikt(op);
        continue;
      }
      l.splice(Math.min(op.index ?? l.length, l.length), 0, nachherKanon.get(op)!);
      continue;
    }
    const soll = vorherText.get(op);
    if (!aktuell || soll === null || soll === undefined || JSON.stringify(aktuell) !== soll) {
      konflikt(op);
      continue;
    }
    if (op.art === 'aendere') l[pos] = nachherKanon.get(op)!;
    else l.splice(pos, 1);
  }
  if (stellen.length > 0) {
    return { ok: false, art: 'konflikt', ids: [...new Set(stellen.map((s) => s.id))], stellen };
  }

  const kandidat: Record<string, unknown> = { ...basis };
  for (const [sammlung, l] of arbeit) {
    const grenze = OP_LIMITS[sammlung];
    if (l.length > grenze) {
      return {
        ok: false,
        art: 'grenze',
        sammlung,
        anzahl: l.length,
        grenze,
        message: `${l.length} ${sammlung} — mehr als ${grenze} nimmt das Weltdokument nicht auf; nichts geändert`,
      };
    }
    kandidat[sammlung] = l;
  }
  const neu = san(kandidat);
  if (!neu) return { ok: false, art: 'ungueltig', message: 'Ergebnis ist kein gültiges Weltdokument' };
  // The sanitizer cuts and drops without a word; a Vorgang must not lose an entry that way.
  for (const [sammlung, l] of arbeit) {
    const behalten = eintraegeVon(neu, sammlung).length;
    if (behalten !== l.length) {
      return {
        ok: false,
        art: 'ungueltig',
        message: `${sammlung}: ${l.length - behalten} von ${l.length} Einträgen würde der Sanitizer verwerfen; nichts geändert`,
      };
    }
  }
  return { ok: true, layout: neu };
}

const UMKEHR_VORSATZ = 'zurueck:';

/**
 * The Vorgang that takes `vorgang` back: the ops in reverse order, each one
 * inverted. `wende(wende(d, v), invertiere(v))` gives `d` back, byte for
 * byte, when every `setze`/`entferne` carries its `index` (the helpers below
 * fill it in). Inverting twice gives the original Vorgang.
 */
export function invertiere(vorgang: Vorgang): Vorgang {
  const vorgangId = vorgang.vorgangId.startsWith(UMKEHR_VORSATZ)
    ? vorgang.vorgangId.slice(UMKEHR_VORSATZ.length)
    : `${UMKEHR_VORSATZ}${vorgang.vorgangId}`.slice(0, 128);
  const ops: Op[] = [];
  for (const op of [...vorgang.ops].reverse()) {
    const kopie = (e: OpEntry | undefined): OpEntry | undefined => (e ? (structuredClone(e) as OpEntry) : undefined);
    const mitIndex = op.index !== undefined ? { index: op.index } : {};
    if (op.art === 'setze') {
      ops.push({ art: 'entferne', sammlung: op.sammlung, id: op.id, vorher: kopie(op.nachher), ...mitIndex });
    } else if (op.art === 'entferne') {
      ops.push({ art: 'setze', sammlung: op.sammlung, id: op.id, nachher: kopie(op.vorher), ...mitIndex });
    } else {
      ops.push({ art: 'aendere', sammlung: op.sammlung, id: op.id, vorher: kopie(op.nachher), nachher: kopie(op.vorher) });
    }
  }
  return { vorgangId, ops };
}

const gleich = (a: OpEntry | undefined, b: OpEntry | undefined): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Fold `b` (which came after `a`) into one Vorgang with the effect of both.
 *
 * Folds only what keeps the meaning EXACT: an op of `b` joins the last op on
 * the same object when that op's result is what the `b` op saw
 * (`nachher` = `vorher`), and
 *  - `aendere` after `setze` / `aendere` becomes one `setze` / `aendere`
 *    (position never changes, always safe);
 *  - `entferne` after `setze` cancels both, `entferne` after `aendere`
 *    becomes one `entferne` — only when no later op touches the same
 *    collection, because the `index` of those would shift.
 * Everything else is appended unchanged, so the result is longer than
 * ideal but never wrong. If everything cancels out, the result has NO ops:
 * a Vorgang without effect, which `wende` refuses like any empty Vorgang —
 * whoever keeps an undo stack drops it.
 */
export function verschmelze(a: Vorgang, b: Vorgang): Vorgang {
  const ops: Op[] = a.ops.map((o) => structuredClone(o));
  for (const o of b.ops) {
    let p = -1;
    for (let i = ops.length - 1; i >= 0; i--) {
      if (ops[i]!.sammlung === o.sammlung && ops[i]!.id === o.id) {
        p = i;
        break;
      }
    }
    const prev = p >= 0 ? ops[p] : undefined;
    if (prev && prev.art !== 'entferne' && o.art !== 'setze' && gleich(prev.nachher, o.vorher)) {
      if (o.art === 'aendere') {
        // Keeps `prev`'s kind, `vorher` and `index`; only the end state moves on.
        ops[p] = { ...prev, nachher: structuredClone(o.nachher) };
        continue;
      }
      // o.art === 'entferne': only as the last op of its collection.
      const letzteDerSammlung = !ops.slice(p + 1).some((x) => x.sammlung === o.sammlung);
      if (letzteDerSammlung) {
        if (prev.art === 'setze') ops.splice(p, 1);
        else ops[p] = { art: 'entferne', sammlung: o.sammlung, id: o.id, vorher: structuredClone(prev.vorher), ...(o.index !== undefined ? { index: o.index } : {}) };
        continue;
      }
    }
    ops.push(structuredClone(o));
  }
  return { vorgangId: a.vorgangId, ops };
}

// ── Builders: fill `vorher` and `index` from the layout the writer sees ──

function stelle(layout: WorldLayout, sammlung: OpCollection, id: string): { eintrag: OpEntry; index: number } | null {
  const liste = eintraegeVon(layout, sammlung);
  const index = liste.findIndex((e) => e.id === id);
  const eintrag = liste[index];
  return eintrag ? { eintrag, index } : null;
}

/** `setze`: put a new entry; at the end of the list unless `index` is given. */
export function opSetzen(sammlung: OpCollection, nachher: OpEntry, index?: number): Op {
  return { art: 'setze', sammlung, id: nachher.id, nachher: structuredClone(nachher), ...(index !== undefined ? { index } : {}) };
}

/** `aendere`: replace the entry that `layout` holds under `nachher.id`. Throws when there is none. */
export function opAendern(layout: WorldLayout, sammlung: OpCollection, nachher: OpEntry): Op {
  const s = stelle(layout, sammlung, nachher.id);
  if (!s) throw new Error(`opAendern: ${sammlung} "${nachher.id}" gibt es im Dokument nicht`);
  return { art: 'aendere', sammlung, id: nachher.id, vorher: structuredClone(s.eintrag), nachher: structuredClone(nachher) };
}

/** `entferne`: delete the entry `layout` holds under `id`, remembering where it stood. Throws when there is none. */
export function opEntfernen(layout: WorldLayout, sammlung: OpCollection, id: string): Op {
  const s = stelle(layout, sammlung, id);
  if (!s) throw new Error(`opEntfernen: ${sammlung} "${id}" gibt es im Dokument nicht`);
  return { art: 'entferne', sammlung, id, vorher: structuredClone(s.eintrag), index: s.index };
}
