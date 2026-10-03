/**
 * GET/PUT /api/gegenstaende and GET /api/gegenstaende/quittung: the save path of the item data
 * (Editor card EG1, on top of Game card G1 / PR #152). The mask (EG2) sits on these routes.
 * Speicherweg der Gegenstandsdaten im Betriebsdienst (Editor-Karte EG1).
 *
 * ── Files ────────────────────────────────────────────────────────────
 * The working copy is `gegenstandsArbeitsDatei(wurzel)` (same folder as the world working copy, fixed name; never
 * a path from a request). It is created from the repo state `shared/data/gegenstaende.json` if it is missing, with a
 * `.basis` file holding the SHA-256 of the repo bytes, like `weltAbgleichen` does for the world. The game server's
 * watch (Game card G2) reads the working copy and writes the receipt (`gegenstaende.quittung.json`, next to it).
 *
 * ── PUT ──────────────────────────────────────────────────────────────
 * `If-Match` (the hash of the bytes on disk, as delivered by GET) is mandatory: 428 without it, 412 with the current
 * hash if it is stale. The body IS the document (`{version, gegenstaende}`). It goes through the shared sanitiser
 * `leseGegenstandsDatei` (imported, never copied): a broken file or ANY discarded entry is a 422 and nothing is
 * written — never a part silently dropped. What is written is the canonical text `schreibeGegenstandsDatei(entries)`,
 * not the request bytes, atomically (`<file>.<pid>.<random>.tmp`, then `rename`) under `<file>.lock` (the same lock mechanism
 * as the world, `layoutUnterSperre`, but its own lock file; the game server watch (G2) must take this one). Compare, check and rename are ONE synchronous section, so two PUTs with
 * the same `If-Match` give exactly one 200 and one 412.
 *
 * ── Removing items (nothing is ever lost silently) ───────────────────
 * If the new state lacks an item of the old state, the route answers 409 `brauchtBestaetigung` with `entfernt: [ids]`
 * and writes nothing; with `?bestaetigt=1` it writes. Removing ALWAYS needs this confirmation. That includes entries
 * the reader DISCARDS in the old state (hand-edited, or dropped by a later, stricter reader): their id is read from
 * the raw old JSON and counts as removed once it is missing in the new state; an entry without a readable id is listed
 * as `#<index>` in `entferntOhneId` (it can never be found again, so it always needs the confirmation).
 * An old state that is itself broken (`dateiFehler`: unreadable, cut off, unknown version, too big) is overwritten only
 * with `?bestaetigt=1`; without it: 409 `alter-stand-kaputt` (+ the old `dateiFehler`). Before that write the route
 * keeps a copy `<file>.kaputt-<UTC time>` of the broken file (the last 5 stay).
 *
 * ── Lock ─────────────────────────────────────────────────────────────
 * The lock is taken WITHOUT blocking the event loop: one non-waiting attempt (`sperreWartenMs: 0`), then up to 2 s of
 * `setTimeout` waits between retries. If a foreign holder (the game server's watch) is still there: 503 `gesperrt`
 * with `Retry-After: 2`, no pid, host or path in the answer. (`layoutUnterSperre` itself waits synchronously; it lives
 * in `shared/**`, so the route wraps it instead of changing it.)
 *
 * ── If-Match ─────────────────────────────────────────────────────────
 * A list of tags applies if ONE entry matches the current hash. `*` (anywhere in the value) is refused with 428
 * `basis-unbestimmt`: it would switch the protection off ("any state exists").
 *
 * Every answer carries a stable `fehler` code (404 `unbekannter-endpunkt`, 405 `methode`, 500 `intern`); raw error texts
 * (paths, `EISDIR`, stacks) go to the log only. How many players hold
 * the item is counted later by the server watch (Game card G2), which holds back its own application in the receipt
 * (`bestaetigung-noetig`), like the deletion lock of the world (Z3). The route knows no inventories.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';
import { LayoutGesperrt, layoutHash, layoutUnterSperre } from '@wov/shared/src/worldlayout/layoutDatei.js';
import {
  GegenstandsSchreibFehler,
  MAX_DATEI_BYTES,
  istGrundItem,
  leseGegenstandsDatei,
  schreibeGegenstandsDatei,
  type GegenstandsLesung,
} from '@wov/shared/src/items/gegenstandsDaten.js';
import { gegenstandsArbeitsDatei, gegenstandsBasisDatei, gegenstandsRepoDatei } from '@wov/shared/src/items/gegenstandsArbeitskopie.js';

/**
 * The receipt written by the server watch (Game card G2), next to the working copy. The path rule lives here
 * because `gegenstandsArbeitskopie.ts` belongs to Game; G2 should take this name over from there.
 */
export const GEGENSTAENDE_QUITTUNG_DATEI = 'gegenstaende.quittung.json';
/** A receipt larger than this is not read (it is a small status file). */
const QUITTUNG_MAX_BYTES = 256 * 1024;

type Kopf = Record<string, string>;

function json(res: ServerResponse, code: number, daten: unknown, kopf: Kopf = {}): void {
  const leib = JSON.stringify(daten);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(leib),
    ...kopf,
  });
  res.end(leib);
}

const etag = (hash: string): Kopf => ({ ETag: `"${hash}"` });

/**
 * The bare hashes of an `If-Match` value: a comma separated list of `"<hash>"`, `W/"<hash>"` or bare hashes (the
 * request applies if ONE of them is the current hash). `null` if the value contains `*`, which is refused.
 */
function basisHashes(roh: string): string[] | null {
  const aus: string[] = [];
  for (const teil of roh.split(',')) {
    const s = teil.trim().replace(/^W\//, '');
    if (s === '*') return null;
    const bloss = s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
    if (bloss !== '') aus.push(bloss);
  }
  return aus;
}

/** How long a PUT waits (asynchronously) for a foreign lock before it answers 503. */
const SPERRE_WARTEN_MS = 2000;
const SPERRE_PAUSE_MS = 100;
/** Own temp files older than this are leftovers of a crashed writer. */
const TMP_ALTER_MS = 10 * 60_000;
/** Copies of a broken working copy that stay. */
const KAPUTT_KOPIEN = 5;

/** The lock is held by someone else and did not come free within `SPERRE_WARTEN_MS`. */
class Gesperrt extends Error {}

/**
 * `layoutUnterSperre` without blocking the event loop: a non-waiting attempt (`sperreWartenMs: 0` gives up after ONE
 * try, no sleep), retried after `setTimeout` pauses for up to `SPERRE_WARTEN_MS`. `arbeit` runs synchronously (no
 * `await`) once the lock is held, exactly like before.
 */
async function unterSperre<T>(pfad: string, arbeit: () => T): Promise<T> {
  const ende = Date.now() + SPERRE_WARTEN_MS;
  for (;;) {
    let gefangen: unknown;
    try {
      return layoutUnterSperre(pfad, arbeit, { sperreWartenMs: 0 });
    } catch (fehler) {
      if (!(fehler instanceof LayoutGesperrt)) throw fehler;
      gefangen = fehler;
    }
    if (Date.now() >= ende) throw new Gesperrt(String((gefangen as Error).name));
    await new Promise<void>((fertig) => setTimeout(fertig, SPERRE_PAUSE_MS));
  }
}

/** Removes leftovers `<file>.<pid>.<random>.tmp` of this route (older than 10 min). Only inside the lock. */
function tmpAufraeumen(dateien: string[]): void {
  for (const datei of dateien) {
    const ordner = dirname(datei);
    const muster = new RegExp(`^${basename(datei).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.\\d+\\.[0-9a-f]{8}\\.tmp$`);
    try {
      for (const name of readdirSync(ordner)) {
        if (!muster.test(name)) continue;
        const voll = resolve(ordner, name);
        try {
          if (Date.now() - statSync(voll).mtimeMs > TMP_ALTER_MS) rmSync(voll, { force: true });
        } catch {
          /* gone in between */
        }
      }
    } catch {
      /* cleaning up is never more important than the request */
    }
  }
}

/** The time part of a copy name (`20260930T123456789`); the rotation pattern below is derived from this very function. */
const kaputtStempel = (zeit: Date): string => zeit.toISOString().replace(/[-:.Z]/g, '');
const KAPUTT_STEMPEL_MUSTER = kaputtStempel(new Date(0)).replace(/\d/g, '\\d');

/**
 * Keeps a copy of the broken working copy (`<file>.kaputt-<UTC time>[-<n>]`) and removes all but the last 5 OF THESE
 * COPIES (the fresh copy included and never removed itself, even if its stamp is not the newest). Only names that match exactly this pattern (and are regular files) count and are ever removed; anything else
 * with a similar prefix is left alone. An entry that cannot be removed is skipped and logged. Afterwards the own fresh
 * copy must still exist with the same bytes, otherwise this throws BEFORE the working copy is overwritten. Inside the lock.
 */
function kaputtSichern(arbeit: string): void {
  const ordner = dirname(arbeit);
  const stempel = kaputtStempel(new Date());
  let ziel = `${arbeit}.kaputt-${stempel}`;
  for (let i = 1; existsSync(ziel); i++) ziel = `${arbeit}.kaputt-${stempel}-${i}`;
  copyFileSync(arbeit, ziel);
  const eigen = new RegExp(`^${basename(arbeit).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.kaputt-(${KAPUTT_STEMPEL_MUSTER})(?:-(\\d+))?$`);
  const kopien: { name: string; stempel: string; nummer: number }[] = [];
  for (const name of readdirSync(ordner)) {
    const treffer = eigen.exec(name);
    if (treffer === null) continue;
    try {
      if (!lstatSync(resolve(ordner, name)).isFile()) {
        console.error(`[Admin] Gegenstaende: ${name} ist keine Datei, bei der Rotation der Sicherungen uebersprungen`);
        continue;
      }
    } catch {
      continue;
    }
    kopien.push({ name, stempel: treffer[1], nummer: treffer[2] === undefined ? 0 : Number(treffer[2]) });
  }
  kopien.sort((x, y) => (x.stempel < y.stempel ? -1 : x.stempel > y.stempel ? 1 : x.nummer - y.nummer));
  // The own fresh copy is never rotated: only the OTHER own copies are, the newest KAPUTT_KOPIEN - 1 of them stay.
  const andere = kopien.filter((k) => k.name !== basename(ziel));
  const zukunft = andere.filter((k) => k.stempel > stempel);
  if (zukunft.length > 0) console.error(`[Admin] Gegenstaende: ${zukunft.length} Sicherung(en) mit Stempel nach ${stempel} (Uhr zurueckgesprungen?), die frische Kopie ${basename(ziel)} bleibt trotzdem erhalten`);
  for (const alt of andere.slice(0, Math.max(0, andere.length - (KAPUTT_KOPIEN - 1)))) {
    try {
      rmSync(resolve(ordner, alt.name));
    } catch (fehler) {
      console.error(`[Admin] Gegenstaende: Sicherung ${alt.name} nicht entfernt, uebersprungen: ${fehler instanceof Error ? fehler.message : String(fehler)}`);
    }
  }
  let heil = false;
  try {
    heil = readFileSync(ziel).equals(readFileSync(arbeit));
  } catch {
    /* gone or unreadable: not intact */
  }
  if (!heil) throw new Error(`Sicherung ${basename(ziel)} fehlt nach der Rotation oder weicht ab`);
}

/** The ids of entries the reader discards in `text`, read from the raw JSON (`#<index>` if there is none). */
function verworfeneIds(text: string, lesung: GegenstandsLesung): { ids: string[]; ohneId: string[] } {
  let roh: unknown[] = [];
  try {
    const dokument = JSON.parse(text) as { gegenstaende?: unknown };
    if (Array.isArray(dokument.gegenstaende)) roh = dokument.gegenstaende;
  } catch {
    /* an unreadable file has no discarded entries, it has a dateiFehler */
  }
  const ids: string[] = [];
  const ohneId: string[] = [];
  for (const v of lesung.verworfen) {
    const eintrag = roh[v.index] as { id?: unknown } | null | undefined;
    const id = typeof v.id === 'string' && v.id !== '' ? v.id : typeof eintrag?.id === 'string' && eintrag.id !== '' ? eintrag.id : null;
    if (id === null) ohneId.push(`#${v.index}`);
    else ids.push(id);
  }
  return { ids, ohneId };
}

/** Never an internal message: a code and a generic sentence; the details go to the log. */
function interneFehlerAntwort(res: ServerResponse, fehler: unknown): void {
  console.error(`[Admin] Gegenstaende: interner Fehler: ${fehler instanceof Error ? (fehler.stack ?? fehler.message) : String(fehler)}`);
  if (res.headersSent) {
    res.destroy();
    return;
  }
  json(res, 500, { ok: false, fehler: 'intern', message: 'Interner Fehler — nichts geschrieben, Einzelheiten im Log des Betriebsdienstes.' });
}

function gesperrtAntwort(res: ServerResponse): void {
  json(
    res,
    503,
    { ok: false, fehler: 'gesperrt', message: 'Die Gegenstandsdatei wird gerade von einem anderen Vorgang geschrieben — gleich noch einmal versuchen. Nichts geschrieben.' },
    { 'Retry-After': '2' }
  );
}

/** Path of the receipt file: next to the working copy. */
export function gegenstandsQuittungDatei(wurzel: string): string {
  return resolve(dirname(gegenstandsArbeitsDatei(wurzel)), GEGENSTAENDE_QUITTUNG_DATEI);
}

/** Atomic write: temp file in the same folder, then rename. */
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

function dateiBytes(pfad: string): Buffer | null {
  try {
    return readFileSync(pfad);
  } catch (fehler) {
    if ((fehler as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw fehler;
  }
}

/** The request body as text, or `null` once it exceeds `grenze` bytes (the rest stays unread). */
async function rumpfLesen(req: IncomingMessage, grenze: number): Promise<string | null> {
  const teile: Buffer[] = [];
  let gesamt = 0;
  for await (const stueck of req) {
    gesamt += (stueck as Buffer).length;
    if (gesamt > grenze) return null;
    teile.push(stueck as Buffer);
  }
  return Buffer.concat(teile).toString('utf-8');
}

type Stand = { bytes: Buffer; hash: string; quelle: 'arbeit' | 'repo' } | { fehler: 'repo-fehlt' | 'repo-kaputt' };

/**
 * The current bytes of the working copy. If it is missing, create it from the repo state (with the basis file),
 * under the lock. Must run inside the lock section or take it itself (`layoutUnterSperre` is not re-entrant).
 */
function arbeitsstandOhneSperre(arbeit: string, basis: string, repo: string): Stand {
  const repoBytes = dateiBytes(repo);
  let bytes = dateiBytes(arbeit);
  if (bytes === null) {
    if (repoBytes === null) return { fehler: 'repo-fehlt' };
    if (leseGegenstandsDatei(repoBytes.toString('utf-8')).dateiFehler !== null) return { fehler: 'repo-kaputt' };
    atomarSchreiben(arbeit, repoBytes);
    atomarSchreiben(basis, `${layoutHash(repoBytes)}\n`);
    bytes = repoBytes;
  }
  const hash = layoutHash(bytes);
  // 'repo': the working copy is still exactly the accepted repo state; 'arbeit': it has been edited.
  return { bytes, hash, quelle: repoBytes !== null && layoutHash(repoBytes) === hash ? 'repo' : 'arbeit' };
}

function standAntwort(res: ServerResponse, stand: Stand): stand is { bytes: Buffer; hash: string; quelle: 'arbeit' | 'repo' } {
  if ('fehler' in stand) {
    json(
      res,
      stand.fehler === 'repo-fehlt' ? 404 : 500,
      {
        ok: false,
        fehler: stand.fehler,
        message:
          stand.fehler === 'repo-fehlt'
            ? 'shared/data/gegenstaende.json fehlt — die Arbeitskopie kann nicht angelegt werden.'
            : 'shared/data/gegenstaende.json ist keine gültige Gegenstandsdatei — die Arbeitskopie wird nicht angelegt.',
      }
    );
    return false;
  }
  return true;
}

async function lesen(res: ServerResponse, wurzel: string): Promise<void> {
  const arbeit = gegenstandsArbeitsDatei(wurzel);
  const anlegen = (): Stand => {
    tmpAufraeumen([arbeit, gegenstandsBasisDatei(wurzel)]);
    return arbeitsstandOhneSperre(arbeit, gegenstandsBasisDatei(wurzel), gegenstandsRepoDatei(wurzel));
  };
  // An existing working copy is read without the lock: writers replace it by `rename`, so a reader sees a whole file.
  const stand = existsSync(arbeit) ? arbeitsstandOhneSperre(arbeit, gegenstandsBasisDatei(wurzel), gegenstandsRepoDatei(wurzel)) : await unterSperre(arbeit, anlegen);
  if (!standAntwort(res, stand)) return;
  const text = stand.bytes.toString('utf-8');
  const lesung = leseGegenstandsDatei(text);
  json(
    res,
    200,
    {
      ok: true,
      text,
      eintraege: lesung.eintraege,
      verworfen: lesung.verworfen,
      dateiFehler: lesung.dateiFehler,
      // base entries that differ from the base: reading replaced them (shown by the editor from GD4 on)
      grundErsetzt: lesung.grundErsetzt,
      hash: stand.hash,
      quelle: stand.quelle,
    },
    etag(stand.hash)
  );
}

async function schreiben(req: IncomingMessage, res: ServerResponse, wurzel: string, bestaetigt: boolean): Promise<void> {
  const text = await rumpfLesen(req, MAX_DATEI_BYTES);
  if (text === null) {
    json(
      res,
      413,
      { ok: false, fehler: 'anfrage-zu-gross', grenze: MAX_DATEI_BYTES, message: `Die Datei ist größer als ${MAX_DATEI_BYTES} Bytes — nichts geschrieben.` },
      { Connection: 'close' }
    );
    return;
  }
  const ifMatch = req.headers['if-match'];
  const basisRoh = Array.isArray(ifMatch) ? ifMatch[0] : ifMatch;
  if (basisRoh === undefined || basisRoh.trim() === '') {
    json(res, 428, {
      ok: false,
      fehler: 'basis-fehlt',
      message: 'Speichern ohne Basis: If-Match mit dem Hash aus GET /api/gegenstaende fehlt — nichts geschrieben.',
    });
    return;
  }
  const basen = basisHashes(basisRoh);
  if (basen === null || basen.length === 0) {
    json(res, 428, {
      ok: false,
      fehler: basen === null ? 'basis-unbestimmt' : 'basis-fehlt',
      message:
        basen === null
          ? 'If-Match: * gilt nicht — der Hash aus GET /api/gegenstaende ist nötig. Nichts geschrieben.'
          : 'Speichern ohne Basis: If-Match ohne Hash — nichts geschrieben.',
    });
    return;
  }

  // Sanitise BEFORE the lock (pure): a broken file or any discarded entry is refused as a whole.
  const neu: GegenstandsLesung = leseGegenstandsDatei(text);
  if (neu.dateiFehler !== null) {
    json(res, 422, { ok: false, fehler: neu.dateiFehler, message: `Die Datei ist unbrauchbar (${neu.dateiFehler}) — nichts geschrieben.` });
    return;
  }
  if (neu.verworfen.length > 0) {
    json(res, 422, {
      ok: false,
      fehler: 'eintraege-verworfen',
      verworfen: neu.verworfen.map((v) => ({ index: v.index, id: v.id, grund: v.grund })),
      message: `${neu.verworfen.length} Eintrag/Einträge sind ungültig — nichts geschrieben.`,
    });
    return;
  }
  if (neu.grundErsetzt.length > 0) {
    // Reading replaces such an entry by the base entry (nothing is lost there); SAVING refuses it, so the author notices.
    let roh: unknown[] = [];
    try { roh = (JSON.parse(text) as { gegenstaende: unknown[] }).gegenstaende; } catch { /* the reader accepted it */ }
    const indexVon = (id: string): number => roh.findIndex((e) => typeof e === 'object' && e !== null && (e as { id?: unknown }).id === id);
    json(res, 422, {
      ok: false,
      fehler: 'eintraege-verworfen',
      verworfen: neu.grundErsetzt.map((id) => ({ index: indexVon(id), id, grund: 'grundwert-gesperrt' })),
      message: `${neu.grundErsetzt.length} Grundgegenstand/Grundgegenstände weichen vom Grundstand ab — nichts geschrieben.`,
    });
    return;
  }
  let kanonisch: string;
  try {
    kanonisch = schreibeGegenstandsDatei(neu.eintraege);
  } catch (fehler) {
    if (fehler instanceof GegenstandsSchreibFehler) {
      json(res, 422, { ok: false, fehler: fehler.code, message: `Die Datei ist unbrauchbar (${fehler.code}) — nichts geschrieben.` });
      return;
    }
    throw fehler;
  }

  const arbeit = gegenstandsArbeitsDatei(wurzel);
  type Ausgang =
    | { art: 'stand'; stand: Stand }
    | { art: 'veraltet'; hash: string }
    | { art: 'bestaetigung'; hash: string; entfernt: string[]; entferntOhneId: string[] }
    | { art: 'altKaputt'; hash: string; dateiFehler: string }
    | { art: 'geschrieben'; hash: string; entfernt: string[]; entferntOhneId: string[] };
  // ONE synchronous section: read, compare, check removals, rename. No `await` in here (the wait for the lock is
  // asynchronous and happens BEFORE it).
  const ausgang = await unterSperre(arbeit, (): Ausgang => {
    tmpAufraeumen([arbeit, gegenstandsBasisDatei(wurzel)]);
    const stand = arbeitsstandOhneSperre(arbeit, gegenstandsBasisDatei(wurzel), gegenstandsRepoDatei(wurzel));
    if ('fehler' in stand) return { art: 'stand', stand };
    if (!basen.includes(stand.hash)) return { art: 'veraltet', hash: stand.hash };
    const altText = stand.bytes.toString('utf-8');
    const alt = leseGegenstandsDatei(altText);
    if (alt.dateiFehler !== null) {
      // The old state is broken: nothing of it can be compared, so overwriting needs the confirmation (and a copy).
      if (!bestaetigt) return { art: 'altKaputt', hash: stand.hash, dateiFehler: alt.dateiFehler };
      kaputtSichern(arbeit);
      atomarSchreiben(arbeit, kanonisch);
      return { art: 'geschrieben', hash: layoutHash(kanonisch), entfernt: [], entferntOhneId: [] };
    }
    const neueIds = new Set(neu.eintraege.map((e) => e.id));
    const verworfen = verworfeneIds(altText, alt);
    // A base id that leaves the file falls back to the base entry: it is no removal and needs no confirmation.
    const entfernt = [...new Set([...alt.eintraege.map((e) => e.id), ...verworfen.ids])].filter((id) => !neueIds.has(id) && !istGrundItem(id));
    const entferntOhneId = verworfen.ohneId;
    if ((entfernt.length > 0 || entferntOhneId.length > 0) && !bestaetigt) return { art: 'bestaetigung', hash: stand.hash, entfernt, entferntOhneId };
    atomarSchreiben(arbeit, kanonisch);
    return { art: 'geschrieben', hash: layoutHash(kanonisch), entfernt, entferntOhneId };
  });

  switch (ausgang.art) {
    case 'stand':
      standAntwort(res, ausgang.stand);
      return;
    case 'veraltet':
      json(
        res,
        412,
        {
          ok: false,
          fehler: 'veraltet',
          hash: ausgang.hash,
          message: 'Die Gegenstandsdatei hat sich seit dem Lesen geändert — neu laden. Nichts geschrieben.',
        },
        etag(ausgang.hash)
      );
      return;
    case 'altKaputt':
      json(
        res,
        409,
        {
          ok: false,
          fehler: 'alter-stand-kaputt',
          brauchtBestaetigung: true,
          dateiFehler: ausgang.dateiFehler,
          hash: ausgang.hash,
          message: `Die bisherige Arbeitsdatei ist unbrauchbar (${ausgang.dateiFehler}). Mit ?bestaetigt=1 erneut senden, um sie zu ersetzen (eine Sicherung bleibt liegen). Nichts geschrieben.`,
        },
        etag(ausgang.hash)
      );
      return;
    case 'bestaetigung': {
      const alle = [...ausgang.entfernt, ...ausgang.entferntOhneId];
      json(
        res,
        409,
        {
          ok: false,
          fehler: 'brauchtBestaetigung',
          brauchtBestaetigung: true,
          entfernt: ausgang.entfernt,
          entferntOhneId: ausgang.entferntOhneId,
          hash: ausgang.hash,
          message: `${alle.length} Gegenstand/Gegenstände würden endgültig entfernt (${alle.join(', ')}). Mit ?bestaetigt=1 erneut senden, um sie zu entfernen. Nichts geschrieben.`,
        },
        etag(ausgang.hash)
      );
      return;
    }
    case 'geschrieben':
      console.log(`[Admin] Gegenstandsdatei geschrieben: ${neu.eintraege.length} Eintrag/Einträge, ${ausgang.entfernt.length + ausgang.entferntOhneId.length} entfernt (${basename(arbeit)})`);
      json(res, 200, { ok: true, hash: ausgang.hash, eintraege: neu.eintraege.length, entfernt: ausgang.entfernt, entferntOhneId: ausgang.entferntOhneId }, etag(ausgang.hash));
      return;
  }
}

function quittungLesen(res: ServerResponse, wurzel: string): void {
  const pfad = gegenstandsQuittungDatei(wurzel);
  if (!existsSync(pfad)) {
    json(res, 200, { ok: true, status: 'keine' });
    return;
  }
  const bytes = dateiBytes(pfad);
  let quittung: unknown = null;
  if (bytes !== null && bytes.length <= QUITTUNG_MAX_BYTES) {
    try {
      quittung = JSON.parse(bytes.toString('utf-8'));
    } catch {
      quittung = null;
    }
  }
  if (typeof quittung !== 'object' || quittung === null || Array.isArray(quittung) || typeof (quittung as { status?: unknown }).status !== 'string') {
    json(res, 200, { ok: true, status: 'unlesbar' });
    return;
  }
  json(res, 200, { ok: true, ...(quittung as Record<string, unknown>) });
}

/**
 * Entry point from `admin/src/main.ts` (before the JSON gate: the body is read as raw text so that broken JSON gets
 * the reason code `datei-kein-json`). Returns `true` if the path belongs to this module and the answer was sent.
 */
export async function gegenstaendeBehandeln(
  req: IncomingMessage,
  res: ServerResponse,
  pfad: string,
  parameter: URLSearchParams,
  wurzel: string
): Promise<boolean> {
  if (pfad !== '/api/gegenstaende' && !pfad.startsWith('/api/gegenstaende/')) return false;
  try {
    await verteilen(req, res, pfad, parameter, wurzel);
  } catch (fehler) {
    if (fehler instanceof Gesperrt) gesperrtAntwort(res);
    else if (req.aborted || (fehler as Error)?.message === 'aborted') res.destroy(); // client gone: nobody to answer, no noise
    else interneFehlerAntwort(res, fehler);
  }
  return true;
}

async function verteilen(req: IncomingMessage, res: ServerResponse, pfad: string, parameter: URLSearchParams, wurzel: string): Promise<void> {
  const methode = req.method ?? 'GET';
  if (pfad === '/api/gegenstaende') {
    if (methode === 'GET') await lesen(res, wurzel);
    else if (methode === 'PUT') await schreiben(req, res, wurzel, parameter.get('bestaetigt') === '1');
    else json(res, 405, { ok: false, fehler: 'methode', message: 'GET oder PUT erwartet' }, { Allow: 'GET, PUT' });
  } else if (pfad === '/api/gegenstaende/quittung') {
    if (methode === 'GET') quittungLesen(res, wurzel);
    else json(res, 405, { ok: false, fehler: 'methode', message: 'GET erwartet' }, { Allow: 'GET' });
  } else {
    json(res, 404, { ok: false, fehler: 'unbekannter-endpunkt', message: 'Unbekannter Endpunkt unter /api/gegenstaende.' });
  }
}
