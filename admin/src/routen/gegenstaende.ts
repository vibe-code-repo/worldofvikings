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
 * not the request bytes, atomically (`<file>.<pid>.<random>.tmp`, then `rename`) under `<file>.lock` (the same lock
 * file the world uses, `layoutUnterSperre`). Compare, check and rename are ONE synchronous section, so two PUTs with
 * the same `If-Match` give exactly one 200 and one 412.
 *
 * ── Removing items ───────────────────────────────────────────────────
 * If the new state lacks an item of the old state, the route answers 409 `brauchtBestaetigung` with `entfernt: [ids]`
 * and writes nothing; with `?bestaetigt=1` it writes. Removing ALWAYS needs this confirmation. How many players hold
 * the item is counted later by the server watch (Game card G2), which holds back its own application in the receipt
 * (`bestaetigung-noetig`), like the deletion lock of the world (Z3). The route knows no inventories.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';
import { layoutHash, layoutUnterSperre } from '@wov/shared/src/worldlayout/layoutDatei.js';
import {
  GegenstandsSchreibFehler,
  MAX_DATEI_BYTES,
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

/** The bare hash of an `If-Match` value (`"<hash>"`, `W/"<hash>"`, or bare); anything else matches no hash. */
function basisHash(roh: string): string {
  const s = roh.trim().replace(/^W\//, '');
  return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
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

function lesen(res: ServerResponse, wurzel: string): void {
  const arbeit = gegenstandsArbeitsDatei(wurzel);
  const stand = layoutUnterSperre(arbeit, () => arbeitsstandOhneSperre(arbeit, gegenstandsBasisDatei(wurzel), gegenstandsRepoDatei(wurzel)));
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
  const basis = basisHash(basisRoh);

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
    | { art: 'bestaetigung'; hash: string; entfernt: string[] }
    | { art: 'geschrieben'; hash: string; entfernt: string[] };
  // ONE synchronous section: read, compare, check removals, rename. No `await` in here.
  const ausgang = layoutUnterSperre(arbeit, (): Ausgang => {
    const stand = arbeitsstandOhneSperre(arbeit, gegenstandsBasisDatei(wurzel), gegenstandsRepoDatei(wurzel));
    if ('fehler' in stand) return { art: 'stand', stand };
    if (stand.hash !== basis) return { art: 'veraltet', hash: stand.hash };
    const neueIds = new Set(neu.eintraege.map((e) => e.id));
    const entfernt = leseGegenstandsDatei(stand.bytes.toString('utf-8')).eintraege.map((e) => e.id).filter((id) => !neueIds.has(id));
    if (entfernt.length > 0 && !bestaetigt) return { art: 'bestaetigung', hash: stand.hash, entfernt };
    atomarSchreiben(arbeit, kanonisch);
    return { art: 'geschrieben', hash: layoutHash(kanonisch), entfernt };
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
    case 'bestaetigung':
      json(
        res,
        409,
        {
          ok: false,
          fehler: 'brauchtBestaetigung',
          brauchtBestaetigung: true,
          entfernt: ausgang.entfernt,
          hash: ausgang.hash,
          message: `${ausgang.entfernt.length} Gegenstand/Gegenstände würden endgültig entfernt (${ausgang.entfernt.join(', ')}). Mit ?bestaetigt=1 erneut senden, um sie zu entfernen. Nichts geschrieben.`,
        },
        etag(ausgang.hash)
      );
      return;
    case 'geschrieben':
      console.log(`[Admin] Gegenstandsdatei geschrieben: ${neu.eintraege.length} Eintrag/Einträge, ${ausgang.entfernt.length} entfernt (${basename(arbeit)})`);
      json(res, 200, { ok: true, hash: ausgang.hash, eintraege: neu.eintraege.length, entfernt: ausgang.entfernt }, etag(ausgang.hash));
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
  const methode = req.method ?? 'GET';
  if (pfad === '/api/gegenstaende') {
    if (methode === 'GET') lesen(res, wurzel);
    else if (methode === 'PUT') await schreiben(req, res, wurzel, parameter.get('bestaetigt') === '1');
    else json(res, 405, { ok: false, fehler: 'methode', message: 'GET oder PUT erwartet' });
    return true;
  }
  if (pfad === '/api/gegenstaende/quittung') {
    if (methode === 'GET') quittungLesen(res, wurzel);
    else json(res, 405, { ok: false, fehler: 'methode', message: 'GET erwartet' });
    return true;
  }
  return false;
}
