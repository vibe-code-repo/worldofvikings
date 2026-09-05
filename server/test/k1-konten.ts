/**
 * K1: Accounts, characters and password storage.
 *
 * The interesting assertions are the negative ones -- a store that accepts
 * every password would pass a naive "correct password works" test.
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { passwortEinlagern, passwortPruefen, veraltet } from '../src/konto/Passwort.js';
import { Kontendatenbank } from '../src/konto/Kontendatenbank.js';
import { istSpielerId } from '../src/net/Identitaet.js';

const ordner = mkdtempSync(join(tmpdir(), 'wov-konto-'));
const db = new Kontendatenbank(join(ordner, 'konten.db'));

try {
  // ── Passwords ─────────────────────────────────────────────────────
  const eintrag = await passwortEinlagern('Korrektes Ross Batterie Heftklammer');
  assert.ok(eintrag.startsWith('scrypt$'), 'Eintrag traegt seine Parameter');
  assert.ok(!eintrag.includes('Korrektes'), 'Klartext steht nicht im Eintrag');
  assert.equal(await passwortPruefen('Korrektes Ross Batterie Heftklammer', eintrag), true);
  assert.equal(await passwortPruefen('falsch', eintrag), false);
  assert.equal(await passwortPruefen('', eintrag), false);

  // Zwei Einlagerungen desselben Passworts muessen sich unterscheiden --
  // sonst fehlt das Salz und gleiche Passwoerter waeren erkennbar.
  const zweiter = await passwortEinlagern('Korrektes Ross Batterie Heftklammer');
  assert.notEqual(eintrag, zweiter, 'Salz macht jeden Eintrag einmalig');

  // Kaputte Eintraege duerfen nicht durchlassen und nicht werfen.
  for (const murks of ['', 'scrypt$', 'scrypt$1$2$3$4$5', 'bcrypt$1$1$1$aa$bb',
                       'scrypt$99999999$8$1$aa$bb', 'scrypt$32768$8$1$$']) {
    assert.equal(await passwortPruefen('egal', murks), false, `Murks abgewiesen: ${murks}`);
  }
  assert.equal(veraltet('scrypt$1024$8$1$aa$bb'), true, 'schwaechere Kosten gelten als veraltet');
  assert.equal(veraltet(eintrag), false, 'frischer Eintrag ist aktuell');

  // ── Accounts ──────────────────────────────────────────────────────
  const a = db.kontoAnlegen('Mike', 'mike@kaldig.de', eintrag);
  assert.equal(a.ok, true);

  const doppelt = db.kontoAnlegen('Mike', 'zweit@example.org', eintrag);
  assert.equal(doppelt.ok, false);
  // Der Fehlercode heisst seit ddaea13 englisch (`KontoFehler`); die Webseite
  // las bis dahin ein anders benanntes Feld und zeigte jeden Fehler als
  // allgemeinen. Der Quelltext ist hier die Wahrheit, nicht dieser Text.
  assert.equal(doppelt.ok === false && doppelt.fehler, 'username-taken');

  // Gross-/Kleinschreibung darf kein zweites Konto ergeben.
  const anders = db.kontoAnlegen('mIkE', 'dritt@example.org', eintrag);
  assert.equal(anders.ok, false, 'Benutzername ohne Ruecksicht auf Schreibweise einmalig');

  assert.ok(db.kontoNachName('mike'), 'Anmelden klappt in jeder Schreibweise');
  assert.equal(db.kontoNachName('gibtsnicht'), null);

  const kontoId = a.ok ? a.konto.id : 0;

  // ── Characters ────────────────────────────────────────────────────
  assert.deepEqual(db.charaktereVonKonto(kontoId), [], 'frisches Konto hat keine Charaktere');

  // `haarfarbe` kam mit bd31fec dazu und ist eine Pflichtspalte — ohne sie
  // wirft SQLite an Parameter 7, nicht an einer lesbaren Zusicherung.
  const aussehen = {
    figur: 'wikingerin',
    frisur: 'H_03',
    haarfarbe: 'fuchsrot',
    ober: 'leder_bh',
    beine: '',
  };
  const c1 = db.charakterAnlegen(kontoId, 'Bjorn', aussehen);
  const c2 = db.charakterAnlegen(kontoId, 'Astrid', aussehen);
  assert.equal(c1.ok && c2.ok, true, 'mehrere Charaktere je Konto');

  assert.equal(db.charaktereVonKonto(kontoId).length, 2);

  // Jeder Charakter traegt eine EIGENE, gueltige spielerId -- das ist der
  // Grund, warum das Weltformat unangetastet bleibt.
  const [x, y] = db.charaktereVonKonto(kontoId);
  assert.ok(istSpielerId(x!.spielerId) && istSpielerId(y!.spielerId));
  assert.notEqual(x!.spielerId, y!.spielerId, 'zwei Charaktere, zwei Identitaeten');
  assert.notEqual(x!.altlastUserId, y!.altlastUserId);
  assert.ok(x!.altlastUserId > 0n, 'BigInt kommt heil aus der Datenbank zurueck');

  // Namen sind global einmalig -- sonst weist der Spielserver beim
  // Verbinden mit "Name already in use" ab, und zwar erst DANN.
  const belegt = db.charakterAnlegen(kontoId, 'bjorn', aussehen);
  assert.equal(belegt.ok, false);
  assert.equal(belegt.ok === false && belegt.fehler, 'name-taken');

  // Ein fremdes Konto darf den Charakter weder sehen noch loeschen.
  const b = db.kontoAnlegen('Fremder', 'f@example.org', eintrag);
  const fremdId = b.ok ? b.konto.id : 0;
  assert.equal(db.charakterVonKonto(fremdId, x!.id), null, 'kein Zugriff auf fremde Charaktere');
  assert.equal(db.charakterLoeschen(fremdId, x!.id), false, 'kein Loeschen fremder Charaktere');
  assert.ok(db.charakterVonKonto(kontoId, x!.id), 'eigener Charakter bleibt erreichbar');

  db.gespieltVermerken(x!.id);
  assert.ok(db.charakterVonKonto(kontoId, x!.id)!.zuletztGespielt! > 0);

  // Konto weg -> Charaktere weg (ON DELETE CASCADE, PRAGMA foreign_keys).
  assert.equal(db.charakterLoeschen(kontoId, x!.id), true);
  assert.equal(db.charaktereVonKonto(kontoId).length, 1);

  console.log('K1 Konten: alle Pruefungen bestanden');
} finally {
  db.schliessen();
  rmSync(ordner, { recursive: true, force: true });
}
