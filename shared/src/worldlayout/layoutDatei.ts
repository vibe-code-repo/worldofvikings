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
// einem fremden Werkzeug; ohne sie erkennt man eine wiederverwendete pid nicht). Eine solche Sperre darf nicht ewig halten — der
// Dienst käme nach einem Neustart nie wieder zum Schreiben: Sie gilt als
// verwaist, sobald sie älter als `sperreVeraltetMs` (30 s) ist, und wird mit
// lauter Logzeile (Rechner, pid, Alter) gebrochen. Das Restrisiko — der
// Besitzer lebt auf dem anderen Rechner und schreibt noch — ist bewusst
// eingegangen: eine Sperre, die über 30 s hält, ist bei einem Schreibvorgang
// von Millisekunden ohnehin verdächtig. Jünger als 30 s bleibt sie liegen.
//
// Eine Sperre OHNE lesbare Besitzangabe (von Hand angelegt, oder ein Prozess
// stürzte in den Mikrosekunden zwischen `open` und `write` ab) hat keinen
// Besitzer, den man prüfen könnte; sie gilt aus demselben Grund ab
// `sperreVeraltetMs` als Müll.
//
// Bewusst NICHT gebrochen wird die Sperre eines lebenden, aber angehaltenen
// Prozesses (SIGSTOP, eingefrorener Container): Er lebt, und würde er später
// weiterlaufen, schriebe er über den Sieger. Der Aufrufer bekommt
// `LayoutGesperrt` mit pid und Rechner des Besitzers; ab 30 s Alter steht in
// Meldung und Log, dass ein Eingriff von Hand nötig ist.

/** So lange wartet `layoutSchreiben` auf eine fremde Sperre, bevor es `LayoutGesperrt` wirft. */
export const SPERRE_WARTEN_MS = 3000;
/**
 * Alter (mtime der Sperrdatei), ab dem (a) eine Sperre ohne lesbare
 * Besitzangabe und (b) eine Sperre, deren Besitzer sich von hier aus nicht
 * prüfen lässt (anderer Rechnername), als verwaist gebrochen wird, und ab dem
 * (c) eine liegengebliebene Tmp-Datei weggeräumt wird. Die Sperre eines
 * lebenden Besitzers auf DIESEM Rechner hängt NICHT davon ab.
 */
export const SPERRE_VERALTET_MS = 30_000;
/** Ab diesem Alter einer von einem lebenden Prozess gehaltenen Sperre gibt es eine Logzeile. */
const SPERRE_LOGGEN_AB_MS = 30_000;

export interface SchreibOptionen {
  /** Hash der Datei, auf die sich der Schreiber bezieht. Fehlt er, wird ohne Vergleich geschrieben. */
  basis?: string | null;
  sperreWartenMs?: number;
  sperreVeraltetMs?: number;
}

export type SchreibErgebnis = {
  layout: WorldLayout;
  sicherung: string | null;
  text: string;
  hash: string;
  /** So viele rohe Platzierungen hat der Sanitizer verworfen (0 im Normalfall). */
  verworfen: number;
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

type Urteil =
  | { art: 'frei' }
  | { art: 'brechen'; roh: string; pid: number | null; grund: string }
  | { art: 'besetzt'; beschreibung: string; alterMs: number };

function sperreBeurteilen(sperrPfad: string, veraltetMs: number): Urteil {
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
  switch (besitzerPruefen(info)) {
    case 'tot':
      return { art: 'brechen', roh, pid: info.pid, grund: `Besitzer pid ${info.pid} lebt nicht mehr` };
    case 'lebt':
      return { art: 'besetzt', beschreibung: `gehalten von pid ${info.pid} auf Rechner ${info.host}, der lebt`, alterMs };
    default:
      // Lebendprüfung von hier aus unmöglich (anderer Rechner): nach `veraltetMs`
      // gilt die Sperre als verwaist. Die pid sagt hier nichts, deshalb werden
      // auch keine Tmp-Dateien dieser pid geräumt (pid: null).
      if (alterMs > veraltetMs) {
        return {
          art: 'brechen',
          roh,
          pid: null,
          grund:
            `ACHTUNG Besitzer pid ${info.pid} auf Rechner ${info.host} (dieser Rechner: ${hostname()}) ` +
            `lässt sich von hier nicht sicher prüfen (${info.host !== hostname() ? 'anderer Rechner' : 'Startzeit fehlt in der Sperre'}), ` +
            `Sperre ${Math.round(alterMs / 1000)} s alt (Grenze ${Math.round(veraltetMs / 1000)} s) — ` +
            `als verwaist behandelt, er könnte noch leben`,
        };
      }
      return {
        art: 'besetzt',
        beschreibung:
          `gehalten von pid ${info.pid} auf Rechner ${info.host} (ob er lebt, lässt sich von hier nicht ` +
          `sicher prüfen; ab ${Math.round(veraltetMs / 1000)} s Alter gilt die Sperre als verwaist)`,
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
 * gemeldeten Hash, der nicht auf der Platte liegt. So bleibt höchstens EIN
 * Schreiber übrig, und der Brecher meldet ehrlich 503.
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
  return { pfad: sperrPfad, inhalt };
}

type Versuch = { sperre: Sperre } | { besetzt: string; alterMs: number };

/** Ein Versuch, die Sperre zu bekommen — wartet nicht. Bricht dabei nur, was nachweislich verwaist ist. */
function sperreVersuchen(pfad: string, veraltetMs: number): Versuch {
  const sperrPfad = `${pfad}.lock`;
  for (let i = 0; i < 5; i++) {
    const sperre = sperreAnlegen(sperrPfad);
    if (sperre) return { sperre };
    const u = sperreBeurteilen(sperrPfad, veraltetMs);
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

function sperreNehmen(pfad: string, wartenMs: number, veraltetMs: number): Sperre {
  const ende = Date.now() + wartenMs;
  for (;;) {
    const v = sperreVersuchen(pfad, veraltetMs);
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
async function sperreNehmenAsync(pfad: string, wartenMs: number, veraltetMs: number): Promise<Sperre> {
  const ende = Date.now() + wartenMs;
  for (;;) {
    const v = sperreVersuchen(pfad, veraltetMs);
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
 * Nur unter der Sperre und nur ab einem Alter, in dem kein lebender
 * Schreiber mehr daran arbeiten kann. (Die Tmp-Dateien eines Besitzers, der
 * beim Sperrbruch als tot erkannt wird, räumt `sperreBrechen` sofort weg.)
 */
function tmpLeichenRaeumen(pfad: string, veraltetMs: number): void {
  const ordner = dirname(pfad);
  const muster = dateiMuster(pfad, '(?:\\d+\\.[0-9a-f]+\\.)?tmp');
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

function platzierungenZaehlen(eingabe: unknown): number {
  if (typeof eingabe !== 'object' || eingabe === null) return 0;
  const p = (eingabe as { placements?: unknown }).placements;
  return Array.isArray(p) ? p.length : 0;
}

/** Alles, was vor der Sperre feststehen kann: Prüfung des Rohdokuments, Sanitizer, Text. */
function schreibenVorbereiten(eingabe: unknown): { layout: WorldLayout; text: string; verworfen: number } {
  // Beides am ROHEN Dokument, vor dem Sanitizer: Der schneidet bei 2000
  // Platzierungen still ab und macht aus einem Nicht-Array eine leere Liste.
  listenPruefen(eingabe);
  const anzahl = platzierungenZaehlen(eingabe);
  if (anzahl > PLATZIERUNGEN_GRENZE) throw new LayoutZuVielePlatzierungen(anzahl);
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
  // Ein Array voller Müll (`["x", "y"]`, `[[]]`, `[{}]`) ist ein Array und passiert die
  // Listenprüfung oben; der Sanitizer wirft die Einträge einzeln weg. Dann gingen
  // alle Platzierungen mit 200 verloren. Roh gegen gefiltert zu vergleichen geht
  // hier, ohne den Sanitizer anzufassen: Bleibt von mindestens einer nichts übrig,
  // ist das Feld unbrauchbar (422); wird nur ein Teil verworfen, meldet der
  // Aufrufer die Zahl.
  const roh = platzierungenZaehlen(eingabe);
  const behalten = layout.placements?.length ?? 0;
  if (roh > 0 && behalten === 0) {
    throw new LayoutFeldUngueltig(
      'placements',
      `Feld "placements": keiner der ${roh} Einträge ist eine gültige Platzierung — verworfen; nichts gespeichert`
    );
  }
  return { layout, text: layoutText(layout), verworfen: roh - behalten };
}

/** Der Teil, der die Sperre HÄLT: Basisvergleich, Sicherung, Tmp-Datei, Rename. Rein synchron, ohne `await`. */
function unterSperreSchreiben(
  pfad: string,
  sperre: Sperre,
  v: { layout: WorldLayout; text: string; verworfen: number },
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
    tmpLeichenRaeumen(pfad, optionen.sperreVeraltetMs ?? SPERRE_VERALTET_MS);
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
    return { layout: v.layout, sicherung, text: v.text, hash: layoutHash(v.text), verworfen: v.verworfen };
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
  const v = schreibenVorbereiten(eingabe);
  mkdirSync(dirname(pfad), { recursive: true });
  const sperre = sperreNehmen(
    pfad,
    optionen.sperreWartenMs ?? SPERRE_WARTEN_MS,
    optionen.sperreVeraltetMs ?? SPERRE_VERALTET_MS
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
  const v = schreibenVorbereiten(eingabe);
  mkdirSync(dirname(pfad), { recursive: true });
  const sperre = await sperreNehmenAsync(
    pfad,
    optionen.sperreWartenMs ?? SPERRE_WARTEN_MS,
    optionen.sperreVeraltetMs ?? SPERRE_VERALTET_MS
  );
  return unterSperreSchreiben(pfad, sperre, v, behalten, optionen);
}
