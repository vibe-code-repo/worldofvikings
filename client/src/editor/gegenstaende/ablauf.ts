/**
 * Item mask (Editor card EG2, N1): the DOM-free flow around saving. Three things the page must get right and
 * a test must be able to reach without a browser:
 *  - when the save button is locked, and why (`speicherSperre`): while loading, while saving, while a conflict
 *    waits for the author's choice, and while the form has errors;
 *  - that nothing from the dialog or the network escapes as an unhandled rejection (`speichereGefangen`,
 *    `ladeGefangen`);
 *  - what a reload means for the entry being edited (`pruefeKonflikt`): the server changed THIS entry while the
 *    author edited it, so neither version may win silently (`unterschiede` lists both).
 * Gegenstands-Maske (EG2 N1): DOM-freier Ablauf ums Speichern: Sperre des Knopfs, gefangene Fehler, Konflikt.
 */
import { ID_MUSTER, type GegenstandsEintrag } from '@wov/shared/src/items/gegenstandsDaten.js';
import { STAT_IDS } from '@wov/shared/src/items/stats.js';
import { ladeStand, speichernMitBestaetigung, type ApiOptionen, type LadeErgebnis, type SpeicherAblauf, type Stand } from './api';
import { abhaengige, eintragZuFormular, ohneEintrag, type Formular } from './modell';
import type { BestaetigungInfo } from './texte';

// ── Save button ────────────────────────────────────────────────────────

export type SpeicherSperre = 'laedt' | 'speichert' | 'konflikt' | 'fehler';

/** Why the save button is locked, or null when it may be pressed. Loading comes first: the button then says "loading". */
export function speicherSperre(z: { laedt: boolean; speichert: boolean; konflikt: boolean; fehlerAnzahl: number }): SpeicherSperre | null {
  if (z.laedt) return 'laedt';
  if (z.speichert) return 'speichert';
  if (z.konflikt) return 'konflikt';
  if (z.fehlerAnzahl > 0) return 'fehler';
  return null;
}

// ── One state, one hash ────────────────────────────────────────────────

/**
 * The list a PUT is built from, and the hash of the very state it came from, frozen together. A PUT sends
 * `hash` of the snapshot and never the hash of a state loaded later: if the file changed in between, the route
 * answers 412 instead of overwriting the other author's entries with an old list.
 */
export interface Schnappschuss {
  readonly eintraege: readonly GegenstandsEintrag[];
  readonly hash: string;
}

export function schnappschuss(stand: Pick<Stand, 'eintraege' | 'hash'>): Schnappschuss {
  return Object.freeze({ eintraege: Object.freeze([...stand.eintraege]), hash: stand.hash });
}

/** Saves `liste` (built from `s.eintraege`) with the hash of `s`. */
export function speichereSchnappschuss(
  o: ApiOptionen,
  s: Schnappschuss,
  liste: readonly GegenstandsEintrag[],
  frage: (info: BestaetigungInfo) => Promise<boolean>
): Promise<SpeicherAblauf | Ausnahme> {
  return speichereGefangen(o, liste, s.hash, frage);
}

/** The author said no to the dependents dialog: nothing was sent. */
export interface DialogNein {
  art: 'dialog-nein';
}

/**
 * Removes `id`. The snapshot is taken when the flow starts, BEFORE the dependents dialog; list and hash come from it
 * and from nothing that is loaded while the dialog is open. `bestaetige` gets the ids that would go with it.
 */
export async function entferneGegenstand(
  o: ApiOptionen,
  holeStand: () => Pick<Stand, 'eintraege' | 'hash'> | null,
  id: string,
  bestaetige: (abhaengigeIds: string[]) => Promise<boolean>,
  frage: (info: BestaetigungInfo) => Promise<boolean>
): Promise<SpeicherAblauf | Ausnahme | DialogNein> {
  try {
    const stand = holeStand();
    if (stand === null) return { art: 'ausnahme' };
    const s = schnappschuss(stand);
    const abh = abhaengige(s.eintraege, id);
    let liste = ohneEintrag(s.eintraege, id);
    if (abh.length > 0) {
      if (!(await bestaetige(abh))) return { art: 'dialog-nein' };
      liste = liste.filter((e) => !abh.includes(e.id));
    }
    return await speichereSchnappschuss(o, s, liste, frage);
  } catch {
    return { art: 'ausnahme' };
  }
}

// ── Nothing escapes ────────────────────────────────────────────────────

/** Something threw inside the save or load call (the dialog, the network layer): a result, never a rejection. */
export interface Ausnahme {
  art: 'ausnahme';
}

/**
 * `speichernMitBestaetigung`, but a throw (from `frage` or from anywhere below) becomes `{art: 'ausnahme'}`.
 * A throw inside `frage` is not an answer: the confirmed PUT is NOT sent.
 */
export async function speichereGefangen(
  o: ApiOptionen,
  eintraege: readonly GegenstandsEintrag[],
  hash: string,
  frage: (info: BestaetigungInfo) => Promise<boolean>
): Promise<SpeicherAblauf | Ausnahme> {
  try {
    return await speichernMitBestaetigung(o, eintraege, hash, frage);
  } catch {
    return { art: 'ausnahme' };
  }
}

export async function ladeGefangen(o: ApiOptionen): Promise<LadeErgebnis | Ausnahme> {
  try {
    return await ladeStand(o);
  } catch {
    return { art: 'ausnahme' };
  }
}

// ── Conflict after a reload ────────────────────────────────────────────

export interface Unterschied {
  /** A field id of the mask (`nameDe`, `wert.damage`, `rezept` ...). */
  feld: string;
  eigen: string;
  server: string;
}

export type KonfliktErgebnis =
  | { art: 'keiner' }
  /** The author has nothing of their own in the form (or it equals the server's): take the server's version, nothing is lost. */
  | { art: 'uebernehmen'; server: GegenstandsEintrag | null }
  /** Both sides changed this entry: the author chooses. `server` null = the entry is gone on the server. */
  | { art: 'konflikt'; server: GegenstandsEintrag | null; unterschiede: Unterschied[] };

const vektorText = (v: readonly string[]): string => (v.every((x) => x.trim() === '') ? '' : v.join(', '));

/** The form as a flat list of `field id -> shown value`. */
export function flach(f: Formular): Record<string, string> {
  const aus: Record<string, string> = {
    id: f.id,
    nameDe: f.nameDe,
    nameEn: f.nameEn,
    beschreibungDe: f.beschreibungDe,
    beschreibungEn: f.beschreibungEn,
    typ: f.typ,
    upload: f.upload,
    skala: f.skala,
    haltePosition: vektorText(f.haltePosition),
    halteRotation: vektorText(f.halteRotation),
    hiebVersatz: f.hiebVersatz,
    animationsSatz: f.animationsSatz,
    symbol: f.symbol,
    stapel: f.stapel,
    gewicht: f.gewicht,
  };
  for (const s of STAT_IDS) aus[`wert.${s}`] = f.werte[s];
  aus.ernteBaum = f.ernteBaum;
  aus.ernteFels = f.ernteFels;
  aus.haltbarkeitMax = f.haltbarkeitMax;
  aus.haltbarkeitVerbrauch = f.haltbarkeitVerbrauch;
  aus.haltbarkeitAusdauer = f.haltbarkeitAusdauer;
  aus.itemLevel = f.itemLevel;
  aus.rarity = f.rarity;
  aus.rezept = f.hatRezept ? `${f.rezeptMenge}: ${f.zutaten.map((z) => `${z.menge} ${z.item}`).join(', ')}` : '';
  return aus;
}

/** The fields in which the two forms differ, in form order. */
export function unterschiede(eigen: Formular, server: Formular): Unterschied[] {
  const a = flach(eigen);
  const b = flach(server);
  return Object.keys(a)
    .filter((feld) => a[feld] !== b[feld])
    .map((feld) => ({ feld, eigen: a[feld], server: b[feld] }));
}

/** What a form says, without what only says where it came from (new / saved, text keys). */
const inhalt = (f: Formular): string => JSON.stringify({ ...f, neu: false, nameSchluessel: null, beschreibungSchluessel: null });

/**
 * The reload brought a new state of the file. Did it change the entry the author is editing?
 *  - `basis`: the saved version of the entry when the form was opened (null for a new entry);
 *  - `ausgewaehlt`: id of the saved entry being edited, null for a new one (then `form.id` is its id);
 *  - `entwurfGeaendert`: the form differs from what was opened.
 * Other entries changing is not a conflict: a save writes the whole file with the new state, so they stay.
 */
export function pruefeKonflikt(a: {
  basis: GegenstandsEintrag | null;
  form: Formular;
  ausgewaehlt: string | null;
  entwurfGeaendert: boolean;
  neuerStand: readonly GegenstandsEintrag[];
}): KonfliktErgebnis {
  const id = a.ausgewaehlt ?? (ID_MUSTER.test(a.form.id) ? a.form.id : null);
  if (id === null) return { art: 'keiner' };
  const server = a.neuerStand.find((e) => e.id === id) ?? null;
  if (a.basis === null) {
    // A new entry: it only clashes when someone else made the same id in the meantime.
    if (server === null) return { art: 'keiner' };
  } else if (server !== null && JSON.stringify(server) === JSON.stringify(a.basis)) {
    return { art: 'keiner' };
  }
  const serverForm = server === null ? null : eintragZuFormular(server);
  if (!a.entwurfGeaendert || (serverForm !== null && inhalt(serverForm) === inhalt(a.form))) return { art: 'uebernehmen', server };
  return { art: 'konflikt', server, unterschiede: serverForm === null ? [] : unterschiede(a.form, serverForm) };
}
