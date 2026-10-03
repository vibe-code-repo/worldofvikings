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
import { leseGegenstandsDatei, schreibeGegenstandsDatei } from './gegenstandsDaten.js';

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
 * Repo state, working copy and basis file are compared like `weltAbgleichen` does for the world; the decision
 * comes from three hashes (SHA-256 over the bytes):
 *
 *   working copy missing                              → create it from the repo, write the basis       (angelegt)
 *   working copy is no item file (broken, 0 byte)     → write NOTHING, loud                            (arbeit-kaputt)
 *   repo file missing / no item file                  → copy NOTHING, loud                             (repo-fehlt / repo-kaputt)
 *   working copy = repo (bytes or after reading)      → nothing to do, basis := repo                   (unveraendert)
 *   repo = basis                                      → only the working copy changed: keep it         (unveraendert)
 *   working copy = basis, or empty without a basis    → only the repo changed: back up, pull           (nachgezogen)
 *   otherwise (both changed)                          → the working copy WINS, nothing is overwritten  (konflikt)
 *
 * "Empty without a basis" is the state every instance has from before this card: a working copy `{"gegenstaende": []}`
 * that was never edited (the base stock comes from `shared`, not from the file). Without this rule the first start
 * would call that a conflict and the 29 base entries would never reach the file. A working copy with own entries
 * and no basis (a Holzaxt) is a real conflict: the working copy wins, the base stock is added by `mitGrundbestand`.
 *
 * Runs under `<working copy>.lock`, the lock the admin route and the watch take, so a save cannot be lost between
 * reading the three hashes and writing. Written atomically (temp file, `rename`), working copy first, then basis.
 * Never throws for a bad file, only for real I/O errors or a lock that does not come free.
 */
export type GegenstandsAbgleichFall = 'angelegt' | 'nachgezogen' | 'unveraendert' | 'konflikt' | 'repo-fehlt' | 'repo-kaputt' | 'arbeit-kaputt' | 'gleicher-pfad';

export interface GegenstandsAbgleich {
  fall: GegenstandsAbgleichFall;
  /** One line for the log (a loud warning for `konflikt`, `repo-kaputt`, `arbeit-kaputt`). */
  meldung: string;
  repoHash: string | null;
  arbeitHash: string | null;
  basisHash: string | null;
  /** Where the old working copy went before it was pulled. */
  sicherung?: string | null;
}

export interface GegenstandsAbgleichOptionen {
  repoDatei: string;
  arbeitsDatei: string;
  /** `voll` creates and pulls (game server, admin route); `pruefen` writes nothing and only names the case. */
  modus?: 'voll' | 'pruefen';
  /** How long to wait for the lock (default 30 s; the admin route passes its own, it holds the lock already). */
  sperreWartenMs?: number;
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

/** What the bytes are as an item file: `null` = no item file; `kanon` = hash of the text the writer makes of them (`null` if it cannot). */
function beschreibe(bytes: Buffer): { kanon: string | null; leer: boolean } | null {
  const lesung = leseGegenstandsDatei(bytes.toString('utf-8'));
  if (lesung.dateiFehler !== null) return null;
  let kanon: string | null = null;
  // An entry the reader discarded is not part of the canonical text: such a file is never "the same" as another.
  if (lesung.verworfen.length === 0) {
    try {
      kanon = layoutHash(schreibeGegenstandsDatei(lesung.eintraege));
    } catch {
      kanon = null;
    }
  }
  return { kanon, leer: lesung.verworfen.length === 0 && lesung.eintraege.length === 0 };
}

const kurz = (h: string | null): string => (h === null ? '-' : h.slice(0, 8));

/** The reconciliation. See the head of this section. */
export function gegenstaendeAbgleichen(opt: GegenstandsAbgleichOptionen): GegenstandsAbgleich {
  const modus = opt.modus ?? 'voll';
  const repoPfad = resolve(opt.repoDatei);
  const arbeitsPfad = resolve(opt.arbeitsDatei);
  if (repoPfad === arbeitsPfad) {
    return { fall: 'gleicher-pfad', meldung: `[Gegenstaende] Arbeitskopie = Repo-Datei (${arbeitsPfad}), kein Abgleich`, repoHash: null, arbeitHash: null, basisHash: null };
  }
  if (modus === 'pruefen') return gegenstaendeAbgleichenOhneSperre(repoPfad, arbeitsPfad, modus);
  return layoutUnterSperre(arbeitsPfad, () => gegenstaendeAbgleichenOhneSperre(repoPfad, arbeitsPfad, modus), { sperreWartenMs: opt.sperreWartenMs ?? 30_000 });
}

/** The same inside a section that already holds `<working copy>.lock` (the admin route). */
export function gegenstaendeAbgleichenOhneSperre(repoPfad: string, arbeitsPfad: string, modus: 'voll' | 'pruefen' = 'voll'): GegenstandsAbgleich {
  const repoBytes = dateiBytes(repoPfad);
  const arbeitBytes = dateiBytes(arbeitsPfad);
  const repoHash = repoBytes === null ? null : layoutHash(repoBytes);
  const arbeitHash = arbeitBytes === null ? null : layoutHash(arbeitBytes);
  const basisHash = gegenstandsBasisLesen(arbeitsPfad);
  const ergebnis = (fall: GegenstandsAbgleichFall, meldung: string, sicherung?: string | null): GegenstandsAbgleich => ({
    fall,
    meldung,
    repoHash,
    arbeitHash,
    basisHash,
    ...(sicherung === undefined ? {} : { sicherung }),
  });

  const arbeit = arbeitBytes === null ? null : beschreibe(arbeitBytes);
  if (arbeitBytes !== null && arbeit === null) {
    return ergebnis(
      'arbeit-kaputt',
      `[Gegenstaende] FEHLER Arbeitskopie ist keine gueltige Gegenstandsdatei (${arbeitBytes.length} Bytes): ${arbeitsPfad}. Nichts wurde geschrieben; der letzte gute Stand und der Grundbestand gelten.`
    );
  }
  if (repoBytes === null || repoHash === null) {
    return ergebnis('repo-fehlt', `[Gegenstaende] Repo-Datei fehlt (${repoPfad}); Arbeitskopie ${arbeitHash === null ? 'fehlt ebenfalls' : `gelesen (${kurz(arbeitHash)})`}`);
  }
  const repo = beschreibe(repoBytes);
  if (repo === null) {
    return ergebnis(
      'repo-kaputt',
      `[Gegenstaende] FEHLER Repo-Datei ist keine gueltige Gegenstandsdatei (${repoBytes.length} Bytes): ${repoPfad}. Es wird NICHTS kopiert. ${arbeitHash === null ? 'Eine Arbeitskopie gibt es nicht.' : `Gelesen wird die Arbeitskopie (${kurz(arbeitHash)}).`}`
    );
  }

  if (arbeitHash === null || arbeit === null) {
    if (modus === 'pruefen') return ergebnis('angelegt', `[Gegenstaende] Arbeitskopie fehlt, wuerde aus dem Repo angelegt (${arbeitsPfad}, Repo ${kurz(repoHash)})`);
    atomarSchreiben(arbeitsPfad, repoBytes);
    atomarSchreiben(gegenstandsBasisNebenDatei(arbeitsPfad), `${repoHash}\n`);
    return ergebnis('angelegt', `[Gegenstaende] Arbeitskopie angelegt aus dem Repo: ${arbeitsPfad} (Repo ${kurz(repoHash)})`);
  }

  if (arbeitHash === repoHash) {
    if (basisHash !== repoHash && modus === 'voll') atomarSchreiben(gegenstandsBasisNebenDatei(arbeitsPfad), `${repoHash}\n`);
    return ergebnis('unveraendert', `[Gegenstaende] Arbeitskopie gelesen: ${arbeitsPfad} (gleich dem Repo, ${kurz(repoHash)})`);
  }
  if (repoHash === basisHash) {
    return ergebnis('unveraendert', `[Gegenstaende] Arbeitskopie gelesen: ${arbeitsPfad} (Hash ${kurz(arbeitHash)}, gegenueber dem Repo ${kurz(repoHash)} geaendert, Repo unveraendert seit der Basis)`);
  }
  if (arbeitHash === basisHash || (basisHash === null && arbeit.leer)) {
    if (modus !== 'voll') {
      return ergebnis('nachgezogen', `[Gegenstaende] Repo hat sich geaendert (Basis ${kurz(basisHash)} → Repo ${kurz(repoHash)}), Arbeitskopie unberuehrt: wird beim Start nachgezogen`);
    }
    // Back up first, then overwrite: if the backup fails nothing changes.
    const sicherung = layoutSichern(arbeitsPfad);
    atomarSchreiben(arbeitsPfad, repoBytes);
    atomarSchreiben(gegenstandsBasisNebenDatei(arbeitsPfad), `${repoHash}\n`);
    return ergebnis(
      'nachgezogen',
      `[Gegenstaende] Arbeitskopie nachgezogen: das Repo hat sich geaendert (Basis ${kurz(basisHash)} → Repo ${kurz(repoHash)}), die Arbeitskopie war unveraendert (${arbeitsPfad}); alter Stand gesichert: ${sicherung ?? '(keiner)'}`,
      sicherung
    );
  }
  if (arbeit.kanon !== null && arbeit.kanon === repo.kanon) {
    // The same items, only formatted differently: no conflict, the basis is the repo.
    if (modus === 'voll') atomarSchreiben(gegenstandsBasisNebenDatei(arbeitsPfad), `${repoHash}\n`);
    return ergebnis('unveraendert', `[Gegenstaende] Arbeitskopie gelesen: ${arbeitsPfad} (nach dem Lesen gleich dem Repo ${kurz(repoHash)}, Basis ${modus === 'voll' ? 'wird' : 'wuerde'} auf das Repo gesetzt)`);
  }
  return ergebnis(
    'konflikt',
    `[Gegenstaende] WARNUNG Konflikt: Repo und Arbeitskopie beide geaendert. Es wird NICHTS ueberschrieben; die Arbeitskopie gilt (Repo ${kurz(repoHash)}, Arbeitskopie ${kurz(arbeitHash)}, Basis ${kurz(basisHash)}): ${arbeitsPfad}. ` +
      `Aenderungen des Repos erreichen die Grundgegenstaende erst, wenn der abweichende Eintrag im Editor auf den Grundstand zurueckgesetzt wird.`
  );
}
