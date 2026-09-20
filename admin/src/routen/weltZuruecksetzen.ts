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
import { constants, copyFileSync, existsSync, linkSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { zstdDecompressSync } from 'node:zlib';
import { layoutLesenMitHash, layoutSchreibenAsync } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { WORLD_LAYOUT_VERSION, type WorldLayout } from '@wov/shared/src/worldlayout/types.js';

/** Same shape as `Antwort` in admin/src/main.ts. */
export type ResetAntwort = { code: number; daten: unknown; kopf?: Record<string, string> };

export interface ResetUmgebung {
  instanz: string;
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
  const spielstand = existsSync(umg.spielstand)
    ? (() => {
        const s = statSync(umg.spielstand);
        return { datei: basename(umg.spielstand), bytes: s.size, zdos: zdosZaehlen(umg.spielstand), geaendert: s.mtime.toISOString() };
      })()
    : null;
  return { weltdokument, spielstand, konten: kontenZaehlen(umg.kontenDb) };
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

/** GET: what would go. */
export async function weltZuruecksetzenVorschau(umg: ResetUmgebung): Promise<ResetAntwort> {
  const gesperrt = umg.instanz === 'live';
  return {
    code: 200,
    daten: {
      ok: true,
      instanz: umg.instanz,
      erlaubt: !gesperrt,
      ...(gesperrt ? { grund: 'Auf der Instanz live wird nie zurückgesetzt — dort spielen Leute.' } : {}),
      testweltAktiv: existsSync(`${umg.spielstand}.beiseite`),
      zahlen: zahlenErheben(umg),
    },
  };
}

/** POST: the reset. `body` is the parsed JSON body. */
export async function weltZuruecksetzenBehandeln(body: unknown, umg: ResetUmgebung): Promise<ResetAntwort> {
  if (umg.instanz === 'live') {
    return {
      code: 403,
      daten: { ok: false, fehler: 'live-gesperrt', message: 'Auf der Instanz live wird nie zurückgesetzt — dort spielen Leute. Nichts angefasst.' },
    };
  }
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

async function zuruecksetzen(umg: ResetUmgebung, seed: SeedWahl, mitKonten: boolean): Promise<ResetAntwort> {
  const jetzt = (umg.jetzt ?? (() => new Date()))();
  const stempel = zeitmarke(jetzt);
  const weltenOrdner = dirname(umg.spielstand);

  // 1 + 2: numbers, then the two copies. Nothing has changed yet when this throws.
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
      const kopie = resolve(weltenOrdner, `${basename(umg.layoutDatei)}.${freieKennung(stempel, (k) => [resolve(weltenOrdner, `${basename(umg.layoutDatei)}.${k}`)])}`);
      copyFileSync(umg.layoutDatei, kopie, constants.COPYFILE_EXCL);
      sicherungWeltdokument = kopie;
    }
  } catch (fehler) {
    console.error(`[Admin] POST /api/welt-zuruecksetzen: Sicherung fehlgeschlagen: ${fehlerText(fehler)}`);
    return {
      code: 500,
      daten: { ok: false, fehler: 'sicherung-fehlgeschlagen', message: `Sicherung fehlgeschlagen — nichts verändert, der Server läuft weiter: ${fehlerText(fehler)}` },
    };
  }

  const kandidaten = beiseiteKandidaten(umg, mitKonten);
  const kennung = freieKennung(stempel, (k) => [...kandidaten.spielstand, ...kandidaten.konten].map((d) => `${d}.vor-reset-${k}`));
  const beiseite: { von: string; nach: string }[] = [];

  // 3: stop. When that fails nothing is swapped (the server may still be writing); start is tried anyway.
  try {
    await umg.vorSchritt?.('stop');
    await umg.dienstStoppen();
  } catch (fehler) {
    let startText = '';
    try {
      await umg.dienstStarten();
    } catch (startFehler) {
      startText = ` Auch der Start schlug fehl: ${fehlerText(startFehler)}`;
    }
    console.error(`[Admin] POST /api/welt-zuruecksetzen: Dienst ließ sich nicht stoppen: ${fehlerText(fehler)}`);
    return {
      code: 500,
      daten: {
        ok: false,
        fehler: 'stopp-fehlgeschlagen',
        message: `wov-server ließ sich nicht stoppen — nichts getauscht: ${fehlerText(fehler)}.${startText}`,
        sicherung: { spielstand: sicherungSpielstand ? basename(sicherungSpielstand) : null, weltdokument: sicherungWeltdokument ? basename(sicherungWeltdokument) : null },
      },
    };
  }

  // 4 + 5 + 6: swap, in the order described in the head. `finally` starts the service.
  let tauschFehler: unknown = null;
  const rueckrollFehler: string[] = [];
  let startFehler: unknown = null;
  let geschrieben: Awaited<ReturnType<typeof layoutSchreibenAsync>> | null = null;
  try {
    try {
      await umg.vorSchritt?.('spielstand');
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
  console.warn(
    `[Admin] Welt zurückgesetzt (Instanz ${umg.instanz}, seed ${seed}${mitKonten ? ', mit Konten' : ''}): ` +
      `${zahlen.weltdokument?.platzierungen ?? '?'} Platzierungen, ${zahlen.weltdokument?.regionen ?? '?'} Regionen, ` +
      `${zahlen.spielstand?.zdos ?? '?'} ZDOs beiseite (${kennung})`
  );
  const dienstFehlerText = startFehler === null ? '' : ` ACHTUNG: wov-server ließ sich nicht starten (${fehlerText(startFehler)}) — von Hand: systemctl start wov-server.`;
  return {
    code: startFehler === null ? 200 : 500,
    daten: {
      ok: startFehler === null,
      ...(startFehler === null ? {} : { fehler: 'start-fehlgeschlagen' }),
      message:
        `Welt zurückgesetzt: ${zahlen.weltdokument?.platzierungen ?? 0} Platzierungen, ${zahlen.weltdokument?.regionen ?? 0} Regionen und ` +
        `${zahlen.spielstand?.zdos ?? '?'} Objekte im Spielstand liegen beiseite (Kennung ${kennung}).${dienstFehlerText}`,
      instanz: umg.instanz,
      seed,
      konten: mitKonten,
      kennung,
      vorher: zahlen,
      sicherung,
      beiseite: beiseite.map((b) => basename(b.nach)),
      hash: ergebnis.hash,
      dokument: ergebnis.layout,
      zustand,
    },
  };
}
