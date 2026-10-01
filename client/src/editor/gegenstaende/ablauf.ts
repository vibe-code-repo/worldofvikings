/**
 * Item mask (Editor card EG2, N1): the DOM-free flow around saving. Three things the page must get right and
 * a test must be able to reach without a browser:
 *  - when the save button is locked, and why (`speicherSperre`): while loading, while saving, while a conflict
 *    waits for the author's choice, and while the form has errors;
 *  - that nothing from the dialog or the network escapes as an unhandled rejection (`speichereGefangen`,
 *    `ladeGefangen`);
 *  - what a reload means for the entry being edited (`pruefeKonflikt`): the server changed THIS entry while the
 *    author edited it. A three-way merge per field decides: a field only the server changed is taken, a field only
 *    the draft changed is kept, a field both changed (differently) is the author's choice, so neither version
 *    wins silently (`unterschiede` lists both).
 * Gegenstands-Maske (EG2 N1): DOM-freier Ablauf ums Speichern: Sperre des Knopfs, gefangene Fehler, Konflikt.
 */
import { ID_MUSTER, type GegenstandsEintrag } from '@wov/shared/src/items/gegenstandsDaten.js';
import { STAT_IDS } from '@wov/shared/src/items/stats.js';
import { ladeStand, speichernMitBestaetigung, type ApiOptionen, type LadeErgebnis, type SpeicherAblauf, type Stand } from './api';
import { abhaengige, eintragZuFormular, ohneEintrag, type Formular } from './modell';
import { konfliktInhalt, type BestaetigungInfo, type Uebersetzer } from './texte';

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
  /**
   * Both sides changed the entry, but never the same field: `form` is the draft with the server's changes in; no choice
   * is needed. `uebernommen` lists the fields taken from the server.
   */
  | { art: 'zusammen'; server: GegenstandsEintrag; form: Formular; uebernommen: string[] }
  /**
   * Both sides changed at least one field (differently), or the entry is gone on the server (`server` null): the author
   * chooses. `unterschiede` lists only the fields in dispute (for a removed entry: the draft's fields, as the new entry
   * it would become). `zusammen` is the draft with the server's changes to the OTHER fields in (null if the entry is
   * gone), `uebernommen` names those fields: "keep mine" continues with `zusammen`.
   */
  | { art: 'konflikt'; server: GegenstandsEintrag | null; unterschiede: Unterschied[]; zusammen: Formular | null; uebernommen: string[] };

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

/** Copies ONE field (a key of `flach`) from `quelle` into `ziel`; a field that is several properties of the form copies all of them. */
export function kopiereFeld(ziel: Formular, quelle: Formular, feld: string): void {
  if (feld === 'id') return;
  if (feld === 'haltePosition' || feld === 'halteRotation') ziel[feld] = [...quelle[feld]];
  else if (feld.startsWith('wert.')) {
    const stat = feld.slice('wert.'.length) as keyof Formular['werte'];
    ziel.werte[stat] = quelle.werte[stat];
  } else if (feld === 'rezept') {
    ziel.hatRezept = quelle.hatRezept;
    ziel.rezeptMenge = quelle.rezeptMenge;
    ziel.zutaten = quelle.zutaten.map((z) => ({ ...z }));
  } else (ziel as unknown as Record<string, unknown>)[feld] = (quelle as unknown as Record<string, unknown>)[feld];
}

/** The draft's fields that say anything (empty ones left out), as the rows of an entry the server has removed. */
function entwurfZeilen(eigen: Formular): Unterschied[] {
  return Object.entries(flach(eigen))
    .filter(([feld, wert]) => feld === 'id' || wert !== '')
    .map(([feld, wert]) => ({ feld, eigen: wert, server: '' }));
}

/**
 * The reload brought a new state of the file. Did it change the entry the author is editing?
 *  - `basis`: the saved version of the entry when the form was opened (null for a new entry);
 *  - `ausgewaehlt`: id of the saved entry being edited, null for a new one (then `form.id` is its id);
 *  - `entwurfGeaendert`: the form differs from what was opened.
 * Other entries changing is not a conflict: a save writes the whole file with the new state, so they stay.
 * For THIS entry the check is a three-way comparison per field against `basis` (what the draft was made from):
 *  - only the server changed the field: the server's value goes into the draft;
 *  - only the draft changed it (or both changed it to the same value): the draft's value stays;
 *  - both changed it, to different values: a conflict line, the author chooses.
 * A new entry has no basis: every field that differs is in dispute.
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
  if (server === null || serverForm === null) return { art: 'konflikt', server: null, unterschiede: entwurfZeilen(a.form), zusammen: null, uebernommen: [] };
  if (a.basis === null) return { art: 'konflikt', server, unterschiede: unterschiede(a.form, serverForm), zusammen: a.form, uebernommen: [] };
  const ausgang = flach(eintragZuFormular(a.basis));
  const eigen = flach(a.form);
  const vomServer = flach(serverForm);
  const streit: Unterschied[] = [];
  const uebernommen: string[] = [];
  const zusammen: Formular = structuredClone(a.form);
  for (const feld of Object.keys(eigen)) {
    if (eigen[feld] === vomServer[feld] || vomServer[feld] === ausgang[feld]) continue; // the same, or only the draft changed it
    if (eigen[feld] === ausgang[feld]) {
      kopiereFeld(zusammen, serverForm, feld); // only the server changed it
      uebernommen.push(feld);
    } else streit.push({ feld, eigen: eigen[feld], server: vomServer[feld] });
  }
  if (streit.length === 0) return { art: 'zusammen', server, form: zusammen, uebernommen };
  return { art: 'konflikt', server, unterschiede: streit, zusammen, uebernommen };
}

// ── The banner after a failed reload ───────────────────────────────────

/**
 * What the banner shows when a reload FAILED. If a conflict is open it stays: its lines and the two choices are shown
 * again under the error line, so the buttons never vanish while saving is still locked by the conflict (`wahlknoepfe`).
 */
export function ladefehlerBanner(a: { fehlerText: string; konflikt: Extract<KonfliktErgebnis, { art: 'konflikt' }> | null }, uebersetze?: Uebersetzer): { zeilen: string[]; wahlknoepfe: boolean } {
  if (a.konflikt === null) return { zeilen: [a.fehlerText], wahlknoepfe: false };
  const inhaltK = konfliktInhalt(a.konflikt, uebersetze);
  return { zeilen: [a.fehlerText, inhaltK.titel, ...inhaltK.zeilen, ...(inhaltK.weitere === null ? [] : [inhaltK.weitere])], wahlknoepfe: true };
}
