/**
 * Arbeitskopie der Welt — Anlegen, Nachziehen, Abnehmen, Verwerfen.
 *
 * Zur Laufzeit lesen und schreiben Spielserver, Betriebsdienst und MCP die Welt unter
 * `<Arbeitsordner>/<instanz>.json` (shared/src/instanz.ts, `weltDatei`; Ordner: `WOV_WELT_VERZEICHNIS`,
 * sonst `<wurzel>/server/data/welten-arbeit/`). `server/data/welten/<instanz>.json` im Repo ist der
 * ABGENOMMENE Stand. So macht Speichern im Editor den Git-Baum nicht schmutzig, und `tools/wov-update.sh`
 * bricht deswegen nicht ab.
 *
 * Neben der Arbeitskopie liegt `<instanz>.basis`: eine Zeile mit dem Hash (SHA-256 über die Bytes) des
 * Repo-Stands, aus dem die Arbeitskopie zuletzt angelegt oder nachgezogen wurde. Der Abgleich beim
 * Start des Spielservers entscheidet allein aus drei Hashes (Repo, Arbeitskopie, Basis):
 *
 *   Arbeitskopie nicht lesbar (kein Weltdokument)   → NICHTS schreiben, laut melden        (arbeit-kaputt)
 *   Repo-Datei nicht lesbar (kein Weltdokument)     → NICHTS kopieren, laut melden         (repo-kaputt)
 *   Arbeitskopie fehlt                              → aus dem Repo anlegen, Basis schreiben (angelegt)
 *   Arbeitskopie = Repo                             → nichts zu tun, Basis nachtragen      (unveraendert)
 *   Repo = Basis                                    → nur die Arbeitskopie ist geaendert   (unveraendert)
 *   Repo ≠ Basis und Arbeitskopie = Basis           → nur das Repo ist geaendert: sichern
 *                                                     (.bak) und nachziehen                (nachgezogen)
 *   Arbeitskopie und Repo nach dem Sanitizer gleich → dasselbe Dokument, Basis := Repo     (unveraendert)
 *   sonst (beide geaendert, Basis fehlt)            → NICHTS ueberschreiben, laute Warnung (konflikt)
 *
 * ── Sperre ─────────────────────────────────────────────────────────────
 * Anlegen, Nachziehen und Basis schreiben laufen unter `<arbeitsdatei>.lock`, derselben Sperrdatei, die
 * `layoutSchreiben` im Betriebsdienst beim Speichern nimmt (`layoutUnterSperre`). Ohne sie gingen Bearbeitungen
 * verloren (Speichern gewinnt gegen den Abgleich, dann zieht der Abgleich nach) oder der Abgleich meldete
 * „nachgezogen“, obwohl eine Bearbeitung dazwischen kam: gemessen 4–12 verlorene Speicherungen und 28–280 falsche
 * Meldungen in je 500 Wettläufen. Lesen der drei Hashes und Schreiben stehen in EINEM Abschnitt unter der Sperre.
 *
 * Geschrieben wird atomar (`<datei>.<pid>.<zufall>.tmp`, dann `rename`), zuerst die Arbeitskopie, dann die
 * Basis: Bricht der Vorgang dazwischen ab, ist die Arbeitskopie = Repo, und der naechste Lauf traegt die
 * Basis nach (zweite Zeile der Tabelle). Repo-Bytes werden unveraendert kopiert; vorher prueft der Sanitizer,
 * dass sie ein Weltdokument sind (sonst `repo-kaputt`).
 *
 * ── Abnehmen schreibt KEINE Basis ─────────────────────────────────────
 * `weltAbnehmen` setzt nur die Repo-Datei. Die Basis gehoert dem Start: Ist die Arbeitskopie danach dem Repo
 * gleich (oder nach dem Sanitizer gleich), traegt der naechste Start den Repo-Hash als Basis nach; ist das
 * Repo noch der alte Stand (Branch nicht gemergt), bleibt „Repo = Basis“, und die Bearbeitung bleibt liegen.
 * Eine vom Abnehmen gesetzte Basis liess einen DEV-Neustart vor dem Merge die Bearbeitung zurueckziehen.
 *
 * Kein Git hier: der Betriebsdienst und der Server fassen Git nie an. Der Commit gehoert in
 * `tools/welt-abnehmen.sh`.
 *
 * Nicht ueber shared/src/index.ts exportiert (node:fs gehoert nicht ins Client-Buendel).
 */

import { copyFileSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { layoutHash, layoutSichern, layoutSchreiben, layoutText, layoutUnterSperre } from './layoutDatei.js';
import { sanitizeWorldLayout } from './sanitize.js';

export type AbgleichFall =
  | 'angelegt'
  | 'nachgezogen'
  | 'unveraendert'
  | 'konflikt'
  | 'repo-fehlt'
  | 'repo-kaputt'
  | 'arbeit-kaputt'
  | 'gleicher-pfad';

export interface AbgleichErgebnis {
  fall: AbgleichFall;
  /** Eine Zeile fuers Log (bei `konflikt`, `repo-kaputt` und `arbeit-kaputt` die laute Warnung). */
  meldung: string;
  repoHash: string | null;
  arbeitHash: string | null;
  basisHash: string | null;
  /** Pfad der Sicherung, die vor dem Nachziehen angelegt wurde. */
  sicherung?: string | null;
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
  /** So lange wartet der Abgleich auf die Sperre der Arbeitskopie (Vorgabe 30 s). */
  sperreWartenMs?: number;
}

/** Die Basis-Datei zu einer Arbeitskopie: `dev.json` → `dev.basis`. */
export function basisDatei(arbeitsDatei: string): string {
  return arbeitsDatei.replace(/\.json$/, '') + '.basis';
}

function dateiBytes(pfad: string): Buffer | null {
  try {
    return readFileSync(pfad);
  } catch (fehler) {
    if ((fehler as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw fehler;
  }
}

/**
 * Hash des Textes, den der Schreibweg aus diesen Bytes machen wuerde (Sanitizer + `layoutText`), oder null,
 * wenn es kein Weltdokument ist (kein JSON, leer, vom Sanitizer verworfen). Zwei Dateien mit gleichem
 * Kanon-Hash sind dasselbe Dokument, auch wenn die Bytes (Formatierung) abweichen.
 */
export function kanonHash(bytes: Buffer): string | null {
  try {
    const layout = sanitizeWorldLayout(JSON.parse(bytes.toString('utf-8')) as unknown);
    return layout === null ? null : layoutHash(layoutText(layout));
  } catch {
    return null;
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

/** Der Abgleich. Siehe Kopf. Wirft nur bei echten Ein-/Ausgabefehlern (Rechte, Platte) oder wenn die Sperre nicht frei wird. */
export function weltAbgleichen(opt: AbgleichOptionen): AbgleichErgebnis {
  const modus = opt.modus ?? 'voll';
  const repoPfad = resolve(opt.repoDatei);
  const arbeitsPfad = resolve(opt.arbeitsDatei);
  if (repoPfad === arbeitsPfad) {
    return { fall: 'gleicher-pfad', meldung: `[Welt] Arbeitskopie = Repo-Datei (${arbeitsPfad}), kein Abgleich`, repoHash: null, arbeitHash: null, basisHash: null };
  }
  // Nur `pruefen` liest ohne Sperre (es schreibt nichts); alles andere liest UND schreibt in einem Abschnitt.
  if (modus === 'pruefen') return abgleichenOhneSperre(repoPfad, arbeitsPfad, modus);
  return layoutUnterSperre(arbeitsPfad, () => abgleichenOhneSperre(repoPfad, arbeitsPfad, modus), { sperreWartenMs: opt.sperreWartenMs ?? 30_000 });
}

function abgleichenOhneSperre(repoPfad: string, arbeitsPfad: string, modus: 'voll' | 'anlegen' | 'pruefen'): AbgleichErgebnis {
  const repoBytes = dateiBytes(repoPfad);
  const arbeitBytes = dateiBytes(arbeitsPfad);
  const repoHash = repoBytes === null ? null : layoutHash(repoBytes);
  const arbeitHash = arbeitBytes === null ? null : layoutHash(arbeitBytes);
  const basisHash = basisLesen(arbeitsPfad);
  const ergebnis = (fall: AbgleichFall, meldung: string, sicherung?: string | null): AbgleichErgebnis => ({
    fall,
    meldung,
    repoHash,
    arbeitHash,
    basisHash,
    ...(sicherung === undefined ? {} : { sicherung }),
  });

  const arbeitKanon = arbeitBytes === null ? null : kanonHash(arbeitBytes);
  if (arbeitBytes !== null && arbeitKanon === null) {
    return ergebnis(
      'arbeit-kaputt',
      `[Welt] FEHLER Arbeitskopie ist kein gueltiges Weltdokument (${arbeitBytes.length} Bytes): ${arbeitsPfad}. ` +
        `Nichts wurde geschrieben. Reparieren oder verwerfen: tools/welt-abnehmen.sh <instanz> --verwerfen`
    );
  }

  if (repoHash === null || repoBytes === null) {
    return ergebnis('repo-fehlt', `[Welt] Repo-Datei fehlt (${repoPfad}); Arbeitskopie ${arbeitHash === null ? 'fehlt ebenfalls' : `gelesen (${kurz(arbeitHash)})`}`);
  }
  const repoKanon = kanonHash(repoBytes);
  if (repoKanon === null) {
    return ergebnis(
      'repo-kaputt',
      `[Welt] FEHLER Repo-Datei ist kein gueltiges Weltdokument (${repoBytes.length} Bytes): ${repoPfad}. ` +
        `Es wird NICHTS kopiert. ${arbeitHash === null ? 'Eine Arbeitskopie gibt es nicht.' : `Gelesen wird die Arbeitskopie ${arbeitsPfad} (${kurz(arbeitHash)}).`} ` +
        `Die Repo-Datei muss repariert werden (Git-Stand pruefen).`
    );
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
    // Erst sichern, dann ueberschreiben: schlaegt die Sicherung fehl, bleibt alles wie es war.
    const sicherung = layoutSichern(arbeitsPfad);
    atomarSchreiben(arbeitsPfad, repoBytes);
    basisSchreiben(arbeitsPfad, repoHash);
    return ergebnis(
      'nachgezogen',
      `[Welt] Arbeitskopie nachgezogen: das Repo hat sich geaendert (Basis ${kurz(basisHash)} → Repo ${kurz(repoHash)}), die Arbeitskopie war unveraendert (${arbeitsPfad}); alter Stand gesichert: ${sicherung ?? '(keiner)'}`,
      sicherung
    );
  }

  if (arbeitKanon === repoKanon) {
    // Dasselbe Dokument, nur anders formatiert (etwa nach dem Abnehmen): kein Konflikt, die Basis ist das Repo.
    if (modus !== 'pruefen') basisSchreiben(arbeitsPfad, repoHash);
    return ergebnis('unveraendert', `[Welt] Arbeitskopie gelesen: ${arbeitsPfad} (nach dem Sanitizer gleich dem Repo ${kurz(repoHash)}, Basis ${modus === 'pruefen' ? 'wuerde' : 'wird'} auf das Repo gesetzt)`);
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
}

/**
 * Welt abnehmen: Arbeitskopie → Repo, sanitisiert und byte-gleich wie der Betriebsdienst (derselbe
 * Schreibweg `layoutSchreiben`). Die Arbeitskopie und ihre Basis bleiben UNBERUEHRT (siehe Kopf: die Basis
 * gleicht sich beim naechsten Start selbst an). Kein Git hier.
 */
export function weltAbnehmen(opt: { repoDatei: string; arbeitsDatei: string }): AbnehmenErgebnis {
  const arbeitsBytes = readFileSync(opt.arbeitsDatei);
  const roh: unknown = JSON.parse(arbeitsBytes.toString('utf-8'));
  const vorher = dateiBytes(opt.repoDatei);
  // behalten = 0: im Repo-Ordner bleibt keine Sicherung liegen, Git ist die Sicherung.
  const r = layoutSchreiben(opt.repoDatei, roh, 0);
  return { repoDatei: opt.repoDatei, repoHash: r.hash, geaendert: vorher === null || layoutHash(vorher) !== r.hash, verworfen: r.verworfen };
}

/** So viele Sicherungen verworfener Arbeitskopien bleiben liegen (eigene Namen, vom Editor-Speichern nicht rotiert). */
export const VERWORFEN_BEHALTEN = 50;

/**
 * Sicherung einer Arbeitskopie, die verworfen wird: `<datei>.verworfen-<Zeitstempel>.gesichert`. Bewusst NICHT
 * als `.bak`: die `.bak`-Rotation des Editor-Speicherns (10 Stueck) raeumte sonst eine verworfene Bearbeitung
 * nach wenigen Speicherungen weg. Eigene Rotation ueber `VERWORFEN_BEHALTEN`.
 */
export function verworfenSichern(arbeitsDatei: string, behalten = VERWORFEN_BEHALTEN): string | null {
  if (!existsSync(arbeitsDatei)) return null;
  let t = Date.now();
  let ziel: string;
  for (;;) {
    ziel = `${arbeitsDatei}.verworfen-${new Date(t).toISOString().replace(/[:.]/g, '-')}.gesichert`;
    try {
      copyFileSync(arbeitsDatei, ziel, constants.COPYFILE_EXCL);
      break;
    } catch (fehler) {
      if ((fehler as NodeJS.ErrnoException).code !== 'EEXIST') throw fehler;
    }
    t++;
  }
  const ordner = dirname(arbeitsDatei);
  const name = basename(arbeitsDatei);
  const alte = readdirSync(ordner)
    .filter((f) => f.startsWith(`${name}.verworfen-`) && f.endsWith('.gesichert'))
    .sort();
  while (alte.length > behalten) unlinkSync(resolve(ordner, alte.shift()!));
  return ziel;
}

/**
 * Welt verwerfen: Arbeitskopie neu aus dem Repo anlegen. Die alte wird vorher gesichert (`verworfenSichern`); fehlt
 * sie, wird sie einfach angelegt. Ist die Repo-Datei kein Weltdokument, wird nichts veraendert (Fehler). Unter
 * derselben Sperre wie das Editor-Speichern.
 */
export function weltVerwerfen(opt: { repoDatei: string; arbeitsDatei: string }): { sicherung: string | null; repoHash: string; angelegt: boolean } {
  const repoBytes = readFileSync(opt.repoDatei);
  if (kanonHash(repoBytes) === null) throw new Error(`Repo-Datei ${opt.repoDatei} ist kein gueltiges Weltdokument; nichts veraendert`);
  return layoutUnterSperre(opt.arbeitsDatei, () => {
    const angelegt = !existsSync(opt.arbeitsDatei);
    const sicherung = verworfenSichern(opt.arbeitsDatei);
    atomarSchreiben(opt.arbeitsDatei, repoBytes);
    const repoHash = layoutHash(repoBytes);
    basisSchreiben(opt.arbeitsDatei, repoHash);
    return { sicherung, repoHash, angelegt };
  });
}
