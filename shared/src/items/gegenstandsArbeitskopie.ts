/**
 * Paths of the item data file: the accepted repo state and the working copy (Node only).
 * Pfade der Gegenstandsdatei: abgenommener Repo-Stand und Arbeitskopie (nur Node).
 *
 * The working copy lives in the SAME folder as the world working copy (`weltArbeitsOrdner`: the
 * environment variable `WOV_WELT_VERZEICHNIS`, else `<root>/server/data/welten-arbeit`), under a fixed
 * file name. The game server and the admin route both call these functions; there is no second path rule
 * and no path ever comes from a request.
 *
 * Not exported through shared/src/index.ts: the barrel goes into the client bundle, and this file needs
 * `node:path` (same reason as instanz.ts).
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { weltArbeitsOrdner } from '../instanz.js';
import { layoutHash, layoutSichern, layoutUnterSperre } from '../worldlayout/layoutDatei.js';
import { ernteFehlt as ernteFehltRoh, ernteWirdGeerbt, leseGegenstandsDatei, mitGeerbterErnte, schreibeGegenstandsDatei, type GegenstandsEintrag } from './gegenstandsDaten.js';

/** Fixed file names. The data are the same for every instance, so no instance name in them. */
export const GEGENSTAENDE_DATEI = 'gegenstaende.json';
export const GEGENSTAENDE_BASIS_DATEI = 'gegenstaende.basis';
/** The receipt the game server's watch writes next to the working copy (read by the admin route). */
export const GEGENSTAENDE_QUITTUNG_DATEI = 'gegenstaende.quittung.json';
/** The confirmation request (`{hash, zeit, id}`, same form as `POST /api/welt/bestaetigen`) the admin route leaves next to the working copy; the watch consumes it. */
export const GEGENSTAENDE_BESTAETIGEN_DATEI = 'gegenstaende.bestaetigen.json';

/** Notes of the last reconciliation the editor should show (GD4): the base entries without an `ernte` whose old state was unknown, an unreadable basis. */
export const GEGENSTAENDE_HINWEISE_DATEI = 'gegenstaende.hinweise.json';

export function gegenstandsHinweiseDatei(arbeitsDatei: string): string {
  return gegenstandsNebenDatei(arbeitsDatei, GEGENSTAENDE_HINWEISE_DATEI);
}

/** What the editor gets with `GET /api/gegenstaende` and the receipt answer. */
export interface GegenstandsHinweise {
  /** Base entries without an `ernte` field whose old state was unknown: they inherit the harvest of the base entry (nothing was written). */
  ernteUnklar: string[];
  /** The basis file was unreadable at the last reconciliation and was rewritten. */
  basisKaputt: boolean;
  /** When the reconciliation noted it (ISO time), `null` if there is nothing to show. */
  zeit: string | null;
}

export const KEINE_HINWEISE: Readonly<GegenstandsHinweise> = { ernteUnklar: [], basisKaputt: false, zeit: null };

/** The notes of the last reconciliation, or `KEINE_HINWEISE` (missing, unreadable or not of this shape). */
export function gegenstandsHinweiseLesen(arbeitsDatei: string): GegenstandsHinweise {
  try {
    const roh = JSON.parse(readFileSync(gegenstandsHinweiseDatei(arbeitsDatei), 'utf-8')) as Partial<GegenstandsHinweise>;
    if (!Array.isArray(roh.ernteUnklar) || !roh.ernteUnklar.every((x) => typeof x === 'string') || typeof roh.basisKaputt !== 'boolean' || typeof roh.zeit !== 'string') return { ...KEINE_HINWEISE };
    return { ernteUnklar: [...roh.ernteUnklar], basisKaputt: roh.basisKaputt, zeit: roh.zeit };
  } catch {
    return { ...KEINE_HINWEISE };
  }
}

/** The accepted repo state (in Git): read and compare, never write at run time. `wurzel` is the project root. */
export function gegenstandsRepoDatei(wurzel: string): string {
  return resolve(wurzel, 'shared/data', GEGENSTAENDE_DATEI);
}

/** The working copy: what the server watches and the admin route writes. */
export function gegenstandsArbeitsDatei(wurzel: string, roh: string | undefined = process.env.WOV_WELT_VERZEICHNIS): string {
  return resolve(weltArbeitsOrdner(wurzel, roh), GEGENSTAENDE_DATEI);
}

/** The basis file next to the working copy: hash of the repo state it was last created or updated from. */
export function gegenstandsBasisDatei(wurzel: string, roh: string | undefined = process.env.WOV_WELT_VERZEICHNIS): string {
  return resolve(weltArbeitsOrdner(wurzel, roh), GEGENSTAENDE_BASIS_DATEI);
}

/** A file next to the working copy (`arbeitsDatei` is the path from `gegenstandsArbeitsDatei`): receipt, confirmation request. */
export function gegenstandsNebenDatei(arbeitsDatei: string, name: string): string {
  return resolve(dirname(arbeitsDatei), name);
}

export function gegenstandsQuittungsDatei(arbeitsDatei: string): string {
  return gegenstandsNebenDatei(arbeitsDatei, GEGENSTAENDE_QUITTUNG_DATEI);
}

export function gegenstandsBestaetigenDatei(arbeitsDatei: string): string {
  return gegenstandsNebenDatei(arbeitsDatei, GEGENSTAENDE_BESTAETIGEN_DATEI);
}

/** The last state the watch applied successfully (same form as the working copy); the start falls back to it if the working copy is broken or gone. */
export const GEGENSTAENDE_LETZTER_GUTER_DATEI = 'gegenstaende.letzter-guter.json';

export function gegenstandsLetzterGuterDatei(arbeitsDatei: string): string {
  return gegenstandsNebenDatei(arbeitsDatei, GEGENSTAENDE_LETZTER_GUTER_DATEI);
}

// ── Reconciliation at start (Card GD2) ────────────────────────────────
/**
 * The working copy holds only DEVIATIONS: own new items and base items somebody edited on purpose. A base item without an
 * entry follows the repo, so every change of the repo state (also `ernte`) reaches the game. The reconciliation therefore
 * never copies the 29 base entries into the file; it cleans out what is no deviation, and tells about what is.
 *
 * The BASIS file (`gegenstaende.basis`) holds the repo state the working copy was last reconciled with: a copy of the repo file
 * (full text, so every entry can be compared with its own state of then). Older basis files hold only the SHA-256 of
 * that state; they are still read (see "old basis" below).
 *
 *   working copy missing                           → create an EMPTY document, write the basis          (angelegt)
 *   working copy is no item file (broken, 0 byte)  → write NOTHING, loud                                (arbeit-kaputt)
 *   repo file missing / no item file               → change NOTHING, loud                               (repo-fehlt / repo-kaputt)
 *   an entry with a known base id that is no deviation → take it out (back-up `.bak`, loud)             (bereinigt)
 *       = it equals the repo entry, or it equals its entry in the BASIS (untouched since the last copy: it follows the
 *         repo again; an id the repo no longer has is removed the same way). Comparison is canonical (key order, number
 *         form, entry order do not matter).
 *   a base entry that deviates from the basis AND whose repo entry changed since the basis
 *                                                  → the working copy WINS, nothing is overwritten, loud (konflikt)
 *   otherwise                                                                                          (unveraendert)
 *
 * Old basis (hash only, written by GD1, so always an earlier state of `shared/data/gegenstaende.json`): (1) the state is looked
 * up in the baked-in HISTORY `shared/data/gegenstaende-historie/<hash>.json` (every state the repo file has had since GD1; a
 * test makes sure the current one is in it) and used like a full basis, also when the file holds edited base entries and
 * the repo changed locked fields at the same time; (2) a file that equals the basis byte for byte is an untouched copy:
 * every entry goes; (3) otherwise the state is rebuilt from the file if that can be verified: its base-id entries, written
 * canonically, must hash to the basis hash; (4) else only "equals the repo entry" counts, and the message says the basis
 * is unknown. States are read AS WRITTEN (`ohneGrundsperre`), never against the base stock baked into this build.
 *
 * Transition from the old format (basis only a hash, or none): a base entry of the file WITHOUT an `ernte` field ran with
 * `ernte {}` under GD1 (its writer left an empty `ernte` out); the new rule would inherit the base harvest for a missing field. So
 * the reconciliation takes such a file over as it worked: it writes `ernte: {}` explicitly into those entries (only where the
 * repo entry has a harvest; canonical, back-up, loud). Afterwards the new rule holds: a missing field inherits.
 *
 * Afterwards the basis is a copy of the repo file. Order of writing: working copy first (atomic), basis second, so an abort
 * between the two leaves a file that is cleaned and a basis that is still old; the next start only repeats the (harmless)
 * report. A conflict is reported once: the next start has basis = repo.
 *
 * Runs under `<working copy>.lock`, the lock the admin route and the watch take. Never throws for a bad file, only for real
 * I/O errors or a lock that does not come free.
 */
export type GegenstandsAbgleichFall = 'angelegt' | 'bereinigt' | 'unveraendert' | 'konflikt' | 'repo-fehlt' | 'repo-kaputt' | 'arbeit-kaputt' | 'gleicher-pfad';

export interface GegenstandsAbgleich {
  fall: GegenstandsAbgleichFall;
  /** One line for the log (a loud warning for `konflikt`, `repo-kaputt`, `arbeit-kaputt`). */
  meldung: string;
  repoHash: string | null;
  arbeitHash: string | null;
  basisHash: string | null;
  /** Where the old working copy went before it was cleaned. */
  sicherung?: string | null;
  /** `bereinigt`: the ids taken out of the file (no deviation). */
  bereinigt?: string[];
  /** Of those, the ids the repo no longer has (removed from the repo, the copy was untouched). */
  entfallen?: string[];
  /** The base ids that are still deviations in the file. */
  abweichend?: string[];
  /** Transition from the old format: ids of base entries without an `ernte` field that got an explicit `ernte: {}` (see the head). */
  ernteFestgeschrieben?: string[];
  /** Base entries without an `ernte` field in an old-format file whose state is unknown (no basis, unreadable, unknown hash): nothing was written, the field inherits. */
  ernteUnklar?: string[];
  /** The basis file exists but is unusable: it is no old format, it is replaced. */
  basisKaputt?: boolean;
  /** An old hash-only basis that matches no known repo state and cannot be rebuilt: only "equals the repo entry" counted. */
  basisUnbekannt?: boolean;
}

export interface GegenstandsAbgleichOptionen {
  repoDatei: string;
  arbeitsDatei: string;
  /** `voll` creates and cleans (game server, admin route); `pruefen` writes nothing and only names the case. */
  modus?: 'voll' | 'pruefen';
  /** How long to wait for the lock (default 30 s). */
  sperreWartenMs?: number;
  /** Test seam: called between the write of the working copy and the write of the basis (an abort there is simulated by throwing). */
  zwischenschritt?: () => void;
}

/** The basis file next to a working copy (`gegenstaende.basis`). */
export function gegenstandsBasisNebenDatei(arbeitsDatei: string): string {
  return gegenstandsNebenDatei(arbeitsDatei, GEGENSTAENDE_BASIS_DATEI);
}

/** What the basis file says: `text` is the full repo state of then, `null` for an old basis that holds only the hash. */
export interface GegenstandsBasis {
  hash: string;
  text: string | null;
}

export function gegenstandsBasisStand(arbeitsDatei: string): GegenstandsBasis | null {
  let text: string;
  try {
    text = readFileSync(gegenstandsBasisNebenDatei(arbeitsDatei), 'utf-8');
  } catch (fehler) {
    if ((fehler as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw fehler;
  }
  const t = text.trim();
  if (/^[0-9a-f]{64}$/.test(t)) return { hash: t, text: null };
  if (leseGegenstandsDatei(text).dateiFehler !== null) return null;
  return { hash: layoutHash(text), text };
}

/** The hash of the basis (of the file text for a full basis, the stored hash for an old one), or `null`. */
export function gegenstandsBasisLesen(arbeitsDatei: string): string | null {
  return gegenstandsBasisStand(arbeitsDatei)?.hash ?? null;
}

function dateiBytes(pfad: string): Buffer | null {
  try {
    return readFileSync(pfad);
  } catch (fehler) {
    if ((fehler as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw fehler;
  }
}

function atomarSchreiben(ziel: string, inhalt: Buffer | string): void {
  mkdirSync(dirname(ziel), { recursive: true });
  const tmp = `${ziel}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, inhalt);
    renameSync(tmp, ziel);
  } catch (fehler) {
    rmSync(tmp, { force: true });
    throw fehler;
  }
}

/**
 * The canonical text of ONE raw entry as WRITTEN (the writer's text of what the reader makes of it, without comparing it with
 * the base stock baked into this build: an old copy of an item whose locked field the repo changed since is still the old
 * copy). An entry the reader refuses leaves an empty list, whose text never equals the text of a repo entry, so it counts as
 * a deviation.
 */
function kanonVonRoh(roh: unknown): string | null {
  const lesung = leseGegenstandsDatei(JSON.stringify({ version: 1, gegenstaende: [roh] }), { ohneGrundsperre: true });
  try {
    return schreibeGegenstandsDatei(lesung.eintraege);
  } catch {
    return null;
  }
}

/** id → canonical text per entry of a document text (the reader's entries, written one by one). */
function kanonKarte(text: string): Map<string, string> {
  return new Map(leseGegenstandsDatei(text, { ohneGrundsperre: true }).eintraege.map((e) => [e.id, schreibeGegenstandsDatei([e])] as const));
}

/** Where the baked-in history keeps the repo state with this hash (next to the repo file). */
export function gegenstandsHistorieDatei(repoPfad: string, hash: string): string {
  return resolve(dirname(repoPfad), 'gegenstaende-historie', `${hash}.json`);
}

/** The text of an earlier repo state from the history, if it is there and really has this hash and is an item file. */
function historieText(repoPfad: string, hash: string): string | null {
  // (`hash` is a 64-digit hex string here: the old-basis branch only gets that far for such a value)
  const bytes = dateiBytes(gegenstandsHistorieDatei(repoPfad, hash));
  if (bytes === null || layoutHash(bytes) !== hash) return null;
  const text = bytes.toString('utf-8');
  return leseGegenstandsDatei(text, { ohneGrundsperre: true }).dateiFehler === null ? text : null;
}

/**
 * The notes for the editor (`gegenstaende.hinweise.json`). Notes are MERGED across runs, not overwritten: an id stays noted until the
 * author dealt with exactly that id (`gegenstandsHinweiseIdsEntfernen`: a reset or a saved deviation), because the mask (GD4) cannot
 * show them yet. Only ids that exist in the repo are kept, so the file cannot grow without bound. `basisKaputt` is a fact of THIS run.
 */
function hinweiseSchreiben(arbeitsPfad: string, ernteUnklar: readonly string[], basisKaputt: boolean, repoIds: ReadonlySet<string>): void {
  const ziel = gegenstandsHinweiseDatei(arbeitsPfad);
  const alt = gegenstandsHinweiseLesen(arbeitsPfad);
  const ids = [...new Set([...alt.ernteUnklar, ...ernteUnklar])].filter((id) => repoIds.has(id));
  if (ids.length === 0 && !basisKaputt) {
    rmSync(ziel, { force: true });
    return;
  }
  if (alt.zeit !== null && alt.basisKaputt === basisKaputt && alt.ernteUnklar.length === ids.length && alt.ernteUnklar.every((id, i) => id === ids[i])) return;
  const hinweise: GegenstandsHinweise = { ernteUnklar: ids, basisKaputt, zeit: new Date().toISOString() };
  atomarSchreiben(ziel, `${JSON.stringify(hinweise, null, 2)}\n`);
}

/**
 * The author dealt with these ids (a reset that took the entry out, a saved deviation): their notes go. Other ids and `basisKaputt` stay;
 * the file goes when nothing is left. Call inside the lock section of the working copy.
 */
export function gegenstandsHinweiseIdsEntfernen(arbeitsDatei: string, ids: readonly string[]): void {
  const alt = gegenstandsHinweiseLesen(arbeitsDatei);
  const rest = alt.ernteUnklar.filter((id) => !ids.includes(id));
  if (rest.length === alt.ernteUnklar.length) return;
  const ziel = gegenstandsHinweiseDatei(arbeitsDatei);
  if (rest.length === 0 && !alt.basisKaputt) rmSync(ziel, { force: true });
  else atomarSchreiben(ziel, `${JSON.stringify({ ...alt, ernteUnklar: rest }, null, 2)}\n`);
}

const kurz = (h: string | null): string => (h === null ? '-' : h.slice(0, 8));
const idVon = (roh: unknown): string | null => (typeof roh === 'object' && roh !== null && typeof (roh as { id?: unknown }).id === 'string' ? (roh as { id: string }).id : null);

/** The reconciliation. See the head of this section. */
export function gegenstaendeAbgleichen(opt: GegenstandsAbgleichOptionen): GegenstandsAbgleich {
  const modus = opt.modus ?? 'voll';
  const repoPfad = resolve(opt.repoDatei);
  const arbeitsPfad = resolve(opt.arbeitsDatei);
  if (repoPfad === arbeitsPfad) {
    return { fall: 'gleicher-pfad', meldung: `[Gegenstaende] Arbeitskopie = Repo-Datei (${arbeitsPfad}), kein Abgleich`, repoHash: null, arbeitHash: null, basisHash: null };
  }
  if (modus === 'pruefen') return gegenstaendeAbgleichenOhneSperre(repoPfad, arbeitsPfad, modus);
  return layoutUnterSperre(arbeitsPfad, () => gegenstaendeAbgleichenOhneSperre(repoPfad, arbeitsPfad, modus, opt.zwischenschritt), { sperreWartenMs: opt.sperreWartenMs ?? 30_000 });
}

/** The same inside a section that already holds `<working copy>.lock` (the admin route). */
export function gegenstaendeAbgleichenOhneSperre(repoPfad: string, arbeitsPfad: string, modus: 'voll' | 'pruefen' = 'voll', zwischenschritt?: () => void): GegenstandsAbgleich {
  const repoBytes = dateiBytes(repoPfad);
  const arbeitBytes = dateiBytes(arbeitsPfad);
  const repoHash = repoBytes === null ? null : layoutHash(repoBytes);
  const arbeitHash = arbeitBytes === null ? null : layoutHash(arbeitBytes);
  const basis = gegenstandsBasisStand(arbeitsPfad);
  const basisHash = basis?.hash ?? null;
  const basisPfad = gegenstandsBasisNebenDatei(arbeitsPfad);
  const ergebnis = (fall: GegenstandsAbgleichFall, meldung: string, mehr: Partial<GegenstandsAbgleich> = {}): GegenstandsAbgleich => ({
    fall,
    meldung,
    repoHash,
    arbeitHash,
    basisHash,
    ...mehr,
  });

  const arbeitLesung = arbeitBytes === null ? null : leseGegenstandsDatei(arbeitBytes.toString('utf-8'));
  if (arbeitBytes !== null && arbeitLesung !== null && arbeitLesung.dateiFehler !== null) {
    return ergebnis(
      'arbeit-kaputt',
      `[Gegenstaende] FEHLER Arbeitskopie ist keine gueltige Gegenstandsdatei (${arbeitBytes.length} Bytes): ${arbeitsPfad}. Nichts wurde geschrieben; der letzte gute Stand und der Grundbestand gelten.`
    );
  }
  if (repoBytes === null || repoHash === null) {
    return ergebnis('repo-fehlt', `[Gegenstaende] Repo-Datei fehlt (${repoPfad}); Arbeitskopie ${arbeitHash === null ? 'fehlt ebenfalls' : `gelesen (${kurz(arbeitHash)})`}`);
  }
  // The repo file is read AS WRITTEN (the base stock baked into this build is the same file in a running system; in a test or
  // right after a pull it may not be yet, and the comparison must follow the file).
  const repoLesung = leseGegenstandsDatei(repoBytes.toString('utf-8'), { ohneGrundsperre: true });
  if (repoLesung.dateiFehler !== null) {
    return ergebnis(
      'repo-kaputt',
      `[Gegenstaende] FEHLER Repo-Datei ist keine gueltige Gegenstandsdatei (${repoBytes.length} Bytes): ${repoPfad}. Es wird NICHTS veraendert. ${arbeitHash === null ? 'Eine Arbeitskopie gibt es nicht.' : `Gelesen wird die Arbeitskopie (${kurz(arbeitHash)}).`}`
    );
  }

  if (arbeitBytes === null || arbeitLesung === null || arbeitHash === null) {
    if (modus === 'pruefen') return ergebnis('angelegt', `[Gegenstaende] Arbeitskopie fehlt, wuerde leer angelegt (${arbeitsPfad}, Repo ${kurz(repoHash)})`);
    atomarSchreiben(arbeitsPfad, schreibeGegenstandsDatei([]));
    atomarSchreiben(basisPfad, repoBytes);
    return ergebnis('angelegt', `[Gegenstaende] Arbeitskopie angelegt (leer: die Grundgegenstaende folgen dem Repo, ${arbeitsPfad}, Repo ${kurz(repoHash)})`);
  }

  // Which entries of the file are no deviation? (raw entries of the file, compared canonically)
  const repoKanon = new Map<string, string>();
  for (const e of repoLesung.eintraege) repoKanon.set(e.id, schreibeGegenstandsDatei([e]));
  const dokument = JSON.parse(arbeitBytes.toString('utf-8')) as { gegenstaende: unknown[] };
  // The basis state per entry: the full text of a new basis; for an old (hash only) basis: the whole file when it equals the
  // basis, else the base-id entries of the file if they hash to the basis hash.
  let basisKanon: Map<string, string> | null = null;
  // The entries of the repo state the old (hash only) basis stands for, when it is known: what decides the transition (below).
  let basisEintraege: Map<string, GegenstandsEintrag> | null = null;
  // The entries of ANY known basis state (full, history, rebuilt, or the repo when the hash equals it): to read a missing `ernte` of an
  // entry like the game does (it inherits the harvest of THAT state's entry when the file is compared with that state).
  let basisAlle: Map<string, GegenstandsEintrag> | null = null;
  let dateiIstBasis = false;
  let basisUnbekannt = false;
  if (basis !== null && basis.text !== null) {
    basisKanon = kanonKarte(basis.text);
    basisAlle = new Map(leseGegenstandsDatei(basis.text, { ohneGrundsperre: true }).eintraege.map((e) => [e.id, e] as const));
  }
  else if (basis !== null) {
    const historie = historieText(repoPfad, basis.hash);
    if (basis.hash === repoHash) {
      basisKanon = repoKanon;
      basisEintraege = new Map(repoLesung.eintraege.map((e) => [e.id, e] as const));
      basisAlle = basisEintraege;
    } else if (historie !== null) {
      basisKanon = kanonKarte(historie);
      basisEintraege = new Map(leseGegenstandsDatei(historie, { ohneGrundsperre: true }).eintraege.map((e) => [e.id, e] as const));
      basisAlle = basisEintraege;
    }
    else if (arbeitHash === basis.hash) dateiIstBasis = true;
    else {
      const kandidat = leseGegenstandsDatei(JSON.stringify({ version: 1, gegenstaende: dokument.gegenstaende.filter((r) => { const id = idVon(r); return id !== null && repoKanon.has(id); }) }), { ohneGrundsperre: true });
      if (kandidat.dateiFehler === null && kandidat.verworfen.length === 0 && kandidat.eintraege.length > 0) {
        try {
          if (layoutHash(schreibeGegenstandsDatei(kandidat.eintraege)) === basis.hash) {
            basisKanon = new Map(kandidat.eintraege.map((e) => [e.id, schreibeGegenstandsDatei([e])] as const));
            basisEintraege = new Map(kandidat.eintraege.map((e) => [e.id, e] as const));
            basisAlle = basisEintraege;
          }
        } catch {
          /* cannot be written: no reconstruction */
        }
      }
      basisUnbekannt = basisKanon === null;
    }
  }

  const behalten: unknown[] = [];
  const bereinigt: string[] = [];
  const entfallen: string[] = [];
  const abweichend: string[] = [];
  const ernteFestgeschrieben: string[] = [];
  // A working copy in the OLD format (basis only a hash, or no basis file) was written by GD1, whose writer left an empty `ernte`
  // out: a base entry of such a file WITHOUT the field ran with `ernte {}` ("harvests nothing") IF the base entry of the state
  // the server let it work under had a harvest; where it had none the field is simply missing and inherits. The transition
  // therefore decides by the BASIS state (history, rebuilt, or the repo when the hash equals it; `basisEintraege` is set only for an old hash basis, so a full basis or a missing/unreadable one never writes), never by today's repo: a
  // harvest the repo gets only now must arrive. Without a known state (no basis, unknown hash) nothing is written and the
  // message says so. An unreadable FULL basis is no old format (it is replaced, nothing is written).
  const basisKaputt = basis === null && dateiBytes(basisPfad) !== null;
  const ernteAlsBasis = (id: string): boolean => Object.keys(basisEintraege?.get(id)?.ernte ?? {}).length > 0;
  const repoHatErnte = (id: string): boolean => Object.keys(repoLesung.eintraege.find((e) => e.id === id)?.ernte ?? {}).length > 0;
  const ernteUnklar: string[] = [];
  const ohneErnteKonflikt = new Set<string>();
  // the state the file worked under is unknown: no basis file, an unreadable one, or a hash that is no known state
  const standUnbekannt = basis === null || (basis.text === null && basisEintraege === null);
  for (const roh of dokument.gegenstaende) {
    const id = idVon(roh);
    const imRepo = id !== null && repoKanon.has(id);
    // The file is read like the game reads it: a base entry without `ernte` inherits the harvest of the state it is compared with
    // (the SAME rule as the reader, `mitGeerbterErnte`). Exception: the GD1 transition, where such an entry ran with `{}` because the
    // old state had a harvest for it (it is a deviation and gets the explicit `ernte: {}` below).
    const erbt = id !== null && !(basisEintraege !== null && ernteAlsBasis(id));
    const gegenRepo = id !== null && erbt && imRepo ? mitGeerbterErnte(roh, repoLesung.eintraege.find((e) => e.id === id)?.ernte ?? {}) : roh;
    const basisEintrag = id === null ? undefined : basisAlle?.get(id);
    const gegenBasis = id !== null && erbt && basisEintrag !== undefined ? mitGeerbterErnte(roh, basisEintrag.ernte) : roh;
    const kanonRepo = id === null ? null : kanonVonRoh(gegenRepo);
    const kanonBasis = id === null ? null : kanonVonRoh(gegenBasis);
    const gleichRepo = imRepo && kanonRepo !== null && kanonRepo === repoKanon.get(id!);
    const gleichBasis = id !== null && (dateiIstBasis || (basisKanon !== null && kanonBasis !== null && basisKanon.get(id) === kanonBasis));
    const ernteFehlt = typeof roh === 'object' && roh !== null && ernteFehltRoh((roh as { ernte?: unknown }).ernte);
    if (id !== null && (gleichRepo || gleichBasis)) {
      bereinigt.push(id);
      if (!imRepo) entfallen.push(id);
      // An entry without `ernte` that goes although the state it worked under is unknown: under GD1 that may once have meant "harvests
      // nothing". The game value does not change (it inherits), but the editor should see it.
      if (standUnbekannt && ernteFehlt && repoHatErnte(id)) ernteUnklar.push(id);
    } else {
      const festgeschrieben = ernteFehlt && ernteAlsBasis(id!); // (`ernteAlsBasis` is false while the basis state is unknown)
      if (festgeschrieben) {
        behalten.push({ ...(roh as object), ernte: {} });
        ernteFestgeschrieben.push(id!);
      } else {
        behalten.push(roh);
        // the state of an old file is unknown (no basis, or a basis that is no known state) or the basis is unusable: nothing is written
        if (standUnbekannt && ernteFehlt && repoHatErnte(id!)) ernteUnklar.push(id!);
      }
      if (imRepo) abweichend.push(id!);
      // "without ernte" = what the reader really inherits (field missing, null or invalid), and never an entry that was just written as `ernte: {}`
      if (imRepo && !festgeschrieben && ernteWirdGeerbt((roh as { ernte?: unknown }).ernte)) ohneErnteKonflikt.add(id!);
    }
  }
  // An abweichende id counts as a conflict when its repo entry changed since the basis (known exactly with a full basis;
  // with an old basis: when the repo moved on at all).
  const repoGewandert = repoHash !== basisHash;
  const konfliktIds = abweichend.filter((id) => (basisKanon !== null ? basisKanon.get(id) !== repoKanon.get(id) : repoGewandert));

  const basisNachtragen = basis === null || basis.text === null || basis.hash !== repoHash;
  const abweichungen = abweichend.length > 0 ? ` Abweichende Grundgegenstaende: ${abweichend.join(', ')}.` : '';
  let sicherung: string | null | undefined;
  if ((bereinigt.length > 0 || ernteFestgeschrieben.length > 0) && modus === 'voll') {
    // Back up first, then rewrite: if the back-up fails nothing changes. Working copy first, basis second (abort-proof).
    sicherung = layoutSichern(arbeitsPfad);
    atomarSchreiben(arbeitsPfad, `${JSON.stringify({ ...dokument, gegenstaende: behalten }, null, 2)}\n`);
  }
  zwischenschritt?.();
  if (basisNachtragen && modus === 'voll') atomarSchreiben(basisPfad, repoBytes);
  if (modus === 'voll') hinweiseSchreiben(arbeitsPfad, ernteUnklar, basisKaputt, new Set(repoLesung.eintraege.map((e) => e.id)));

  const mehr = {
    bereinigt, entfallen, abweichend,
    ...(ernteFestgeschrieben.length > 0 ? { ernteFestgeschrieben } : {}),
    ...(ernteUnklar.length > 0 ? { ernteUnklar } : {}),
    ...(basisUnbekannt ? { basisUnbekannt } : {}),
    ...(basisKaputt ? { basisKaputt } : {}),
    ...(sicherung === undefined ? {} : { sicherung }),
  };
  // The messages say only what really happened (or, in `pruefen`, would happen): nothing about taking entries out when none go, no
  // "written" in `pruefen`, the back-up named once.
  const voll = modus === 'voll';
  const teile: string[] = [];
  if (bereinigt.length > 0) teile.push(`${bereinigt.length} Eintrag/Eintraege ohne Abweichung ${voll ? 'herausgenommen' : 'wuerden herausgenommen'} (${bereinigt.join(', ')})`);
  if (ernteFestgeschrieben.length > 0) teile.push(`alte Datei uebernommen, wie der Server sie wirken liess: \`ernte: {}\` ${voll ? 'ausdruecklich geschrieben' : 'wuerde ausdruecklich geschrieben'} fuer ${ernteFestgeschrieben.join(', ')}`);
  const wort = bereinigt.length > 0 ? 'bereinigt' : 'umgeschrieben';
  const aenderung = teile.length > 0 ? ` Arbeitskopie ${voll ? wort : `wuerde ${wort}`}: ${teile.join('; ')}${voll ? `; alter Stand gesichert: ${sicherung ?? '(keiner)'}` : ''}.` : '';
  const zusatz =
    (entfallen.length > 0 ? ` Nicht mehr im Repo (Eintrag unberuehrt, entfernt): ${entfallen.join(', ')}.` : '') +
    (basisUnbekannt ? ` Die alte Basis (Hash ${kurz(basisHash)}) ist keine bekannte Repo-Fassung und laesst sich nicht aus der Datei aufbauen: nur Gleichheit mit dem Repo-Stand zaehlt.` : '') +
    (basisKaputt ? ' Die Basisdatei war unlesbar und wird neu geschrieben.' : '') +
    (ernteUnklar.length > 0 ? ` Eintraege ohne ernte-Feld (${ernteUnklar.join(', ')}): der Stand, unter dem die Datei wirkte, ist unbekannt (Basis fehlt, ist unlesbar oder keine bekannte Repo-Fassung), es wird nichts festgeschrieben; hier war moeglicherweise einmal "erntet nichts" gemeint. Das fehlende Feld erbt die Ernte des Grundeintrags (im Spiel gilt sie, auch nachdem das Repo ein gesperrtes Feld aendert); der Wert im Spiel aendert sich dadurch nicht.` : '');
  if (konfliktIds.length > 0) {
    // An entry WITHOUT an `ernte` field inherits the harvest of the base entry (the game reads it so): a changed repo harvest reaches it
    // at once. Only entries WITH an own `ernte` keep it until they are reset.
    const mitErnte = konfliktIds.filter((id) => !ohneErnteKonflikt.has(id));
    const ohneErnte = konfliktIds.filter((id) => ohneErnteKonflikt.has(id));
    return ergebnis(
      'konflikt',
      `[Gegenstaende] WARNUNG Konflikt: das Repo hat sich geaendert (Basis ${kurz(basisHash)} → Repo ${kurz(repoHash)}), die Arbeitskopie hat abweichende Grundgegenstaende (${konfliktIds.join(', ')}). ` +
        `Es wird NICHTS ueberschrieben; die Arbeitskopie gilt (${arbeitsPfad}). Bis GD3 ist nur \`ernte\` aenderbar: alle anderen Felder folgen dem Repo.` +
        (mitErnte.length > 0 ? ` Eine geaenderte \`ernte\` des Repos kommt fuer ${mitErnte.join(', ')} (eigene \`ernte\`) erst an, wenn der Eintrag im Editor auf den Grundstand zurueckgesetzt wird.` : '') +
        (ohneErnte.length > 0 ? ` ${ohneErnte.join(', ')} ${ohneErnte.length === 1 ? 'hat' : 'haben'} kein \`ernte\`-Feld und folgt der Ernte des Repos sofort.` : '') +
        aenderung + zusatz,
      { ...mehr, abweichend }
    );
  }
  if (bereinigt.length > 0 || ernteFestgeschrieben.length > 0) {
    return ergebnis('bereinigt', `[Gegenstaende]${aenderung}${abweichungen}${zusatz}`, mehr);
  }
  return ergebnis('unveraendert', `[Gegenstaende] Arbeitskopie gelesen: ${arbeitsPfad} (Hash ${kurz(arbeitHash)}, Repo ${kurz(repoHash)}).${abweichungen}${zusatz}`, mehr);
}

/**
 * The deviations among `eintraege`: everything but the base entries that equal the repo entry (canonical text of the
 * writer, so key order and number form do not matter). The admin route writes only these, so the file is already what
 * the reconciliation would leave.
 */
export function nurAbweichungen(eintraege: readonly GegenstandsEintrag[], repoEintraege: readonly GegenstandsEintrag[]): GegenstandsEintrag[] {
  const repoKanon = new Map(repoEintraege.map((e) => [e.id, schreibeGegenstandsDatei([e])] as const));
  return eintraege.filter((e) => repoKanon.get(e.id) !== schreibeGegenstandsDatei([e]));
}
