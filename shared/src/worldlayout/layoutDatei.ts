/**
 * Das Weltdokument auf der Platte: lesen, prüfen, sichern, schreiben.
 *
 * ── Warum diese Datei existiert ──────────────────────────────────────
 * Derselbe Dreisatz — Sicherung mit Rotation, atomares Schreiben über
 * `.tmp` + `rename`, Prüfung durch `sanitizeWorldLayout` — stand bis
 * Block A/16 an ZWEI Stellen: im MCP-Server (tools/worldlayout-mcp) und
 * im Speicher-Plugin des Vite-Servers (client/vite.config.ts). Beide
 * schrieben in dieselbe Datei, aber nur eine der beiden Kopien prüfte
 * streng; die andere kam an `@wov/shared` nicht heran und begnügte sich
 * mit einem Struktur-Check. Zwei Schreibwege auf eine Datei, mit
 * unterschiedlich scharfer Prüfung, sind eine Frage der Zeit.
 *
 * Jetzt gibt es genau EINE Stelle, die das Weltdokument schreibt, und
 * jeder Verwender (Betriebsdienst, MCP-Server) bekommt automatisch
 * dieselbe Prüfung, dieselbe Sicherung und dieselbe Byte-Darstellung.
 *
 * ── Warum NICHT über shared/src/index.ts exportiert ──────────────────
 * Der Barrel geht in den Client-Bundle; `node:fs` hat dort nichts zu
 * suchen (Rollup würde es als externes Modul stehen lassen und der
 * Browser bräche beim Laden ab). Verwender importieren direkt:
 *
 *     import { layoutSchreiben } from '@wov/shared/src/worldlayout/layoutDatei.js';
 *
 * Vorbild ist shared/src/instanz.ts, das aus demselben Grund (dort
 * `process.env`) am Barrel vorbeigeht.
 *
 * ── Die Byte-Darstellung ist Teil des Vertrags ───────────────────────
 * `JSON.stringify(layout, null, 2)` OHNE abschliessenden Zeilenumbruch.
 * shared/test/worldlayout.ts hält für BEIDE Weltdateien fest, dass sie
 * bytegleich durch den Sanitizer gehen. Wer hier das Format ändert —
 * andere Einrückung, Zeilenumbruch am Ende, sortierte Schlüssel —
 * bricht diesen Test und damit die Zusicherung, dass ein Speichervorgang
 * des Editors die Welt nicht stillschweigend umformatiert. Ein Diff mit
 * 3000 geänderten Zeilen versteckt die eine Änderung, auf die es ankam.
 */

import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { sanitizeWorldLayout } from './sanitize.js';
import type { WorldLayout } from './types.js';

/**
 * So viele Sicherungen bleiben liegen. Zehn ist kein magischer Wert,
 * sondern die Zahl, mit der beide Vorgänger-Kopien gearbeitet haben —
 * genug, um einen verunglückten Editor-Nachmittag zurückzudrehen, wenig
 * genug, dass der Ordner überschaubar bleibt (10 × ~56 KB).
 */
export const SICHERUNGEN_BEHALTEN = 10;

/**
 * Das Dokument ist unbrauchbar — vom Aufrufer als 400 zu behandeln, nicht
 * als 500. Eine eigene Klasse statt eines Fehlertexts, damit der
 * Betriebsdienst „der Nutzer hat Müll geschickt" von „bei mir ist etwas
 * kaputt" unterscheiden kann, ohne in Meldungen zu greppen.
 */
export class LayoutUngueltig extends Error {
  constructor(meldung: string) {
    super(meldung);
    this.name = 'LayoutUngueltig';
  }
}

/**
 * So viele Platzierungen nimmt der Sanitizer an (`placements.slice(0, 2000)`
 * in sanitize.ts) — alles dahinter schneidet er OHNE Meldung ab. Die Zahl
 * steht dort als Literal; hier wird sie ein zweites Mal benannt, damit
 * `layoutSchreiben` das Überschreiten VOR dem Sanitizer melden kann, statt
 * dass ein Speichervorgang stillschweigend Platzierungen verliert.
 */
export const PLATZIERUNGEN_GRENZE = 2000;

/**
 * Das Dokument hat mehr als `PLATZIERUNGEN_GRENZE` Platzierungen (gezählt am
 * ROHEN Dokument, vor dem Sanitizer). Eine Unterklasse von `LayoutUngueltig`,
 * damit jeder Aufrufer, der sie nicht eigens kennt, sie als „Dokument
 * unbrauchbar" behandelt und nicht als Serverfehler; der Betriebsdienst
 * fängt sie vorher und antwortet 422.
 */
export class LayoutZuVielePlatzierungen extends LayoutUngueltig {
  constructor(
    readonly anzahl: number,
    readonly grenze: number = PLATZIERUNGEN_GRENZE
  ) {
    super(`${anzahl} Platzierungen — mehr als ${grenze} nimmt das Weltdokument nicht auf; nichts gespeichert`);
    this.name = 'LayoutZuVielePlatzierungen';
  }
}

/**
 * Die mitgeschickte Basis passt nicht zur Datei auf der Platte: Zwischen
 * Lesen und Schreiben hat jemand anderes gespeichert. `aktuell` ist der Hash
 * der Datei JETZT (null, wenn sie fehlt) — der Aufrufer kann daraus neu
 * lesen und mergen.
 */
export class LayoutVeraltet extends Error {
  constructor(readonly aktuell: string | null) {
    super('Weltdokument veraltet — die Datei hat sich seit dem Lesen geändert');
    this.name = 'LayoutVeraltet';
  }
}

/**
 * Die Sperrdatei blieb über die Wartezeit hinaus in der Hand eines anderen
 * Schreibers. Kein Fehler des Dokuments, kein Fehler des Servers: „später
 * noch einmal".
 */
export class LayoutGesperrt extends Error {
  constructor(meldung: string) {
    super(meldung);
    this.name = 'LayoutGesperrt';
  }
}

/** Die verbindliche Byte-Darstellung des Weltdokuments. Siehe Kopf. */
export function layoutText(layout: WorldLayout): string {
  return JSON.stringify(layout, null, 2);
}

/**
 * Der Stand einer Weltdatei: SHA-256 (hex, klein) über die BYTES, so wie sie
 * auf der Platte liegen — nicht über das geprüfte Dokument. Zwei Dateien mit
 * demselben geprüften Inhalt, aber anderer Formatierung, haben verschiedene
 * Stände; genau das ist gewollt, denn überschrieben würde die Formatierung
 * auch.
 */
export function layoutHash(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Stand der Datei auf der Platte, oder null, wenn es sie nicht gibt. Andere
 * Lesefehler (Rechte, Verzeichnis statt Datei) werfen.
 */
export function layoutDateiHash(pfad: string): string | null {
  try {
    return layoutHash(readFileSync(pfad));
  } catch (fehler) {
    if ((fehler as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw fehler;
  }
}

/**
 * Weltdokument laden und streng prüfen. Wirft `LayoutUngueltig`, wenn die
 * Datei fehlt, kein JSON ist oder den Sanitizer nicht übersteht.
 *
 * Bewusst wird das GEPRÜFTE Dokument zurückgegeben, nicht der Rohtext:
 * Wer liest, soll dasselbe sehen wie der Spielserver beim Start — sonst
 * zeigt der Editor Felder an, die der Server anschliessend wegwirft.
 */
export function layoutLesen(pfad: string): WorldLayout {
  return layoutLesenMitHash(pfad).layout;
}

/**
 * Wie `layoutLesen`, liefert aber den Hash der gelesenen Bytes mit. Die
 * Datei wird EINMAL gelesen: Hash und Dokument stammen aus denselben Bytes,
 * also gehört die Basis, mit der der Aufrufer später schreibt, wirklich zu
 * dem Dokument, das er gesehen hat. Zwei Lesevorgänge hintereinander
 * könnten dazwischen einen fremden Schreibvorgang erwischen.
 */
export function layoutLesenMitHash(pfad: string): { layout: WorldLayout; hash: string } {
  let bytes: Buffer;
  let roh: unknown;
  try {
    bytes = readFileSync(pfad);
    roh = JSON.parse(bytes.toString('utf-8'));
  } catch (fehler) {
    throw new LayoutUngueltig(`${basename(pfad)} nicht lesbar: ${(fehler as Error).message}`);
  }
  const sauber = sanitizeWorldLayout(roh);
  if (!sauber) throw new LayoutUngueltig(`${basename(pfad)} ist kein gültiges WorldLayout`);
  return { layout: sauber, hash: layoutHash(bytes) };
}

/**
 * Zeitgestempelte Sicherung anlegen und die ältesten wegräumen; gibt den
 * Pfad der neuen Sicherung zurück (oder null, wenn es noch nichts zu
 * sichern gab).
 *
 * Die Namen tragen den ISO-Zeitstempel, deshalb sortiert ein einfaches
 * `.sort()` sie chronologisch — kein `statSync` pro Datei nötig, und das
 * Ergebnis hängt nicht an mtime-Werten, die ein `cp -a` verschieben kann.
 */
export function layoutSichern(pfad: string, behalten = SICHERUNGEN_BEHALTEN): string | null {
  if (!existsSync(pfad)) return null;
  const stempel = new Date().toISOString().replace(/[:.]/g, '-');
  const ziel = `${pfad}.${stempel}.bak`;
  copyFileSync(pfad, ziel);
  const ordner = dirname(pfad);
  const name = basename(pfad);
  const alte = readdirSync(ordner)
    .filter((f) => f.startsWith(`${name}.`) && f.endsWith('.bak'))
    .sort();
  while (alte.length > behalten) unlinkSync(resolve(ordner, alte.shift()!));
  return ziel;
}

/** So lange wartet `layoutSchreiben` auf eine fremde Sperre, bevor es `LayoutGesperrt` wirft. */
export const SPERRE_WARTEN_MS = 3000;
/** Ab diesem Alter (mtime) gilt eine Sperre als verwaist und wird gebrochen. */
export const SPERRE_VERALTET_MS = 30_000;

export interface SchreibOptionen {
  /** Hash der Datei, auf die sich der Schreiber bezieht. Fehlt er, wird ohne Vergleich geschrieben. */
  basis?: string | null;
  sperreWartenMs?: number;
  sperreVeraltetMs?: number;
}

function platzierungenZaehlen(eingabe: unknown): number {
  if (typeof eingabe !== 'object' || eingabe === null) return 0;
  const p = (eingabe as { placements?: unknown }).placements;
  return Array.isArray(p) ? p.length : 0;
}

interface Sperre {
  pfad: string;
  marke: string;
}

/** Synchron schlafen: `layoutSchreiben` ist synchron, ein Busy-Loop würde die CPU grundlos verbrennen. */
function schlafen(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function zufall(): string {
  return randomBytes(6).toString('hex');
}

/**
 * Bricht eine verwaiste Sperre. Gibt true zurück, wenn sich am Zustand der
 * Sperre etwas geändert hat (gebrochen ODER inzwischen weg oder erneuert) —
 * der Aufrufer versucht es dann sofort noch einmal.
 *
 * Nicht `unlink`, sondern `rename` auf einen eindeutigen Namen: Vorher wird
 * noch einmal geprüft, dass es dieselbe Datei ist (Inode und mtime), die
 * eben als veraltet erkannt wurde. Zwei Wartende, die dieselbe verwaiste
 * Sperre sehen, brechen sie so nicht nacheinander — der zweite würde sonst
 * die frische Sperre des ersten löschen.
 */
function verwaisteSperreBrechen(sperrPfad: string, veraltetMs: number): boolean {
  try {
    const gesehen = statSync(sperrPfad);
    const alter = Date.now() - gesehen.mtimeMs;
    if (alter <= veraltetMs) return false;
    const jetzt = statSync(sperrPfad);
    if (jetzt.ino !== gesehen.ino || jetzt.mtimeMs !== gesehen.mtimeMs) return true;
    const beiseite = `${sperrPfad}.verwaist.${process.pid}.${zufall()}`;
    renameSync(sperrPfad, beiseite);
    rmSync(beiseite, { force: true });
    console.warn(
      `[layoutDatei] verwaiste Sperre ${basename(sperrPfad)} gebrochen (${Math.round(alter / 1000)} s alt)`
    );
    return true;
  } catch (fehler) {
    if ((fehler as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw fehler;
  }
}

function sperreNehmen(pfad: string, wartenMs: number, veraltetMs: number): Sperre {
  const sperrPfad = `${pfad}.lock`;
  const marke = `${process.pid}.${zufall()}`;
  const ende = Date.now() + wartenMs;
  for (;;) {
    try {
      const fd = openSync(sperrPfad, 'wx');
      try {
        writeFileSync(fd, marke);
      } catch (fehler) {
        rmSync(sperrPfad, { force: true });
        throw fehler;
      } finally {
        closeSync(fd);
      }
      return { pfad: sperrPfad, marke };
    } catch (fehler) {
      if ((fehler as NodeJS.ErrnoException).code !== 'EEXIST') throw fehler;
    }
    const geaendert = verwaisteSperreBrechen(sperrPfad, veraltetMs);
    if (Date.now() >= ende) {
      throw new LayoutGesperrt(
        `${basename(pfad)} ist gesperrt — ein anderer Schreiber hält ${basename(sperrPfad)} ` +
          `seit mehr als ${wartenMs} ms`
      );
    }
    if (!geaendert) schlafen(5 + Math.floor(Math.random() * 15));
  }
}

function sperreGehoertUns(sperre: Sperre): boolean {
  try {
    return readFileSync(sperre.pfad, 'utf-8') === sperre.marke;
  } catch {
    return false;
  }
}

/** Gibt nur frei, was uns gehört: eine fremde, frische Sperre bleibt liegen. */
function sperreFreigeben(sperre: Sperre): void {
  if (sperreGehoertUns(sperre)) rmSync(sperre.pfad, { force: true });
  else console.warn(`[layoutDatei] Sperre ${basename(sperre.pfad)} gehörte beim Freigeben nicht mehr uns`);
}

/**
 * Räumt Tmp-Dateien weg, die ein abgestürzter Schreiber hinterlassen hat.
 * Nur unter der Sperre und nur ab einem Alter, in dem kein lebender
 * Schreiber mehr daran arbeiten kann. Der feste Tmp-Name von früher wurde
 * beim nächsten Schreiben überschrieben; die eindeutigen Namen würden sich
 * sonst über Abstürze hinweg ansammeln.
 */
function tmpLeichenRaeumen(pfad: string, veraltetMs: number): void {
  const ordner = dirname(pfad);
  const muster = new RegExp(`^${basename(pfad).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.\\d+\\.[0-9a-f]+\\.tmp$`);
  for (const f of readdirSync(ordner)) {
    if (!muster.test(f)) continue;
    const voll = resolve(ordner, f);
    try {
      if (Date.now() - statSync(voll).mtimeMs > veraltetMs) rmSync(voll, { force: true });
    } catch {
      /* zwischen readdir und stat verschwunden — auch gut */
    }
  }
}

/**
 * Weltdokument prüfen, sichern und atomar schreiben — der EINZIGE
 * Schreibweg auf die Weltdatei.
 *
 * `eingabe` ist absichtlich `unknown`: Der Aufrufer soll nicht in die
 * Lage kommen, mit einem `as WorldLayout` an der Prüfung vorbeizukommen.
 * Was hier hineingeht, geht durch `sanitizeWorldLayout` — auch das, was
 * der Aufrufer schon selbst sanitisiert hat (der Sanitizer ist
 * idempotent, genau das hält der Bytegleich-Test in
 * shared/test/worldlayout.ts fest).
 *
 * ── Reihenfolge: erst sichern, dann schreiben ────────────────────────
 * Und zwar UNGESCHÜTZT: Schlägt die Sicherung fehl (Platte voll, Ordner
 * nur lesbar), bricht der Vorgang ab, bevor irgendetwas überschrieben
 * ist. Die MCP-Kopie fing den Fehler hier bisher ab und schrieb trotzdem
 * — das ist genau der Fall, in dem man die Sicherung gebraucht hätte.
 *
 * ── Warum .tmp + rename ──────────────────────────────────────────────
 * `rename` innerhalb desselben Dateisystems ist atomar: Ein Stromausfall
 * mitten im Schreiben hinterlässt die alte Datei vollständig, nie eine
 * halbe. Direkt in die Zieldatei zu schreiben hiesse, dass der
 * Spielserver beim Start eine abgeschnittene Welt lesen könnte.
 * Der Tmp-Name ist je Aufruf eindeutig (`<pfad>.<pid>.<zufall>.tmp`); ein
 * fester Name ließe zwei Prozesse in dieselbe Tmp-Datei schreiben.
 *
 * ── Basis und Sperre ─────────────────────────────────────────────────
 * Mit `optionen.basis` (Hash der Datei, wie ihn `layoutHash` bildet) wird
 * nur geschrieben, wenn die Datei noch genau so aussieht: sonst
 * `LayoutVeraltet`, Datei unverändert. Ohne Basis gilt weiter „wer zuletzt
 * speichert, gewinnt". Vergleich, Sicherung und Rename laufen unter einer
 * Sperrdatei (`<pfad>.lock`, `open(..., 'wx')`), weil Vergleich und Rename
 * über Prozessgrenzen sonst nicht atomar sind. Die Sperre schützt
 * Schreiber voreinander, nicht Leser: Leser sehen dank Rename immer eine
 * ganze Datei.
 *
 * ── Die Grenze der Sperre ────────────────────────────────────────────
 * Eine Sperre, die ein abgestürzter Prozess hinterlassen hat, wird nach
 * `SPERRE_VERALTET_MS` gebrochen. Ein Schreiber, der so lange stillsteht
 * und danach erwacht, kann mit dem neuen Halter zusammentreffen; die
 * Prüfung `sperreGehoertUns` vor dem Rename verkleinert dieses Fenster auf
 * Mikrosekunden, schließt es aber nicht ganz. Für einen Dienst, der Sekunden
 * hält und in Millisekunden schreibt, ist das die richtige Größenordnung.
 */
export function layoutSchreiben(
  pfad: string,
  eingabe: unknown,
  behalten = SICHERUNGEN_BEHALTEN,
  optionen: SchreibOptionen = {}
): { layout: WorldLayout; sicherung: string | null; text: string; hash: string } {
  // Gezählt am ROHEN Dokument, vor dem Sanitizer: Der schneidet still bei
  // 2000 ab, und ein Editor, der 2001 hält, würde eine Platzierung
  // verlieren, ohne dass jemand es erfährt.
  const anzahl = platzierungenZaehlen(eingabe);
  if (anzahl > PLATZIERUNGEN_GRENZE) throw new LayoutZuVielePlatzierungen(anzahl);
  const veraltetMs = optionen.sperreVeraltetMs ?? SPERRE_VERALTET_MS;
  const layout = sanitizeWorldLayout(eingabe);
  if (!layout) throw new LayoutUngueltig('Kein gültiges WorldLayout — verworfen');
  // ── Warum diese zusätzliche Hürde ──────────────────────────────────
  // Der Sanitizer klemmt und verwirft, aber er WIRFT nicht: Ein Dokument
  //     { version: 1, name: "x", regions: "kein Array" }
  // kommt als vollständig gültiges Layout mit NULL Regionen heraus —
  // offene See. Genau das fällt aus einem halb übertragenen Upload, einem
  // vertauschten Feld oder einem Editor-Zustand heraus, der noch nichts
  // geladen hatte. Ohne diese Zeile ersetzte so ein Fehlgriff eine Welt
  // mit 158 Platzierungen durch 102 Bytes Wasser, und zwar mit 200 OK.
  //
  // Der alte Struktur-Check im Vite-Plugin hat das nebenbei mit erledigt
  // (`Array.isArray(sauber.regions)`); beim Umstieg auf die STRENGE
  // Prüfung wäre diese Zusicherung sonst verlorengegangen — die strengere
  // Prüfung ist an dieser einen Stelle die nachsichtigere.
  //
  // Nur beim SCHREIBEN, nicht beim Lesen: Wer eine leere Datei von Hand
  // hinlegt, soll sie noch öffnen und reparieren können.
  if (layout.regions.length === 0) {
    throw new LayoutUngueltig(
      'Weltdokument ohne eine einzige Region — verworfen. Das wäre eine Welt aus offener See; ' +
        'wahrscheinlich ist das Dokument unvollständig übertragen worden.'
    );
  }
  const text = layoutText(layout);
  mkdirSync(dirname(pfad), { recursive: true });
  const sperre = sperreNehmen(pfad, optionen.sperreWartenMs ?? SPERRE_WARTEN_MS, veraltetMs);
  try {
    // Der Vergleich steht INNERHALB der Sperre, sonst wäre er wertlos: Zwischen
    // einem Vergleich davor und dem Rename könnte ein zweiter Prozess seine
    // Datei hinlegen, und beide hielten sich für die Basis.
    if (optionen.basis !== undefined && optionen.basis !== null) {
      const aktuell = layoutDateiHash(pfad);
      if (aktuell !== optionen.basis) throw new LayoutVeraltet(aktuell);
    }
    tmpLeichenRaeumen(pfad, veraltetMs);
    const sicherung = layoutSichern(pfad, behalten);
    const tmp = `${pfad}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      writeFileSync(tmp, text);
      // Letzte Prüfung vor dem einen Schritt, der nicht zurückzunehmen ist:
      // Wurde die Sperre inzwischen als verwaist gebrochen (Prozess stand
      // länger als die Frist still), gehört die Datei jemand anderem.
      if (!sperreGehoertUns(sperre)) {
        throw new LayoutGesperrt(
          `Sperre auf ${basename(pfad)} während des Schreibens verloren — nichts geschrieben`
        );
      }
      renameSync(tmp, pfad);
    } catch (fehler) {
      rmSync(tmp, { force: true });
      throw fehler;
    }
    return { layout, sicherung, text, hash: layoutHash(text) };
  } finally {
    sperreFreigeben(sperre);
  }
}
