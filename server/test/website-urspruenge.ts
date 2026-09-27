/**
 * Karte D1: die gemeinsame Ursprungs-Liste von KontoApi.ts und ForumApi.ts.
 *
 * Auf `origin/main` kannte keine der beiden APIs world-of-mmorpg.com/.de —
 * die Charaktervorschau/das Anmelden von dort wäre an CORS gescheitert.
 * Drei Ebenen werden geprüft:
 *  1. Die Konstante selbst — die drei Basisdomains samt `www.`.
 *  2. KontoApi UND ForumApi ueber eine echte HTTP-Verbindung bzw. einen
 *     Fake-Request: ein bekannter Ursprung bekommt die CORS-Kopfzeile, ein
 *     fremder nicht.
 *  3. Angriffsbefund M5 (Opus-Prüfung c2c2765): feindliche Ursprünge mit
 *     Präfix-/Suffix-Treffer auf eine bekannte Domain — ein `.some(u =>
 *     ursprung.startsWith(u))` statt `Set.has` hätte diese fälschlich
 *     erlaubt, und kein bisheriger Test hätte das bemerkt.
 */
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WEBSITE_URSPRUENGE } from '../src/net/WebsiteUrspruenge.js';
import { KontoApi } from '../src/konto/KontoApi.js';
import { Kontendatenbank } from '../src/konto/Kontendatenbank.js';
import { geheimnisErzeugen } from '../src/net/Identitaet.js';
import { ForumApi } from '../src/forum/ForumApi.js';
import { ForumDatabase } from '../src/forum/ForumDatabase.js';

// ── 1. Die Konstante selbst ─────────────────────────────────────────────

const ERWARTET = [
  'https://world-of-mmorpg.com',
  'https://www.world-of-mmorpg.com',
  'https://world-of-mmorpg.de',
  'https://www.world-of-mmorpg.de',
  'https://world-of-vikings.com',
  'https://www.world-of-vikings.com',
];
for (const ursprung of ERWARTET) {
  assert.ok(WEBSITE_URSPRUENGE.has(ursprung), `WEBSITE_URSPRUENGE fehlt ${ursprung}`);
}
assert.equal(WEBSITE_URSPRUENGE.size, ERWARTET.length, 'keine ueberzaehligen Eintraege');

// ── 2a. KontoApi ueber echtes HTTP ───────────────────────────────────────

const ordner = mkdtempSync(join(tmpdir(), 'wov-website-urspruenge-'));
const db = new Kontendatenbank(join(ordner, 'konten.db'));
const geheimnis = Buffer.from(geheimnisErzeugen(), 'hex');
const kontoApi = new KontoApi(db, geheimnis, () => ({ spieler: 0, plaetze: 10, tag: 1, welt: 'test' }));

const server = createServer((req, res) => {
  if (!kontoApi.behandle(req, res)) res.writeHead(404).end();
});

await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve());
});
const { port } = server.address() as { port: number };
const basis = `http://127.0.0.1:${port}`;

async function korsKopf(ursprung: string): Promise<string | null> {
  const antwort = await fetch(`${basis}/accounts/status`, { headers: { Origin: ursprung } });
  return antwort.headers.get('access-control-allow-origin');
}

assert.equal(
  await korsKopf('https://world-of-mmorpg.com'),
  'https://world-of-mmorpg.com',
  'KontoApi erlaubt world-of-mmorpg.com',
);
assert.equal(
  await korsKopf('https://world-of-mmorpg.de'),
  'https://world-of-mmorpg.de',
  'KontoApi erlaubt world-of-mmorpg.de',
);
assert.equal(
  await korsKopf('https://evil.example'),
  null,
  'KontoApi setzt fuer einen fremden Ursprung keine CORS-Kopfzeile',
);

// ── Feindliche Ursprünge (M5): Präfix-/Suffix-Treffer auf world-of-mmorpg.com
const FEINDLICHE_URSPRUENGE = [
  'https://world-of-mmorpg.com.evil.tld',
  'https://evilworld-of-mmorpg.com',
  'http://world-of-mmorpg.com',
  'https://world-of-mmorpg.com:8443',
  'https://world-of-mmorpg.com.',
  'null',
];
for (const ursprung of FEINDLICHE_URSPRUENGE) {
  assert.equal(
    await korsKopf(ursprung),
    null,
    `KontoApi lehnt den feindlichen Ursprung ${ursprung} ab`,
  );
}

await new Promise<void>((resolve) => server.close(() => resolve()));
rmSync(ordner, { recursive: true, force: true });

// ── 2b. ForumApi ueber einen Fake-Request ────────────────────────────────

interface FakeAntwort {
  status: number;
  headers: Record<string, string>;
}

async function forumKorsKopf(api: ForumApi, ursprung: string): Promise<string | undefined> {
  const res: FakeAntwort = { status: 0, headers: {} };
  const fakeRes = {
    setHeader: (k: string, v: string) => { res.headers[k] = v; },
    writeHead: (s: number, h?: Record<string, string>) => {
      res.status = s;
      if (h) for (const [k, v] of Object.entries(h)) res.headers[k] = v;
      return fakeRes;
    },
    end: () => {},
    headersSent: false,
  };
  const req = { method: 'GET', url: '/forum/boards', headers: { origin: ursprung } } as unknown as IncomingMessage;
  api.behandle(req, fakeRes as unknown as ServerResponse);
  await new Promise((r) => setTimeout(r, 0));
  return res.headers['Access-Control-Allow-Origin'];
}

const forumOrdner = mkdtempSync(join(tmpdir(), 'wov-website-urspruenge-forum-'));
const forumDb = new ForumDatabase(join(forumOrdner, 'world.db'));
const forumApi = new ForumApi(forumDb);

assert.equal(
  await forumKorsKopf(forumApi, 'https://world-of-mmorpg.com'),
  'https://world-of-mmorpg.com',
  'ForumApi erlaubt world-of-mmorpg.com',
);
assert.equal(
  await forumKorsKopf(forumApi, 'https://world-of-mmorpg.de'),
  'https://world-of-mmorpg.de',
  'ForumApi erlaubt world-of-mmorpg.de',
);
assert.equal(
  await forumKorsKopf(forumApi, 'https://evil.example'),
  undefined,
  'ForumApi setzt fuer einen fremden Ursprung keine CORS-Kopfzeile',
);

for (const ursprung of FEINDLICHE_URSPRUENGE) {
  assert.equal(
    await forumKorsKopf(forumApi, ursprung),
    undefined,
    `ForumApi lehnt den feindlichen Ursprung ${ursprung} ab`,
  );
}

rmSync(forumOrdner, { recursive: true, force: true });

console.log('website-urspruenge: alle Proben gruen');
