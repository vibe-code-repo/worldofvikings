/**
 * Herkunft.ts: ein vom Besucher mitgeschickter X-Forwarded-For darf die
 * Herkunft nicht bestimmen (Befund F3).
 *
 * Der Proxy Manager haengt die Adresse, die er sieht, RECHTS an einen vom
 * Besucher gesendeten Kopf an; alles links davon ist Besucher-Eingabe.
 * Geprueft wird (1) direkt mit Attrappen und (2) ueber einen echten
 * HTTP-Server, an den mit rohen, mehrfachen Kopfzeilen gesendet wird.
 */
import { strict as assert } from 'node:assert';
import { createServer, request } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { herkunftErmitteln } from '../src/net/Herkunft.js';

function attrappe(remoteAddress: string | undefined, headers: Record<string, string> = {}): IncomingMessage {
  return { socket: { remoteAddress }, headers } as unknown as IncomingMessage;
}
const lo = (kopf: string, extra: Record<string, string> = {}) =>
  herkunftErmitteln(attrappe('127.0.0.1', { 'x-forwarded-for': kopf, ...extra }));

// ── 1. Direkt ────────────────────────────────────────────────────────────
assert.equal(lo('1.2.3.4, 203.0.113.9'), '203.0.113.9', 'gefaelschter erster Eintrag zaehlt nicht');
assert.equal(lo('1.2.3.4, 5.6.7.8, 203.0.113.9'), '203.0.113.9', 'beliebig viele vorangestellte Eintraege');
assert.equal(lo('  1.2.3.4 ,   203.0.113.9  '), '203.0.113.9', 'Leerraum um die Eintraege');
assert.equal(lo('1.2.3.4,203.0.113.9'), '203.0.113.9', 'Komma ohne Leerzeichen');
assert.equal(lo('203.0.113.9'), '203.0.113.9', 'ein einzelner Eintrag (nginx ueberschreibt)');
assert.equal(lo('1.2.3.4, 2001:db8::7'), '2001:db8::7', 'IPv6 als letzter Eintrag');
assert.equal(lo('1.2.3.4, 2001:DB8::7'), '2001:db8::7', 'IPv6 wird klein geschrieben');
assert.equal(lo('1.2.3.4, ::ffff:203.0.113.9'), '203.0.113.9', 'IPv4-gemappt wird zur v4-Form');
assert.equal(lo('1.2.3.4, [2001:db8::7]:5555'), '2001:db8::7', 'eckige Klammern mit Port');
assert.equal(lo('1.2.3.4, 203.0.113.9:5555'), '203.0.113.9', 'v4 mit Port');

// Ungueltiger letzter Eintrag: der Kopf gilt als kaputt, der vorletzte (Besucher-Eingabe) NICHT.
assert.equal(lo('1.2.3.4, unknown'), '127.0.0.1', '"unknown" als letzter Eintrag -> Peer, nicht 1.2.3.4');
assert.equal(lo('1.2.3.4, '), '127.0.0.1', 'leerer letzter Eintrag -> Peer');
assert.equal(lo('1.2.3.4, <script>'), '127.0.0.1', 'Text -> Peer');
assert.equal(lo('unknown', { 'x-real-ip': '198.51.100.7' }), '198.51.100.7', 'kaputter Kopf -> X-Real-IP');
assert.equal(lo('1.2.3.4, unknown', { 'x-real-ip': 'unknown' }), '127.0.0.1', 'auch X-Real-IP muss eine IP sein');
assert.equal(herkunftErmitteln(attrappe('127.0.0.1', { 'x-real-ip': '198.51.100.7' })), '198.51.100.7', 'fehlender Kopf -> X-Real-IP');
assert.equal(herkunftErmitteln(attrappe('127.0.0.1')), '127.0.0.1', 'gar kein Kopf -> Peer');
assert.equal(herkunftErmitteln(attrappe('::1', { 'x-forwarded-for': '1.2.3.4, 203.0.113.9' })), '203.0.113.9', '::1 als Peer');
assert.equal(herkunftErmitteln(attrappe('::ffff:127.0.0.1', { 'x-forwarded-for': '1.2.3.4, 203.0.113.9' })), '203.0.113.9', 'gemapptes Loopback als Peer');
// Nicht-Loopback: jeder Kopf wird ignoriert.
assert.equal(herkunftErmitteln(attrappe('198.51.100.42', { 'x-forwarded-for': '203.0.113.9' })), '198.51.100.42', 'Peer ohne Loopback');
assert.equal(herkunftErmitteln(attrappe(undefined, { 'x-forwarded-for': '203.0.113.9' })), 'unknown', 'ohne Peer');
console.log('Herkunft-XFF: direkt geprueft');

// ── 2. Echter HTTP-Server, rohe Kopfzeilen ───────────────────────────────
const server = createServer((req, res) => res.end(herkunftErmitteln(req)));
await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve());
});
const { port } = server.address() as { port: number };

function abfrage(kopfzeilen: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/', method: 'GET', headers: {} }, (res) => {
      let text = '';
      res.on('data', (d) => (text += d));
      res.on('end', () => resolve(text));
    });
    req.on('error', reject);
    // Mehrfache Zeilen gleichen Namens: rawHeaders-Weg via Array-Wert.
    req.setHeader('x-forwarded-for', kopfzeilen);
    req.end();
  });
}

try {
  assert.equal(await abfrage(['203.0.113.9']), '203.0.113.9', 'eine Zeile');
  assert.equal(await abfrage(['1.2.3.4, 203.0.113.9']), '203.0.113.9', 'gefaelschter Eintrag in einer Zeile');
  assert.equal(await abfrage(['1.2.3.4', '203.0.113.9']), '203.0.113.9', 'zwei Kopfzeilen: die letzte gilt');
  assert.equal(await abfrage(['203.0.113.9', '1.2.3.4']), '1.2.3.4', 'zwei Kopfzeilen: die zuletzt gesendete ist die des naechsten Sprungs');
  console.log('Herkunft-XFF: ueber echten HTTP-Server geprueft');
} finally {
  server.close();
}
