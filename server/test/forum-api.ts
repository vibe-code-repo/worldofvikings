/**
 * Das Thing — Waechter ueber die Forum-API: Lesen UND Schreiben (M1/M3).
 *
 * Kein Netz: Ein Fake-Request trifft `ForumApi.behandle` direkt, die
 * Antwort wird abgefangen. `behandle` stösst die Arbeit asynchron an (wie
 * im Betrieb), deshalb wartet der Helfer einen Tick, bevor er die Antwort
 * liest.
 *
 * Geprueft wird:
 *  - der Rueckfall (`false`) fuer fremde Pfade, damit die 426-Gesundheits-
 *    pruefung bleibt,
 *  - Lesen: Bretter, Themenliste, Thema, 404 fuer Unbekanntes, Blaettern,
 *  - Schreiben: 401 ohne Token, 400 bei falschem Charakter/Titel/Text,
 *    201 beim Anlegen, Antwort an ein Thema,
 *  - Eigentum: Bearbeiten/Loeschen NUR am eigenen Beitrag (zweites Konto),
 *  - Drossel nach zu vielen Beitraegen.
 *
 * The Thing's API guard: reads and writes, in-process fakes, no network.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BOARD_SLUGS } from '@wov/shared';
import { ForumDatabase } from '../src/forum/ForumDatabase.js';
import { ForumApi } from '../src/forum/ForumApi.js';

const dir = mkdtempSync(join(tmpdir(), 'wov-forum-api-'));
let fehler = 0;
function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    console.log(`  OK   ${name}`);
  } else {
    fehler++;
    console.error(`  ROT  ${name}${extra ? ` (${extra})` : ''}`);
  }
}

interface FakeAntwort {
  status: number;
  body: string;
  headers: Record<string, string>;
}

/** Konto-Id, die die Anfrage „traegt"; null = nicht angemeldet. */
let angemeldet: number | null = null;

/** Zwei Konten mit je einem Charakter: 1→3 „Runa", 2→5 „Bjorn". */
const NAMEN: Record<string, string> = { '1:3': 'Runa', '2:5': 'Bjorn' };

function fakeApi(db: ForumDatabase): ForumApi {
  return new ForumApi(
    db,
    () => angemeldet,
    (kontoId, charakterId) => {
      const name = NAMEN[`${kontoId}:${charakterId}`];
      return name ? { id: charakterId, name } : null;
    },
  );
}

async function frage(
  api: ForumApi,
  method: string,
  url: string,
  koerper?: unknown,
): Promise<{ behandelt: boolean; res: FakeAntwort }> {
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
  const req = {
    method,
    url,
    headers: {},
    [Symbol.asyncIterator]: async function* () {
      if (koerper !== undefined) yield Buffer.from(JSON.stringify(koerper));
    },
  } as unknown as IncomingMessage;
  const behandelt = api.behandle(req, fakeRes as unknown as ServerResponse);
  // Die Arbeit laeuft asynchron (behandle stösst sie an); einen Tick warten.
  await new Promise((r) => setTimeout(r, 0));
  return { behandelt, res };
}

function json(res: FakeAntwort): Record<string, unknown> {
  try {
    return JSON.parse(res.body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  const db = new ForumDatabase(join(dir, 'world.db'));
  const api = fakeApi(db);

  // ── Rueckfall ──────────────────────────────────────────────────────
  check('fremder Pfad ⇒ false (426 bleibt beim Aufrufer)',
    (await frage(api, 'GET', '/accounts/status')).behandelt === false);

  // ── Bretter lesen ──────────────────────────────────────────────────
  const bretter = await frage(api, 'GET', '/forum/boards');
  check('GET /forum/boards ⇒ 200', bretter.res.status === 200);
  check('sechs Bretter', Array.isArray(json(bretter.res).boards)
    && (json(bretter.res).boards as unknown[]).length === BOARD_SLUGS.length);

  // ── Schreiben ohne Token ───────────────────────────────────────────
  angemeldet = null;
  const ohneToken = await frage(api, 'POST', '/forum/boards/mead_hall/threads',
    { title: 'Hallo', body: 'Welt', characterId: 3 });
  check('POST Thema ohne Token ⇒ 401', ohneToken.res.status === 401);

  // ── Angemeldet, aber fremder Charakter ─────────────────────────────
  angemeldet = 1;
  const fremderChar = await frage(api, 'POST', '/forum/boards/mead_hall/threads',
    { title: 'Hallo', body: 'Welt', characterId: 99 });
  check('POST Thema mit fremdem Charakter ⇒ 400', fremderChar.res.status === 400);

  const kurz = await frage(api, 'POST', '/forum/boards/mead_hall/threads',
    { title: 'A', body: 'Text', characterId: 3 });
  check('zu kurzer Titel ⇒ 400', kurz.res.status === 400);
  const leer = await frage(api, 'POST', '/forum/boards/mead_hall/threads',
    { title: 'Ein Titel', body: '   ', characterId: 3 });
  check('leerer Text ⇒ 400', leer.res.status === 400);

  // ── Gueltiges Thema (Konto 1 / Runa) ───────────────────────────────
  const angelegt = await frage(api, 'POST', '/forum/boards/mead_hall/threads',
    { title: 'Erster Axtkauf', body: '**Wo** kauft man Aexte?', characterId: 3 });
  check('POST gueltiges Thema ⇒ 201', angelegt.res.status === 201);
  const threadId = Number(json(angelegt.res).threadId);
  check('Antwort nennt die Thread-Id', Number.isInteger(threadId) && threadId > 0);

  const liste = await frage(api, 'GET', '/forum/boards/mead_hall/threads');
  const themen = json(liste.res).threads as Array<Record<string, unknown>>;
  check('Thema steht in der Liste', themen.length === 1 && themen[0]!.authorName === 'Runa');

  // ── Antwort von Konto 2 / Bjorn ────────────────────────────────────
  angemeldet = 2;
  const antwort = await frage(api, 'POST', `/forum/threads/${threadId}/posts`,
    { body: 'Beim Schmied.', characterId: 5 });
  check('POST Antwort ⇒ 201', antwort.res.status === 201);

  const thema = await frage(api, 'GET', `/forum/threads/${threadId}`);
  const posts = json(thema.res).posts as Array<Record<string, unknown>>;
  check('Thema hat zwei Beitraege', posts.length === 2);
  const ersterPost = Number(posts[0]!.id); // Runa
  const zweiterPost = Number(posts[1]!.id); // Bjorn

  // ── Eigentum: Konto 1 darf Bjorns Beitrag nicht anfassen ───────────
  angemeldet = 1;
  const fremdPatch = await frage(api, 'PATCH', `/forum/posts/${zweiterPost}`,
    { body: 'geaendert', characterId: 3 });
  check('PATCH auf einen fremden Beitrag ⇒ 403', fremdPatch.res.status === 403);
  const fremdWeg = await frage(api, 'DELETE', `/forum/posts/${zweiterPost}`);
  check('DELETE auf einen fremden Beitrag ⇒ 403', fremdWeg.res.status === 403);

  // ── Eigenen Beitrag bearbeiten und loeschen ────────────────────────
  const eigen = await frage(api, 'PATCH', `/forum/posts/${ersterPost}`,
    { body: 'Korrigiert.', characterId: 3 });
  check('PATCH auf den eigenen Beitrag ⇒ 200', eigen.res.status === 200);
  const nachEdit = await frage(api, 'GET', `/forum/threads/${threadId}`);
  const p0 = (json(nachEdit.res).posts as Array<Record<string, unknown>>)[0]!;
  check('Bearbeiten setzt Text und edited_at', p0.bodyMd === 'Korrigiert.' && p0.editedAt !== null);

  const eigenWeg = await frage(api, 'DELETE', `/forum/posts/${ersterPost}`);
  check('DELETE auf den eigenen Beitrag ⇒ 200', eigenWeg.res.status === 200);
  const nachWeg = await frage(api, 'GET', `/forum/threads/${threadId}`);
  const p0weg = (json(nachWeg.res).posts as Array<Record<string, unknown>>)[0]!;
  check('geloeschter Beitrag bleibt als Platzhalter stehen',
    p0weg.deletedAt !== null && p0weg.bodyMd === 'Korrigiert.');

  // ── Drossel: nach fuenf Beitraegen ist Schluss (Konto 1) ───────────
  let letzterStatus = 0;
  for (let i = 0; i < 7; i++) {
    const r = await frage(api, 'POST', `/forum/threads/${threadId}/posts`,
      { body: `Antwort ${i}`, characterId: 3 });
    letzterStatus = r.res.status;
  }
  check('Drossel greift (429 nach zu vielen Beitraegen)', letzterStatus === 429);

  // ── Rand ───────────────────────────────────────────────────────────
  const seiteWeit = await frage(api, 'GET', `/forum/threads/${threadId}?page=999`);
  check('Seite 999 wird geklemmt, nicht 404', seiteWeit.res.status === 200);
  const unbekannt = await frage(api, 'GET', '/forum/boards/gibt-es-nicht/threads');
  check('unbekanntes Brett ⇒ 404', unbekannt.res.status === 404);

  db.schliessen();
}

try {
  await main();
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (fehler > 0) {
  console.error(`\nForum-API: ${fehler} Pruefung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('\nForum-API: alles gruen.');
