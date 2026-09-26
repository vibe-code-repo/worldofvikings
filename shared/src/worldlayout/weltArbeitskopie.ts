/**
 * Arbeitskopie der Welt — Anlegen, Nachziehen, Abnehmen, Verwerfen.
 *
 * Zur Laufzeit lesen und schreiben Spielserver, Betriebsdienst und MCP die Welt unter
 * `<WOV_WELT_VERZEICHNIS, sonst /var/lib/wov/welten>/<instanz>.json` (shared/src/instanz.ts,
 * `weltDatei`). `server/data/welten/<instanz>.json` im Repo ist der ABGENOMMENE Stand. So macht
 * Speichern im Editor den Git-Baum nicht schmutzig, und `tools/wov-update.sh` bricht deswegen nicht ab.
 *
 * Neben der Arbeitskopie liegt `<instanz>.basis`: eine Zeile mit dem Hash (SHA-256 über die Bytes) des
 * Repo-Stands, aus dem die Arbeitskopie zuletzt angelegt oder nachgezogen wurde. Der Abgleich beim
 * Start des Spielservers entscheidet allein aus drei Hashes (Repo, Arbeitskopie, Basis):
 *
 *   Arbeitskopie fehlt                       → aus dem Repo anlegen, Basis schreiben       (angelegt)
 *   Arbeitskopie = Repo                      → nichts zu tun, Basis nachtragen            (unveraendert)
 *   Repo = Basis                             → nur die Arbeitskopie ist geaendert          (unveraendert)
 *   Repo ≠ Basis und Arbeitskopie = Basis    → nur das Repo ist geaendert: nachziehen      (nachgezogen)
 *   sonst (beide geaendert, Basis fehlt)     → NICHTS ueberschreiben, laute Warnung        (konflikt)
 *
 * Geschrieben wird atomar (`<datei>.<pid>.<zufall>.tmp`, dann `rename`), zuerst die Arbeitskopie, dann die
 * Basis: Bricht der Vorgang dazwischen ab, ist die Arbeitskopie = Repo, und der naechste Lauf traegt die
 * Basis nach (zweite Zeile der Tabelle). Repo-Bytes werden unveraendert kopiert; sie stammen aus dem
 * Schreibweg (`layoutSchreiben`) und sind damit schon die verbindliche Byte-Darstellung.
 *
 * Kein Git hier: der Betriebsdienst und der Server fassen Git nie an. Der Commit gehoert in
 * `tools/welt-abnehmen.sh`.
 *
 * Nicht ueber shared/src/index.ts exportiert (node:fs gehoert nicht ins Client-Buendel).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { layoutHash, layoutSichern, layoutSchreiben, layoutText } from './layoutDatei.js';

export type AbgleichFall = 'angelegt' | 'nachgezogen' | 'unveraendert' | 'konflikt' | 'repo-fehlt' | 'gleicher-pfad';

export interface AbgleichErgebnis {
  fall: AbgleichFall;
  /** Eine Zeile fuers Log (bei `konflikt` die laute Warnung). */
  meldung: string;
  repoHash: string | null;
  arbeitHash: string | null;
  basisHash: string | null;
}

export interface AbgleichOptionen {
  /** Der abgenommene Stand im Repo. */
  repoDatei: string;
  /** Die Arbeitskopie. */
  arbeitsDatei: string;
  /**
   * `voll`      anlegen, nachziehen, Warnung (Spielserver);
   * `anlegen`   nur eine fehlende Arbeitskopie anlegen (Betriebsdienst);
   * `pruefen`   nichts schreiben, nur den Fall melden (wov-update.sh).
   */
  modus?: 'voll' | 'anlegen' | 'pruefen';
}

/** Die Basis-Datei zu einer Arbeitskopie: `dev.json` → `dev.basis`. */
export function basisDatei(arbeitsDatei: string): string {
  return arbeitsDatei.replace(/\.json$/, '') + '.basis';
}

function dateiHash(pfad: string): string | null {
  try {
    return layoutHash(readFileSync(pfad));
  } catch (fehler) {
    if ((fehler as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw fehler;
  }
}

export function basisLesen(arbeitsDatei: string): string | null {
  try {
    const t = readFileSync(basisDatei(arbeitsDatei), 'utf-8').trim();
    return /^[0-9a-f]{64}$/.test(t) ? t : null;
  } catch (fehler) {
    if ((fehler as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw fehler;
  }
}

/** Atomar schreiben: Tmp-Datei im selben Ordner, dann rename. */
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

export function basisSchreiben(arbeitsDatei: string, hash: string): void {
  atomarSchreiben(basisDatei(arbeitsDatei), `${hash}\n`);
}

const kurz = (h: string | null): string => (h === null ? '-' : h.slice(0, 8));

/** Der Abgleich. Siehe Kopf. Wirft nur bei echten Ein-/Ausgabefehlern (Rechte, Platte). */
export function weltAbgleichen(opt: AbgleichOptionen): AbgleichErgebnis {
  const modus = opt.modus ?? 'voll';
  const repoPfad = resolve(opt.repoDatei);
  const arbeitsPfad = resolve(opt.arbeitsDatei);
  if (repoPfad === arbeitsPfad) {
    return { fall: 'gleicher-pfad', meldung: `[Welt] Arbeitskopie = Repo-Datei (${arbeitsPfad}), kein Abgleich`, repoHash: null, arbeitHash: null, basisHash: null };
  }
  const repoBytes = existsSync(repoPfad) ? readFileSync(repoPfad) : null;
  const repoHash = repoBytes === null ? null : layoutHash(repoBytes);
  const arbeitHash = dateiHash(arbeitsPfad);
  const basisHash = basisLesen(arbeitsPfad);
  const ergebnis = (fall: AbgleichFall, meldung: string): AbgleichErgebnis => ({ fall, meldung, repoHash, arbeitHash, basisHash });

  if (repoHash === null || repoBytes === null) {
    return ergebnis('repo-fehlt', `[Welt] Repo-Datei fehlt (${repoPfad}); Arbeitskopie ${arbeitHash === null ? 'fehlt ebenfalls' : `gelesen (${kurz(arbeitHash)})`}`);
  }

  if (arbeitHash === null) {
    if (modus === 'pruefen') return ergebnis('angelegt', `[Welt] Arbeitskopie fehlt, wuerde aus dem Repo angelegt (${arbeitsPfad}, Repo ${kurz(repoHash)})`);
    atomarSchreiben(arbeitsPfad, repoBytes);
    basisSchreiben(arbeitsPfad, repoHash);
    return ergebnis('angelegt', `[Welt] Arbeitskopie angelegt aus dem Repo: ${arbeitsPfad} (Repo ${kurz(repoHash)})`);
  }

  if (arbeitHash === repoHash) {
    if (basisHash !== repoHash && modus !== 'pruefen') basisSchreiben(arbeitsPfad, repoHash);
    return ergebnis('unveraendert', `[Welt] Arbeitskopie gelesen: ${arbeitsPfad} (gleich dem Repo, ${kurz(repoHash)})`);
  }

  if (repoHash === basisHash) {
    return ergebnis('unveraendert', `[Welt] Arbeitskopie gelesen: ${arbeitsPfad} (Hash ${kurz(arbeitHash)}, gegenueber dem Repo ${kurz(repoHash)} geaendert, Repo unveraendert seit der Basis)`);
  }

  if (arbeitHash === basisHash) {
    if (modus !== 'voll') {
      return ergebnis('nachgezogen', `[Welt] Repo hat sich geaendert (Basis ${kurz(basisHash)} → Repo ${kurz(repoHash)}), Arbeitskopie unberuehrt: wird beim Start des Spielservers nachgezogen`);
    }
    atomarSchreiben(arbeitsPfad, repoBytes);
    basisSchreiben(arbeitsPfad, repoHash);
    return ergebnis('nachgezogen', `[Welt] Arbeitskopie nachgezogen: das Repo hat sich geaendert (Basis ${kurz(basisHash)} → Repo ${kurz(repoHash)}), die Arbeitskopie war unveraendert (${arbeitsPfad})`);
  }

  return ergebnis(
    'konflikt',
    `[Welt] WARNUNG Weltkonflikt: Repo und Arbeitskopie beide geaendert, Welt abnehmen oder verwerfen ` +
      `(tools/welt-abnehmen.sh). Repo ${kurz(repoHash)}, Arbeitskopie ${kurz(arbeitHash)}, Basis ${kurz(basisHash)}. ` +
      `Es wird NICHTS ueberschrieben; gelesen wird die Arbeitskopie ${arbeitsPfad}.`
  );
}

export interface AbnehmenErgebnis {
  repoDatei: string;
  repoHash: string;
  /** Die Bytes im Repo haben sich geaendert. */
  geaendert: boolean;
  /** So viele rohe Eintraege hat der Sanitizer verworfen (0 im Normalfall). */
  verworfen: number;
  /** Die Arbeitskopie wurde auf die sanitisierten Bytes gesetzt, weil sie davon abwich. */
  arbeitskopieAngeglichen: boolean;
}

/**
 * Welt abnehmen: Arbeitskopie → Repo, sanitisiert und byte-gleich wie der Betriebsdienst (derselbe
 * Schreibweg `layoutSchreiben`), danach die Basis auf den neuen Repo-Stand. Wich die Arbeitskopie in den
 * Bytes vom sanitisierten Text ab (von Hand bearbeitet), wird sie auf diesen Text gesetzt, sonst meldete
 * der naechste Abgleich einen Konflikt, obwohl beides dasselbe Dokument ist. Kein Git hier.
 */
export function weltAbnehmen(opt: { repoDatei: string; arbeitsDatei: string }): AbnehmenErgebnis {
  const arbeitsBytes = readFileSync(opt.arbeitsDatei);
  const roh: unknown = JSON.parse(arbeitsBytes.toString('utf-8'));
  const vorher = dateiHash(opt.repoDatei);
  // behalten = 0: im Repo-Ordner bleibt keine Sicherung liegen, Git ist die Sicherung.
  const r = layoutSchreiben(opt.repoDatei, roh, 0);
  const text = layoutText(r.layout);
  let angeglichen = false;
  if (layoutHash(arbeitsBytes) !== r.hash) {
    // Sicherung der abweichenden Arbeitskopie, dann auf den sanitisierten Text setzen.
    layoutSichern(opt.arbeitsDatei);
    atomarSchreiben(opt.arbeitsDatei, text);
    angeglichen = true;
  }
  basisSchreiben(opt.arbeitsDatei, r.hash);
  return { repoDatei: opt.repoDatei, repoHash: r.hash, geaendert: vorher !== r.hash, verworfen: r.verworfen, arbeitskopieAngeglichen: angeglichen };
}

/** Welt verwerfen: Arbeitskopie neu aus dem Repo anlegen (die alte wird vorher gesichert). Gibt den Sicherungspfad zurueck. */
export function weltVerwerfen(opt: { repoDatei: string; arbeitsDatei: string }): { sicherung: string | null; repoHash: string } {
  const repoBytes = readFileSync(opt.repoDatei);
  const sicherung = layoutSichern(opt.arbeitsDatei);
  atomarSchreiben(opt.arbeitsDatei, repoBytes);
  const repoHash = layoutHash(repoBytes);
  basisSchreiben(opt.arbeitsDatei, repoHash);
  return { sicherung, repoHash };
}
