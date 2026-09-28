/**
 * W3-Reste — Konto-Namensorakel und -Grenzen (Karte 2026-09-28).
 *
 * Deckt die Punkte U1-U3, N3, N5, N6 und die reservierten Namen (Punkt 10)
 * der Karte ab, alle in `KontoApi.ts` gefunden von den W3-N2/N3/N4-Pruefungen
 * (Opus, 27.09.2026):
 *
 *  - U1: Der Schluessel fuer unbekannte Login-Namen faltete Unicode voll
 *    (`toLowerCase()`), SQLite `COLLATE NOCASE` faltet nur A-Z — zwei
 *    Schreibweisen, die fuer die Datenbank verschieden sind (Kelvin-K
 *    U+212A vs. "k", Å vs. å), landeten im SELBEN Zaehlschluessel und
 *    konnten sich so gegenseitig die Drossel leeren bzw. fuellen.
 *  - U2: Namen, die `BENUTZERNAME_REGEX` nicht erfuellen, liefen ungekuerzt
 *    (bis zu ~4 KB) in den Schluessel.
 *  - U3: Das Aufraeumen darf nur ABGELAUFENE Eintraege loeschen.
 *  - N3: Ein gleichzeitiger Generationswechsel (richtiges Passwort, aber
 *    das Token davor ist ungueltig geworden) antwortet mit 409 "conflict",
 *    nicht mit 401 "login-failed" — siehe auch server/test/konto-verwaltung.ts.
 *  - N5: IPv6-Adressen werden je /64-Praefix gezaehlt, nicht einzeln.
 *  - N6: Ein Variantenselektor (U+FE0F usw.) hinter einer Ziffer, `#` oder
 *    `*` ist nur Teil einer ECHTEN Keycap-Folge (Basis + Selektor +
 *    U+20E3) erlaubt.
 *  - Punkt 10: Ein neuer Kontocharakter darf nicht "Editor" heissen (auch
 *    nicht in anderer Schreibweise) — derselbe Namensvergleich wie im
 *    Spiel (`server/src/net/Namen.ts`, `namenSchluessel`/`EDITOR_NAME`).
 */
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KontoApi, bereinigeText } from '../src/konto/KontoApi.js';
import { Kontendatenbank } from '../src/konto/Kontendatenbank.js';
import { geheimnisErzeugen } from '../src/net/Identitaet.js';

const ordner = mkdtempSync(join(tmpdir(), 'wov-konto-namensorakel-'));
const db = new Kontendatenbank(join(ordner, 'konten.db'));
const geheimnis = Buffer.from(geheimnisErzeugen(), 'hex');
const api = new KontoApi(db, geheimnis, () => ({ spieler: 0, plaetze: 10, tag: 1, welt: 'test' }));

const server = createServer((req, res) => { if (!api.behandle(req, res)) res.writeHead(404).end(); });
await new Promise<void>((ok, fehler) => { server.once('error', fehler); server.listen(0, '127.0.0.1', () => ok()); });
const basis = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

interface Antwort { status: number; daten: Record<string, unknown> }

async function aufruf(pfad: string, koerper: unknown, herkunft: string, token?: string): Promise<Antwort> {
  const r = await fetch(basis + pfad, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', 'x-forwarded-for': herkunft,
      ...(token ? { 'x-wov-account': token } : {}),
    },
    body: JSON.stringify(koerper),
  });
  let daten: Record<string, unknown> = {};
  try { daten = await r.json() as Record<string, unknown>; } catch { /* leerer Koerper */ }
  return { status: r.status, daten };
}

async function login(username: string, password: string, herkunft: string): Promise<Antwort> {
  return aufruf('/accounts/login', { username, password }, herkunft);
}

const aussehen = {
  figure: 'wikingerin', hairstyle: 'H_01', hairColor: 'mittelbraun', eyeColor: 'fjordblau', top: '', legs: '',
};

try {
  // ── U1a: Kelvin-Zeichen (U+212A) vs. regulaeres "k" ──────────────────
  {
    const ip = '203.0.113.10';
    // Fuenf Fehlversuche mit dem Kelvin-Zeichen statt einem regulaeren K:
    // SQLite NOCASE findet damit NIE ein Konto (nur ASCII wird gefaltet),
    // volles toLowerCase() faltet das Kelvin-Zeichen aber zu 'k' — vor der
    // Behebung landete der Versuch im SELBEN Schluessel wie "karl".
    for (let n = 0; n < 5; n++) {
      assert.equal((await login('Karl', `falsch${n}xxxxx`, ip)).status, 401, `Kelvin-Karl Fehlversuch ${n + 1}`);
    }
    const echtesKarl = await login('karl', 'irgendeinpasswort1', ip);
    assert.equal(
      echtesKarl.status, 401,
      `regulaeres "karl" behaelt ein EIGENES Budget (kein Schluesselzusammenstoss mit Kelvin-Karl, U1), war ${echtesKarl.status}`,
    );
  }

  // ── U1b: Å/å-Schreibweisen eines UNBEKANNTEN Namens ──────────────────
  {
    const ip = '203.0.113.11';
    // "Ülf" (Kapitaelchen Ü) und "ülf" (Kleinbuchstabe ü) sind fuer SQLite
    // NOCASE verschieden (nur ASCII wird gefaltet) und muessen es auch fuer
    // den Zaehlschluessel bleiben.
    for (let n = 0; n < 5; n++) {
      assert.equal((await login('Ülf', `falsch${n}xxxxx`, ip)).status, 401, `Ülf Fehlversuch ${n + 1}`);
    }
    const andereSchreibweise = await login('ülf', 'irgendeinpasswort1', ip);
    assert.equal(
      andereSchreibweise.status, 401,
      `"ülf" bleibt vom "Ülf"-Budget unberuehrt (eigener Schluessel, U1), war ${andereSchreibweise.status}`,
    );
  }

  // ── U2: ungueltige (zu lange) Namen bekommen einen FESTEN Schluessel ──
  {
    const ip = '203.0.113.12';
    const riesig = (kennung: string): string => `${'x'.repeat(3900)}${kennung}`;
    for (let n = 0; n < 5; n++) {
      assert.equal((await login(riesig(`a${n}`), 'falsch123456', ip)).status, 401, `riesiger Name ${n + 1}`);
    }
    // Ein sechster, wieder ANDERER riesiger Name: Vor der Behebung landete
    // jeder ungueltige Name unter seinem eigenen, ungekuerzten Schluessel
    // (kein Zusammenstoss, also 401). Nach U2 teilen sie sich den festen
    // Schluessel `?#ungueltig` — der sechste ist damit gesperrt.
    const sechster = await login(riesig('anders'), 'falsch123456', ip);
    assert.equal(
      sechster.status, 429,
      `ein sechster, andersartiger ungueltiger Name teilt sich den festen Schluessel (U2), war ${sechster.status}`,
    );

    // Der Schluessel selbst bleibt kurz statt der ungekuerzten ~3,9 KB.
    const karte = (api as unknown as { loginVersuche: Map<string, unknown> }).loginVersuche;
    let gefunden = false;
    for (const schluessel of karte.keys()) {
      if (schluessel.startsWith(`${ip}|`)) {
        gefunden = true;
        assert.ok(schluessel.length < 50, `Schluessel fuer ungueltige Namen bleibt kurz (war ${schluessel.length} Zeichen)`);
      }
    }
    assert.ok(gefunden, 'ein Schluessel fuer diese Herkunft steht in der Karte');
  }

  // ── U3: Aufraeumen loescht nur ABGELAUFENE Eintraege ─────────────────
  {
    const echteUhr = Date.now;
    let uhr = echteUhr();
    Date.now = (): number => uhr;
    try {
      const ip = '203.0.113.13';
      for (let n = 0; n < 5; n++) {
        assert.equal((await login('Aufraeumopfer', `falsch${n}xxxxx`, ip)).status, 401, `Vorlauf ${n + 1}`);
      }
      assert.equal((await login('Aufraeumopfer', 'egal123456', ip)).status, 429, 'nach fuenf Versuchen gesperrt');

      // +6 Minuten: Der Aufraeum-Takt (alle 5 min) ist faellig, das eigene
      // 15-Minuten-Fenster des Eintrags ist es NICHT. Irgendein Login-
      // Versuch (von einer anderen Herkunft) loest den naechsten Durchlauf
      // aus, weil abgelaufenesAufraeumen() bei jedem Zaehlvorgang laeuft.
      uhr += 6 * 60 * 1000;
      await login('irrelevant-anderer-name', 'egal123456', '203.0.113.14');
      // Ein Mutant "Aufraeumen loescht alles" wuerde die Sperre hier schon
      // aufheben — richtig ist: sie steht noch (U3).
      assert.equal(
        (await login('Aufraeumopfer', 'egal123456', ip)).status, 429,
        'die Sperre steht nach dem Aufraeum-Takt weiter, solange ihr eigenes Fenster laeuft (U3)',
      );

      // +16 Minuten insgesamt: das 15-Minuten-Fenster des Eintrags ist um.
      uhr += 10 * 60 * 1000;
      const frei = await login('Aufraeumopfer', 'egal123456', ip);
      assert.notEqual(frei.status, 429, 'nach Ablauf des eigenen Fensters ist der Name wieder frei');
    } finally {
      Date.now = echteUhr;
    }
  }

  // ── N5: IPv6-Adressen zaehlen je /64-Praefix, nicht einzeln ──────────
  {
    const a1 = '2001:db8:77::1';
    const a2 = '2001:db8:77::2'; // dasselbe /64 wie a1
    const b1 = '2001:db8:78::1'; // ein ANDERES /64
    for (let n = 0; n < 3; n++) {
      assert.equal((await login('NieVorhanden', `falscha1${n}xxxx`, a1)).status, 401, `a1 Versuch ${n + 1}`);
    }
    for (let n = 0; n < 2; n++) {
      assert.equal((await login('NieVorhanden', `falscha2${n}xxxx`, a2)).status, 401, `a2 (gleiches /64) Versuch ${n + 1}`);
    }
    assert.equal(
      (await login('NieVorhanden', 'falscha1x99', a1)).status, 429,
      'a1: /64-Budget von a1+a2 zusammen aufgebraucht (N5)',
    );
    assert.equal(
      (await login('NieVorhanden', 'falscha2x99', a2)).status, 429,
      'a2: dasselbe /64-Budget, ebenfalls gesperrt (N5)',
    );
    assert.equal(
      (await login('NieVorhanden', 'falschb1x99', b1)).status, 401,
      'b1 (anderes /64) bleibt unberuehrt (N5)',
    );
  }

  // ── N3: Generationswechsel waehrend des Hashens ⇒ 409, nicht 401 ─────
  // (Der Haupt-Nachweis mit erzwungenem Fenster steht in
  // server/test/konto-verwaltung.ts, "B1"; hier nur eine unabhaengige,
  // einfache Gegenprobe: ein Login mit dem NEUEN Passwort nach einem
  // regulaeren Wechsel bleibt schlicht 200, keine Verwechslung mit 409.)
  {
    const ip = '203.0.113.15';
    const reg = await aufruf('/accounts/register', {
      username: 'Konflikttest', email: 'konflikttest@example.org', password: 'altespasswort1',
    }, ip);
    assert.equal(reg.status, 201);
    const login200 = await login('Konflikttest', 'altespasswort1', ip);
    assert.equal(login200.status, 200, 'ein normaler Login ohne Wettlauf bleibt 200');
  }

  // ── N6: Variantenselektor hinter Ziffer/#/* nur in ECHTEN Keycaps ────
  {
    assert.equal(bereinigeText('1️', 300), null, 'Ziffer + Selektor OHNE Einfassung: abgelehnt (N6)');
    assert.equal(bereinigeText('#️', 300), null, '# + Selektor OHNE Einfassung: abgelehnt (N6)');
    assert.equal(bereinigeText('*️', 300), null, '* + Selektor OHNE Einfassung: abgelehnt (N6)');
    assert.equal(bereinigeText('1️⃣', 300), '1️⃣', 'echte Keycap-Folge (Ziffer) bleibt erlaubt');
    assert.equal(bereinigeText('#️⃣', 300), '#️⃣', 'echte Keycap-Folge (#) bleibt erlaubt');
    assert.equal(bereinigeText('❤️', 300), '❤️', 'Selektor hinter echtem Emoji bleibt erlaubt (Regressionsschutz)');
  }

  // ── Punkt 10: "Editor" ist fuer neue Kontocharaktere reserviert ──────
  {
    const ip = '203.0.113.16';
    const reg = await aufruf('/accounts/register', {
      username: 'Namensspielerin', email: 'namensspielerin@example.org', password: 'korrektespasswort123',
    }, ip);
    assert.equal(reg.status, 201);
    const token = reg.daten.token as string;
    for (const [was, name] of [['exakt', 'Editor'], ['klein', 'editor'], ['GROSS', 'EDITOR']] as const) {
      const r = await aufruf('/accounts/characters', { name, ...aussehen }, ip, token);
      assert.equal(r.status, 409, `Charaktername "${name}" (${was}) wird abgelehnt`);
      assert.equal(r.daten.error, 'name-taken');
    }
    const ok = await aufruf('/accounts/characters', { name: 'Redakteur', ...aussehen }, ip, token);
    assert.equal(ok.status, 201, 'ein regulaerer Name bleibt weiterhin erlaubt');
  }

  console.log('Konto-Namensorakel: alle Zusicherungen erfuellt');
} finally {
  server.close();
  db.schliessen();
  rmSync(ordner, { recursive: true, force: true });
}
