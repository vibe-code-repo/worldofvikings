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
import { abhaengige, eintragZuFormular, istListe, istUnveraendert, keineVereinheitlichung, ohneEintrag, type Formular, type Vereinheitlichung } from './modell';
import type { Anzeigetext } from './anzeige';
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

/**
 * What the author has to know before the first save of a loaded file: the save writes the canonical text of the WHOLE
 * list. `vereinheitlicht` = what that text changes in the file as loaded (`vereinheitlichung`); `verworfeneInDatei` =
 * every entry of the file the reader discarded (the save drops them all, whichever entry is saved); `ueberschreibt` =
 * the part of those whose id the saved entry carries (the save replaces that raw entry).
 */
export interface Vorwarnung {
  vereinheitlicht: Vereinheitlichung;
  verworfeneInDatei: Array<{ index: number; id: string | null; grund: string }>;
  ueberschreibt: Array<{ index: number; id: string | null; grund: string }>;
}

/** True if there is anything to ask about. */
export const hatVorwarnung = (w: Vorwarnung): boolean => !istUnveraendert(w.vereinheitlicht) || w.verworfeneInDatei.length > 0 || w.ueberschreibt.length > 0;

/**
 * The warning for saving the entry `id` (null: a removal, which writes the file too but saves no entry) into a list
 * loaded as `stand`.
 */
export function vorwarnungVon(stand: Pick<Stand, 'vereinheitlicht' | 'verworfen'>, id: string | null): Vorwarnung {
  return { vereinheitlicht: stand.vereinheitlicht, verworfeneInDatei: [...stand.verworfen], ueberschreibt: id === null ? [] : stand.verworfen.filter((v) => v.id === id) };
}

/**
 * Whether to ask before saving into `stand`, and what the "yes" is remembered as. The question is asked ONCE per loaded
 * state (key: its hash): after a "yes" for this very state, the unifying and the dropped entries are not asked again
 * (they are the same ones); the overwrite of a discarded id (`ueberschreibt`) is asked every time. After a "no" or a
 * throw nothing is remembered (the caller only stores `merkerNachJa` on a yes), so the next save asks again.
 */
export function brauchtVorwarnung(
  merker: string | null,
  stand: Pick<Stand, 'hash' | 'vereinheitlicht' | 'verworfen'>,
  id: string | null
): { fragen: boolean; warnung: Vorwarnung; merkerNachJa: string } {
  const w = vorwarnungVon(stand, id);
  const warnung: Vorwarnung = merker === stand.hash ? { ...w, vereinheitlicht: keineVereinheitlichung(), verworfeneInDatei: [] } : w;
  return { fragen: hatVorwarnung(warnung), warnung, merkerNachJa: stand.hash };
}

/**
 * The `VorabFrage` of one save: `merker` is what the page remembered (the hash of the state the author said yes for),
 * `setzeMerker` stores a new one, `dialog` shows the question. The merker is stored only after a "yes".
 */
export function vorabFuer(a: {
  merker: string | null;
  setzeMerker: (hash: string) => void;
  stand: Pick<Stand, 'hash' | 'vereinheitlicht' | 'verworfen'>;
  id: string | null;
  dialog: (w: Vorwarnung) => Promise<boolean>;
}): VorabFrage {
  const b = brauchtVorwarnung(a.merker, a.stand, a.id);
  return {
    warnung: b.warnung,
    frage: async (warnung) => {
      const ja = await a.dialog(warnung);
      if (ja) a.setzeMerker(b.merkerNachJa);
      return ja;
    },
  };
}

/** The question before the first save: `true` = go on. Without a yes nothing is sent. */
export interface VorabFrage {
  warnung: Vorwarnung;
  frage: (w: Vorwarnung) => Promise<boolean>;
}

/**
 * Saves `liste` (built from `s.eintraege`) with the hash of `s`. With `vorab` and something to warn about, the
 * author is asked FIRST: "no" (or a throw) sends nothing at all (`dialog-nein` / `ausnahme`).
 */
export async function speichereSchnappschuss(
  o: ApiOptionen,
  s: Schnappschuss,
  liste: readonly GegenstandsEintrag[],
  frage: (info: BestaetigungInfo) => Promise<boolean>,
  vorab?: VorabFrage
): Promise<SpeicherAblauf | Ausnahme | DialogNein> {
  if (vorab !== undefined && hatVorwarnung(vorab.warnung)) {
    try {
      if (!(await vorab.frage(vorab.warnung))) return { art: 'dialog-nein' };
    } catch {
      return { art: 'ausnahme' };
    }
  }
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
  frage: (info: BestaetigungInfo) => Promise<boolean>,
  vorab?: VorabFrage
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
    return await speichereSchnappschuss(o, s, liste, frage, vorab);
  } catch {
    return { art: 'ausnahme' };
  }
}

// ── The newest load wins ───────────────────────────────────────────────

/**
 * Two loads must not overtake each other: an answer that arrives after a newer load was started is stale and is
 * dropped (`null`). Every load of the page goes through one `juengsteAntwort()`.
 */
export function juengsteAntwort(): (lauf: () => Promise<LadeErgebnis | Ausnahme>) => Promise<LadeErgebnis | Ausnahme | null> {
  let zaehler = 0;
  return async (lauf) => {
    const nr = ++zaehler;
    const erg = await lauf();
    return nr === zaehler ? erg : null;
  };
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
   * gone), `uebernommen` names those fields: "keep mine" continues with `zusammen`. `formBeiAnzeige` is a copy of the
   * draft as it was when the conflict was found (what "keep mine" compares the live form with).
   */
  | { art: 'konflikt'; server: GegenstandsEintrag | null; unterschiede: Unterschied[]; zusammen: Formular | null; uebernommen: string[]; formBeiAnzeige: Formular };

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

/** The text keys of the entry are fields of the three-way comparison too (a hand-edited file may change them), but not of the mask. */
const mitSchluesseln = (f: Formular): Record<string, string> => ({ ...flach(f), nameSchluessel: f.nameSchluessel ?? '', beschreibungSchluessel: f.beschreibungSchluessel ?? '' });

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
  if (server === null || serverForm === null) return { art: 'konflikt', server: null, unterschiede: entwurfZeilen(a.form), zusammen: null, uebernommen: [], formBeiAnzeige: structuredClone(a.form) };
  if (a.basis === null) return { art: 'konflikt', server, unterschiede: unterschiede(a.form, serverForm), zusammen: a.form, uebernommen: [], formBeiAnzeige: structuredClone(a.form) };
  const ausgang = mitSchluesseln(eintragZuFormular(a.basis));
  const eigen = mitSchluesseln(a.form);
  const vomServer = mitSchluesseln(serverForm);
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
  return { art: 'konflikt', server, unterschiede: streit, zusammen, uebernommen, formBeiAnzeige: structuredClone(a.form) };
}

// ── The banner after a failed reload ───────────────────────────────────

/**
 * What the banner shows when a reload FAILED. If a conflict is open it stays: its lines and the two choices are shown
 * again under the error line, so the buttons never vanish while saving is still locked by the conflict (`wahlknoepfe`).
 */
export function ladefehlerBanner(a: { fehlerText: Anzeigetext; konflikt: Extract<KonfliktErgebnis, { art: 'konflikt' }> | null }, uebersetze?: Uebersetzer): { zeilen: Anzeigetext[]; wahlknoepfe: boolean } {
  if (a.konflikt === null) return { zeilen: [a.fehlerText], wahlknoepfe: false };
  const inhaltK = konfliktInhalt(a.konflikt, uebersetze);
  return { zeilen: [a.fehlerText, inhaltK.titel, ...inhaltK.zeilen, ...(inhaltK.weitere === null ? [] : [inhaltK.weitere])], wahlknoepfe: true };
}

// ── "Keep mine" ────────────────────────────────────────────────────────

export type OffenerKonflikt = Extract<KonfliktErgebnis, { art: 'konflikt' }>;

/** What "keep mine" does once the comparison is run again against the LIVE form. */
export type EigeneBehalten =
  /** Carry on with `form` (the draft, with the server's changes to the fields the author did not touch). `server` null: the entry is gone, the draft stays as a new entry. */
  | { art: 'weiter'; form: Formular; server: GegenstandsEintrag | null }
  /** The author's edits since the conflict was shown opened a dispute over a field not shown before: show the conflict again, decide nothing. */
  | { art: 'neu'; konflikt: OffenerKonflikt };

/**
 * "Keep mine" was pressed. The form stays editable while a conflict is open, so the author may have typed since it was
 * shown; the result is therefore computed NOW: base = the state the form was opened from (`basis`), server = the state
 * the conflict was found against (`konflikt.server`), draft = `form` as it is at this moment, not the copy made when the
 * conflict was found. If that leaves a field in dispute that was not in the shown conflict, the author has not seen it:
 * `neu`, the mask shows the conflict again. A dispute that only got smaller (the author settled a field by editing it)
 * needs no second look: they pressed "keep mine" for the rest.
 * "Keep mine" means the author's value for every field in the shown dispute AND for every field the author changed
 * since it was shown (live form against `konflikt.formBeiAnzeige`), even if the value typed equals the original.
 * Every other field, i.e. one the author has not touched since the conflict was shown and that was not in the shown
 * dispute, stays a three-way merge (base, draft, server), where a field whose draft value equals the base takes the
 * server's value.
 */
export function eigeneBehaltenAbgleich(a: { basis: GegenstandsEintrag | null; form: Formular; ausgewaehlt: string | null; konflikt: OffenerKonflikt }): EigeneBehalten {
  const server = a.konflikt.server;
  if (server === null) return { art: 'weiter', form: a.form, server: null };
  const gezeigt = new Set(a.konflikt.unterschiede.map((u) => u.feld));
  const jetzt = mitSchluesseln(a.form);
  const damals = mitSchluesseln(a.konflikt.formBeiAnzeige);
  const eigeneFelder = Object.keys(jetzt).filter((feld) => gezeigt.has(feld) || jetzt[feld] !== damals[feld]);
  const mitEigenen = (f: Formular): Formular => {
    const aus = structuredClone(f);
    for (const feld of eigeneFelder) kopiereFeld(aus, a.form, feld);
    return aus;
  };
  const r = pruefeKonflikt({ basis: a.basis, form: a.form, ausgewaehlt: a.ausgewaehlt, entwurfGeaendert: true, neuerStand: [server] });
  if (r.art === 'zusammen') return { art: 'weiter', form: mitEigenen(r.form), server };
  if (r.art !== 'konflikt') return { art: 'weiter', form: a.form, server };
  if (r.unterschiede.every((u) => gezeigt.has(u.feld))) return { art: 'weiter', form: mitEigenen(r.zusammen ?? a.form), server };
  return { art: 'neu', konflikt: r };
}

// ── After a save ───────────────────────────────────────────────────────

/** The form in one canonical string (keys sorted), to tell "unchanged since the save started" from "edited meanwhile". */
export function kanonisch(f: Formular | null): string {
  const sortiert = (v: unknown): unknown =>
    istListe(v) ? v.map(sortiert) : v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([k, w]) => [k, sortiert(w)])) : v;
  return JSON.stringify(sortiert(f));
}

/**
 * What the page does with the form after a save went through and the state was reloaded.
 *  - `ersetzen`: the form is exactly what was saved (nothing typed meanwhile): it becomes the server's saved entry.
 *  - `behalten`: the author kept typing (or chose another entry) while the save ran: the draft stays. `weiter` says what
 *    the draft is now: still the entry that was just saved (`ausgewaehlt`/`basis` follow it, `neu` false) or, after a
 *    removal, a new entry (`ausgewaehlt` null); `null` = another entry is open, nothing about it changes. `offen`: unsaved edits are open (false when no form is open).
 */
export type NachSpeichern =
  | { art: 'ersetzen' }
  | { art: 'behalten'; weiter: { ausgewaehlt: string | null; basis: GegenstandsEintrag | null; neu: boolean } | null; offen: boolean };

export function entscheideNachSpeichern(a: {
  /** `kanonisch` of the form when the save started. */
  formVorher: string;
  idVorher: string;
  ausgewaehltVorher: string | null;
  /** The form now; null when none is open (then nothing is unsaved: `ersetzen`). */
  formJetzt: Formular | null;
  ausgewaehltJetzt: string | null;
  /** Id of the entry just saved (null after a removal). */
  gespeicherteId: string | null;
  /** The reloaded entry of `gespeicherteId`, null if it is not in the file. */
  server: GegenstandsEintrag | null;
}): NachSpeichern {
  if (a.formJetzt === null) return { art: 'behalten', weiter: null, offen: false }; // no form is open: there are no unsaved edits to report
  if (kanonisch(a.formJetzt) === a.formVorher) return { art: 'ersetzen' };
  const gleicherEintrag = a.ausgewaehltJetzt === a.ausgewaehltVorher && a.formJetzt.id === a.idVorher;
  if (!gleicherEintrag) return { art: 'behalten', weiter: null, offen: true };
  if (a.gespeicherteId !== null && a.server !== null) return { art: 'behalten', weiter: { ausgewaehlt: a.gespeicherteId, basis: a.server, neu: false }, offen: true };
  return { art: 'behalten', weiter: { ausgewaehlt: null, basis: null, neu: true }, offen: true };
}
