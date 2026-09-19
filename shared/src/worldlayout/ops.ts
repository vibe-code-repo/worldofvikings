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
 *  - POSITION. List order matters (region order is the z-order), so an undo
 *    must put an entry back exactly where it was. A position is an ANCHOR:
 *    `nach` = the id of the entry that stood directly in front of this one
 *    (`null` = it was the first). `entferne` records it when the op is built
 *    (`opEntfernen`), `invertiere` hands it to the `setze` that undoes it, and
 *    `wende` puts the entry back right behind that anchor, wherever the anchor
 *    is NOW: a foreign insert at the front or a foreign delete elsewhere does
 *    not shift it. A number would; that was the bug of the first version.
 *  - The anchor may be read from a snapshot or from the running state, both
 *    are right. Building several `entferne` ops from ONE snapshot
 *    (`ids.map(id => opEntfernen(stand, s, id))`) names anchors that an
 *    earlier op of the same Vorgang deletes; building them one after the
 *    other names only anchors that still stand. `wende` therefore places an
 *    entry whose anchor is missing (or itself waiting) provisionally and,
 *    after the last op, moves it right behind its anchor, repeating until
 *    nothing moves. Snapshot and running builds restore the same bytes.
 *  - A position that cannot be established is REPORTED, never guessed
 *    silently: when the anchor is gone for good, or the op names only a
 *    number (`index`, the last known position, used as the fallback), the
 *    entry goes to the clamped number and `wende` lists its id in
 *    `positionUngenau`. The caller sees it; the service passes it on. A
 *    `setze` with neither `nach` nor `index` appends and is exact.
 *  - Neither decides whether an op stands; ids and `vorher` do.
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
  /**
   * Anchor, see the header: the id of the entry directly in front (`null` = first).
   * Absent on `setze` = append. Ignored for `aendere`.
   */
  nach?: string | null;
  /** Last known position (0-based); only the fallback when the anchor is missing. Ignored for `aendere`. */
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
// One optional leading `~` marks an undo Vorgang (see `invertiere`); a client id never carries it,
// so 127 characters plus the mark always fit into 128 and inverting is an exact involution.
const VORGANG_ID_RE = /^~?[A-Za-z0-9._:-]{1,127}$/;
const VORGANG_ID_MAX = 128;
const INDEX_MAX = 1_000_000;

export type WendeErgebnis =
  | {
      ok: true;
      layout: WorldLayout;
      /** Entries whose position could not be established from an anchor (see the header); empty when all are exact. */
      positionUngenau: { sammlung: OpCollection; id: string }[];
    }
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
    return { ok: false, message: 'vorgangId fehlt oder ist ungültig (1–127 Zeichen aus A–Z a–z 0–9 . _ : -, davor höchstens ein ~)' };
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
    if (roh.nach !== undefined) {
      if (roh.nach !== null && (typeof roh.nach !== 'string' || !ID_RE.test(roh.nach))) {
        return { ok: false, message: `${wo}: nach muss eine id oder null sein` };
      }
      if (art !== 'aendere') op.nach = roh.nach;
    }
    if (roh.index !== undefined && roh.index !== null) {
      if (typeof roh.index !== 'number' || !Number.isInteger(roh.index) || roh.index < 0 || roh.index > INDEX_MAX) {
        return { ok: false, message: `${wo}: index muss eine ganze Zahl von 0 bis ${INDEX_MAX} sein` };
      }
      if (art !== 'aendere') op.index = roh.index;
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
  // Entries placed provisionally because their anchor was missing or itself waiting (see the header).
  const offen: { sammlung: OpCollection; id: string; nach: string }[] = [];
  const offenIds = new Set<string>();
  const nurZahl: { sammlung: OpCollection; id: string }[] = [];
  const einfuegen = (l: OpEntry[], eintrag: OpEntry, op: Op): void => {
    if (op.nach === null) {
      l.splice(0, 0, eintrag);
    } else if (typeof op.nach === 'string') {
      const a = l.findIndex((e) => e.id === op.nach);
      if (a >= 0) l.splice(a + 1, 0, eintrag);
      else l.splice(Math.min(op.index ?? l.length, l.length), 0, eintrag);
      if (a < 0 || offenIds.has(op.nach)) {
        offen.push({ sammlung: op.sammlung, id: op.id, nach: op.nach });
        offenIds.add(op.id);
      }
    } else if (op.index !== undefined) {
      l.splice(Math.min(op.index, l.length), 0, eintrag);
      nurZahl.push({ sammlung: op.sammlung, id: op.id });
    } else {
      l.push(eintrag);
    }
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
      einfuegen(l, nachherKanon.get(op)!, op);
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

  // Move every waiting entry right behind its anchor; repeat, because an anchor may move too.
  for (let durchgang = 0; durchgang < 2 * offen.length + 2; durchgang++) {
    let bewegt = false;
    for (const o of offen) {
      const l = arbeit.get(o.sammlung)!;
      const a = l.findIndex((e) => e.id === o.nach);
      const i = l.findIndex((e) => e.id === o.id);
      if (a < 0 || i < 0 || i === a + 1) continue;
      const [e] = l.splice(i, 1);
      l.splice(l.findIndex((x) => x.id === o.nach) + 1, 0, e!);
      bewegt = true;
    }
    if (!bewegt) break;
  }
  const positionUngenau = [...nurZahl];
  for (const o of offen) {
    const l = arbeit.get(o.sammlung)!;
    const a = l.findIndex((e) => e.id === o.nach);
    const i = l.findIndex((e) => e.id === o.id);
    if (i >= 0 && a + 1 !== i) positionUngenau.push({ sammlung: o.sammlung, id: o.id });
  }
  // An entry that a later op of the same Vorgang deleted again has no position to report.
  const uebrig = positionUngenau.filter((p) => arbeit.get(p.sammlung)!.some((e) => e.id === p.id));

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
  return { ok: true, layout: neu, positionUngenau: uebrig };
}

/** The mark of an undo Vorgang in `vorgangId`; see VORGANG_ID_RE. */
const UMKEHR_MARKE = '~';

/**
 * The Vorgang that takes `vorgang` back: the ops in reverse order, each one
 * inverted. `wende(wende(d, v), invertiere(v))` gives `d` back, byte for
 * byte, when every `entferne` carries its anchor (`opEntfernen` fills it in),
 * whether the ops were built from one snapshot or one after the other; see
 * POSITION in the header. Inverting twice gives the original Vorgang, `vorgangId`
 * included: the id of an undo Vorgang is the original with a leading `~`
 * (or without it, when the original already has one).
 */
export function invertiere(vorgang: Vorgang): Vorgang {
  const vorgangId = vorgang.vorgangId.startsWith(UMKEHR_MARKE)
    ? vorgang.vorgangId.slice(UMKEHR_MARKE.length)
    : `${UMKEHR_MARKE}${vorgang.vorgangId}`;
  if (vorgangId.length > VORGANG_ID_MAX) throw new Error(`invertiere: vorgangId "${vorgang.vorgangId.slice(0, 20)}…" ist zu lang`);
  const ops: Op[] = [];
  for (const op of [...vorgang.ops].reverse()) {
    const kopie = (e: OpEntry | undefined): OpEntry | undefined => (e ? (structuredClone(e) as OpEntry) : undefined);
    const position = {
      ...(op.nach !== undefined ? { nach: op.nach } : {}),
      ...(op.index !== undefined ? { index: op.index } : {}),
    };
    if (op.art === 'setze') {
      ops.push({ art: 'entferne', sammlung: op.sammlung, id: op.id, vorher: kopie(op.nachher), ...position });
    } else if (op.art === 'entferne') {
      ops.push({ art: 'setze', sammlung: op.sammlung, id: op.id, nachher: kopie(op.vorher), ...position });
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
 *    collection, because the anchors of those could name the entry that goes.
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
        else {
          ops[p] = {
            art: 'entferne',
            sammlung: o.sammlung,
            id: o.id,
            vorher: structuredClone(prev.vorher),
            ...(o.nach !== undefined ? { nach: o.nach } : {}),
            ...(o.index !== undefined ? { index: o.index } : {}),
          };
        }
        continue;
      }
    }
    ops.push(structuredClone(o));
  }
  return { vorgangId: a.vorgangId, ops };
}

// ── Builders: fill `vorher` and the position from the layout the writer sees ──
// The layout may be a snapshot from before the Vorgang or the state after the
// ops built so far; both restore exactly (see POSITION in the header).

function stelle(layout: WorldLayout, sammlung: OpCollection, id: string): { eintrag: OpEntry; index: number; nach: string | null } | null {
  const liste = eintraegeVon(layout, sammlung);
  const index = liste.findIndex((e) => e.id === id);
  const eintrag = liste[index];
  return eintrag ? { eintrag, index, nach: index === 0 ? null : liste[index - 1]!.id } : null;
}

/** `setze`: put a new entry at the END of the list (exact, needs no anchor). */
export function opSetzen(sammlung: OpCollection, nachher: OpEntry): Op {
  return { art: 'setze', sammlung, id: nachher.id, nachher: structuredClone(nachher) };
}

/**
 * `setze` at a position: the entry goes in at `index` of `layout` and the op
 * names its predecessor there as the anchor (`null` = first). An `index` past
 * the end appends.
 */
export function opEinfuegen(layout: WorldLayout, sammlung: OpCollection, nachher: OpEntry, index: number): Op {
  const liste = eintraegeVon(layout, sammlung);
  const i = Math.max(0, Math.min(index, liste.length));
  return { ...opSetzen(sammlung, nachher), nach: i === 0 ? null : liste[i - 1]!.id, index: i };
}

/** `aendere`: replace the entry that `layout` holds under `nachher.id`. Throws when there is none. */
export function opAendern(layout: WorldLayout, sammlung: OpCollection, nachher: OpEntry): Op {
  const s = stelle(layout, sammlung, nachher.id);
  if (!s) throw new Error(`opAendern: ${sammlung} "${nachher.id}" gibt es im Dokument nicht`);
  return { art: 'aendere', sammlung, id: nachher.id, vorher: structuredClone(s.eintrag), nachher: structuredClone(nachher) };
}

/** `entferne`: delete the entry `layout` holds under `id`, remembering its predecessor. Throws when there is none. */
export function opEntfernen(layout: WorldLayout, sammlung: OpCollection, id: string): Op {
  const s = stelle(layout, sammlung, id);
  if (!s) throw new Error(`opEntfernen: ${sammlung} "${id}" gibt es im Dokument nicht`);
  return { art: 'entferne', sammlung, id, vorher: structuredClone(s.eintrag), nach: s.nach, index: s.index };
}
