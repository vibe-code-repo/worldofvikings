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
  constants,
  copyFileSync,
  existsSync,
  linkSync,
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
import { hostname } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { sanitizeWorldLayout, sanitizeWorldLayoutMitBericht } from './sanitize.js';
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
 *
 * Zwei Sicherungen in derselben Millisekunde bekämen denselben Namen, und
 * die zweite überschriebe die erste. Deshalb wird der Zeitstempel um eine
 * Millisekunde hochgezählt, bis der Name frei ist; das hält die Namen
 * eindeutig UND in der Reihenfolge des Entstehens. `COPYFILE_EXCL` macht aus
 * „Name frei?" und „anlegen" einen Schritt, falls doch jemand dazwischenkommt.
 */
export function layoutSichern(pfad: string, behalten = SICHERUNGEN_BEHALTEN): string | null {
  if (!existsSync(pfad)) return null;
  let t = Date.now();
  let ziel: string;
  for (;;) {
    ziel = `${pfad}.${new Date(t).toISOString().replace(/[:.]/g, '-')}.bak`;
    if (!existsSync(ziel)) {
      try {
        copyFileSync(pfad, ziel, constants.COPYFILE_EXCL);
        break;
      } catch (fehler) {
        if ((fehler as NodeJS.ErrnoException).code !== 'EEXIST') throw fehler;
      }
    }
    t++;
  }
  const ordner = dirname(pfad);
  const name = basename(pfad);
  const alte = readdirSync(ordner)
    .filter((f) => f.startsWith(`${name}.`) && f.endsWith('.bak'))
    .sort();
  while (alte.length > behalten) unlinkSync(resolve(ordner, alte.shift()!));
  return ziel;
}

// ══ Sperre ════════════════════════════════════════════════════════════
//
// Die Sperrdatei `<pfad>.lock` trägt, wem sie gehört:
//     { pid, start, host, marke }
// `start` ist die Startzeit des Prozesses (Linux: /proc/<pid>/stat, Feld 22),
// damit eine WIEDERVERWENDETE pid nicht für den Besitzer gehalten wird.
//
// ── Wann eine Sperre gebrochen wird ──────────────────────────────────
// NUR, wenn ihr Besitzer nachweislich nicht mehr lebt: `kill(pid, 0)` meldet
// ESRCH, der Prozess ist ein Zombie, oder unter dieser pid läuft ein anderer
// Prozess (Startzeit passt nicht). Dann SOFORT — ein Absturz zwischen Sperre
// und Rename soll den nächsten Speichervorgang nicht 30 s lang aussperren.
// Die Sperre eines LEBENDEN Besitzers wird nie gebrochen, egal wie alt: Ein
// langsamer Schreiber (GC-Pause, volle Platte, angehaltener Container) bleibt
// Besitzer, bis er fertig ist. Früher brach ein Wartender jede Sperre ab 30 s,
// und der langsame Schreiber benannte danach seinen Tmp-Stand über den des
// anderen — ein Lost Update trotz Sperre.
//
// Nicht entscheidbar ist der Besitzer bei einem anderen Rechnernamen (gemeinsames
// Dateisystem, oder ein neuer Container mit neuem Namen nach einem Absturz;
// `kill` wirkt nur lokal) und bei einer Sperre ohne Startzeit (von Hand oder aus
// einem fremden Werkzeug; ohne sie erkennt man eine wiederverwendete pid nicht).
// Eine solche Sperre darf nicht ewig halten — der Dienst käme nach einem
// Neustart nie wieder zum Schreiben. Aber „Alter“ ist nur dann ein Zeichen für
// einen toten Besitzer, wenn ein LEBENDER es nicht jung hält. Deshalb gilt:
//  - Der HALTER frischt die mtime seiner Sperrdatei alle `HERZSCHLAG_MS` (5 s)
//    auf, solange er hält (Herzschlag, siehe unten). Das Alter misst so
//    Untätigkeit, nicht die Dauer des Schreibvorgangs.
//  - Eine nicht entscheidbare Sperre gilt erst als verwaist, wenn ihre mtime
//    älter als `sperreUnentscheidbarMs` (10 min) ist, und wird dann mit lauter
//    Logzeile (Rechner, pid, Alter) gebrochen.
// Die Grenze, ehrlich: Geteilte Laufwerke über mehrere Rechner werden NICHT
// unterstützt. Ein Schreiber, der länger als 10 min angehalten ist (eingefrorener
// Container, hängender Netz-Mount), kann seine Sperre verlieren; kommt er zurück,
// schreibt er über den Sieger. Auf einem lokalen Dateisystem, wo ein Schreibvorgang
// Millisekunden dauert und der Besitzer entscheidbar ist, tritt das nicht auf.
//
// Der Herzschlag läuft in einem eigenen Thread (`worker_threads`), nicht in einem
// Timer des Prozesses: Der kritische Abschnitt ist synchron, und ein Halter, der
// in einem hängenden Systemaufruf steht, bedient keinen Timer. Ein angehaltener
// Prozess (SIGSTOP, eingefrorener Container) hält ALLE Threads an — dann bleibt
// die mtime stehen, und nach 10 min gilt die Sperre als verwaist.
//
// Eine Sperre OHNE lesbare Besitzangabe (von Hand angelegt, oder ein Prozess
// stürzte in den Mikrosekunden zwischen `open` und `write` ab) hat keinen
// Besitzer, den man prüfen könnte; sie gilt ab `sperreVeraltetMs` (30 s) als
// Müll — ein lebender Schreiber schreibt seine Angabe sofort.
//
// Die eigene Sperrleiche — Sperre mit der pid UND der Startzeit DIESES Prozesses,
// aber einer Marke, die er gerade nicht hält (ein Freigeben ist gescheitert) —
// ist verwaist und wird sofort gebrochen. Voraussetzung: Der Prozess hält seine
// Sperren nie quer über einen `await` (der kritische Abschnitt hat keinen), und
// kein zweiter Thread desselben Prozesses schreibt dieselbe Datei.
//
// Bewusst NICHT gebrochen wird die Sperre eines lebenden, aber angehaltenen
// Prozesses auf DIESEM Rechner (SIGSTOP): Er lebt, und würde er später
// weiterlaufen, schriebe er über den Sieger. Der Aufrufer bekommt
// `LayoutGesperrt` mit pid und Rechner des Besitzers; ab 30 s Alter steht in
// Meldung und Log, dass ein Eingriff von Hand nötig ist.

/** So lange wartet `layoutSchreiben` auf eine fremde Sperre, bevor es `LayoutGesperrt` wirft. */
export const SPERRE_WARTEN_MS = 3000;
/**
 * Alter (mtime der Sperrdatei), ab dem eine Sperre OHNE lesbare Besitzangabe als
 * Müll gebrochen wird. Die Sperre eines lebenden Besitzers auf DIESEM Rechner
 * hängt NICHT davon ab.
 */
export const SPERRE_VERALTET_MS = 30_000;
/**
 * Alter (mtime der Sperrdatei), ab dem eine Sperre, deren Besitzer sich von hier
 * aus nicht prüfen lässt (anderer Rechnername, keine Startzeit), als verwaist
 * gebrochen wird — und ab dem eine Tmp-Datei eines nicht prüfbaren Besitzers
 * weggeräumt wird. Der Halter frischt die mtime alle `HERZSCHLAG_MS` auf, also
 * misst dieses Alter Untätigkeit. Siehe „Wann eine Sperre gebrochen wird“.
 */
export const SPERRE_UNENTSCHEIDBAR_MS = 600_000;
/** So oft frischt der Halter die mtime seiner Sperrdatei auf. */
export const HERZSCHLAG_MS = 5000;
/** Ab diesem Alter einer von einem lebenden Prozess gehaltenen Sperre gibt es eine Logzeile. */
const SPERRE_LOGGEN_AB_MS = 30_000;

export interface SchreibOptionen {
  /** Hash der Datei, auf die sich der Schreiber bezieht. Fehlt er, wird ohne Vergleich geschrieben. */
  basis?: string | null;
  /**
   * Ein Dokument ohne jede Region zulassen.
   *
   * WARUM es diese Option gibt: `schreibenVorbereiten` verweigert jedes Dokument ohne Region, weil ein solches
   * Dokument aus einem halb übertragenen Upload oder einem vertauschten Feld entsteht und sonst eine Welt still
   * durch offene See ersetzte (s. dort). Genau EIN Fall will eine leere Welt wirklich schreiben: das Zurücksetzen der
   * Welt im Editor (K4.0, admin/src/routen/weltZuruecksetzen.ts), nach Tippbestätigung und mit Sicherung.
   *
   * Sie darf sonst NIRGENDS gesetzt werden: nicht im Speicherweg des Editors, nicht in PATCH .../ops, nicht im MCP.
   * Dass genau eine Stelle sie setzt, hält admin/test/welt-zuruecksetzen.ts am Syntaxbaum fest.
   */
  leereWelt?: boolean;
  sperreWartenMs?: number;
  /** Frist für eine Sperre ohne lesbare Besitzangabe (Vorgabe `SPERRE_VERALTET_MS`). */
  sperreVeraltetMs?: number;
  /** Frist für eine Sperre mit nicht prüfbarem Besitzer (Vorgabe `SPERRE_UNENTSCHEIDBAR_MS`). */
  sperreUnentscheidbarMs?: number;
}

export type SchreibErgebnis = {
  layout: WorldLayout;
  sicherung: string | null;
  text: string;
  hash: string;
  /** So viele rohe Einträge (Summe über alle Listen) hat der Sanitizer verworfen; 0 im Normalfall. */
  verworfen: number;
  /** Dasselbe je Liste (`placements`, `continents`, `routes`, `rivers`, `lakes`); nur Felder mit Verlust stehen drin. */
  verworfenJeFeld: Record<string, number>;
  /**
   * So viele exakte Duplikate hat der Sanitizer zu einem Eintrag zusammengefasst (heute nur
   * `placements`). Das ist KEIN Verlust und zählt deshalb nicht bei `verworfen`.
   */
  zusammengefasst: number;
  /** Dasselbe je Liste; nur Felder mit zusammengefassten Einträgen stehen drin. */
  zusammengefasstJeFeld: Record<string, number>;
};

interface SperrInfo {
  pid: number;
  start: string | null;
  host: string;
  marke: string;
}

interface Sperre {
  pfad: string;
  inhalt: string;
}

function zufall(): string {
  return randomBytes(6).toString('hex');
}

/** Synchron schlafen: ein Busy-Loop würde die CPU grundlos verbrennen. Nur für den synchronen Schreibweg. */
function schlafen(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const pauseMs = (): number => 5 + Math.floor(Math.random() * 15);

/** Startzeit und Zustand eines Prozesses aus /proc (Linux); null, wo es das nicht gibt. */
function prozessDaten(pid: number): { start: string; zustand: string } | null {
  try {
    const s = readFileSync(`/proc/${pid}/stat`, 'utf-8');
    // Der Prozessname (Feld 2) steht in Klammern und darf selbst Klammern und
    // Leerzeichen enthalten — deshalb ab der LETZTEN Klammer zählen. Danach
    // beginnt Feld 3 (Zustand); Feld 22 (Startzeit) ist das 20. Element.
    const rest = s.slice(s.lastIndexOf(')') + 2).split(' ');
    return rest[19] === undefined ? null : { start: rest[19], zustand: rest[0] ?? '' };
  } catch {
    return null;
  }
}

/** Die Sperren, die DIESER Prozess gerade hält (ihr Inhalt); alles andere mit unserer pid und Startzeit ist Leiche. */
const gehalten = new Set<string>();

// ── Herzschlag ────────────────────────────────────────────────────────
// Ein eigener Thread, der die mtime der gehaltenen Sperren auffrischt (nur, solange der
// Inhalt noch unserer ist). Er wird beim ersten Sperren-Nehmen gestartet und hängt den
// Prozess nicht am Leben (`unref`). Fällt er aus, läuft alles ohne Herzschlag weiter: Dann
// gilt wieder nur die 10-min-Frist.
const HERZSCHLAG_CODE = `
const { parentPort } = require('node:worker_threads');
const fs = require('node:fs');
const gehalten = new Map();
parentPort.on('message', (m) => {
  if (m.art === 'halten') gehalten.set(m.pfad, m.inhalt);
  else gehalten.delete(m.pfad);
});
setInterval(() => {
  for (const [pfad, inhalt] of gehalten) {
    try {
      if (fs.readFileSync(pfad, 'utf-8') === inhalt) {
        const t = new Date();
        fs.utimesSync(pfad, t, t);
      }
    } catch {
      /* die Sperre ist weg oder nicht lesbar: nichts zu beleben */
    }
  }
}, ${HERZSCHLAG_MS});
`;
let herzschlag: Worker | null | undefined;

function herzschlagMelden(nachricht: { art: 'halten'; pfad: string; inhalt: string } | { art: 'frei'; pfad: string }): void {
  try {
    if (herzschlag === undefined) {
      const w = new Worker(HERZSCHLAG_CODE, { eval: true });
      w.unref();
      w.on('error', (fehler) => {
        console.error(`[layoutDatei] Herzschlag-Thread ausgefallen: ${fehler.message} — es gilt nur noch die Frist`);
        herzschlag = null;
      });
      herzschlag = w;
    }
    herzschlag?.postMessage(nachricht);
  } catch (fehler) {
    console.error(`[layoutDatei] Herzschlag-Thread nicht startbar: ${(fehler as Error).message} — es gilt nur noch die Frist`);
    herzschlag = null;
  }
}

function sperreInhalt(): string {
  const info: SperrInfo = {
    pid: process.pid,
    start: prozessDaten(process.pid)?.start ?? null,
    host: hostname(),
    marke: zufall(),
  };
  return JSON.stringify(info);
}

function sperreLesen(text: string): SperrInfo | null {
  try {
    const o = JSON.parse(text) as Partial<SperrInfo> | null;
    if (
      o !== null &&
      typeof o === 'object' &&
      Number.isInteger(o.pid) &&
      (o.pid as number) > 0 &&
      typeof o.host === 'string' &&
      typeof o.marke === 'string' &&
      (o.start === null || typeof o.start === 'string')
    ) {
      return o as SperrInfo;
    }
  } catch {
    /* kein JSON */
  }
  return null;
}

function besitzerPruefen(info: SperrInfo): 'lebt' | 'tot' | 'unbekannt' {
  if (info.host !== hostname()) return 'unbekannt';
  try {
    process.kill(info.pid, 0);
  } catch (fehler) {
    const code = (fehler as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return 'tot';
    if (code !== 'EPERM') return 'unbekannt';
  }
  const jetzt = prozessDaten(info.pid);
  if (jetzt !== null && jetzt.zustand === 'Z') return 'tot'; // beendet, aber noch nicht abgeholt
  if (info.start === null) {
    // Ohne Startzeit lässt sich eine wiederverwendete pid nicht von dem Besitzer unterscheiden
    // ("irgendein Prozess hat diese pid" ist kein Beweis, dass es unser Besitzer ist). Wo es /proc
    // gibt, schreibt dieser Code die Startzeit immer; eine Sperre ohne sie stammt von Hand oder
    // aus einem fremden Werkzeug und gilt als nicht entscheidbar (30-s-Frist wie bei einem fremden
    // Rechner). Ohne /proc (Nicht-Linux) bleibt es beim `kill`-Ergebnis.
    return prozessDaten(process.pid) !== null ? 'unbekannt' : 'lebt';
  }
  if (jetzt !== null && jetzt.start !== info.start) return 'tot'; // pid wiederverwendet
  return 'lebt';
}

/** Lebt der Prozess mit dieser pid auf DIESEM Rechner? (Zombie zählt als tot.) */
function pidStatus(pid: number): 'lebt' | 'tot' {
  try {
    process.kill(pid, 0);
  } catch (fehler) {
    if ((fehler as NodeJS.ErrnoException).code === 'ESRCH') return 'tot';
    return 'lebt';
  }
  return prozessDaten(pid)?.zustand === 'Z' ? 'tot' : 'lebt';
}

type Urteil =
  | { art: 'frei' }
  | { art: 'brechen'; roh: string; pid: number | null; grund: string }
  | { art: 'besetzt'; beschreibung: string; alterMs: number };

function sperreBeurteilen(sperrPfad: string, veraltetMs: number, unentscheidbarMs: number): Urteil {
  let roh: string;
  let alterMs: number;
  try {
    roh = readFileSync(sperrPfad, 'utf-8');
    alterMs = Date.now() - statSync(sperrPfad).mtimeMs;
  } catch (fehler) {
    if ((fehler as NodeJS.ErrnoException).code === 'ENOENT') return { art: 'frei' };
    throw fehler;
  }
  const info = sperreLesen(roh);
  if (info === null) {
    if (alterMs > veraltetMs) {
      return { art: 'brechen', roh, pid: null, grund: `ohne lesbare Besitzangabe, ${Math.round(alterMs / 1000)} s alt` };
    }
    return { art: 'besetzt', beschreibung: 'Sperre ohne lesbare Besitzangabe', alterMs };
  }
  // Die eigene Leiche: unsere pid UND Startzeit, aber eine Marke, die wir gerade nicht halten (ein
  // Freigeben ist gescheitert). Ein anderer Prozess mit unserer pid hätte eine andere Startzeit.
  if (info.pid === process.pid && info.host === hostname() && !gehalten.has(roh)) {
    const meine = prozessDaten(process.pid)?.start ?? null;
    if (meine !== null && info.start === meine) {
      return { art: 'brechen', roh, pid: null, grund: 'eigene Sperrleiche (ein früheres Freigeben ist gescheitert)' };
    }
  }
  switch (besitzerPruefen(info)) {
    case 'tot':
      return { art: 'brechen', roh, pid: info.pid, grund: `Besitzer pid ${info.pid} lebt nicht mehr` };
    case 'lebt':
      return { art: 'besetzt', beschreibung: `gehalten von pid ${info.pid} auf Rechner ${info.host}, der lebt`, alterMs };
    default:
      // Lebendprüfung von hier aus unmöglich (anderer Rechner, keine Startzeit): nach
      // `unentscheidbarMs` (10 min) OHNE Herzschlag gilt die Sperre als verwaist. Die pid
      // sagt hier nichts, deshalb werden auch keine Tmp-Dateien dieser pid geräumt (pid: null).
      if (alterMs > unentscheidbarMs) {
        return {
          art: 'brechen',
          roh,
          pid: null,
          grund:
            `ACHTUNG Besitzer pid ${info.pid} auf Rechner ${info.host} (dieser Rechner: ${hostname()}) ` +
            `lässt sich von hier nicht sicher prüfen (${info.host !== hostname() ? 'anderer Rechner' : 'Startzeit fehlt in der Sperre'}), ` +
            `Sperre ${Math.round(alterMs / 1000)} s alt und ohne Herzschlag (Grenze ${Math.round(unentscheidbarMs / 1000)} s) — ` +
            `als verwaist behandelt, er könnte noch leben. Geteilte Laufwerke über mehrere Rechner werden ` +
            `nicht unterstützt; ein Schreiber, der länger als ${Math.round(unentscheidbarMs / 60000)} min angehalten ist, ` +
            `kann seine Sperre verlieren`,
        };
      }
      return {
        art: 'besetzt',
        beschreibung:
          `gehalten von pid ${info.pid} auf Rechner ${info.host} (ob er lebt, lässt sich von hier nicht ` +
          `sicher prüfen; ohne Herzschlag gilt die Sperre ab ${Math.round(unentscheidbarMs / 60000)} min Alter als verwaist)`,
        alterMs,
      };
  }
}

const dateiMuster = (pfad: string, mitte: string): RegExp =>
  new RegExp(`^${basename(pfad).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.${mitte}$`);

/** Tmp-Dateien eines Prozesses, von dem feststeht, dass er nicht mehr lebt, sofort wegräumen. */
function tmpVonToterpidRaeumen(pfad: string, pid: number): void {
  const ordner = dirname(pfad);
  const muster = dateiMuster(pfad, `${pid}\\.[0-9a-f]+\\.tmp`);
  for (const f of readdirSync(ordner)) if (muster.test(f)) rmSync(resolve(ordner, f), { force: true });
}

/**
 * Bricht eine verwaiste Sperre. Nicht `unlink`, sondern `rename` auf einen
 * eindeutigen Namen, und danach wird geprüft, dass WIRKLICH die beurteilte
 * Sperre weggeräumt wurde: Zwischen Urteil und Rename kann ein anderer
 * Wartender dieselbe Sperre gebrochen und eine frische angelegt haben — die
 * hätten wir dann gerade ihrem lebenden Besitzer entzogen. In dem Fall legen
 * wir sie zurück.
 *
 * Gelingt das Zurücklegen NICHT (Dateisystem ohne harte Links, oder ein Dritter
 * hat in der Lücke schon eine neue Sperre angelegt), wird NICHT weitergemacht:
 * `LayoutGesperrt`, nichts geschrieben. Der Besitzer der weggenommenen Sperre
 * steht vielleicht schon hinter seiner Prüfung `sperreGehoertUns` und schreibt
 * gleich; schriebe der Brecher jetzt auch, hätten wir zwei Schreiber und einen
 * gemeldeten Hash, der nicht auf der Platte liegt. Der Brecher meldet ehrlich 503.
 *
 * Was das NICHT zusagt: Es bleibt nur dann höchstens EIN Schreiber übrig, solange
 * harte Links funktionieren (dann wird die Sperre zurückgelegt und ist nie weg).
 * Scheitert das Zurücklegen, ist die Sperre des Besitzers für den Rest seines
 * kritischen Abschnitts weg; kommt in dieser Zeit ein dritter Schreiber (mit
 * Basis) hinein, schreiben zwei. Das Fenster ist Mikrosekunden breit (Besitzer
 * hinter seiner Prüfung, vor dem Rename) und nur mit Fehlerinjektion erreicht
 * worden; ein Umbau auf eine Kernel-Sperre (`flock`) würde es schließen.
 */
function sperreBrechen(sperrPfad: string, pfad: string, u: { roh: string; pid: number | null; grund: string }): void {
  const beiseite = `${pfad}.${process.pid}.${zufall()}.tmp`;
  try {
    renameSync(sperrPfad, beiseite);
  } catch (fehler) {
    if ((fehler as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw fehler;
  }
  let jetzt: string | null;
  try {
    jetzt = readFileSync(beiseite, 'utf-8');
  } catch {
    jetzt = null;
  }
  if (jetzt !== u.roh) {
    let zurueck = false;
    try {
      linkSync(beiseite, sperrPfad);
      zurueck = true;
    } catch {
      /* unten */
    }
    rmSync(beiseite, { force: true });
    if (zurueck) {
      console.warn(`[layoutDatei] ${basename(sperrPfad)}: fremde frische Sperre versehentlich weggenommen und zurückgelegt`);
      return;
    }
    console.warn(
      `[layoutDatei] ${basename(sperrPfad)}: fremde frische Sperre weggenommen, Zurücklegen scheiterte — es wird nicht geschrieben`
    );
    throw new LayoutGesperrt(
      `${basename(pfad)}: beim Brechen einer Sperre wurde die frische Sperre eines anderen Schreibers versehentlich ` +
        `weggenommen und ließ sich nicht zurücklegen — nichts geschrieben, bitte noch einmal versuchen`
    );
  }
  rmSync(beiseite, { force: true });
  if (u.pid !== null) tmpVonToterpidRaeumen(pfad, u.pid);
  console.warn(`[layoutDatei] verwaiste Sperre ${basename(sperrPfad)} gebrochen: ${u.grund}`);
}

function sperreAnlegen(sperrPfad: string): Sperre | null {
  const inhalt = sperreInhalt();
  let fd: number;
  try {
    fd = openSync(sperrPfad, 'wx');
  } catch (fehler) {
    if ((fehler as NodeJS.ErrnoException).code === 'EEXIST') return null;
    throw fehler;
  }
  try {
    writeFileSync(fd, inhalt);
  } catch (fehler) {
    closeSync(fd);
    rmSync(sperrPfad, { force: true });
    throw fehler;
  }
  closeSync(fd);
  gehalten.add(inhalt);
  herzschlagMelden({ art: 'halten', pfad: sperrPfad, inhalt });
  return { pfad: sperrPfad, inhalt };
}

type Versuch = { sperre: Sperre } | { besetzt: string; alterMs: number };

/** Ein Versuch, die Sperre zu bekommen — wartet nicht. Bricht dabei nur, was nachweislich verwaist ist. */
function sperreVersuchen(pfad: string, veraltetMs: number, unentscheidbarMs: number): Versuch {
  const sperrPfad = `${pfad}.lock`;
  for (let i = 0; i < 5; i++) {
    const sperre = sperreAnlegen(sperrPfad);
    if (sperre) return { sperre };
    const u = sperreBeurteilen(sperrPfad, veraltetMs, unentscheidbarMs);
    if (u.art === 'besetzt') return { besetzt: u.beschreibung, alterMs: u.alterMs };
    if (u.art === 'brechen') sperreBrechen(sperrPfad, pfad, u);
  }
  return { besetzt: 'die Sperre wechselt laufend den Besitzer', alterMs: 0 };
}

function gesperrt(pfad: string, v: { besetzt: string; alterMs: number }, wartenMs: number): LayoutGesperrt {
  const alter = Math.round(v.alterMs / 1000);
  if (v.alterMs >= SPERRE_LOGGEN_AB_MS) {
    console.warn(`[layoutDatei] ${basename(pfad)}.lock seit ${alter} s ${v.besetzt} — wird NICHT gebrochen`);
  }
  const hinweis =
    v.alterMs >= SPERRE_LOGGEN_AB_MS
      ? `; läuft der Prozess noch, ist ein Eingriff von Hand nötig (${basename(pfad)}.lock entfernen, wenn er wirklich festhängt)`
      : '';
  return new LayoutGesperrt(
    `${basename(pfad)} ist gesperrt (${v.besetzt}, Sperre ${alter} s alt) — nach ${wartenMs} ms aufgegeben${hinweis}`
  );
}

function sperreNehmen(pfad: string, wartenMs: number, veraltetMs: number, unentscheidbarMs: number): Sperre {
  const ende = Date.now() + wartenMs;
  for (;;) {
    const v = sperreVersuchen(pfad, veraltetMs, unentscheidbarMs);
    if ('sperre' in v) return v.sperre;
    if (Date.now() >= ende) throw gesperrt(pfad, v, wartenMs);
    schlafen(pauseMs());
  }
}

/**
 * Wie `sperreNehmen`, wartet aber mit `setTimeout` statt zu schlafen: Die
 * Ereignisschleife des Betriebsdienstes bleibt frei (GET /status u. a.
 * antworten weiter), während ein fremder Schreiber die Sperre hält.
 */
async function sperreNehmenAsync(
  pfad: string,
  wartenMs: number,
  veraltetMs: number,
  unentscheidbarMs: number
): Promise<Sperre> {
  const ende = Date.now() + wartenMs;
  for (;;) {
    const v = sperreVersuchen(pfad, veraltetMs, unentscheidbarMs);
    if ('sperre' in v) return v.sperre;
    if (Date.now() >= ende) throw gesperrt(pfad, v, wartenMs);
    await new Promise<void>((fertig) => setTimeout(fertig, pauseMs()));
  }
}

function sperreGehoertUns(sperre: Sperre): boolean {
  try {
    return readFileSync(sperre.pfad, 'utf-8') === sperre.inhalt;
  } catch {
    return false;
  }
}

/** Gibt nur frei, was uns gehört: eine fremde Sperre bleibt liegen. */
function sperreFreigeben(sperre: Sperre): void {
  // Wirft nie: Es läuft im `finally` NACH dem Rename. Ein Fehler hier (Ordner
  // plötzlich schreibgeschützt) würde sonst das Ergebnis eines gelungenen
  // Schreibvorgangs durch einen Fehler ersetzen, obwohl die Datei längst
  // geschrieben ist. Die Sperre bleibt dann liegen und gehört einem lebenden
  // Prozess; das steht laut im Log.
  gehalten.delete(sperre.inhalt);
  herzschlagMelden({ art: 'frei', pfad: sperre.pfad });
  try {
    if (sperreGehoertUns(sperre)) rmSync(sperre.pfad, { force: true });
    else console.warn(`[layoutDatei] Sperre ${basename(sperre.pfad)} gehörte beim Freigeben nicht mehr uns`);
  } catch (fehler) {
    console.error(
      `[layoutDatei] Sperre ${basename(sperre.pfad)} konnte nicht freigegeben werden: ${(fehler as Error).message} ` +
        `— sie bleibt liegen und blockiert weitere Schreibvorgänge, bis sie von Hand entfernt wird`
    );
  }
}

/**
 * Räumt Tmp-Dateien weg, die ein abgestürzter Schreiber hinterlassen hat —
 * `<datei>.<pid>.<zufall>.tmp` und den festen Namen `<datei>.tmp` von früher.
 * Nur unter der Sperre. Weggeräumt wird nur, was nachweislich niemandem mehr
 * gehört: die Tmp-Datei eines Prozesses, der auf diesem Rechner NICHT MEHR
 * LEBT (pid im Namen), sofort; alles andere — ein lebender oder nicht prüfbarer
 * Besitzer, der alte feste Name ohne pid — erst nach `unentscheidbarMs` (10 min).
 * Früher galt für alle 30 s, und ein Schreiber, dessen Sperre gebrochen worden
 * war, verlor so seine Tmp-Datei und scheiterte beim Rename mit einem rohen ENOENT.
 * (Die Tmp-Dateien eines Besitzers, der beim Sperrbruch als tot erkannt wird,
 * räumt `sperreBrechen` sofort weg.)
 */
function tmpLeichenRaeumen(pfad: string, unentscheidbarMs: number): void {
  const ordner = dirname(pfad);
  const muster = dateiMuster(pfad, '(?:(\\d+)\\.[0-9a-f]+\\.)?tmp');
  for (const f of readdirSync(ordner)) {
    const treffer = muster.exec(f);
    if (!treffer) continue;
    const voll = resolve(ordner, f);
    try {
      const tot = treffer[1] !== undefined && pidStatus(Number(treffer[1])) === 'tot';
      if (tot || Date.now() - statSync(voll).mtimeMs > unentscheidbarMs) rmSync(voll, { force: true });
    } catch {
      /* zwischen readdir und stat verschwunden — auch gut */
    }
  }
}

// ══ Schreiben ═════════════════════════════════════════════════════════

/**
 * Felder, die ein Array sein müssen, wenn sie da sind. Der Sanitizer nimmt bei
 * einem Nicht-Array einfach eine leere Liste — ein Editor, der versehentlich
 * ein Objekt (eine Map) statt einer Liste schickt, löschte damit den gesamten
 * Bestand mit 200 OK. `regions` fehlt hier absichtlich: Ein Dokument ohne
 * Regionen wird ohnehin verworfen (siehe unten, 400).
 */
const LISTENFELDER = ['placements', 'continents', 'routes', 'rivers', 'lakes'] as const;

/**
 * Ein Listenfeld ist vorhanden, aber kein Array. Unterklasse von
 * `LayoutUngueltig`; der Betriebsdienst fängt sie vorher und antwortet 422 mit
 * dem Feldnamen.
 */
export class LayoutFeldUngueltig extends LayoutUngueltig {
  constructor(
    readonly feld: string,
    meldung?: string
  ) {
    super(meldung ?? `Feld "${feld}" ist vorhanden, aber keine Liste — verworfen; nichts gespeichert`);
    this.name = 'LayoutFeldUngueltig';
  }
}

function listenPruefen(eingabe: unknown): void {
  if (typeof eingabe !== 'object' || eingabe === null || Array.isArray(eingabe)) return;
  for (const feld of LISTENFELDER) {
    const wert = Object.prototype.hasOwnProperty.call(eingabe, feld)
      ? (eingabe as Record<string, unknown>)[feld]
      : undefined;
    if (wert !== undefined && !Array.isArray(wert)) throw new LayoutFeldUngueltig(feld);
  }
}

function listeZaehlen(eingabe: unknown, feld: string): number {
  if (typeof eingabe !== 'object' || eingabe === null) return 0;
  const p = (eingabe as Record<string, unknown>)[feld];
  return Array.isArray(p) ? p.length : 0;
}

const platzierungenZaehlen = (eingabe: unknown): number => listeZaehlen(eingabe, 'placements');

/**
 * Die Listen des Dokuments, deren rohe Einträge der Sanitizer einzeln verwirft. Für jede gilt:
 *  - Bleibt von mindestens einem rohen Eintrag NICHTS übrig (`["x","y"]`, `[[]]`, `[{}]`),
 *    ist das Feld unbrauchbar: 422, sonst ginge die ganze Liste mit 200 verloren.
 *  - Wird nur ein Teil verworfen, meldet der Aufrufer die Zahl je Feld (`verworfenJeFeld`).
 *
 * Auch für `routes`, ohne Ausnahme: Der Routen-Editor legt einen unfertigen Entwurf mit
 * `points: []` an, aber der Editor speichert nie roh, sondern schickt vorher durch
 * `sanitizeWorldLayout` (`inDieWeltSpeichern`), wo der Entwurf herausfliegt. Ein Entwurf
 * erreicht diesen Weg also nicht; eine Ausnahme dafür ließe stattdessen eine Liste aus
 * lauter Entwürfen die echten Routen auf der Platte still ersetzen.
 * `regions` steht nicht in der Tabelle: Ein Dokument ohne Regionen wird ohnehin verworfen (400).
 */
const LISTEN = [
  { feld: 'placements', name: 'eine gültige Platzierung', behalten: (l: WorldLayout): number => l.placements?.length ?? 0 },
  { feld: 'continents', name: 'ein gültiger Kontinent', behalten: (l: WorldLayout): number => l.continents.length },
  { feld: 'routes', name: 'eine gültige Route', behalten: (l: WorldLayout): number => l.routes?.length ?? 0 },
  { feld: 'rivers', name: 'ein gültiger Fluss', behalten: (l: WorldLayout): number => l.rivers?.length ?? 0 },
  { feld: 'lakes', name: 'ein gültiger See', behalten: (l: WorldLayout): number => l.lakes?.length ?? 0 },
] as const;

/** Alles, was vor der Sperre feststehen kann: Prüfung des Rohdokuments, Sanitizer, Text. */
function schreibenVorbereiten(eingabe: unknown, leereWelt = false): {
  layout: WorldLayout;
  text: string;
  verworfen: number;
  verworfenJeFeld: Record<string, number>;
  zusammengefasst: number;
  zusammengefasstJeFeld: Record<string, number>;
} {
  // Beides am ROHEN Dokument, vor dem Sanitizer: Der schneidet bei 2000
  // Platzierungen still ab und macht aus einem Nicht-Array eine leere Liste.
  listenPruefen(eingabe);
  const anzahl = platzierungenZaehlen(eingabe);
  if (anzahl > PLATZIERUNGEN_GRENZE) throw new LayoutZuVielePlatzierungen(anzahl);
  const bericht = sanitizeWorldLayoutMitBericht(eingabe);
  if (!bericht) throw new LayoutUngueltig('Kein gültiges WorldLayout — verworfen');
  const layout = bericht.layout;
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
  if (layout.regions.length === 0 && !leereWelt) {
    throw new LayoutUngueltig(
      'Weltdokument ohne eine einzige Region — verworfen. Das wäre eine Welt aus offener See; ' +
        'wahrscheinlich ist das Dokument unvollständig übertragen worden.'
    );
  }
  // Ein Array voller Müll (`["x", "y"]`, `[[]]`, `[{}]`) ist ein Array und passiert die
  // Listenprüfung oben; der Sanitizer wirft die Einträge einzeln weg. Dann gingen alle
  // Einträge des Feldes mit 200 verloren. Roh gegen gefiltert zu vergleichen geht hier,
  // ohne den Sanitizer anzufassen (Regeln: siehe LISTEN).
  // Zusammengefasste exakte Duplikate fehlen in `behalten`, sind aber nichts Verworfenes: Sie werden
  // getrennt gezählt (`zusammengefasst`), sonst meldete der Editor „ACHTUNG … verworfen" für einen Eintrag,
  // der nur mit seinem Zwilling zusammenfiel. Die Zahl kommt ausdrücklich vom Sanitizer.
  const zusammengefasstJeFeld: Record<string, number> = {};
  let zusammengefasst = 0;
  if (bericht.zusammengefasst.length > 0) {
    zusammengefasstJeFeld.placements = bericht.zusammengefasst.length;
    zusammengefasst = bericht.zusammengefasst.length;
  }
  const verworfenJeFeld: Record<string, number> = {};
  let verworfen = 0;
  for (const liste of LISTEN) {
    const roh = listeZaehlen(eingabe, liste.feld);
    const behalten = liste.behalten(layout);
    const gefaltet = zusammengefasstJeFeld[liste.feld] ?? 0;
    if (roh > 0 && behalten === 0) {
      throw new LayoutFeldUngueltig(
        liste.feld,
        `Feld "${liste.feld}": keiner der ${roh} Einträge ist ${liste.name} — verworfen; nichts gespeichert`
      );
    }
    if (roh > behalten + gefaltet) {
      verworfenJeFeld[liste.feld] = roh - behalten - gefaltet;
      verworfen += roh - behalten - gefaltet;
    }
  }
  return { layout, text: layoutText(layout), verworfen, verworfenJeFeld, zusammengefasst, zusammengefasstJeFeld };
}

/** Der Teil, der die Sperre HÄLT: Basisvergleich, Sicherung, Tmp-Datei, Rename. Rein synchron, ohne `await`. */
function unterSperreSchreiben(
  pfad: string,
  sperre: Sperre,
  v: {
    layout: WorldLayout;
    text: string;
    verworfen: number;
    verworfenJeFeld: Record<string, number>;
    zusammengefasst: number;
    zusammengefasstJeFeld: Record<string, number>;
  },
  behalten: number,
  optionen: SchreibOptionen
): SchreibErgebnis {
  try {
    // Der Vergleich steht INNERHALB der Sperre, sonst wäre er wertlos: Zwischen
    // einem Vergleich davor und dem Rename könnte ein zweiter Prozess seine
    // Datei hinlegen, und beide hielten sich für die Basis.
    if (optionen.basis !== undefined && optionen.basis !== null) {
      const aktuell = layoutDateiHash(pfad);
      if (aktuell !== optionen.basis) throw new LayoutVeraltet(aktuell);
    }
    tmpLeichenRaeumen(pfad, optionen.sperreUnentscheidbarMs ?? SPERRE_UNENTSCHEIDBAR_MS);
    const sicherung = layoutSichern(pfad, behalten);
    const tmp = `${pfad}.${process.pid}.${zufall()}.tmp`;
    try {
      writeFileSync(tmp, v.text);
      // Letzte Prüfung vor dem einen Schritt, der nicht zurückzunehmen ist —
      // aber sie liegt VOR dem Fenster zwischen Prüfung und Rename und schließt
      // es nicht. Dass hier trotzdem nur einer schreibt, tragen zwei andere
      // Stellen: Die Sperre eines lebenden Besitzers auf diesem Rechner wird nie
      // gebrochen (ein Konkurrent kommt gar nicht erst hinein), und ein Brecher,
      // der die frische Sperre eines anderen weggenommen hat und sie nicht
      // zurücklegen kann, hört auf (siehe sperreBrechen). Diese Prüfung fängt nur
      // den Rest ab: eine von Hand entfernte oder als verwaist gebrochene Sperre
      // (fremder Rechner, fehlende Startzeit, Müll) VOR diesem Punkt.
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
    return {
      layout: v.layout,
      sicherung,
      text: v.text,
      hash: layoutHash(v.text),
      verworfen: v.verworfen,
      verworfenJeFeld: v.verworfenJeFeld,
      zusammengefasst: v.zusammengefasst,
      zusammengefasstJeFeld: v.zusammengefasstJeFeld,
    };
  } finally {
    sperreFreigeben(sperre);
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
 * ganze Datei. Wann eine Sperre gebrochen wird, steht bei „Sperre" oben.
 *
 * Diese Fassung wartet auf eine fremde Sperre SYNCHRON (bis
 * `sperreWartenMs`) und hält dabei den ganzen Prozess an. Ein Dienst, der
 * nebenbei andere Anfragen bedient, nimmt `layoutSchreibenAsync`.
 */
export function layoutSchreiben(
  pfad: string,
  eingabe: unknown,
  behalten = SICHERUNGEN_BEHALTEN,
  optionen: SchreibOptionen = {}
): SchreibErgebnis {
  const v = schreibenVorbereiten(eingabe, optionen.leereWelt === true);
  mkdirSync(dirname(pfad), { recursive: true });
  const sperre = sperreNehmen(
    pfad,
    optionen.sperreWartenMs ?? SPERRE_WARTEN_MS,
    optionen.sperreVeraltetMs ?? SPERRE_VERALTET_MS,
    optionen.sperreUnentscheidbarMs ?? SPERRE_UNENTSCHEIDBAR_MS
  );
  return unterSperreSchreiben(pfad, sperre, v, behalten, optionen);
}

/**
 * Wie `layoutSchreiben`, wartet aber auf eine fremde Sperre, ohne die
 * Ereignisschleife anzuhalten. Nur das WARTEN ist asynchron; sobald die
 * Sperre da ist, läuft der Rest ohne `await` durch — im selben Prozess kann
 * sich also nie ein zweiter Schreiber in die Sperre drängen.
 */
export async function layoutSchreibenAsync(
  pfad: string,
  eingabe: unknown,
  behalten = SICHERUNGEN_BEHALTEN,
  optionen: SchreibOptionen = {}
): Promise<SchreibErgebnis> {
  const v = schreibenVorbereiten(eingabe, optionen.leereWelt === true);
  mkdirSync(dirname(pfad), { recursive: true });
  const sperre = await sperreNehmenAsync(
    pfad,
    optionen.sperreWartenMs ?? SPERRE_WARTEN_MS,
    optionen.sperreVeraltetMs ?? SPERRE_VERALTET_MS,
    optionen.sperreUnentscheidbarMs ?? SPERRE_UNENTSCHEIDBAR_MS
  );
  return unterSperreSchreiben(pfad, sperre, v, behalten, optionen);
}
