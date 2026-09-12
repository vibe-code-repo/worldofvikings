/**
 * Konto-Lokal: End-zu-Ende-HTTP-Probe der Konten-API, wie sie der
 * eingebaute Anmeldedialog fuer einen lokalen Klon benutzt
 * (client/src/ui/Anmeldung.ts) — registrieren, anmelden, einen Charakter
 * anlegen und ihn gegen ein Spielticket eintauschen (POST
 * /accounts/characters/<id>/play, bereits vorhanden in KontoApi.ts).
 *
 * Drei Nachweise, die die Aufgabe ausdruecklich verlangt:
 *   1. Das ausgestellte Ticket ist mit dem Servergeheimnis signiert
 *      (Identitaet.ts, tokenPruefen) — und ein veraendertes wird erkannt.
 *   2. Ein fremdes Konto bekommt fuer einen Charakter, der ihm nicht
 *      gehoert, kein Ticket (die Suche ist auf die eigene Konto-ID
 *      begrenzt, s. KontoApi.spielen).
 *   3. Die Anmelde-Drossel (fuenf Fehlversuche je 15 Minuten) greift
 *      weiterhin, auch wenn danach das RICHTIGE Passwort kommt.
 *
 * Ein echter node:http-Server statt eines Fake-req/res-Paars: KontoApi
 * liest den Anfragekoerper per req.on('data'/'end') und den Herkunfts-IP
 * ueber req.socket.remoteAddress — beides laesst sich nur mit einer
 * echten Verbindung ehrlich pruefen, nicht mit einem Attrappen-Objekt,
 * das diese Felder nur behauptet.
 */
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KontoApi } from '../src/konto/KontoApi.js';
import { Kontendatenbank } from '../src/konto/Kontendatenbank.js';
import { geheimnisErzeugen, tokenPruefen } from '../src/net/Identitaet.js';

const ordner = mkdtempSync(join(tmpdir(), 'wov-konto-lokal-'));
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

interface Antwort { status: number; daten: any }

async function ruf(pfad: string, init: RequestInit = {}): Promise<Antwort> {
  const antwort = await fetch(basis + pfad, init);
  let daten: unknown = null;
  try { daten = await antwort.json(); } catch { /* leerer Koerper */ }
  return { status: antwort.status, daten };
}

const jsonKopf = { 'content-type': 'application/json' };

try {
  // ── Registrieren, Charakter anlegen, spielen ─────────────────────────
  const reg = await ruf('/accounts/register', {
    method: 'POST', headers: jsonKopf,
    body: JSON.stringify({ username: 'Bjorn', email: 'bjorn@example.org', password: 'korrektespasswort123' }),
  });
  assert.equal(reg.status, 201, 'Registrierung erfolgreich');
  const kontoToken = reg.daten.token as string;
  assert.ok(kontoToken, 'Registrierung liefert ein Kontotoken');

  const c = await ruf('/accounts/characters', {
    method: 'POST', headers: { ...jsonKopf, 'x-wov-account': kontoToken },
    body: JSON.stringify({
      name: 'Bjorn', figure: 'wikingerin', hairstyle: 'H_01', hairColor: 'mittelbraun', top: '', legs: '',
    }),
  });
  assert.equal(c.status, 201, 'Charakter angelegt');
  const charId = c.daten.character.id as number;

  const spiel = await ruf(`/accounts/characters/${charId}/play`, {
    method: 'POST', headers: { 'x-wov-account': kontoToken },
  });
  assert.equal(spiel.status, 200, 'Ticket ausgestellt');
  const sessionToken = spiel.daten.sessionToken as string;
  assert.ok(sessionToken, 'Antwort traegt ein SessionToken');

  // ── 1. Signatur ───────────────────────────────────────────────────────
  const geprueft = tokenPruefen(sessionToken, geheimnis);
  assert.equal(geprueft.status, 'gueltig', 'Ticket ist mit dem Servergeheimnis signiert');
  assert.ok(
    geprueft.status === 'gueltig' && geprueft.spielerId.startsWith('sp_'),
    'das Ticket traegt eine echte spielerId, keine vom Client waehlbare',
  );

  const letztesZeichen = sessionToken.at(-1);
  const verfaelscht = sessionToken.slice(0, -1) + (letztesZeichen === 'A' ? 'B' : 'A');
  assert.equal(tokenPruefen(verfaelscht, geheimnis).status, 'gefaelscht', 'ein veraendertes Ticket wird erkannt');

  // ── 2. Fremdes Konto ──────────────────────────────────────────────────
  const regFremd = await ruf('/accounts/register', {
    method: 'POST', headers: jsonKopf,
    body: JSON.stringify({ username: 'Astrid', email: 'astrid@example.org', password: 'einanderespasswort1' }),
  });
  assert.equal(regFremd.status, 201);
  const fremdToken = regFremd.daten.token as string;
  const fremderVersuch = await ruf(`/accounts/characters/${charId}/play`, {
    method: 'POST', headers: { 'x-wov-account': fremdToken },
  });
  assert.equal(fremderVersuch.status, 404, 'fremdes Konto sieht den Charakter nicht');

  // Ein Konto ohne (oder mit kaputtem) Kontotoken kommt erst gar nicht rein.
  const ohneToken = await ruf(`/accounts/characters/${charId}/play`, { method: 'POST' });
  assert.equal(ohneToken.status, 401, 'ohne Kontotoken kein Ticket');
  const kaputterVersuch = await ruf(`/accounts/characters/${charId}/play`, {
    method: 'POST', headers: { 'x-wov-account': `${kontoToken}x` },
  });
  assert.equal(kaputterVersuch.status, 401, 'verfaelschtes Kontotoken wird abgewiesen');

  // ── 3. Drossel ────────────────────────────────────────────────────────
  for (let i = 0; i < 5; i++) {
    const versuch = await ruf('/accounts/login', {
      method: 'POST', headers: jsonKopf,
      body: JSON.stringify({ username: 'Bjorn', password: 'falsch' }),
    });
    assert.equal(versuch.status, 401, `Fehlversuch ${i + 1} bleibt 401, bevor die Drossel greift`);
  }
  const gedrosselt = await ruf('/accounts/login', {
    method: 'POST', headers: jsonKopf,
    body: JSON.stringify({ username: 'Bjorn', password: 'falsch' }),
  });
  assert.equal(gedrosselt.status, 429, 'nach fuenf Fehlversuchen drosselt der Server');

  const richtigAberGedrosselt = await ruf('/accounts/login', {
    method: 'POST', headers: jsonKopf,
    body: JSON.stringify({ username: 'Bjorn', password: 'korrektespasswort123' }),
  });
  assert.equal(
    richtigAberGedrosselt.status, 429,
    'die Drossel unterscheidet nicht zwischen richtigem und falschem Passwort, solange das Fenster laeuft',
  );

  console.log('Konto-Lokal: alle Pruefungen bestanden');
} finally {
  server.close();
  db.schliessen();
  rmSync(ordner, { recursive: true, force: true });
}
