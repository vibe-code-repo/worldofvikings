/**
 * Konto-Herkunft: Herkunft.ts hinter einem Reverse-Proxy.
 *
 * Der Befund: `KontoApi.herkunft()` und `WebSocketAcceptor` lasen bisher
 * nur `req.socket.remoteAddress`. Hinter nginx (deploy/nginx/wov-lab.conf,
 * ein einziger Ursprung) ist das fuer JEDEN Besucher 127.0.0.1 — die
 * Anmelde-Drossel (fuenf Fehlversuche, dann 15 Minuten Pause) haette dann
 * nach fuenf Fehlversuchen von IRGENDWEM jeden weiteren Anmeldeversuch von
 * JEDEM Besucher gesperrt.
 *
 * Zwei Ebenen werden geprueft:
 *  1. Herkunft.ts selbst, direkt und ohne HTTP — mit einem minimalen
 *     Attrappen-Request, der nur `headers` und `socket.remoteAddress`
 *     traegt (alles, was die Funktion liest).
 *  2. KontoApi ueber eine echte HTTP-Verbindung: zwei "Herkuenfte" (per
 *     X-Forwarded-For unterschieden, die Verbindung selbst kommt immer
 *     von 127.0.0.1) sperren sich nicht gegenseitig.
 */
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { herkunftErmitteln } from '../src/net/Herkunft.js';
import { KontoApi } from '../src/konto/KontoApi.js';
import { Kontendatenbank } from '../src/konto/Kontendatenbank.js';
import { geheimnisErzeugen } from '../src/net/Identitaet.js';

/** Attrappe: traegt nur das, was herkunftErmitteln() tatsaechlich liest. */
function attrappe(remoteAddress: string | undefined, headers: Record<string, string> = {}): IncomingMessage {
  return { socket: { remoteAddress }, headers } as unknown as IncomingMessage;
}

// ── 1. Herkunft.ts direkt ────────────────────────────────────────────────

// Loopback + X-Forwarded-For -> erster Eintrag des Kopfes.
assert.equal(
  herkunftErmitteln(attrappe('127.0.0.1', { 'x-forwarded-for': '203.0.113.9, 10.10.10.5' })),
  '203.0.113.9',
  'Loopback-Peer + X-Forwarded-For: erster Eintrag gewinnt',
);
assert.equal(
  herkunftErmitteln(attrappe('::1', { 'x-forwarded-for': '203.0.113.9' })),
  '203.0.113.9',
  '::1 zaehlt ebenfalls als Loopback',
);
assert.equal(
  herkunftErmitteln(attrappe('::ffff:127.0.0.1', { 'x-forwarded-for': '203.0.113.9' })),
  '203.0.113.9',
  'IPv4-gemapptes Loopback (::ffff:127.0.0.1) zaehlt ebenfalls',
);

// Loopback + nur X-Real-IP -> dieser Kopf, wenn X-Forwarded-For fehlt.
assert.equal(
  herkunftErmitteln(attrappe('127.0.0.1', { 'x-real-ip': '198.51.100.7' })),
  '198.51.100.7',
  'Loopback-Peer + X-Real-IP (ohne X-Forwarded-For): der Kopf gewinnt',
);

// Nicht-Loopback + Kopf -> der Kopf wird IGNORIERT, Peer bleibt massgeblich.
// Das ist die eigentliche Schutzwirkung: Kaeme eine Anfrage NICHT ueber den
// lokalen nginx, waere jeder Kopf frei erfindbar.
assert.equal(
  herkunftErmitteln(attrappe('198.51.100.42', { 'x-forwarded-for': '203.0.113.9' })),
  '198.51.100.42',
  'Nicht-Loopback-Peer: der Kopf wird nicht geglaubt',
);

// Kein Kopf -> Peer-Adresse, ob Loopback oder nicht.
assert.equal(herkunftErmitteln(attrappe('127.0.0.1')), '127.0.0.1', 'Loopback ohne Kopf: Peer-Adresse');
assert.equal(herkunftErmitteln(attrappe('198.51.100.42')), '198.51.100.42', 'kein Kopf: Peer-Adresse');
assert.equal(herkunftErmitteln(attrappe(undefined)), 'unknown', 'keine Peer-Adresse: unknown');

console.log('Konto-Herkunft: Herkunft.ts direkt geprueft');

// ── 2. Ueber KontoApi: zwei Herkuenfte sperren sich nicht gegenseitig ────

const ordner = mkdtempSync(join(tmpdir(), 'wov-konto-herkunft-'));
const db = new Kontendatenbank(join(ordner, 'konten.db'));
const geheimnis = Buffer.from(geheimnisErzeugen(), 'hex');
const api = new KontoApi(db, geheimnis, () => ({ spieler: 0, plaetze: 10, tag: 1, welt: 'test' }));

const server = createServer((req, res) => {
  if (!api.behandle(req, res)) res.writeHead(404).end();
});

await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve());
});
const { port } = server.address() as { port: number };
const basis = `http://127.0.0.1:${port}`;

async function anmelden(herkunft: string): Promise<number> {
  const antwort = await fetch(`${basis}/accounts/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': herkunft },
    body: JSON.stringify({ username: 'nichtvorhanden', password: 'falsch' }),
  });
  await antwort.text();
  return antwort.status;
}

try {
  // Fuenf Fehlversuche von "Herkunft A" sperren NUR Herkunft A.
  for (let i = 0; i < 5; i++) {
    assert.equal(await anmelden('203.0.113.1'), 401, `Herkunft A, Versuch ${i + 1}: 401`);
  }
  assert.equal(await anmelden('203.0.113.1'), 429, 'Herkunft A ist nach fuenf Fehlversuchen gesperrt');

  // Herkunft B ist davon unberuehrt — das ist die eigentliche Zusicherung:
  // ohne die echte Herkunft waeren A und B beide "127.0.0.1" gewesen und
  // B waere durch A's Fehlversuche mitgesperrt worden.
  assert.equal(await anmelden('203.0.113.2'), 401, 'Herkunft B bleibt unberuehrt von der Sperre gegen A');

  console.log('Konto-Herkunft: zwei Herkuenfte sperren sich nicht gegenseitig');
} finally {
  server.close();
  db.schliessen();
  rmSync(ordner, { recursive: true, force: true });
}
