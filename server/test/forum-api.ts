/**
 * Das Thing — Waechter ueber die LESENDE Forum-API (M1).
 *
 * Kein Netz: Ein Fake-Request trifft `ForumApi.behandle` direkt, die
 * Antwort wird abgefangen. Damit sind genau die Fehler auffindbar, die
 * eine reine Datenschicht nicht sieht — die Wege, das Blaettern und die
 * Klemmen am Rand.
 *
 * Geprueft wird:
 *  - ein Pfad ausserhalb von `/forum` faellt an den Aufrufer zurueck
 *    (`false`) — sonst bliebe die 426-Gesundheitspruefung weg,
 *  - `/forum/boards` liefert die sechs Bretter,
 *  - ein unbekanntes Brett ist 404, nicht eine leere Liste,
 *  - `/forum/threads/:id` liefert Thema und Beitraege,
 *  - eine Seitenzahl hinter dem Ende wird geklemmt statt 404,
 *  - eine unbekannte Forum-Route ist 404 (nicht der Fallback).
 *
 * The Thing's read-API guard: in-process fakes, no network.
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

function frage(api: ForumApi, method: string, url: string): { behandelt: boolean; res: FakeAntwort } {
  const res: FakeAntwort = { status: 0, body: '', headers: {} };
  const fakeRes = {
    setHeader: (k: string, v: string) => { res.headers[k] = v; },
    writeHead: (s: number, h?: Record<string, string>) => {
      res.status = s;
      if (h) for (const [k, v] of Object.entries(h)) res.headers[k] = v;
      return fakeRes;
    },
    end: (t?: string) => { res.body = t ?? ''; },
  };
  const req = { method, url, headers: {} } as unknown as IncomingMessage;
  const behandelt = api.behandle(req, fakeRes as unknown as ServerResponse);
  return { behandelt, res };
}

function json(res: FakeAntwort): Record<string, unknown> {
  return JSON.parse(res.body) as Record<string, unknown>;
}

try {
  const db = new ForumDatabase(join(dir, 'world.db'));
  const api = new ForumApi(db);
  const autor = { charakterId: 3, kontoId: 1, name: 'Runa' };
  db.createThread('mead_hall', 'Ein Thema', autor, 'Text', 1000);
  const t = db.createThread('weapons', 'Schilde', autor, 'Welcher Schild?', 2000);
  db.createPost(t.threadId, autor, 'Der runde.', 3000);

  // ── Fallback ───────────────────────────────────────────────────────
  check('fremder Pfad ⇒ false (426 bleibt beim Aufrufer)',
    frage(api, 'GET', '/accounts/status').behandelt === false);

  // ── Bretter ────────────────────────────────────────────────────────
  const bretter = frage(api, 'GET', '/forum/boards');
  const brettKörper = json(bretter.res);
  check('GET /forum/boards ⇒ 200', bretter.res.status === 200);
  check('sechs Bretter', Array.isArray(brettKörper.boards)
    && (brettKörper.boards as unknown[]).length === BOARD_SLUGS.length);

  // ── Themenliste ────────────────────────────────────────────────────
  const themen = frage(api, 'GET', '/forum/boards/mead_hall/threads');
  const themenKörper = json(themen.res);
  check('GET /forum/boards/mead_hall/threads ⇒ 200', themen.res.status === 200);
  check('liefert das eine Thema', Array.isArray(themenKörper.threads)
    && (themenKörper.threads as unknown[]).length === 1);
  check('Blaetterzahl 1', themenKörper.pageCount === 1 && themenKörper.page === 1);

  const unbekannt = frage(api, 'GET', '/forum/boards/gibt-es-nicht/threads');
  check('unbekanntes Brett ⇒ 404 (nicht leere Liste)', unbekannt.res.status === 404);

  // ── Thema mit Beitraegen, Seite hinter dem Ende geklemmt ───────────
  const thema = frage(api, 'GET', `/forum/threads/${t.threadId}?page=999`);
  const themaKörper = json(thema.res);
  check('GET /forum/threads/:id ⇒ 200', thema.res.status === 200);
  check('Seite 999 wird auf 1 geklemmt', themaKörper.page === 1 && themaKörper.pageCount === 1);
  check('zwei Beitraege', Array.isArray(themaKörper.posts) && (themaKörper.posts as unknown[]).length === 2);

  const fehlt = frage(api, 'GET', '/forum/threads/424242');
  check('unbekanntes Thema ⇒ 404', fehlt.res.status === 404);

  const quatsch = frage(api, 'GET', '/forum/gibt-es-nicht');
  check('unbekannte Forum-Route ⇒ 404', quatsch.res.status === 404);

  db.schliessen();
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (fehler > 0) {
  console.error(`\nForum-API: ${fehler} Pruefung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('\nForum-API: alles gruen.');
