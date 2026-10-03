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
 * Decision from three hashes (SHA-256 over the bytes: repo, working copy, basis file):
 *
 *   working copy missing                           → create an EMPTY document, write the basis          (angelegt)
 *   working copy is no item file (broken, 0 byte)  → write NOTHING, loud                                (arbeit-kaputt)
 *   repo file missing / no item file               → change NOTHING, loud                               (repo-fehlt / repo-kaputt)
 *   an entry with a base id that is no deviation   → take it out (back-up `.bak`, loud)                 (bereinigt)
 *       = its content equals the repo entry (canonical: key order, number form, entry order do not matter),
 *         or the whole file equals the basis (an untouched copy of an older repo state)
 *   deviating base entries remain AND the repo moved on since the basis
 *                                                  → the working copy WINS, nothing is overwritten, loud (konflikt)
 *   otherwise                                                                                          (unveraendert)
 *
 * Afterwards the basis is the repo hash. Order of writing: working copy first (atomic), basis second, so an abort between the
 * two leaves a file that is cleaned and a basis that is still old; the next start only repeats the (harmless) report.
 * A conflict is reported once: the next start has basis = repo.
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

export function gegenstandsBasisLesen(arbeitsDatei: string): string | null {
  try {
    const t = readFileSync(gegenstandsBasisNebenDatei(arbeitsDatei), 'utf-8').trim();
    return /^[0-9a-f]{64}$/.test(t) ? t : null;
  } catch (fehler) {
    if ((fehler as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw fehler;
  }
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
  const basisHash = gegenstandsBasisLesen(arbeitsPfad);
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
    atomarSchreiben(basisPfad, `${repoHash}\n`);
    return ergebnis('angelegt', `[Gegenstaende] Arbeitskopie angelegt (leer: die Grundgegenstaende folgen dem Repo, ${arbeitsPfad}, Repo ${kurz(repoHash)})`);
  }

  // Which entries of the file are no deviation? (raw entries of the file, compared with the repo entry canonically)
  const repoKanon = new Map<string, string>();
  for (const e of repoLesung.eintraege) repoKanon.set(e.id, schreibeGegenstandsDatei([e]));
  const unberuehrt = arbeitHash === basisHash;
  const dokument = JSON.parse(arbeitBytes.toString('utf-8')) as { gegenstaende: unknown[] };
  const behalten: unknown[] = [];
  const bereinigt: string[] = [];
  const abweichend: string[] = [];
  for (const roh of dokument.gegenstaende) {
    const id = idVon(roh);
    if (id !== null && repoKanon.has(id) && (unberuehrt || kanonVonRoh(roh) === repoKanon.get(id))) bereinigt.push(id);
    else {
      behalten.push(roh);
      if (id !== null && repoKanon.has(id)) abweichend.push(id);
    }
  }

  const basisNachtragen = basisHash !== repoHash;
  const abweichungen = abweichend.length > 0 ? ` Abweichende Grundgegenstaende: ${abweichend.join(', ')}.` : '';
  let sicherung: string | null | undefined;
  if (bereinigt.length > 0 && modus === 'voll') {
    // Back up first, then rewrite: if the back-up fails nothing changes. Working copy first, basis second (abort-proof).
    sicherung = layoutSichern(arbeitsPfad);
    atomarSchreiben(arbeitsPfad, `${JSON.stringify({ ...dokument, gegenstaende: behalten }, null, 2)}\n`);
  }
  zwischenschritt?.();
  if (basisNachtragen && modus === 'voll') atomarSchreiben(basisPfad, `${repoHash}\n`);

  const mehr = { bereinigt, abweichend, ...(sicherung === undefined ? {} : { sicherung }) };
  if (abweichend.length > 0 && basisNachtragen) {
    return ergebnis(
      'konflikt',
      `[Gegenstaende] WARNUNG Konflikt: das Repo hat sich geaendert (Basis ${kurz(basisHash)} → Repo ${kurz(repoHash)}), die Arbeitskopie hat abweichende Grundgegenstaende (${abweichend.join(', ')}). ` +
        `Es wird NICHTS ueberschrieben; die Arbeitskopie gilt (${arbeitsPfad}). Aenderungen des Repos an diesen Gegenstaenden kommen erst an, wenn der Eintrag im Editor auf den Grundstand zurueckgesetzt wird.` +
        (bereinigt.length > 0 ? ` Ohne Abweichung herausgenommen: ${bereinigt.join(', ')} (Sicherung: ${sicherung ?? '(keine)'}).` : ''),
      mehr
    );
  }
  if (bereinigt.length > 0) {
    return ergebnis(
      'bereinigt',
      `[Gegenstaende] Arbeitskopie bereinigt: ${bereinigt.length} Eintrag/Eintraege ohne Abweichung vom Repo ${modus === 'voll' ? 'herausgenommen' : 'wuerden herausgenommen'} (${bereinigt.join(', ')}); alter Stand gesichert: ${sicherung ?? '(keiner)'}.${abweichungen}`,
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
