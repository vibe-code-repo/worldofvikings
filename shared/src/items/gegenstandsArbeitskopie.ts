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

import { dirname, resolve } from 'node:path';
import { weltArbeitsOrdner } from '../instanz.js';

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
