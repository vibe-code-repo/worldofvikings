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
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KontoApi, GELOESCHTER_AUTOR } from '../src/konto/KontoApi.js';
import { Kontendatenbank } from '../src/konto/Kontendatenbank.js';
import { ForumDatabase } from '../src/forum/ForumDatabase.js';
import { geheimnisErzeugen } from '../src/net/Identitaet.js';
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
const api = new KontoApi(
  db, geheimnis, () => ({ spieler: 0, plaetze: 10, tag: 1, welt: 'test' }),
  ['gast'], ['gast', 'admin'],
  {
    forumBereinigen: (a) => { forum.kontoEntfernen(a.kontoId, a.charakterIds, a.namen, GELOESCHTER_AUTOR); },
    weltBereinigen: (k) => { weltAufrufe.push(...k.charaktere.map((c) => c.spielerId)); },
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

  // Sperre: drei Versuche sind verbraucht, zwei weitere gehen noch durch, danach 429 —
  // auch mit dem RICHTIGEN Passwort und von einer anderen Herkunft (Konto-Zaehler).
  const gleichzeitig = await Promise.all(Array.from({ length: 12 }, (_, i) =>
    aufruf('POST', '/accounts/email', { currentPassword: `falsch${i}xxxx`, email: 'x@example.org' }, a.token, '198.51.100.7')));
  const stati = gleichzeitig.map((r) => r.status);
  assert.ok(stati.filter((s) => s === 401).length <= 5, `hoechstens fuenf Versuche kommen bis zum Hashen: ${stati}`);
  assert.ok(stati.includes(429), 'gleichzeitige Versuche laufen in die Sperre');
  const gesperrt = await aufruf('POST', '/accounts/email',
    { currentPassword: 'altespasswort1', email: 'neu@example.org' }, a.token, '198.51.100.99');
  assert.equal(gesperrt.status, 429, 'Kontosperre gilt von jeder Herkunft, auch fuer das richtige Passwort');
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

  console.log('konto-verwaltung: alle Zusicherungen erfuellt');
} finally {
  server.close();
  server.closeAllConnections?.();
  forum.schliessen();
  db.schliessen();
  rmSync(ordner, { recursive: true, force: true });
}
