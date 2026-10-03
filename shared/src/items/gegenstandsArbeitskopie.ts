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
import { leseGegenstandsDatei, schreibeGegenstandsDatei, type GegenstandsEintrag } from './gegenstandsDaten.js';

/** Fixed file names. The data are the same for every instance, so no instance name in them. */
export const GEGENSTAENDE_DATEI = 'gegenstaende.json';
export const GEGENSTAENDE_BASIS_DATEI = 'gegenstaende.basis';
/** The receipt the game server's watch writes next to the working copy (read by the admin route). */
export const GEGENSTAENDE_QUITTUNG_DATEI = 'gegenstaende.quittung.json';
/** The confirmation request (`{hash, zeit, id}`, same form as `POST /api/welt/bestaetigen`) the admin route leaves next to the working copy; the watch consumes it. */
export const GEGENSTAENDE_BESTAETIGEN_DATEI = 'gegenstaende.bestaetigen.json';

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
 * Old basis (hash only): a file that equals it byte for byte is an untouched copy: every entry goes. Otherwise the basis state
 * is rebuilt from the file if that is possible to verify: the base-id entries of the file, written canonically, must hash to
 * the basis hash (the typical state of an instance that got the copy of an older build and saved own items, without touching
 * a base entry). If the hash does not match (a base entry was edited), only "equals the repo entry" counts.
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
 * The canonical text of ONE raw entry (the writer's text of what the reader makes of it), or `null` if the reader replaced it
 * (invalid, or deviating in a locked field). An entry the reader refuses for another reason leaves an empty list, whose text
 * never equals the text of a repo entry, so it counts as a deviation as well.
 */
function kanonVonRoh(roh: unknown): string | null {
  const lesung = leseGegenstandsDatei(JSON.stringify({ version: 1, gegenstaende: [roh] }));
  if (lesung.grundErsetzt.length > 0) return null;
  try {
    return schreibeGegenstandsDatei(lesung.eintraege);
  } catch {
    return null;
  }
}

/** id → canonical text per entry of a document text (the reader's entries, written one by one). */
function kanonKarte(text: string): Map<string, string> {
  return new Map(leseGegenstandsDatei(text).eintraege.map((e) => [e.id, schreibeGegenstandsDatei([e])] as const));
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
  const repoLesung = leseGegenstandsDatei(repoBytes.toString('utf-8'));
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
  let dateiIstBasis = false;
  if (basis !== null && basis.text !== null) basisKanon = kanonKarte(basis.text);
  else if (basis !== null) {
    if (arbeitHash === basis.hash) dateiIstBasis = true;
    else {
      const kandidat = leseGegenstandsDatei(JSON.stringify({ version: 1, gegenstaende: dokument.gegenstaende.filter((r) => { const id = idVon(r); return id !== null && repoKanon.has(id); }) }));
      if (kandidat.dateiFehler === null && kandidat.verworfen.length === 0 && kandidat.grundErsetzt.length === 0 && kandidat.eintraege.length > 0) {
        try {
          if (layoutHash(schreibeGegenstandsDatei(kandidat.eintraege)) === basis.hash) basisKanon = new Map(kandidat.eintraege.map((e) => [e.id, schreibeGegenstandsDatei([e])] as const));
        } catch {
          /* cannot be written: no reconstruction */
        }
      }
    }
  }

  const behalten: unknown[] = [];
  const bereinigt: string[] = [];
  const entfallen: string[] = [];
  const abweichend: string[] = [];
  for (const roh of dokument.gegenstaende) {
    const id = idVon(roh);
    const imRepo = id !== null && repoKanon.has(id);
    const kanon = id === null ? null : kanonVonRoh(roh);
    const gleichRepo = imRepo && kanon !== null && kanon === repoKanon.get(id!);
    const gleichBasis = id !== null && (dateiIstBasis || (basisKanon !== null && kanon !== null && basisKanon.get(id) === kanon));
    if (id !== null && (gleichRepo || gleichBasis)) {
      bereinigt.push(id);
      if (!imRepo) entfallen.push(id);
    } else {
      behalten.push(roh);
      if (imRepo) abweichend.push(id!);
    }
  }
  // An abweichende id counts as a conflict when its repo entry changed since the basis (known exactly with a full basis;
  // with an old basis: when the repo moved on at all).
  const repoGewandert = repoHash !== basisHash;
  const konfliktIds = abweichend.filter((id) => (basisKanon !== null ? basisKanon.get(id) !== repoKanon.get(id) : repoGewandert));

  const basisNachtragen = basis === null || basis.text === null || basis.hash !== repoHash;
  const abweichungen = abweichend.length > 0 ? ` Abweichende Grundgegenstaende: ${abweichend.join(', ')}.` : '';
  let sicherung: string | null | undefined;
  if (bereinigt.length > 0 && modus === 'voll') {
    // Back up first, then rewrite: if the back-up fails nothing changes. Working copy first, basis second (abort-proof).
    sicherung = layoutSichern(arbeitsPfad);
    atomarSchreiben(arbeitsPfad, `${JSON.stringify({ ...dokument, gegenstaende: behalten }, null, 2)}\n`);
  }
  zwischenschritt?.();
  if (basisNachtragen && modus === 'voll') atomarSchreiben(basisPfad, repoBytes);

  const mehr = { bereinigt, entfallen, abweichend, ...(sicherung === undefined ? {} : { sicherung }) };
  const entfallenText = entfallen.length > 0 ? ` Nicht mehr im Repo (Eintrag unberuehrt, entfernt): ${entfallen.join(', ')}.` : '';
  if (konfliktIds.length > 0) {
    return ergebnis(
      'konflikt',
      `[Gegenstaende] WARNUNG Konflikt: das Repo hat sich geaendert (Basis ${kurz(basisHash)} → Repo ${kurz(repoHash)}), die Arbeitskopie hat abweichende Grundgegenstaende (${konfliktIds.join(', ')}). ` +
        `Es wird NICHTS ueberschrieben; die Arbeitskopie gilt (${arbeitsPfad}). Bis GD3 ist nur \`ernte\` aenderbar: alle anderen Felder folgen dem Repo, eine geaenderte \`ernte\` des Repos kommt fuer diese Gegenstaende erst an, wenn der Eintrag im Editor auf den Grundstand zurueckgesetzt wird.` +
        (bereinigt.length > 0 ? ` Ohne Abweichung herausgenommen: ${bereinigt.join(', ')} (Sicherung: ${sicherung ?? '(keine)'}).${entfallenText}` : ''),
      { ...mehr, abweichend }
    );
  }
  if (bereinigt.length > 0) {
    return ergebnis(
      'bereinigt',
      `[Gegenstaende] Arbeitskopie bereinigt: ${bereinigt.length} Eintrag/Eintraege ohne Abweichung ${modus === 'voll' ? 'herausgenommen' : 'wuerden herausgenommen'} (${bereinigt.join(', ')}); alter Stand gesichert: ${sicherung ?? '(keiner)'}.${entfallenText}${abweichungen}`,
      mehr
    );
  }
  return ergebnis('unveraendert', `[Gegenstaende] Arbeitskopie gelesen: ${arbeitsPfad} (Hash ${kurz(arbeitHash)}, Repo ${kurz(repoHash)}).${abweichungen}`, mehr);
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
