/**
 * POST /api/welt-zuruecksetzen: put the world back to zero. GET on the same
 * path: what would go, in numbers (the editor's dialog shows it).
 *
 * ── What "zero" means ────────────────────────────────────────────────
 *  - the world document (`server/data/welten/<instanz>.json`) becomes a valid
 *    minimal document: no regions, rivers, lakes, routes, placements or
 *    continents; the name stays, the detail seed stays or is drawn anew;
 *  - the save (`<instanz>.db.zst`, `.prev`) is gone: the server finds none
 *    and starts a fresh world;
 *  - with `konten: true` the accounts and characters go too. Off by default:
 *    whoever only wants to rebuild the world keeps every login.
 * What stays: dungeons and modules, the forum, the admin list, the placement
 * cache (its key carries the layout hash, it drops itself).
 *
 * ── Nothing is deleted ───────────────────────────────────────────────
 * Every file that goes away is MOVED to a name with the same suffix
 * `.vor-reset-<JJJJ-MM-TT_HHMM>` (UTC; `-2`, `-3` … when that name is taken,
 * one suffix for the whole reset). A move never overwrites: `link()` fails on
 * an existing target, the source is removed only after it worked. Before the
 * server is stopped there are two copies on top of that:
 *  - the save through `sichern()` (`<save>.<ISO>.bak`, 20 generations, the same
 *    rotation as the test world: the moved file is the durable copy, the `.bak`
 *    a second one);
 *  - the world document as `worlds/<instanz>.json.<JJJJ-MM-TT_HHMM>`. In the
 *    save folder on purpose: `server/data/welten/` is in git, and one untracked
 *    file there stops `tools/wov-update.sh` ("repo dirty").
 * Getting things back by hand: Docs/10-Weltbau-Layout-und-Editor.md.
 *
 * ── Order, and why it is not arbitrary ───────────────────────────────
 * The server holds the save open and writes it on its interval, so files are
 * swapped ONLY with the service stopped. `systemctl start` sits in a `finally`
 * like in /api/testwelt: whatever fails, the server runs afterwards.
 * WHICH files are moved is decided AFTER the stop: the game server writes its save when it stops (SIGTERM), and the
 * interval save comes every 30 minutes, so right after a reset (or a first start) there may be no save at all until
 * the stop makes one. A candidate list made before the stop would miss exactly that file, and the restarted server
 * would load it: a "reset" that leaves the whole world standing. The copy made before the stop stays as a bonus, and
 * when it found nothing to copy, the file that appears at the stop is copied then.
 * A marker file (see "The marker" below) makes a reset that is killed halfway findable again.
 * The steps that can fail run in the order save, accounts, document, and the
 * document comes LAST: it is written atomically, so when it fails the moves
 * before it are undone and everything stands as before. A failed reset leaves
 * the world as it was (or, when even the undo fails, with every moved file
 * named in the answer).
 *
 * ── Safeguards ───────────────────────────────────────────────────────
 * Token and origin are checked before this code is reached. Here: `live` is
 * refused (403), an active test world is refused (409: the "save" would be
 * the test world), the body must carry `bestaetigung` === the instance name
 * exactly (400 otherwise, nothing touched), and only one reset runs at a time
 * (409): a double click must not stop the service twice.
 */
import { randomBytes } from 'node:crypto';
import { constants, copyFileSync, existsSync, linkSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { zstdDecompressSync } from 'node:zlib';
import { layoutLesenMitHash, layoutSchreibenAsync } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { WORLD_LAYOUT_VERSION, type WorldLayout } from '@wov/shared/src/worldlayout/types.js';

/** Same shape as `Antwort` in admin/src/main.ts. */
export type ResetAntwort = { code: number; daten: unknown; kopf?: Record<string, string> };

export interface ResetUmgebung {
  instanz: string;
  /**
   * The instance was named explicitly (WOV_INSTANZ set and not empty). `instanzName()` falls back to 'dev' when the variable
   * is missing, which is right for tools and tests but the wrong answer for a lock: a reset must only run where it is
   * certain which world it is, so without this it is refused (fail closed).
   */
  instanzBestimmt: boolean;
  /** `server/data/welten/<instanz>.json` */
  layoutDatei: string;
  /** `server/data/worlds/<instanz>.db.zst` */
  spielstand: string;
  /** `server/data/konten/<instanz>.db` (SQLite, WAL: `-wal` and `-shm` sit beside it) */
  kontenDb: string;
  dienstStoppen(): Promise<void>;
  dienstStarten(): Promise<void>;
  dienstZustand(): Promise<{ aktiv: boolean; seit: string | null }>;
  /** The operations service's `sichern()` (timestamped `.bak`, `behalten` generations). */
  sichern(datei: string, behalten: number): string | null;
  jetzt?: () => Date;
  /** Test hook: runs before each step that changes something ('stop', 'spielstand', 'konten', 'dokument', 'start'). */
  vorSchritt?: (schritt: string) => void | Promise<void>;
}

export type SeedWahl = 'behalten' | 'neu';

export interface ResetZahlen {
  weltdokument: {
    name: string;
    detailSeed: string;
    platzierungen: number;
    regionen: number;
    fluesse: number;
    seen: number;
    routen: number;
    kontinente: number;
    hash: string;
  } | null;
  spielstand: { datei: string; bytes: number; zdos: number | null; geaendert: string } | null;
  konten: { konten: number; charaktere: number } | null;
}

export const SICHERUNGEN_SPIELSTAND = 20;
export const WELTNAME_VORGABE = 'World of Vikings';
/** More compressed bytes than this and the ZDO count is skipped (a count is nice to have, not worth a stalled service). */
const ZDO_ZAEHLEN_BIS_BYTES = 200_000_000;

/** One reset at a time in this process. */
let laeuft = false;

const zweistellig = (n: number): string => String(n).padStart(2, '0');

/** `JJJJ-MM-TT_HHMM`, UTC. */
export function zeitmarke(d: Date): string {
  return `${d.getUTCFullYear()}-${zweistellig(d.getUTCMonth() + 1)}-${zweistellig(d.getUTCDate())}_${zweistellig(d.getUTCHours())}${zweistellig(d.getUTCMinutes())}`;
}

/** The minimal document a reset writes. Valid by construction; the write path runs it through the sanitizer anyway. */
export function leeresWeltdokument(alt: WorldLayout | null, seed: SeedWahl): WorldLayout {
  const behalten = seed === 'behalten' && alt !== null;
  return {
    version: WORLD_LAYOUT_VERSION,
    name: alt?.name ?? WELTNAME_VORGABE,
    detailSeed: behalten ? alt.detailSeed : randomBytes(6).toString('base64url'),
    continents: [],
    regions: [],
    placements: [],
    rivers: [],
    lakes: [],
    routes: [],
  };
}

/** Number of ZDOs in a save, or null when it cannot be told cheaply (unreadable, huge, no `zdos` list). */
export function zdosZaehlen(datei: string): number | null {
  try {
    if (statSync(datei).size > ZDO_ZAEHLEN_BIS_BYTES) return null;
    const umschlag = JSON.parse(zstdDecompressSync(readFileSync(datei)).toString('utf-8')) as { zdos?: unknown };
    return Array.isArray(umschlag.zdos) ? umschlag.zdos.length : null;
  } catch {
    return null;
  }
}

function kontenZaehlen(kontenDb: string): ResetZahlen['konten'] {
  if (!existsSync(kontenDb)) return null;
  try {
    const db = new DatabaseSync(kontenDb, { readOnly: true });
    try {
      const konten = db.prepare('SELECT COUNT(*) AS n FROM konten').get() as { n: number };
      const charaktere = db.prepare('SELECT COUNT(*) AS n FROM charaktere').get() as { n: number };
      return { konten: konten.n, charaktere: charaktere.n };
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/** What is there now, in numbers. Reads only. */
export function zahlenErheben(umg: ResetUmgebung): ResetZahlen {
  let weltdokument: ResetZahlen['weltdokument'] = null;
  try {
    const { layout, hash } = layoutLesenMitHash(umg.layoutDatei);
    weltdokument = {
      name: layout.name,
      detailSeed: layout.detailSeed,
      platzierungen: layout.placements?.length ?? 0,
      regionen: layout.regions.length,
      fluesse: layout.rivers?.length ?? 0,
      seen: layout.lakes?.length ?? 0,
      routen: layout.routes?.length ?? 0,
      kontinente: layout.continents.length,
      hash,
    };
  } catch {
    // Missing or broken: a reset is exactly what repairs that, so it is not an error here.
  }
  return { weltdokument, spielstand: spielstandZahlen(umg), konten: kontenZaehlen(umg.kontenDb) };
}

/** The save as it is right now (`null`: there is none). */
export function spielstandZahlen(umg: ResetUmgebung): ResetZahlen['spielstand'] {
  if (!existsSync(umg.spielstand)) return null;
  const s = statSync(umg.spielstand);
  return { datei: basename(umg.spielstand), bytes: s.size, zdos: zdosZaehlen(umg.spielstand), geaendert: s.mtime.toISOString() };
}

/** The files a reset moves, only those that exist: the save with its `.prev`, and with `konten` the account database with its WAL files. */
function beiseiteKandidaten(umg: ResetUmgebung, mitKonten: boolean): { spielstand: string[]; konten: string[] } {
  const vorhanden = (dateien: string[]): string[] => dateien.filter((d) => existsSync(d));
  return {
    spielstand: vorhanden([umg.spielstand, `${umg.spielstand}.prev`]),
    konten: mitKonten ? vorhanden([umg.kontenDb, `${umg.kontenDb}-wal`, `${umg.kontenDb}-shm`]) : [],
  };
}

/** One suffix for the whole reset: the stamp, or `<stamp>-2`, `-3` … when any target name is taken. */
function freieKennung(stempel: string, ziele: (kennung: string) => string[]): string {
  for (let n = 1; n < 1000; n++) {
    const kennung = n === 1 ? stempel : `${stempel}-${n}`;
    if (ziele(kennung).every((z) => !existsSync(z))) return kennung;
  }
  throw new Error(`keine freie Kennung für ${stempel}`);
}

/** Move without overwriting: `link()` fails on an existing target; the source goes only after it worked. */
function beiseiteLegen(von: string, nach: string): void {
  linkSync(von, nach);
  unlinkSync(von);
}

const fehlerText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Why this process must not reset a world, or `null`. `live` never; an instance nobody named (fallback to 'dev') not either. */
function sperrGrund(umg: ResetUmgebung): { fehler: 'live-gesperrt' | 'instanz-unbestimmt'; meldung: string } | null {
  if (umg.instanz === 'live') return { fehler: 'live-gesperrt', meldung: 'Auf der Instanz live wird nie zurückgesetzt — dort spielen Leute.' };
  if (!umg.instanzBestimmt) {
    return {
      fehler: 'instanz-unbestimmt',
      meldung: 'WOV_INSTANZ ist nicht gesetzt (oder leer): welche Welt dieser Dienst bedient, steht damit nicht fest. Ohne eindeutige Instanz wird nicht zurückgesetzt — in /etc/wov.env WOV_INSTANZ=dev eintragen.',
    };
  }
  return null;
}

/** GET: what would go. */
export async function weltZuruecksetzenVorschau(umg: ResetUmgebung): Promise<ResetAntwort> {
  const sperre = sperrGrund(umg);
  return {
    code: 200,
    daten: {
      ok: true,
      instanz: umg.instanz,
      erlaubt: sperre === null,
      ...(sperre !== null ? { grund: sperre.meldung } : {}),
      testweltAktiv: existsSync(`${umg.spielstand}.beiseite`),
      zahlen: zahlenErheben(umg),
    },
  };
}

/** POST: the reset. `body` is the parsed JSON body. */
export async function weltZuruecksetzenBehandeln(body: unknown, umg: ResetUmgebung): Promise<ResetAntwort> {
  const sperre = sperrGrund(umg);
  if (sperre !== null) return { code: 403, daten: { ok: false, fehler: sperre.fehler, message: `${sperre.meldung} Nichts angefasst.` } };
  const eingabe = (typeof body === 'object' && body !== null ? body : {}) as { bestaetigung?: unknown; seed?: unknown; konten?: unknown };
  if (eingabe.bestaetigung !== umg.instanz) {
    return {
      code: 400,
      daten: { ok: false, fehler: 'bestaetigung', message: `bestaetigung muss genau der Name der Instanz sein ("${umg.instanz}") — nichts angefasst.` },
    };
  }
  if (eingabe.seed !== 'behalten' && eingabe.seed !== 'neu') {
    return { code: 400, daten: { ok: false, fehler: 'seed', message: 'seed muss "behalten" oder "neu" sein — nichts angefasst.' } };
  }
  if (eingabe.konten !== undefined && typeof eingabe.konten !== 'boolean') {
    return { code: 400, daten: { ok: false, fehler: 'konten', message: 'konten muss true oder false sein — nichts angefasst.' } };
  }
  const seed: SeedWahl = eingabe.seed;
  const mitKonten = eingabe.konten === true;
  if (existsSync(`${umg.spielstand}.beiseite`)) {
    return {
      code: 409,
      daten: { ok: false, fehler: 'testwelt-aktiv', message: 'Es läuft eine Testwelt — erst „dev-Welt zurückholen“. Nichts angefasst.' },
    };
  }
  if (laeuft) {
    return { code: 409, daten: { ok: false, fehler: 'laeuft-bereits', message: 'Ein Zurücksetzen läuft bereits — nichts angefasst.' } };
  }
  laeuft = true;
  try {
    return await zuruecksetzen(umg, seed, mitKonten);
  } finally {
    laeuft = false;
  }
}

// ── The marker of a reset in progress ────────────────────────────────
//
// The `finally` that starts the server dies with the process: when the operations service is killed (OOM, `kill -9`,
// a restart of the unit) between `stop` and `start`, the game server stays down, and `Restart=always` does not help
// because it was stopped cleanly. So a reset writes a marker file BEFORE it stops the server and updates it at each
// step; it removes it once the state is known again (server started, nothing half done). At its own start the
// operations service looks for one: found, it starts the game server, names what state the reset was left in (log and
// `/status`) and renames the marker to `<instanz>.zuruecksetzen.abgebrochen-<stamp>`, which stays until someone
// removes it. In `worlds/`, next to the save, for the same reason as the copy of the document: not in git.

export interface ResetMarker {
  zeit: string;
  instanz: string;
  kennung: string;
  seed: SeedWahl;
  konten: boolean;
  /** How far it got: 'vor-stopp' (about to stop, or stopping), 'gestoppt', 'beiseite' (files moved), 'dokument' (document written). */
  schritt: 'vor-stopp' | 'gestoppt' | 'beiseite' | 'dokument';
  /** The files that are to be moved, as full paths AFTER the move; written BEFORE the first move, so at recovery the ones that exist are the ones that were moved. */
  beiseite: string[];
  sicherung: { spielstand: string | null; weltdokument: string | null };
}

export function markerPfad(umg: Pick<ResetUmgebung, 'spielstand' | 'instanz'>): string {
  return resolve(dirname(umg.spielstand), `${umg.instanz}.zuruecksetzen.marker`);
}

/** Atomic (tmp + rename): a marker torn in half would be worse than none. */
function markerSchreiben(umg: ResetUmgebung, marker: ResetMarker): void {
  const pfad = markerPfad(umg);
  const tmp = `${pfad}.tmp`;
  writeFileSync(tmp, JSON.stringify(marker, null, 2));
  renameSync(tmp, pfad);
}

function markerEntfernen(umg: ResetUmgebung): void {
  try {
    unlinkSync(markerPfad(umg));
  } catch {
    // already gone
  }
}

export interface UnfertigerReset {
  datei: string;
  /** The marker as it was left (`null`: unreadable). */
  marker: ResetMarker | null;
  /** In words: what state the reset was left in. */
  zustand: string;
}

/** The world document as it stands now, in words (recovery only; never throws). */
function dokumentZustand(umg: ResetUmgebung): string {
  try {
    const n = layoutLesenMitHash(umg.layoutDatei).layout.regions.length;
    return n === 0 ? 'leer (die Welt ist zurückgesetzt)' : `noch das alte (${n} Regionen)`;
  } catch {
    return 'nicht lesbar oder fehlt';
  }
}

function unfertigBeschreiben(marker: ResetMarker | null, umg: ResetUmgebung): string {
  if (!marker) return 'ein Zurücksetzen wurde unterbrochen, sein Marker ist unlesbar — Dateien in server/data/worlds/ prüfen';
  const kopf = `Zurücksetzen von ${marker.instanz} (Kennung ${marker.kennung}, ${marker.zeit}) `;
  switch (marker.schritt) {
    case 'vor-stopp':
      return `${kopf}abgebrochen vor oder während des Stoppens des Servers (Spielstand und Weltdokument unverändert; der Server kann schon unten gewesen sein).`;
    case 'gestoppt':
      return `${kopf}abgebrochen nach dem Stoppen des Servers, vor dem Beiseitelegen (Spielstand und Weltdokument liegen wie vorher).`;
    case 'beiseite': {
      const da = marker.beiseite.filter((pfad) => existsSync(pfad)).map((pfad) => basename(pfad));
      return `${kopf}abgebrochen beim oder nach dem Beiseitelegen. Beiseite gelegt: ${da.length > 0 ? da.join(', ') : 'nichts'}. Das Weltdokument ist ${dokumentZustand(umg)}.`;
    }
    case 'dokument': {
      const da = marker.beiseite.filter((pfad) => existsSync(pfad)).map((pfad) => basename(pfad));
      return `${kopf}abgebrochen beim oder nach dem Schreiben des leeren Weltdokuments, vor dem Start des Servers. Beiseite gelegt: ${da.length > 0 ? da.join(', ') : 'nichts'}. Das Weltdokument ist ${dokumentZustand(umg)}.`;
    }
    default:
      return `${kopf}abgebrochen (Schritt ${String(marker.schritt)}).`;
  }
}

/** Called once when the operations service starts: finish what a killed reset left open. Returns what it found. */
export async function unfertigenResetMelden(umg: ResetUmgebung): Promise<UnfertigerReset | null> {
  const pfad = markerPfad(umg);
  if (!existsSync(pfad)) return null;
  let marker: ResetMarker | null = null;
  try {
    marker = JSON.parse(readFileSync(pfad, 'utf-8')) as ResetMarker;
  } catch {
    // unreadable: still handled below, the server must come up
  }
  const zustand = unfertigBeschreiben(marker, umg);
  console.error(`[Admin] UNFERTIGES ZURÜCKSETZEN gefunden: ${zustand}`);
  // Rename first, so a second start of this service does not report the same marker again.
  const abgebrochen = resolve(dirname(pfad), `${umg.instanz}.zuruecksetzen.abgebrochen-${zeitmarke((umg.jetzt ?? (() => new Date()))())}`);
  let ziel = abgebrochen;
  for (let n = 2; existsSync(ziel); n++) ziel = `${abgebrochen}-${n}`;
  renameSync(pfad, ziel);
  try {
    await umg.dienstStarten();
    console.error('[Admin] wov-server gestartet (Abschluss des unterbrochenen Zurücksetzens).');
  } catch (fehler) {
    console.error(`[Admin] wov-server ließ sich NICHT starten: ${fehlerText(fehler)} — von Hand: systemctl start wov-server.`);
    return { datei: basename(ziel), marker, zustand: `${zustand} Der Server ließ sich nicht starten: ${fehlerText(fehler)}` };
  }
  return { datei: basename(ziel), marker, zustand };
}

/** For `/status`: every interrupted reset of this instance that is still on record, and whether one runs now. */
export function zuruecksetzenStatus(umg: ResetUmgebung): { laeuft: boolean; unfertige: UnfertigerReset[] } {
  const ordner = dirname(umg.spielstand);
  const unfertige: UnfertigerReset[] = [];
  if (existsSync(ordner)) {
    for (const name of readdirSync(ordner).sort()) {
      if (!name.startsWith(`${umg.instanz}.zuruecksetzen.abgebrochen-`)) continue;
      let marker: ResetMarker | null = null;
      try {
        marker = JSON.parse(readFileSync(resolve(ordner, name), 'utf-8')) as ResetMarker;
      } catch {
        // unreadable: listed without content
      }
      unfertige.push({ datei: name, marker, zustand: unfertigBeschreiben(marker, umg) });
    }
  }
  return { laeuft, unfertige };
}

const wortZdos = (s: ResetZahlen['spielstand']): string =>
  s === null ? 'es gab keinen Spielstand' : s.zdos === null ? 'Spielstand beiseite (Anzahl der Objekte nicht ermittelbar)' : `${s.zdos} Objekte im Spielstand beiseite`;

async function zuruecksetzen(umg: ResetUmgebung, seed: SeedWahl, mitKonten: boolean): Promise<ResetAntwort> {
  const jetzt = (umg.jetzt ?? (() => new Date()))();
  const stempel = zeitmarke(jetzt);
  const weltenOrdner = dirname(umg.spielstand);

  // One suffix for the whole reset, chosen before anything is written: the stamp, or `<stamp>-2`, `-3` … when ANY of the
  // names is taken (the copy of the world document included), so the copy and the moved files always share their name.
  // The names are checked for every file that COULD be moved, not only for those there now: the save may not exist yet
  // (the game server writes it when it stops).
  const moegliche = [umg.spielstand, `${umg.spielstand}.prev`, ...(mitKonten ? [umg.kontenDb, `${umg.kontenDb}-wal`, `${umg.kontenDb}-shm`] : [])];
  const kopieName = (k: string): string => resolve(weltenOrdner, `${basename(umg.layoutDatei)}.${k}`);
  const kennung = freieKennung(stempel, (k) => [kopieName(k), ...moegliche.map((d) => `${d}.vor-reset-${k}`)]);

  // 1 + 2: numbers, then the two copies. Nothing has changed yet when this throws. The copy of the save made here is
  // a bonus: the game server writes its save when it STOPS, so the file that matters is the one there after the stop.
  let zahlen: ResetZahlen;
  let sicherungSpielstand: string | null;
  let sicherungWeltdokument: string | null = null;
  let altesDokument: WorldLayout | null = null;
  try {
    zahlen = zahlenErheben(umg);
    try {
      altesDokument = layoutLesenMitHash(umg.layoutDatei).layout;
    } catch {
      // unreadable: the seed cannot be kept, see leeresWeltdokument
    }
    sicherungSpielstand = umg.sichern(umg.spielstand, SICHERUNGEN_SPIELSTAND);
    if (existsSync(umg.layoutDatei)) {
      copyFileSync(umg.layoutDatei, kopieName(kennung), constants.COPYFILE_EXCL);
      sicherungWeltdokument = kopieName(kennung);
    }
  } catch (fehler) {
    console.error(`[Admin] POST /api/welt-zuruecksetzen: Sicherung fehlgeschlagen: ${fehlerText(fehler)}`);
    return {
      code: 500,
      daten: { ok: false, fehler: 'sicherung-fehlgeschlagen', message: `Sicherung fehlgeschlagen — nichts verändert, der Server läuft weiter: ${fehlerText(fehler)}` },
    };
  }

  const beiseite: { von: string; nach: string }[] = [];
  const marker: ResetMarker = {
    zeit: jetzt.toISOString(),
    instanz: umg.instanz,
    kennung,
    seed,
    konten: mitKonten,
    schritt: 'vor-stopp',
    beiseite: [],
    sicherung: { spielstand: sicherungSpielstand ? basename(sicherungSpielstand) : null, weltdokument: sicherungWeltdokument ? basename(sicherungWeltdokument) : null },
  };
  try {
    markerSchreiben(umg, marker);
  } catch (fehler) {
    // Without the marker a crash could not be found again: better not to start.
    console.error(`[Admin] POST /api/welt-zuruecksetzen: Marker nicht schreibbar: ${fehlerText(fehler)}`);
    return { code: 500, daten: { ok: false, fehler: 'marker-fehlgeschlagen', message: `Marker nicht schreibbar — nichts verändert, der Server läuft weiter: ${fehlerText(fehler)}` } };
  }

  // 3: stop. When that fails nothing is swapped (the server may still be writing); start is tried anyway.
  try {
    await umg.vorSchritt?.('stop');
    await umg.dienstStoppen();
  } catch (fehler) {
    let startText = '';
    let startOk = true;
    try {
      await umg.dienstStarten();
    } catch (startFehler) {
      startOk = false;
      startText = ` Auch der Start schlug fehl: ${fehlerText(startFehler)}`;
    }
    // The state is known again (nothing was changed), unless the server is down as well.
    if (startOk) markerEntfernen(umg);
    console.error(`[Admin] POST /api/welt-zuruecksetzen: Dienst ließ sich nicht stoppen: ${fehlerText(fehler)}`);
    return {
      code: 500,
      daten: {
        ok: false,
        fehler: 'stopp-fehlgeschlagen',
        message: `wov-server ließ sich nicht stoppen — nichts getauscht: ${fehlerText(fehler)}.${startText}`,
        sicherung: marker.sicherung,
      },
    };
  }

  // 4 + 5 + 6: swap, in the order described in the head. `finally` starts the service.
  let tauschFehler: unknown = null;
  const rueckrollFehler: string[] = [];
  let startFehler: unknown = null;
  let geschrieben: Awaited<ReturnType<typeof layoutSchreibenAsync>> | null = null;
  // What the game server left behind when it stopped: THIS is the file to move, and the one to count and back up if
  // the copy above found none.
  let spielstandBeiseite: ResetZahlen['spielstand'] = null;
  try {
    try {
      marker.schritt = 'gestoppt';
      markerSchreiben(umg, marker);
      await umg.vorSchritt?.('spielstand');
      // Decided NOW, after the stop, not before it.
      const kandidaten = beiseiteKandidaten(umg, mitKonten);
      spielstandBeiseite = spielstandZahlen(umg);
      if (sicherungSpielstand === null && spielstandBeiseite !== null) {
        sicherungSpielstand = umg.sichern(umg.spielstand, SICHERUNGEN_SPIELSTAND);
        marker.sicherung.spielstand = sicherungSpielstand ? basename(sicherungSpielstand) : null;
      }
      // The marker says what is about to be moved BEFORE anything is: a kill between a move and a later note would leave
      // a file gone that the marker never mentioned. At recovery the planned files that exist are the ones that moved.
      marker.beiseite = [...kandidaten.spielstand, ...kandidaten.konten].map((datei) => `${datei}.vor-reset-${kennung}`);
      marker.schritt = 'beiseite';
      markerSchreiben(umg, marker);
      for (const datei of kandidaten.spielstand) {
        const nach = `${datei}.vor-reset-${kennung}`;
        beiseiteLegen(datei, nach);
        beiseite.push({ von: datei, nach });
      }
      if (mitKonten) {
        await umg.vorSchritt?.('konten');
        for (const datei of kandidaten.konten) {
          const nach = `${datei}.vor-reset-${kennung}`;
          beiseiteLegen(datei, nach);
          beiseite.push({ von: datei, nach });
        }
      }
      await umg.vorSchritt?.('dokument');
      // Before the write, for the same reason: a kill after it must not find a marker that still says "document untouched".
      marker.schritt = 'dokument';
      markerSchreiben(umg, marker);
      // `leereWelt`: the write path otherwise refuses a document without a region (shared/src/worldlayout/layoutDatei.ts).
      geschrieben = await layoutSchreibenAsync(umg.layoutDatei, leeresWeltdokument(altesDokument, seed), undefined, { leereWelt: true });
    } catch (fehler) {
      tauschFehler = fehler;
      // Put back what already moved, newest first. The document is written last and atomically, so it never needs this.
      for (const { von, nach } of [...beiseite].reverse()) {
        try {
          linkSync(nach, von);
          unlinkSync(nach);
        } catch (e) {
          rueckrollFehler.push(`${basename(nach)} → ${basename(von)}: ${fehlerText(e)}`);
        }
      }
      if (rueckrollFehler.length === 0) beiseite.length = 0;
    }
  } finally {
    // Whatever went wrong: the server runs afterwards.
    try {
      await umg.vorSchritt?.('start');
      await umg.dienstStarten();
    } catch (fehler) {
      startFehler = fehler;
    }
    // The state is known again: the server is up, and nothing is half done (a failed undo keeps the marker).
    if (startFehler === null && rueckrollFehler.length === 0) markerEntfernen(umg);
  }

  const sicherung = {
    spielstand: sicherungSpielstand ? basename(sicherungSpielstand) : null,
    weltdokument: sicherungWeltdokument ? basename(sicherungWeltdokument) : null,
  };
  const zustand = await umg.dienstZustand();

  if (tauschFehler !== null) {
    const zurueckgerollt = rueckrollFehler.length === 0;
    console.error(`[Admin] POST /api/welt-zuruecksetzen: Tausch fehlgeschlagen (${fehlerText(tauschFehler)}), ${zurueckgerollt ? 'zurückgerollt' : 'NICHT vollständig zurückgerollt'}`);
    return {
      code: 500,
      daten: {
        ok: false,
        fehler: 'tausch-fehlgeschlagen',
        message:
          `Zurücksetzen fehlgeschlagen: ${fehlerText(tauschFehler)}. ` +
          (zurueckgerollt ? 'Alles steht wieder wie vorher. ' : `Rückrollen unvollständig (${rueckrollFehler.join('; ')}) — die Dateien liegen unter ihrem neuen Namen. `) +
          (startFehler === null ? 'Der Server läuft.' : `Der Server ließ sich nicht starten: ${fehlerText(startFehler)}`),
        zurueckgerollt,
        beiseite: beiseite.map((b) => basename(b.nach)),
        sicherung,
        zustand,
      },
    };
  }

  const ergebnis = geschrieben!;
  const platz = zahlen.weltdokument ? `${zahlen.weltdokument.platzierungen} Platzierungen, ${zahlen.weltdokument.regionen} Regionen` : 'Weltdokument war nicht lesbar';
  console.warn(`[Admin] Welt zurückgesetzt (Instanz ${umg.instanz}, seed ${seed}${mitKonten ? ', mit Konten' : ''}): ${platz}, ${wortZdos(spielstandBeiseite)} (${kennung})`);
  const dienstFehlerText = startFehler === null ? '' : ` ACHTUNG: wov-server ließ sich nicht starten (${fehlerText(startFehler)}) — von Hand: systemctl start wov-server.`;
  return {
    code: startFehler === null ? 200 : 500,
    daten: {
      ok: startFehler === null,
      ...(startFehler === null ? {} : { fehler: 'start-fehlgeschlagen' }),
      message: `Welt zurückgesetzt: ${platz}; ${wortZdos(spielstandBeiseite)} (Kennung ${kennung}).${dienstFehlerText}`,
      instanz: umg.instanz,
      seed,
      konten: mitKonten,
      kennung,
      vorher: zahlen,
      // The save that was really moved: measured AFTER the stop, when the game server has written its final one.
      spielstandBeiseite,
      sicherung,
      beiseite: beiseite.map((b) => basename(b.nach)),
      hash: ergebnis.hash,
      dokument: ergebnis.layout,
      zustand,
    },
  };
}
