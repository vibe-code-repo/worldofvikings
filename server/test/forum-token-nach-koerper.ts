/**
 * W3-Reste — N-3: Die Forum-Schreibrouten pruefen das Token NACH dem Lesen
 * des Koerpers erneut, genau wie `KontoApi.ts` es fuer Profil, Avatar,
 * Charakter und Melden schon tut (W3-N3-Pruefung, Opus, 27.09.2026).
 *
 * Ein Angreifer mit einem gestohlenen Token, das der Besitzer waehrend
 * einer langsam gesendeten Anfrage widerruft (Passwortwechsel oder
 * "ueberall abmelden"), konnte vorher noch GENAU EINEN Forenschreibvorgang
 * abschliessen: `kontoIdAus` wurde nur VOR `await this.koerper(req)`
 * geprueft.
 *
 * Kein Netz: ein Fake-Request wie in `forum-api.ts`, dessen Koerper aber
 * erst nach einem expliziten Signal ankommt — genau in diesem Fenster wird
 * das Token entzogen (die Attrappe fuer `kontoIdAus` liest eine Variable,
 * die dann umgeschaltet wird).
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ForumDatabase } from '../src/forum/ForumDatabase.js';
import { ForumApi } from '../src/forum/ForumApi.js';

const dir = mkdtempSync(join(tmpdir(), 'wov-forum-token-nach-koerper-'));
let fehler = 0;
function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    console.log(`  OK   ${name}`);
  } else {
    fehler++;
    console.error(`  ROT  ${name}${extra ? ` (${extra})` : ''}`);
  }
}

interface FakeAntwort { status: number; body: string; headers: Record<string, string> }

/** Konto-Id, die die Anfrage "traegt"; null = nicht (mehr) angemeldet. */
let angemeldet: number | null = 1;

function fakeApi(db: ForumDatabase): ForumApi {
  return new ForumApi(
    db,
    () => angemeldet,
    (kontoId, charakterId) => (kontoId === 1 && charakterId === 3 ? { id: 3, name: 'Runa' } : null),
    () => true, // Moderator: fuer den threadSchalter-Fall gebraucht
    () => null,
  );
}

/**
 * Ein Fake-Request, dessen Koerper erst ankommt, NACHDEM `mitte()`
 * aufgerufen wurde — genau dort widerruft der Test das Token, waehrend die
 * Route den Koerper noch liest (`for await (const stueck of req)`).
 */
function fakeReqVerzoegert(method: string, url: string, koerper: unknown, mitte: () => void): IncomingMessage {
  return {
    method,
    url,
    headers: {},
    [Symbol.asyncIterator]: async function* () {
      mitte();
      await new Promise((r) => setTimeout(r, 5));
      yield Buffer.from(JSON.stringify(koerper));
    },
  } as unknown as IncomingMessage;
}

async function frage(api: ForumApi, req: IncomingMessage): Promise<FakeAntwort> {
  const res: FakeAntwort = { status: 0, body: '', headers: {} };
  const fakeRes = {
    setHeader: (k: string, v: string) => { res.headers[k] = v; },
    writeHead: (s: number, h?: Record<string, string>) => {
      res.status = s;
      if (h) for (const [k, v] of Object.entries(h)) res.headers[k] = v;
      return fakeRes;
    },
    end: (t?: string) => { res.body = t ?? ''; },
    headersSent: false,
  };
  api.behandle(req, fakeRes as unknown as ServerResponse);
  await new Promise((r) => setTimeout(r, 30));
  return res;
}

function json(res: FakeAntwort): Record<string, unknown> {
  try { return JSON.parse(res.body) as Record<string, unknown>; } catch { return {}; }
}

async function main(): Promise<void> {
  const db = new ForumDatabase(join(dir, 'world.db'));
  const api = fakeApi(db);

  // ── neuesThema: Token waehrend der Uebertragung entzogen ─────────────
  angemeldet = 1;
  const thema = await frage(api, fakeReqVerzoegert(
    'POST', '/forum/boards/mead_hall/threads',
    { characterId: 3, title: 'Ein Thema', body: 'Ein Beitragstext, lang genug.' },
    () => { angemeldet = null; },
  ));
  check('neuesThema: Token waehrend der Uebertragung entzogen ⇒ 401, kein Thema angelegt',
    thema.status === 401 && json(thema).error === 'not-signed-in', `status=${thema.status} body=${thema.body}`);

  // Kontrolle: dieselbe Anfrage OHNE Entzug legt ein Thema an.
  angemeldet = 1;
  const themaOk = await frage(api, fakeReqVerzoegert(
    'POST', '/forum/boards/mead_hall/threads',
    { characterId: 3, title: 'Ein echtes Thema', body: 'Ein Beitragstext, lang genug.' },
    () => { /* Token bleibt gueltig */ },
  ));
  check('Kontrolle: ohne Entzug wird das Thema angelegt (201)', themaOk.status === 201, `status=${themaOk.status} body=${themaOk.body}`);
  const themaId = json(themaOk).threadId as number;

  // ── neuerBeitrag: dasselbe Fenster ────────────────────────────────────
  angemeldet = 1;
  const beitrag = await frage(api, fakeReqVerzoegert(
    'POST', `/forum/threads/${themaId}/posts`,
    { characterId: 3, body: 'Ein Antworttext, lang genug fuer die Pruefung.' },
    () => { angemeldet = null; },
  ));
  check('neuerBeitrag: Token waehrend der Uebertragung entzogen ⇒ 401',
    beitrag.status === 401 && json(beitrag).error === 'not-signed-in', `status=${beitrag.status} body=${beitrag.body}`);

  // ── reaktion: dasselbe Fenster ─────────────────────────────────────────
  angemeldet = 1;
  const beitragOk = await frage(api, fakeReqVerzoegert(
    'POST', `/forum/threads/${themaId}/posts`,
    { characterId: 3, body: 'Noch ein Antworttext, lang genug.' },
    () => { /* Token bleibt gueltig */ },
  ));
  const postId = json(beitragOk).postId as number;

  angemeldet = 1;
  const reaktion = await frage(api, fakeReqVerzoegert(
    'POST', `/forum/posts/${postId}/reactions`,
    { kind: 'hail' },
    () => { angemeldet = null; },
  ));
  check('reaktion: Token waehrend der Uebertragung entzogen ⇒ 401',
    reaktion.status === 401 && json(reaktion).error === 'not-signed-in', `status=${reaktion.status} body=${reaktion.body}`);

  // ── melden: dasselbe Fenster ────────────────────────────────────────
  angemeldet = 1;
  const melden = await frage(api, fakeReqVerzoegert(
    'POST', `/forum/posts/${postId}/report`,
    { reason: 'Testgrund' },
    () => { angemeldet = null; },
  ));
  check('melden: Token waehrend der Uebertragung entzogen ⇒ 401',
    melden.status === 401 && json(melden).error === 'not-signed-in', `status=${melden.status} body=${melden.body}`);

  db.schliessen();
}

try {
  await main();
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (fehler > 0) {
  console.error(`\nForum-Token-nach-Koerper: ${fehler} Pruefung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('\nForum-Token-nach-Koerper: alles gruen.');
