/**
 * Konto-Registrierung-Drossel: `POST /accounts/register` hatte KEINE
 * Drossel — `registrieren()` rief weder `gesperrt()` noch
 * `fehlversuchZaehlen()`, beide nur in `anmelden()` verdrahtet. Zwanzig
 * Registrierungen in Folge von derselben Herkunft lieferten zwanzigmal 201.
 *
 * Eigene Zusicherungen:
 *  1. Fuenf Registrierungen je Herkunft gehen durch, die sechste bekommt
 *     429 samt `Retry-After`.
 *  2. Eine ANDERE Herkunft ist davon unberuehrt.
 *  3. Nach Ablauf des Fensters ist dieselbe Herkunft wieder frei — die
 *     Uhr wird dafuer gestellt (gleiches Muster wie
 *     server/test/ausdauer-abgleich.ts), eine echte Stunde Wartezeit
 *     waere kein Test, sondern eine Bestrafung.
 *
 * Eigener Server/eigene Datenbank statt Mitbenutzung von konto-lokal.ts:
 * dessen Lauf registriert bereits zwei Konten von 127.0.0.1 und wuerde
 * das Fenster hier von Anfang an anders fuellen.
 */
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KontoApi } from '../src/konto/KontoApi.js';
import { Kontendatenbank } from '../src/konto/Kontendatenbank.js';
import { geheimnisErzeugen } from '../src/net/Identitaet.js';

const ordner = mkdtempSync(join(tmpdir(), 'wov-konto-reg-drossel-'));
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

interface Antwort { status: number; retryAfter: string | null; daten: Record<string, unknown> | null }

async function registrieren(herkunft: string, benutzername: string): Promise<Antwort> {
  const antwort = await fetch(`${basis}/accounts/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': herkunft },
    body: JSON.stringify({
      username: benutzername, email: `${benutzername}@example.org`, password: 'korrektespasswort123',
    }),
  });
  let daten: Record<string, unknown> | null = null;
  try { daten = await antwort.json() as Record<string, unknown>; } catch { /* leerer Koerper */ }
  return { status: antwort.status, retryAfter: antwort.headers.get('retry-after'), daten };
}

// Die Uhr stellen — die Registrierungs-Drossel misst ihr Fenster ueber
// Date.now(). Ohne gestellte Uhr liesse sich "nach Ablauf wieder frei"
// nicht in Sekunden pruefen, nur in einer echten Stunde Wartezeit.
const echteUhr = Date.now;
let uhr = echteUhr();
Date.now = (): number => uhr;

try {
  // ── 1. Fuenf gehen durch, die sechste nicht ──────────────────────────
  for (let i = 0; i < 5; i++) {
    const r = await registrieren('203.0.113.10', `Spieler${i}`);
    assert.equal(r.status, 201, `Registrierung ${i + 1} von 5 geht durch`);
  }
  const sechste = await registrieren('203.0.113.10', 'Spieler5');
  assert.equal(sechste.status, 429, 'die sechste Registrierung derselben Herkunft wird gedrosselt');
  assert.equal(sechste.daten?.error, 'too-many-registrations');
  assert.ok(sechste.retryAfter && Number(sechste.retryAfter) > 0, 'Retry-After steht und ist positiv');

  // ── 2. Andere Herkunft bleibt unberuehrt ─────────────────────────────
  const andereHerkunft = await registrieren('203.0.113.20', 'AndereHerkunft');
  assert.equal(andereHerkunft.status, 201, 'eine andere Herkunft registriert weiterhin');

  // ── 3. Nach Ablauf des Fensters wieder frei ──────────────────────────
  uhr += 60 * 60 * 1000 + 1000; // eine Stunde und eine Sekunde weiter
  const nachAblauf = await registrieren('203.0.113.10', 'WiederFrei');
  assert.equal(nachAblauf.status, 201, 'nach Ablauf des Fensters registriert dieselbe Herkunft wieder');

  console.log('Konto-Registrierung-Drossel: alle Pruefungen bestanden');
} finally {
  Date.now = echteUhr;
  server.close();
  db.schliessen();
  rmSync(ordner, { recursive: true, force: true });
}
