/**
 * Konto-Verwaltung (W3): Passwort, E-Mail, Profiltext und Kontoloeschung
 * ueber `/accounts/*`, gegen einen echten node:http-Server, eine echte
 * Kontendatenbank und eine echte Forendatenbank.
 *
 * Zusicherungen:
 *  1. Falsches aktuelles Passwort: 401, keine Aenderung, und die
 *     Fehlversuchssperre zaehlt mit (auch bei gleichzeitigen Versuchen).
 *  2. Passwortwechsel: altes Token 401, neues Token 200, Login mit dem alten
 *     Passwort scheitert, mit dem neuen geht. Ein Login, der waehrend des
 *     Wechsels sein Hash-Upgrade schreibt, ueberschreibt ihn nicht.
 *  3. Ein fremdes Token aendert nichts am Konto.
 *  4. Loeschung: Zeilen vorher/nachher in BEIDEN Datenbanken, Token 401,
 *     Forum anonymisiert, Name wieder frei, Ids werden nicht wiederverwendet,
 *     ein vor der Loeschung abgeholtes Spieler-Token kommt nicht mehr herein.
 *  5. Loeschung und `play` gleichzeitig hinterlassen keinen verwaisten
 *     Charakter (die Zugangspruefung des Servers lehnt jede Kennung ab).
 *  6. Standardkonten sind gesperrt; Profiltext-Regeln; Meldung.
 */
import { strict as assert } from 'node:assert';
import { createServer, request as httpRequest } from 'node:http';
import { scryptSync, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KontoApi, GELOESCHTER_AUTOR } from '../src/konto/KontoApi.js';
import { Kontendatenbank } from '../src/konto/Kontendatenbank.js';
import { ForumDatabase } from '../src/forum/ForumDatabase.js';
import { geheimnisErzeugen, tokenPruefen } from '../src/net/Identitaet.js';
import { passwortEinlagernSync } from '../src/konto/Passwort.js';

// Antworten sind hier bewusst lose typisiert: der Test liest Felder, die er selbst prueft.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
type Zaehler = { get(...a: unknown[]): { n: number } };
/** COUNT-Abfrage direkt auf der Forendatei (die Klasse bietet keine Zaehlung je Konto). */
const forumZaehlen = (sql: string, ...werte: unknown[]): number =>
  ((forum as unknown as { db: { prepare(s: string): Zaehler } }).db.prepare(sql).get(...werte)).n;

const ordner = mkdtempSync(join(tmpdir(), 'wov-konto-verwaltung-'));
const db = new Kontendatenbank(join(ordner, 'konten.db'));
const forum = new ForumDatabase(join(ordner, 'forum.db'));
const geheimnis = Buffer.from(geheimnisErzeugen(), 'hex');
const weltAufrufe: string[] = [];
const getrennt: string[] = [];
const api = new KontoApi(
  db, geheimnis, () => ({ spieler: 0, plaetze: 10, tag: 1, welt: 'test' }),
  ['gast'], ['gast', 'admin'],
  {
    forumBereinigen: (a) => { forum.kontoEntfernen(a.kontoId, a.charakterIds, a.namen, GELOESCHTER_AUTOR); },
    weltBereinigen: (k) => { weltAufrufe.push(...k.charaktere.map((c) => c.spielerId)); },
    spielerTrennen: (ids) => { getrennt.push(...ids); },
  },
);
db.kontoAnlegen('gast', 'gast@example.org', passwortEinlagernSync('gastpasswort1'));

const server = createServer((req, res) => { if (!api.behandle(req, res)) res.writeHead(404).end(); });
await new Promise<void>((ok, fehler) => { server.once('error', fehler); server.listen(0, '127.0.0.1', () => ok()); });
const basis = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

let zaehler = 0;
async function aufruf(
  methode: string, pfad: string, koerper?: unknown, token?: string, herkunft = `203.0.113.${(++zaehler % 250) + 1}`,
): Promise<{ status: number; daten: Json }> {
  const r = await fetch(basis + pfad, {
    method: methode,
    headers: {
      'content-type': 'application/json', 'x-forwarded-for': herkunft,
      ...(token ? { 'x-wov-account': token } : {}),
    },
    body: koerper === undefined ? undefined : JSON.stringify(koerper),
  });
  let daten: Json = {};
  try { daten = await r.json() as Json; } catch { /* leer */ }
  return { status: r.status, daten };
}

async function neuesKonto(name: string, passwort = 'altespasswort1'): Promise<{ token: string; kontoId: number }> {
  const r = await aufruf('POST', '/accounts/register', { username: name, email: `${name}@example.org`, password: passwort });
  assert.equal(r.status, 201, `Registrierung ${name}`);
  return { token: r.daten.token as string, kontoId: db.kontoNachName(name)!.id };
}
const aussehen = {
  figure: 'wikingerin', hairstyle: 'H_01', hairColor: 'mittelbraun', eyeColor: 'fjordblau', top: '', legs: '',
};
async function charakter(token: string, name: string): Promise<number> {
  const r = await aufruf('POST', '/accounts/characters', { name, ...aussehen }, token);
  assert.equal(r.status, 201, `Charakter ${name}: ${JSON.stringify(r.daten)}`);
  return r.daten.character.id as number;
}
const ich = (token: string) => aufruf('GET', '/accounts/me', undefined, token);

try {
  // ── 1. Falsches Passwort ─────────────────────────────────────────────
  const a = await neuesKonto('Alrun');
  let b = await neuesKonto('Bjarne');
  const alt = db.kontoNachName('Alrun')!.passwort;
  for (const [pfad, koerper] of [
    ['/accounts/password', { currentPassword: 'falsch1234', newPassword: 'neuespasswort1' }],
    ['/accounts/email', { currentPassword: 'falsch1234', email: 'neu@example.org' }],
    ['/accounts/delete', { password: 'falsch1234', confirm: 'Alrun' }],
  ] as const) {
    const r = await aufruf('POST', pfad, koerper, a.token);
    assert.equal(r.status, 401, `${pfad}: falsches Passwort -> 401`);
    assert.equal(r.daten.error, 'password-wrong');
  }
  assert.equal(db.kontoNachName('Alrun')!.passwort, alt, 'Passwort unveraendert');
  assert.equal(db.kontoNachName('Alrun')!.email, 'Alrun@example.org', 'E-Mail unveraendert');
  assert.equal((await ich(a.token)).status, 200, 'Konto besteht, Token gilt weiter');

  // Sperre je Herkunft: fuenf gleichzeitige Versuche gehen bis zum Hashen, der Rest 429.
  const gleichzeitig = await Promise.all(Array.from({ length: 12 }, (_, i) =>
    aufruf('POST', '/accounts/email', { currentPassword: `falsch${i}xxxx`, email: 'x@example.org' }, a.token, '198.51.100.7')));
  const stati = gleichzeitig.map((r) => r.status);
  assert.ok(stati.filter((s) => s === 401).length <= 5, `hoechstens fuenf Versuche kommen bis zum Hashen: ${stati}`);
  assert.ok(stati.includes(429), 'gleichzeitige Versuche laufen in die Sperre');
  const gesperrt = await aufruf('POST', '/accounts/email',
    { currentPassword: 'altespasswort1', email: 'neu@example.org' }, a.token, '198.51.100.7');
  assert.equal(gesperrt.status, 429, 'die Herkunft des Versuchs bleibt gesperrt, auch fuer das richtige Passwort');
  assert.equal(db.kontoNachName('Alrun')!.email, 'Alrun@example.org');

  // ── 3. Fremdes Token ─────────────────────────────────────────────────
  // Bjarnes Token mit Alruns Passwort: bestaetigt wird gegen BJARNES Konto.
  const fremd = await aufruf('POST', '/accounts/password',
    { currentPassword: 'altespasswort1', newPassword: 'gekapert1234' }, b.token);
  assert.equal(fremd.status, 200, 'gleiches Passwort, aber eigenes Konto: Bjarne aendert nur sein Konto');
  assert.equal(db.kontoNachName('Alrun')!.passwort, alt, 'Alruns Passwort unberuehrt');
  b = { ...b, token: fremd.daten.token as string };
  for (const pfad of ['/accounts/password', '/accounts/email', '/accounts/delete', '/accounts/profile']) {
    const r = await aufruf('POST', pfad, { currentPassword: 'x', password: 'x', confirm: 'Alrun', text: 'x' });
    assert.equal(r.status, 401, `${pfad}: ohne Token 401`);
    const r2 = await aufruf('POST', pfad, { text: 'x' }, a.token.slice(0, -3) + 'AAA');
    assert.equal(r2.status, 401, `${pfad}: verfaelschtes Token 401`);
  }

  // ── 2. Passwortwechsel ───────────────────────────────────────────────
  const c = await neuesKonto('Cedric');
  const c2 = await aufruf('POST', '/accounts/login', { username: 'Cedric', password: 'altespasswort1' });
  assert.equal(c2.status, 200);
  const zweiteSitzung = c2.daten.token as string;
  await new Promise((r) => setTimeout(r, 5));
  const kurz = await aufruf('POST', '/accounts/password', { currentPassword: 'altespasswort1', newPassword: 'kurz' }, c.token);
  assert.equal(kurz.status, 400, 'zu kurzes neues Passwort');
  const wechsel = await aufruf('POST', '/accounts/password',
    { currentPassword: 'altespasswort1', newPassword: 'neuespasswort1' }, c.token);
  assert.equal(wechsel.status, 200);
  const neuesToken = wechsel.daten.token as string;
  assert.equal((await ich(c.token)).status, 401, 'altes Token (aufrufende Sitzung) 401');
  assert.equal((await ich(zweiteSitzung)).status, 401, 'andere Sitzung 401');
  assert.equal((await ich(neuesToken)).status, 200, 'neues Token 200');
  assert.equal((await aufruf('POST', '/accounts/login', { username: 'Cedric', password: 'altespasswort1' })).status, 401,
    'Login mit altem Passwort scheitert');
  const neuLogin = await aufruf('POST', '/accounts/login', { username: 'Cedric', password: 'neuespasswort1' });
  assert.equal(neuLogin.status, 200, 'Login mit neuem Passwort geht');
  assert.equal((await ich(neuLogin.daten.token)).status, 200);
  // Forum prueft dasselbe Token ueber kontoIdAus.
  const fakeReq = (t: string) => ({ headers: { 'x-wov-account': t } }) as never;
  assert.equal(api.kontoIdAus(fakeReq(c.token)), null, 'kontoIdAus (Forum): altes Token null');
  assert.equal(api.kontoIdAus(fakeReq(neuesToken)), c.kontoId, 'kontoIdAus: neues Token gilt');

  // E-Mail
  const em = await aufruf('POST', '/accounts/email', { currentPassword: 'neuespasswort1', email: 'neu@example.org' }, neuesToken);
  assert.equal(em.status, 200);
  assert.equal(db.kontoNachId(c.kontoId)!.email, 'neu@example.org');
  assert.equal((await aufruf('POST', '/accounts/email', { currentPassword: 'neuespasswort1', email: 'kaputt' }, neuesToken)).status, 400);
  assert.equal((await ich(neuesToken)).status, 200, 'E-Mail-Wechsel beendet keine Sitzung');

  // ── 6. Standardkonto ─────────────────────────────────────────────────
  const gast = await aufruf('POST', '/accounts/login', { username: 'gast', password: 'gastpasswort1' });
  assert.equal(gast.status, 200);
  for (const [pfad, k] of [
    ['/accounts/password', { currentPassword: 'gastpasswort1', newPassword: 'uebernommen1' }],
    ['/accounts/email', { currentPassword: 'gastpasswort1', email: 'x@example.org' }],
    ['/accounts/delete', { password: 'gastpasswort1', confirm: 'gast' }],
  ] as const) {
    assert.equal((await aufruf('POST', pfad, k, gast.daten.token)).status, 403, `${pfad}: Standardkonto gesperrt`);
  }
  assert.ok(db.kontoNachName('gast'), 'Standardkonto besteht');

  // ── Profiltext ───────────────────────────────────────────────────────
  const d = await neuesKonto('Dagny');
  const dc1 = await charakter(d.token, 'Dagnyr');
  const dc2 = await charakter(d.token, 'Dagnys');
  const p1 = await aufruf('POST', '/accounts/profile', { text: '  Skaldin aus dem Norden\nmit zwei Zeilen ' }, d.token);
  assert.equal(p1.status, 200);
  assert.equal(p1.daten.profile, 'Skaldin aus dem Norden\nmit zwei Zeilen');
  assert.equal((await aufruf('POST', '/accounts/profile', { text: 'x'.repeat(301) }, d.token)).status, 400, '301 Zeichen abgelehnt');
  assert.equal((await aufruf('POST', '/accounts/profile', { text: 'x'.repeat(300) }, d.token)).status, 200, '300 Zeichen ok');
  assert.equal((await aufruf('POST', '/accounts/profile', { text: '😀'.repeat(300) }, d.token)).status, 200, 'Codepunkte, nicht UTF-16-Einheiten');
  for (const boese of ['a\u0000b', 'a‮b', 'a​b', 'a\tb', 42]) {
    assert.equal((await aufruf('POST', '/accounts/profile', { text: boese }, d.token)).status, 400, `abgelehnt: ${JSON.stringify(boese)}`);
  }
  await aufruf('POST', '/accounts/profile', { text: 'Skaldin <b>&</b>' }, d.token);
  assert.equal((await ich(d.token)).daten.profile, 'Skaldin <b>&</b>', 'Text bleibt Text (Rohform, kein HTML-Umbau)');
  assert.equal((await aufruf('GET', `/accounts/characters/${dc1}`)).daten.character.profile, '', 'ohne Avatar kein Profiltext oeffentlich');
  await aufruf('POST', '/accounts/avatar', { characterId: dc1 }, d.token);
  assert.equal((await aufruf('GET', `/accounts/characters/${dc1}`)).daten.character.profile, 'Skaldin <b>&</b>');
  assert.equal((await aufruf('GET', `/accounts/characters/${dc2}`)).daten.character.profile, '', 'nur der Avatar traegt den Text');
  const eigen = await aufruf('POST', `/accounts/characters/${dc1}/report`, { reason: 'x' }, d.token);
  assert.equal(eigen.status, 404, 'eigenes Profil melden geht nicht');
  const gemeldet = await aufruf('POST', `/accounts/characters/${dc1}/report`, { reason: 'Beleidigung' }, b.token);
  assert.equal(gemeldet.status, 201);
  assert.equal(db.profilMeldungenOffen().length, 1);

  // ── 4. Loeschung: Zaehlung vorher/nachher in beiden Datenbanken ──────
  const e = await neuesKonto('Eirik');
  const ec = await charakter(e.token, 'Eirikr');
  const ec2 = await charakter(e.token, 'Eirikson');
  const spieler = db.charaktereVonKonto(e.kontoId).map((x) => x.spielerId);
  const autorE = { kontoId: e.kontoId, charakterId: ec, name: 'Eirikr' };
  const autorB = { kontoId: b.kontoId, charakterId: null, name: 'Bjarne' };
  const t = forum.createThread('mead_hall', 'Hallo', autorE, 'Erster Beitrag von Eirikr');
  const p = forum.createPost(t.threadId, autorB, 'Antwort an Eirikr');
  const eigenerBeitrag2 = forum.createPost(t.threadId, autorE, 'Zweiter Beitrag');
  forum.reactionToggle(p, e.kontoId, 'hail');
  forum.abonnieren(t.threadId, e.kontoId);
  forum.reportPost(p, e.kontoId, 'eigene Meldung');
  const zaehl = () => ({
    konten: db.zaehlen().konten, charaktere: db.zaehlen().charaktere,
    themenVonE: forumZaehlen('SELECT COUNT(*) n FROM threads WHERE author_konto_id = ? OR author_character_id IN (?, ?)', e.kontoId, ec, ec2),
    beitraegeVonE: forumZaehlen('SELECT COUNT(*) n FROM posts WHERE author_konto_id = ? OR author_character_id IN (?, ?)', e.kontoId, ec, ec2),
    reaktionen: forumZaehlen('SELECT COUNT(*) n FROM reactions WHERE konto_id = ?', e.kontoId),
    abos: forumZaehlen('SELECT COUNT(*) n FROM subscriptions WHERE konto_id = ?', e.kontoId),
    meldungen: forumZaehlen('SELECT COUNT(*) n FROM reports WHERE reporter_konto_id = ?', e.kontoId),
    beitraegeGesamt: forumZaehlen('SELECT COUNT(*) n FROM posts'),
  });
  const vorher = zaehl();
  assert.deepEqual([vorher.themenVonE, vorher.beitraegeVonE, vorher.abos, vorher.meldungen], [1, 2, 1, 1]);
  const spielToken = (await aufruf('POST', `/accounts/characters/${ec}/play`, undefined, e.token)).daten.sessionToken;
  assert.ok(spielToken, 'Spieler-Token vor der Loeschung');
  assert.equal(db.bannFuerZugang({ spielerId: spieler[0] }), null, 'vorher darf die Kennung herein');

  assert.equal((await aufruf('POST', '/accounts/delete', { password: 'altespasswort1', confirm: 'falsch' }, e.token)).status, 400, 'Bestaetigung noetig');
  assert.equal((await aufruf('POST', '/accounts/delete', { password: 'altespasswort1' }, e.token)).status, 400);
  assert.equal(db.zaehlen().konten, vorher.konten, 'ohne Bestaetigung nichts geloescht');
  const weg = await aufruf('POST', '/accounts/delete', { password: 'altespasswort1', confirm: 'eirik' }, e.token);
  assert.equal(weg.status, 200, JSON.stringify(weg.daten));
  const nachher = zaehl();
  assert.deepEqual(
    { k: nachher.konten, c: nachher.charaktere },
    { k: vorher.konten - 1, c: vorher.charaktere - 2 }, 'Konto und zwei Charaktere weg');
  assert.deepEqual(
    [nachher.themenVonE, nachher.beitraegeVonE, nachher.reaktionen, nachher.abos, nachher.meldungen], [0, 0, 0, 0, 0],
    'keine Verknuepfung mehr im Forum');
  assert.equal(nachher.beitraegeGesamt, vorher.beitraegeGesamt, 'Beitraege bleiben erhalten');
  const posts = forum.listPosts(t.threadId, 50, 0);
  assert.deepEqual(
    posts.map((x) => x.authorName),
    ['Gelöschter Recke', 'Bjarne', 'Gelöschter Recke'], 'Autor wird "Gelöschter Recke"');
  assert.equal(posts[0].authorCharacterId, null);
  assert.equal(forum.threadById(t.threadId)!.authorName, GELOESCHTER_AUTOR);
  assert.ok(posts.find((x) => x.id === eigenerBeitrag2));
  assert.equal(db.forumAuftraege().length, 0, 'Forum-Auftrag erledigt');
  assert.deepEqual(weltAufrufe.sort(), [...spieler].sort(), 'Welt-Haken bekam beide Charaktere');
  // alle Token tot
  assert.equal((await ich(e.token)).status, 401, 'Token 401');
  assert.equal((await aufruf('POST', `/accounts/characters/${ec}/play`, undefined, e.token)).status, 401);
  assert.equal((await aufruf('POST', '/accounts/login', { username: 'Eirik', password: 'altespasswort1' })).status, 401);
  assert.equal((await aufruf('GET', `/accounts/characters/${ec}`)).status, 404, 'Charakter weg');
  // Spieler-Token von vorher: Kennung wird abgewiesen
  assert.ok(db.bannFuerZugang({ spielerId: spieler[0] }), 'geloeschte Kennung kommt nicht mehr herein');
  assert.ok(db.bannFuerZugang({ spielerId: spieler[1].toUpperCase() }), 'auch in anderer Schreibweise');
  // Name wieder frei, Ids nicht wiederverwendet, altes Token gehoert nicht dem Neuen
  const neuE = await neuesKonto('Eirik');
  assert.ok(neuE.kontoId > e.kontoId, `Konto-Id wird nicht wiederverwendet (${e.kontoId} -> ${neuE.kontoId})`);
  assert.equal((await ich(e.token)).status, 401, 'altes Token gilt nicht fuer das neue Konto gleichen Namens');
  const neuC = await charakter(neuE.token, 'Eirikr');
  assert.ok(neuC > ec2, 'Charakter-Id nicht wiederverwendet; Name Eirikr wieder frei');
  // Einzelnen Charakter loeschen: Id ebenfalls nicht neu vergeben
  assert.equal((await aufruf('DELETE', `/accounts/characters/${neuC}`, undefined, neuE.token)).status, 200);
  assert.ok((await charakter(neuE.token, 'Eirikx')) > neuC, 'Charakter-Id nach Einzelloeschung nicht wiederverwendet');

  // ── 5. Loeschung und play gleichzeitig ───────────────────────────────
  for (let i = 0; i < 8; i++) {
    const f = await neuesKonto(`Fenja${i}`);
    const fc = await charakter(f.token, `Fenjar${i}`);
    const sp = db.charaktereVonKonto(f.kontoId)[0].spielerId;
    const [loesch, spielen] = await Promise.all([
      aufruf('POST', '/accounts/delete', { password: 'altespasswort1', confirm: `Fenja${i}` }, f.token),
      aufruf('POST', `/accounts/characters/${fc}/play`, undefined, f.token),
    ]);
    assert.equal(loesch.status, 200, `Lauf ${i}: Loeschung ${JSON.stringify(loesch.daten)}`);
    assert.ok([200, 401].includes(spielen.status), `Lauf ${i}: play ist 200 oder 401, war ${spielen.status}`);
    assert.equal(db.charaktereVonKonto(f.kontoId).length, 0, 'kein Charakter uebrig');
    assert.equal(db.charakterZuSpielerId(sp), null);
    assert.ok(db.bannFuerZugang({ spielerId: sp }), `Lauf ${i}: auch ein gerade abgeholtes Token kommt nicht in die Welt`);
  }

  // ── Login-Hash-Upgrade darf einen Passwortwechsel nicht zurueckdrehen ─
  const g = await neuesKonto('Gunnar');
  const alterEintrag = db.kontoNachName('Gunnar')!.passwort;
  assert.equal(db.passwortErsetzen(g.kontoId, 'scrypt$x', 'anderer-eintrag'), false, 'CAS: falscher Erwartungswert schreibt nichts');
  assert.equal(db.kontoNachName('Gunnar')!.passwort, alterEintrag);

  // ══ N1 (Opus-Angriff) ════════════════════════════════════════════════

  // B1: Login mit dem ALTEN Passwort, dessen Pruefung vor dem Wechsel fertig
  // wurde, bekommt danach kein Token. Das Fenster wird erzwungen: der Haken
  // fuehrt den Passwortwechsel genau zwischen Pruefung und Tokenausgabe aus.
  {
    const h = await neuesKonto('Hilda');
    let haken = 0;
    api.testHaken.nachLoginPruefung = async () => {
      api.testHaken.nachLoginPruefung = undefined;
      haken++;
      const w = await aufruf('POST', '/accounts/password', { currentPassword: 'altespasswort1', newPassword: 'neuespasswort2' }, h.token);
      assert.equal(w.status, 200, 'Wechsel im Fenster');
    };
    const spaet = await aufruf('POST', '/accounts/login', { username: 'Hilda', password: 'altespasswort1' });
    assert.equal(haken, 1, 'das Fenster wurde tatsaechlich erzwungen');
    // N3 (W3-Reste): Das Passwort WAR richtig, nur die Generation ist waehrend
    // des Hashens weitergezaehlt worden — das ist kein "Benutzername oder
    // Passwort falsch", sondern ein Zusammenstoss mit dem gleichzeitigen
    // Wechsel. Vor N3 stand hier 401 "login-failed".
    assert.equal(spaet.status, 409, `Login mit altem Passwort im Fenster: Zusammenstoss, kein Token (war ${spaet.status})`);
    assert.equal(spaet.daten.error, 'conflict');
    assert.equal(spaet.daten.token, undefined);
    assert.equal((await aufruf('POST', '/accounts/login', { username: 'Hilda', password: 'neuespasswort2' })).status, 200);
  }

  // B2 + B5: Spieler-Token aus /play ueberleben den Wechsel nicht; Uhrsprung sperrt niemanden aus.
  {
    const i = await neuesKonto('Ingrid');
    await charakter(i.token, 'Ingridr');
    const ic = db.charaktereVonKonto(i.kontoId)[0];
    const vorWechsel = (await aufruf('POST', `/accounts/characters/${ic.id}/play`, undefined, i.token)).daten.sessionToken as string;
    const gepr = tokenPruefen(vorWechsel, geheimnis);
    assert.equal(gepr.status, 'gueltig');
    const ausgestellt = gepr.status === 'gueltig' ? gepr.ausgestelltAm : 0;
    assert.equal(db.bannFuerZugang({ spielerId: ic.spielerId, ausgestelltAm: ausgestellt }), null, 'vorher darf das Token herein');
    await new Promise((r) => setTimeout(r, 5));
    const w = await aufruf('POST', '/accounts/password', { currentPassword: 'altespasswort1', newPassword: 'neuespasswort2' }, i.token);
    assert.equal(w.status, 200);
    assert.deepEqual(getrennt.filter((x) => x === ic.spielerId), [ic.spielerId], 'laufende Verbindungen werden getrennt');
    assert.ok(db.bannFuerZugang({ spielerId: ic.spielerId, ausgestelltAm: ausgestellt }), '/play-Token von vor dem Wechsel abgewiesen');
    const ab = db.spielerAbZuSpielerId(ic.spielerId)!;
    assert.ok(db.bannFuerZugang({ spielerId: ic.spielerId, ausgestelltAm: ab }), 'genau zu spieler_ab: abgewiesen');
    assert.equal(db.bannFuerZugang({ spielerId: ic.spielerId, ausgestelltAm: ab + 1 }), null, 'einen ms danach: gueltig');
    assert.equal(db.bannFuerZugang({ spielerId: ic.spielerId }), null, 'ohne Ausstellzeit (Adminweg) keine Pruefung');
    const nachher = (await aufruf('POST', `/accounts/characters/${ic.id}/play`, undefined, w.daten.token)).daten.sessionToken as string;
    const g2 = tokenPruefen(nachher, geheimnis);
    assert.equal(db.bannFuerZugang({
      spielerId: ic.spielerId, ausgestelltAm: g2.status === 'gueltig' ? g2.ausgestelltAm : 0,
    }), null, 'neues /play-Token gilt');

    // Uhrsprung: 60 s zurueck NACH dem Wechsel. Niemand darf ausgesperrt sein.
    const echt = Date.now;
    Date.now = () => echt() - 60_000;
    try {
      const login = await aufruf('POST', '/accounts/login', { username: 'Ingrid', password: 'neuespasswort2' });
      assert.equal(login.status, 200);
      assert.equal((await ich(login.daten.token)).status, 200, 'Token nach Uhrsprung gilt');
      const w2 = await aufruf('POST', '/accounts/password', { currentPassword: 'neuespasswort2', newPassword: 'neuespasswort3' }, login.daten.token);
      assert.equal(w2.status, 200);
      assert.equal((await ich(w2.daten.token)).status, 200, 'Token des zweiten Wechsels gilt nach Uhrsprung');
      const t3 = (await aufruf('POST', `/accounts/characters/${ic.id}/play`, undefined, w2.daten.token)).daten.sessionToken as string;
      const g3 = tokenPruefen(t3, geheimnis);
      assert.equal(db.bannFuerZugang({
        spielerId: ic.spielerId, ausgestelltAm: g3.status === 'gueltig' ? g3.ausgestelltAm : 0,
      }), null, '/play-Token gilt nach Uhrsprung');
    } finally { Date.now = echt; }
  }

  // B3: ein Dieb mit gestohlenem Token sperrt den Besitzer nicht aus.
  {
    const j = await neuesKonto('Jorunn');
    for (let n = 0; n < 6; n++) {
      const r = await aufruf('POST', '/accounts/password', { currentPassword: `falsch${n}xxxx`, newPassword: 'gekapert1234' }, j.token, `192.0.2.${n + 1}`);
      assert.equal(r.status, 401, `Dieb von Adresse ${n + 1}`);
    }
    for (let n = 0; n < 5; n++) {
      assert.equal((await aufruf('POST', '/accounts/password', { currentPassword: `dieb${n}xxxx`, newPassword: 'gekapert1234' }, j.token, '192.0.2.50')).status, 401);
    }
    const dieb = await aufruf('POST', '/accounts/password', { currentPassword: 'falsch9xxxx', newPassword: 'gekapert1234' }, j.token, '192.0.2.50');
    assert.equal(dieb.status, 429, 'der Dieb bleibt an seiner eigenen Adresse gesperrt');
    const besitzer = await aufruf('POST', '/accounts/password', { currentPassword: 'altespasswort1', newPassword: 'neuespasswort2' }, j.token, '198.18.0.1');
    assert.equal(besitzer.status, 200, 'Besitzer von anderer Adresse mit richtigem Passwort kommt durch');
    // Verteiltes Raten hat trotzdem eine Grenze je Konto (50).
    const k = await neuesKonto('Knut');
    let stand429 = 0;
    for (let n = 0; n < 52; n++) {
      const r = await aufruf('POST', '/accounts/email', { currentPassword: `falsch${n}xxxx`, email: 'k@example.org' }, k.token, `198.19.${Math.floor(n / 200)}.${(n % 200) + 1}`);
      if (r.status === 429) stand429++;
    }
    assert.ok(stand429 >= 2, `nach 50 Fehlversuchen von verteilten Adressen greift die Kontosperre (${stand429})`);
    assert.equal((await aufruf('POST', '/accounts/email', { currentPassword: 'altespasswort1', email: 'k@example.org' }, k.token, '198.19.9.9')).status, 429);
  }

  // B8: ein Erfolg setzt die Zaehler zurueck (4 + Erfolg + 4 bleiben unter der Sperre).
  {
    const l = await neuesKonto('Liv');
    const ip = '192.0.2.200';
    for (let n = 0; n < 4; n++) assert.equal((await aufruf('POST', '/accounts/email', { currentPassword: `falsch${n}xxxx`, email: 'l@example.org' }, l.token, ip)).status, 401);
    assert.equal((await aufruf('POST', '/accounts/email', { currentPassword: 'altespasswort1', email: 'l@example.org' }, l.token, ip)).status, 200);
    for (let n = 0; n < 4; n++) assert.equal((await aufruf('POST', '/accounts/email', { currentPassword: `falsch${n}xxxx`, email: 'l@example.org' }, l.token, ip)).status, 401, `Versuch ${n + 1} nach Erfolg`);
  }

  // B8: auch der Konto-Zaehler wird bei Erfolg zurueckgesetzt (45 + Erfolg + 45 bleiben unter 50 je Fenster).
  {
    const o = await neuesKonto('Orm');
    const falsch = async (von: number, bis: number) => {
      for (let n = von; n < bis; n++) {
        const r = await aufruf('POST', '/accounts/email', { currentPassword: `falsch${n}xxxx`, email: 'o@example.org' }, o.token, `198.20.${Math.floor(n / 200)}.${(n % 200) + 1}`);
        assert.equal(r.status, 401, `Versuch ${n}`);
      }
    };
    await falsch(0, 45);
    assert.equal((await aufruf('POST', '/accounts/email', { currentPassword: 'altespasswort1', email: 'o@example.org' }, o.token, '198.21.0.1')).status, 200);
    await falsch(45, 90);
  }

  // B8: Loeschung und E-Mail-Wechsel schreiben nur, wenn das Passwort seit der Pruefung unveraendert ist.
  {
    const m = await neuesKonto('Mette');
    const eintrag = db.kontoNachName('Mette')!.passwort;
    api.testHaken.nachBestaetigung = async () => {
      api.testHaken.nachBestaetigung = undefined;
      assert.ok(db.passwortWechseln(m.kontoId, passwortEinlagernSync('zwischendurch12'), eintrag));
    };
    const weg = await aufruf('POST', '/accounts/delete', { password: 'altespasswort1', confirm: 'Mette' }, m.token);
    assert.equal(weg.status, 409, `Loeschung nach zwischenzeitlichem Wechsel: 409 (war ${weg.status})`);
    assert.ok(db.kontoNachId(m.kontoId), 'Konto besteht');
    api.testHaken.nachBestaetigung = async () => {
      api.testHaken.nachBestaetigung = undefined;
      assert.ok(db.passwortWechseln(m.kontoId, passwortEinlagernSync('zwischendurch34'), db.kontoNachName('Mette')!.passwort));
    };
    // Das Token von vorher ist inzwischen ungueltig (Generation): neu anmelden.
    const neu = await aufruf('POST', '/accounts/login', { username: 'Mette', password: 'zwischendurch12' });
    assert.equal(neu.status, 200);
    const em = await aufruf('POST', '/accounts/email', { currentPassword: 'zwischendurch12', email: 'm@example.org' }, neu.daten.token);
    assert.equal(em.status, 409, 'E-Mail-Wechsel nach zwischenzeitlichem Wechsel: 409');
    assert.notEqual(db.kontoNachId(m.kontoId)!.email, 'm@example.org');
  }

  // B5: spieler_ab und Generation laufen nur vorwaerts, auch wenn `jetzt` rueckwaerts springt.
  {
    const q = await neuesKonto('Quirin');
    const e0 = db.kontoNachName('Quirin')!.passwort;
    const e1 = passwortEinlagernSync('quirin-eins-1');
    const e2 = passwortEinlagernSync('quirin-zwei-2');
    const w1 = db.passwortWechseln(q.kontoId, e1, e0, 1_000_000)!;
    const w2 = db.passwortWechseln(q.kontoId, e2, e1, 500)!;
    assert.equal(w1.generation, 1); assert.equal(w2.generation, 2, 'Generation zaehlt hoch');
    assert.equal(w1.spielerAb, 1_000_000);
    assert.equal(w2.spielerAb, 1_000_001, 'spieler_ab springt trotz kleinerem jetzt nicht zurueck');
  }

  // B6: Standardkonten duerfen weder Profil noch Avatar setzen.
  {
    const g = await aufruf('POST', '/accounts/login', { username: 'gast', password: 'gastpasswort1' });
    const r = await aufruf('POST', '/accounts/profile', { text: 'Ich gehoere allen' }, g.daten.token);
    assert.equal(r.status, 403); assert.equal(r.daten.error, 'standard-account');
    const av = await aufruf('POST', '/accounts/avatar', { characterId: null }, g.daten.token);
    assert.equal(av.status, 403); assert.equal(av.daten.error, 'standard-account');
  }

  // B7: Positivregel fuer Profiltext.
  {
    const n = await neuesKonto('Njal');
    const setze = (text: unknown) => aufruf('POST', '/accounts/profile', { text }, n.token);
    const abgelehnt: [string, string][] = [
      ['Zalgo (299 kombinierende Zeichen)', 'a' + '\u0301'.repeat(299)],
      ['drei kombinierende in Folge', 'x\u0301\u0302\u0303'],
      ['300 Umbrueche', '\n'.repeat(300).replace(/^/, 'a') + 'b'],
      ['sechs Umbrueche', 'a\n\n\n\n\n\nb'],
      ['U+061C', 'a\u061Cb'], ['U+180E', 'a\u180Eb'], ['Tag U+E0001', 'a\u{E0001}b'], ['Tag U+E0041', 'a\u{E0041}b'],
      ['U+3164', 'a\u3164b'], ['U+00AD', 'a\u00ADb'], ['einzelnes Surrogat', 'a\uD800b'],
      ['U+200B', 'a\u200Bb'], ['U+202E', 'a\u202Eb'], ['Tabulator', 'a\tb'], ['U+2028', 'a\u2028b'],
      ['U+2800', 'a\u2800b'], ['privates Zeichen', 'a\uE000b'], ['NUL', 'a\u0000b'],
      ['301 Zeichen', 'x'.repeat(301)], ['301 Emoji', '\u{1F600}'.repeat(301)],
    ];
    for (const [name, text] of abgelehnt) assert.equal((await setze(text)).status, 400, `abgelehnt: ${name}`);
    const erlaubt: [string, string][] = [
      ['zwei kombinierende', 'a\u0301\u0302'], ['fuenf Umbrueche', 'a\n\n\n\n\nb'],
      ['Sprachen', 'Ærø Ünïcödé ᚠᚢᚦ 日本語 Ελληνικά'], ['Emoji mit Hautton', '\u{1F44D}\u{1F3FD}'],
      ['300 Graphem-Cluster', 'e\u0301\u0302'.repeat(300)], ['leer', ''],
    ];
    for (const [name, text] of erlaubt) assert.equal((await setze(text)).status, 200, `erlaubt: ${name}`);
    assert.equal((await setze('e\u0301\u0302'.repeat(301))).status, 400, '301 Graphem-Cluster abgelehnt');
    assert.equal((await aufruf('POST', `/accounts/characters/1/report`, { reason: 'a\u200Bb' }, n.token)).status, 400, 'Meldegrund: dieselbe Regel');
  }

  // ══ N2 (Opus-Nachangriff) ═════════════════════════════════════════════

  // N1-1: Ein Erfolg im EIGENEN Konto setzt die Zaehlung gegen das Opfer nicht
  // zurueck (vier falsch, einmal eigener Erfolg, 14 Runden, von EINER Adresse).
  for (const weg of ['login', 'email'] as const) {
    const opfer = await neuesKonto(`Opfer${weg}`);
    const dieb = await neuesKonto(`Dieb${weg}`);
    const ip = weg === 'login' ? '198.51.100.66' : '198.51.100.67';
    let biszumHash = 0;
    let gesperrtAnzahl = 0;
    for (let runde = 0; runde < 14; runde++) {
      for (let n = 0; n < 4; n++) {
        const r = await aufruf('POST', '/accounts/password', { currentPassword: `raten${runde}-${n}`, newPassword: 'gekapert1234' }, opfer.token, ip);
        if (r.status === 401) biszumHash++; else if (r.status === 429) gesperrtAnzahl++;
      }
      const eigen = weg === 'login'
        ? await aufruf('POST', '/accounts/login', { username: `Dieb${weg}`, password: 'altespasswort1' }, undefined, ip)
        : await aufruf('POST', '/accounts/email', { currentPassword: 'altespasswort1', email: `d${runde}@example.org` }, dieb.token, ip);
      assert.equal(eigen.status, 200, `Erfolg im eigenen Konto (${weg}) in Runde ${runde}`);
    }
    assert.ok(biszumHash <= 5, `${weg}: hoechstens fuenf Versuche von einer Adresse kommen bis zum Hash (waren ${biszumHash})`);
    assert.ok(gesperrtAnzahl >= 50, `${weg}: der Rest wird gesperrt (${gesperrtAnzahl})`);
    const besitzer = await aufruf('POST', '/accounts/password', { currentPassword: 'altespasswort1', newPassword: 'neuespasswort2' }, opfer.token, '198.18.7.7');
    assert.equal(besitzer.status, 200, `${weg}: der Besitzer von anderer Adresse kommt durch`);
  }

  // Rettungsweg: Ein verteilter Dieb (50 Adressen) sperrt die Passwortbestaetigung
  // des Kontos; "ueberall abmelden" mit dem RICHTIGEN Passwort geht trotzdem und
  // beendet die Sitzung des Diebs.
  {
    const r = await neuesKonto('Rettung');
    for (let n = 0; n < 50; n++) {
      const x = await aufruf('POST', '/accounts/password', { currentPassword: `verteilt${n}xx`, newPassword: 'gekapert1234' }, r.token, `198.22.${Math.floor(n / 200)}.${(n % 200) + 1}`);
      assert.equal(x.status, 401, `verteilter Versuch ${n}`);
    }
    assert.equal((await aufruf('POST', '/accounts/password', { currentPassword: 'altespasswort1', newPassword: 'neuespasswort2' }, r.token, '198.23.0.1')).status, 429, 'Konto-Sperre greift');
    assert.equal((await aufruf('POST', '/accounts/login', { username: 'Rettung', password: 'falsch12345', logoutOthers: true }, undefined, '198.23.0.2')).status, 401, 'falsches Passwort: keine Abmeldung');
    assert.equal((await ich(r.token)).status, 200, 'Token gilt nach dem falschen Versuch weiter');
    const rette = await aufruf('POST', '/accounts/login', { username: 'Rettung', password: 'altespasswort1', logoutOthers: true }, undefined, '198.23.0.3');
    assert.equal(rette.status, 200, 'Rettungsweg trotz Kontosperre');
    assert.equal((await ich(r.token)).status, 401, 'die alte (gestohlene) Sitzung ist beendet');
    assert.equal((await ich(rette.daten.token)).status, 200, 'die neue Sitzung gilt');
    const wechsel = await aufruf('POST', '/accounts/password', { currentPassword: 'altespasswort1', newPassword: 'neuespasswort2' }, rette.daten.token, '198.23.0.4');
    assert.equal(wechsel.status, 200, 'danach ist die Sperre aufgehoben, Passwortwechsel geht');
    // Standardkonten: kein "ueberall abmelden"
    assert.equal((await aufruf('POST', '/accounts/login', { username: 'gast', password: 'gastpasswort1', logoutOthers: true }, undefined, '198.23.0.5')).status, 403);
  }

  // N1-2: gleichzeitige, richtige Logins mit VERALTETEM Hash bekommen alle ein Token.
  for (let lauf = 0; lauf < 3; lauf++) {
    const salz = randomBytes(16);
    const roh = scryptSync('altespasswort1'.normalize('NFKC'), salz, 32, { N: 16384, r: 8, p: 1 });
    const eintrag = `scrypt$16384$8$1$${salz.toString('base64url')}$${roh.toString('base64url')}`;
    const name = `Veraltet${lauf}`;
    assert.ok(db.kontoAnlegen(name, `${name}@example.org`, eintrag).ok);
    const antworten = await Promise.all(Array.from({ length: 4 }, (_, i) =>
      aufruf('POST', '/accounts/login', { username: name, password: 'altespasswort1' }, undefined, `198.24.${lauf}.${i + 1}`)));
    assert.deepEqual(antworten.map((a) => a.status), [200, 200, 200, 200], `Lauf ${lauf}: alle vier Logins bekommen ein Token`);
    for (const a of antworten) assert.equal((await ich(a.daten.token)).status, 200, `Lauf ${lauf}: Token gilt`);
  }

  // N1-3: Hangul-Jamo-Ketten, einzelne Variantenselektoren.
  {
    const n = await neuesKonto('Nils');
    const setze = (text: unknown) => aufruf('POST', '/accounts/profile', { text }, n.token);
    const abgelehnt: [string, string][] = [
      ['Jamo-Kette', '\u1100'.repeat(50) + '\u1161' + '\u11A8'.repeat(50)],
      ['vier Jamo hintereinander', '\u1100\u1100\u1100\u1100'],
      ['U+180B allein', '\u180B'], ['U+FE0F allein', '\uFE0F'], ['U+FE0F hinter Leerzeichen', 'a \uFE0F'],
      ['U+FE0F hinter Buchstabe', 'a\uFE0F'], ['U+180B hinter Buchstabe', 'a\u180B'], ['Kombinierendes am Anfang', '\u0301abc'],
      ['Kombinierendes nach Umbruch', 'a\n\u0301'],
    ];
    for (const [name, text] of abgelehnt) assert.equal((await setze(text)).status, 400, `abgelehnt: ${name}`);
    const erlaubt: [string, string][] = [
      ['Emoji mit VS16', '\u2764\uFE0F'], ['Han mit Selektor', '\u845B\uFE00'], ['Hangul (NFD, wird NFC)', '\u1112\u1161\u11AB\u1100\u1173\u11AF'],
      ['Hangul fertig', '한글 안녕하세요'],
    ];
    for (const [name, text] of erlaubt) assert.equal((await setze(text)).status, 200, `erlaubt: ${name}`);
  }

  // ══ N3 (Opus-Pruefung N2) ═════════════════════════════════════════════

  // M1: Ein erfolgreicher Login (auch in das oeffentliche gast-Konto) setzt die
  // Login-Zaehlung gegen andere Konten nicht zurueck: vier falsch am Opferkonto,
  // ein Gast-Login, 14 Runden, von EINER Adresse.
  {
    await neuesKonto('LoginOpfer');
    const ip = '198.51.100.120';
    let biszumHash = 0;
    let gesperrt429 = 0;
    for (let runde = 0; runde < 14; runde++) {
      for (let n = 0; n < 4; n++) {
        const r = await aufruf('POST', '/accounts/login', { username: 'LoginOpfer', password: `rate${runde}-${n}xx` }, undefined, ip);
        if (r.status === 401) biszumHash++; else if (r.status === 429) gesperrt429++;
      }
      const g = await aufruf('POST', '/accounts/login', { username: 'gast', password: 'gastpasswort1' }, undefined, ip);
      assert.equal(g.status, 200, `gast-Login in Runde ${runde}`);
    }
    assert.ok(biszumHash <= 5, `Login-Raten von einer Adresse: hoechstens fuenf kommen bis zum Hash (waren ${biszumHash})`);
    assert.ok(gesperrt429 >= 50, `der Rest wird gesperrt (${gesperrt429})`);
    assert.equal((await aufruf('POST', '/accounts/login', { username: 'LoginOpfer', password: 'altespasswort1' }, undefined, '198.18.9.9')).status, 200, 'der Besitzer von anderer Adresse kommt durch');
  }

  // Herkunftszaehler: viele Konten von einer Adresse, Erfolge setzen ihn nicht zurueck.
  {
    const konten: string[] = [];
    for (let i = 0; i < 7; i++) { konten.push(`Klapper${i}`); await neuesKonto(`Klapper${i}`); }
    const ip = '198.51.100.121';
    let biszumHash = 0;
    let gesperrt429 = 0;
    for (const name of konten) {
      for (let n = 0; n < 4; n++) {
        const r = await aufruf('POST', '/accounts/login', { username: name, password: `falsch${n}xxxxx` }, undefined, ip);
        if (r.status === 401) biszumHash++; else if (r.status === 429) gesperrt429++;
      }
      await aufruf('POST', '/accounts/login', { username: 'gast', password: 'gastpasswort1' }, undefined, ip);
    }
    assert.ok(biszumHash <= 25, `hoechstens 25 Login-Fehlversuche je Herkunft ueber alle Konten (waren ${biszumHash})`);
    assert.ok(gesperrt429 >= 1, 'danach 429');
  }

  // L7: Die Rettung umgeht die Herkunftssperre des Logins nicht.
  {
    await neuesKonto('Rettung2');
    const ip = '198.51.100.122';
    for (let n = 0; n < 5; n++) {
      assert.equal((await aufruf('POST', '/accounts/login', { username: 'Rettung2', password: `falsch${n}xxxxx` }, undefined, ip)).status, 401);
    }
    const r = await aufruf('POST', '/accounts/login', { username: 'Rettung2', password: 'altespasswort1', logoutOthers: true }, undefined, ip);
    assert.equal(r.status, 429, 'Rettung von gesperrter Herkunft: 429');
    const von = await aufruf('POST', '/accounts/login', { username: 'Rettung2', password: 'altespasswort1', logoutOthers: true }, undefined, '198.51.100.123');
    assert.equal(von.status, 200, 'von anderer Herkunft geht sie');
  }

  // N2: Die Rettung raeumt auch die Bestaetigungssperre (Herkunft, Konto).
  {
    const u = await neuesKonto('Hausnetz');
    const ip = '198.51.100.160';
    for (let n = 0; n < 5; n++) {
      assert.equal((await aufruf('POST', '/accounts/email', { currentPassword: `falsch${n}xxxx`, email: 'h@example.org' }, u.token, ip)).status, 401);
    }
    assert.equal((await aufruf('POST', '/accounts/email', { currentPassword: 'altespasswort1', email: 'h@example.org' }, u.token, ip)).status, 429, 'gesperrt');
    const rette = await aufruf('POST', '/accounts/login', { username: 'Hausnetz', password: 'altespasswort1', logoutOthers: true }, undefined, '198.51.100.161');
    assert.equal(rette.status, 200);
    assert.equal((await aufruf('POST', '/accounts/email', { currentPassword: 'altespasswort1', email: 'h@example.org' }, rette.daten.token, ip)).status, 200,
      'nach der Rettung geht die Bestaetigung auch von der vorher gesperrten Adresse');
  }

  // N4: Ein VOR der Rettung begonnener, langsamer Schreibaufruf schreibt danach nicht mehr.
  {
    const u = await neuesKonto('Langsam');
    const langsam = (pfad: string, koerper: unknown): { fertig: Promise<number>; senden: () => void } => {
      const text = JSON.stringify(koerper);
      const [host, port] = basis.replace('http://', '').split(':');
      let senden: () => void = () => undefined;
      const fertig = new Promise<number>((ok, scheitern) => {
        const rq = httpRequest({
          host, port: Number(port), method: 'POST', path: pfad,
          headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)),
            'x-wov-account': u.token, 'x-forwarded-for': '198.51.100.170' },
        }, (res) => { res.resume(); res.on('end', () => ok(res.statusCode ?? 0)); });
        rq.on('error', scheitern);
        rq.flushHeaders();
        senden = () => rq.end(text);
      });
      return { fertig, senden };
    };
    const profil = langsam('/accounts/profile', { text: 'Ich schreibe nach der Rettung' });
    const anlegen = langsam('/accounts/characters', { name: 'Nachzuegler', ...aussehen });
    await new Promise((r) => setTimeout(r, 200));
    const rette = await aufruf('POST', '/accounts/login', { username: 'Langsam', password: 'altespasswort1', logoutOthers: true }, undefined, '198.51.100.171');
    assert.equal(rette.status, 200);
    profil.senden(); anlegen.senden();
    assert.deepEqual([await profil.fertig, await anlegen.fertig], [401, 401], 'beide Aufrufe werden abgewiesen');
    assert.equal(db.profilTextVon(u.kontoId), '', 'kein Profiltext geschrieben');
    assert.equal(db.charaktereVonKonto(u.kontoId).length, 0, 'kein Charakter angelegt');
  }

  // ══ N4 (Opus-Pruefung N3) ═════════════════════════════════════════════

  // A1: bekannte und unbekannte Benutzernamen verhalten sich gleich (kein Orakel).
  {
    await neuesKonto('Orakelopfer');
    const ip = '198.51.100.40';
    for (let n = 0; n < 5; n++) {
      assert.equal((await aufruf('POST', '/accounts/login', { username: `Gibtsnicht${n}`, password: 'egal123456' }, undefined, ip)).status, 401, `unbekannt ${n}`);
    }
    const t0 = Date.now();
    const neuUnbekannt = await aufruf('POST', '/accounts/login', { username: 'Niemand', password: 'egal123456' }, undefined, ip);
    const dauerUnbekannt = Date.now() - t0;
    const bekannt = await aufruf('POST', '/accounts/login', { username: 'Orakelopfer', password: 'egal123456' }, undefined, ip);
    assert.equal(neuUnbekannt.status, bekannt.status, 'neuer unbekannter und bekannter Name: gleicher Status');
    assert.equal(neuUnbekannt.status, 401);
    assert.ok(dauerUnbekannt > 20, `unbekannter Name kostet wie ein bekannter einen Hash (${dauerUnbekannt} ms)`);
    // je Name: derselbe erfundene Name wird nach fuenf Versuchen gesperrt, wie ein bekannter
    for (let n = 0; n < 4; n++) await aufruf('POST', '/accounts/login', { username: 'Niemand', password: `egal${n}12345` }, undefined, ip);
    assert.equal((await aufruf('POST', '/accounts/login', { username: 'niemand', password: 'egal123456' }, undefined, ip)).status, 429, 'sechster Versuch mit demselben erfundenen Namen (Gross/Klein egal): 429');
  }

  // N-1: Herkunftsgrenze auch nach dem Lesen verzoegerter Koerper.
  {
    const namen: string[] = [];
    for (let i = 0; i < 30; i++) { namen.push(`Schwall${i}`); await neuesKonto(`Schwall${i}`); }
    const [host, port] = basis.replace('http://', '').split(':');
    const senden: (() => void)[] = [];
    const ergebnisse = namen.map((name) => new Promise<number>((ok, scheitern) => {
      const text = JSON.stringify({ username: name, password: 'falsch123456' });
      const rq = httpRequest({
        host, port: Number(port), method: 'POST', path: '/accounts/login',
        headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)), 'x-forwarded-for': '198.51.100.50' },
      }, (res) => { res.resume(); res.on('end', () => ok(res.statusCode ?? 0)); });
      rq.on('error', scheitern);
      rq.flushHeaders();
      senden.push(() => rq.end(text));
    }));
    await new Promise((r) => setTimeout(r, 300));
    for (const s of senden) s();
    const stati = await Promise.all(ergebnisse);
    assert.ok(stati.filter((x) => x === 401).length <= 25, `verzoegerte Koerper: hoechstens 25 kommen bis zum Hash (${stati.filter((x) => x === 401).length})`);
    assert.ok(stati.includes(429), 'der Rest wird gesperrt');
  }

  // N-2 (a): gleichzeitige Fehl-Logins auf EIN Konto, hoechstens 5 bis zum Hash.
  {
    await neuesKonto('Gleichzeitig');
    const r = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      aufruf('POST', '/accounts/login', { username: 'Gleichzeitig', password: `falsch${i}xxxxx` }, undefined, '198.51.100.51')));
    assert.ok(r.filter((x) => x.status === 401).length <= 5, `gleichzeitige Logins: hoechstens 5 bis zum Hash (${r.map((x) => x.status)})`);
    assert.ok(r.some((x) => x.status === 429));
  }

  // N-2 (b): erfolgreiche Logins verbrauchen kein Herkunftsbudget (30 Gast-Logins von einer Adresse).
  for (let n = 0; n < 30; n++) {
    assert.equal((await aufruf('POST', '/accounts/login', { username: 'gast', password: 'gastpasswort1' }, undefined, '198.51.100.52')).status, 200, `Gast-Login ${n}`);
  }

  // N-2 (c): auch Avatar und Melden pruefen das Token nach dem Koerper; (d) die Rettung raeumt nur das eigene Konto.
  {
    const langsam = (pfad: string, koerper: unknown, token: string, ip: string): { fertig: Promise<number>; senden: () => void } => {
      const text = JSON.stringify(koerper);
      const [host, port] = basis.replace('http://', '').split(':');
      let senden: () => void = () => undefined;
      const fertig = new Promise<number>((ok, scheitern) => {
        const rq = httpRequest({
          host, port: Number(port), method: 'POST', path: pfad,
          headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)), 'x-wov-account': token, 'x-forwarded-for': ip },
        }, (res) => { res.resume(); res.on('end', () => ok(res.statusCode ?? 0)); });
        rq.on('error', scheitern);
        rq.flushHeaders();
        senden = () => rq.end(text);
      });
      return { fertig, senden };
    };
    const u = await neuesKonto('Langsam2');
    const ziel = await neuesKonto('Meldeziel');
    const zielChar = await charakter(ziel.token, 'Meldezielr');
    await aufruf('POST', '/accounts/avatar', { characterId: zielChar }, ziel.token);
    await aufruf('POST', '/accounts/profile', { text: 'Anstoessig' }, ziel.token);
    const avatar = langsam('/accounts/avatar', { characterId: null }, u.token, '198.51.100.53');
    const melden = langsam(`/accounts/characters/${zielChar}/report`, { reason: 'x' }, u.token, '198.51.100.53');
    await new Promise((r) => setTimeout(r, 200));
    const rette = await aufruf('POST', '/accounts/login', { username: 'Langsam2', password: 'altespasswort1', logoutOthers: true }, undefined, '198.51.100.54');
    assert.equal(rette.status, 200);
    avatar.senden(); melden.senden();
    assert.deepEqual([await avatar.fertig, await melden.fertig], [401, 401], 'Avatar und Melden nach der Rettung abgewiesen');
    assert.equal(db.profilMeldungenOffen().filter((m) => m.gemeldetKontoId === ziel.kontoId).length, 0, 'keine Meldung geschrieben');

    // (d) zwei Konten von DERSELBEN Adresse gesperrt, Rettung von einem: das andere bleibt gesperrt
    const a2 = await neuesKonto('Haus2a');
    const b2 = await neuesKonto('Haus2b');
    const ip = '198.51.100.60';
    for (const t of [a2.token, b2.token]) {
      for (let n = 0; n < 5; n++) assert.equal((await aufruf('POST', '/accounts/email', { currentPassword: `falsch${n}xxxx`, email: 'h@example.org' }, t, ip)).status, 401);
    }
    const r2 = await aufruf('POST', '/accounts/login', { username: 'Haus2a', password: 'altespasswort1', logoutOthers: true }, undefined, '198.51.100.61');
    assert.equal(r2.status, 200);
    assert.equal((await aufruf('POST', '/accounts/email', { currentPassword: 'altespasswort1', email: 'h@example.org' }, r2.daten.token, ip)).status, 200, 'gerettetes Konto: frei');
    assert.equal((await aufruf('POST', '/accounts/email', { currentPassword: 'altespasswort1', email: 'h@example.org' }, b2.token, ip)).status, 429, 'anderes Konto derselben Adresse bleibt gesperrt');
  }

  console.log('konto-verwaltung: alle Zusicherungen erfuellt');
} finally {
  server.close();
  server.closeAllConnections?.();
  forum.schliessen();
  db.schliessen();
  rmSync(ordner, { recursive: true, force: true });
}
