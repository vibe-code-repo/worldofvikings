/**
 * Das Thing — Waechter ueber die Forum-API: Lesen UND Schreiben (M1/M3).
 *
 * Kein Netz: Ein Fake-Request trifft `ForumApi.behandle` direkt, die
 * Antwort wird abgefangen. `behandle` stösst die Arbeit asynchron an (wie
 * im Betrieb), deshalb wartet der Helfer einen Tick, bevor er die Antwort
 * liest.
 *
 * Geprueft wird:
 *  - der Rueckfall (`false`) fuer fremde Pfade, damit die 426-Gesundheits-
 *    pruefung bleibt,
 *  - Lesen: Bretter, Themenliste, Thema, 404 fuer Unbekanntes, Blaettern,
 *  - Schreiben: 401 ohne Token, 400 bei falschem Charakter/Titel/Text,
 *    201 beim Anlegen, Antwort an ein Thema,
 *  - Eigentum: Bearbeiten/Loeschen NUR am eigenen Beitrag (zweites Konto),
 *  - Drossel nach zu vielen Beitraegen.
 *
 * The Thing's API guard: reads and writes, in-process fakes, no network.
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

/** Konto-Id, die die Anfrage „traegt"; null = nicht angemeldet. */
let angemeldet: number | null = null;
/** Ist das angemeldete Konto Moderator? */
let moderator = false;

/** Drei Konten mit je einem Charakter: 1→3 „Runa", 2→5 „Bjorn", 3→7 „Sigrid". */
const NAMEN: Record<string, string> = { '1:3': 'Runa', '2:5': 'Bjorn', '3:7': 'Sigrid' };

function fakeApi(db: ForumDatabase): ForumApi {
  return new ForumApi(
    db,
    () => angemeldet,
    (kontoId, charakterId) => {
      const name = NAMEN[`${kontoId}:${charakterId}`];
      return name ? { id: charakterId, name } : null;
    },
    () => moderator,
    // `@Name` aufloesen: Charaktername zurueck zum Konto (wie WovServer).
    (name) => {
      const eintrag = Object.entries(NAMEN).find(([, n]) => n === name);
      return eintrag ? Number(eintrag[0].split(':')[0]) : null;
    },
  );
}

async function frage(
  api: ForumApi,
  method: string,
  url: string,
  koerper?: unknown,
): Promise<{ behandelt: boolean; res: FakeAntwort }> {
  const res: FakeAntwort = { status: 0, body: '', headers: {} };
  const fakeRes = {
    setHeader: (k: string, v: string) => { res.headers[k] = v; },
    writeHead: (s: number, h?: Record<string, string>) => {
      res.status = s;
      if (h) for (const [k, v] of Object.entries(h)) res.headers[k] = v;
      return fakeRes;
    },
    end: (t?: string) => { res.body = t ?? ''; },
    headersSent: false,
  };
  const req = {
    method,
    url,
    headers: {},
    [Symbol.asyncIterator]: async function* () {
      if (koerper !== undefined) yield Buffer.from(JSON.stringify(koerper));
    },
  } as unknown as IncomingMessage;
  const behandelt = api.behandle(req, fakeRes as unknown as ServerResponse);
  // Die Arbeit laeuft asynchron (behandle stösst sie an); einen Tick warten.
  await new Promise((r) => setTimeout(r, 0));
  return { behandelt, res };
}

function json(res: FakeAntwort): Record<string, unknown> {
  try {
    return JSON.parse(res.body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  const db = new ForumDatabase(join(dir, 'world.db'));
  const api = fakeApi(db);

  // ── Rueckfall ──────────────────────────────────────────────────────
  check('fremder Pfad ⇒ false (426 bleibt beim Aufrufer)',
    (await frage(api, 'GET', '/accounts/status')).behandelt === false);

  // ── Bretter lesen ──────────────────────────────────────────────────
  const bretter = await frage(api, 'GET', '/forum/boards');
  check('GET /forum/boards ⇒ 200', bretter.res.status === 200);
  check('sechs Bretter', Array.isArray(json(bretter.res).boards)
    && (json(bretter.res).boards as unknown[]).length === BOARD_SLUGS.length);

  // ── Schreiben ohne Token ───────────────────────────────────────────
  angemeldet = null;
  const ohneToken = await frage(api, 'POST', '/forum/boards/mead_hall/threads',
    { title: 'Hallo', body: 'Welt', characterId: 3 });
  check('POST Thema ohne Token ⇒ 401', ohneToken.res.status === 401);

  // ── Angemeldet, aber fremder Charakter ─────────────────────────────
  angemeldet = 1;
  const fremderChar = await frage(api, 'POST', '/forum/boards/mead_hall/threads',
    { title: 'Hallo', body: 'Welt', characterId: 99 });
  check('POST Thema mit fremdem Charakter ⇒ 400', fremderChar.res.status === 400);

  const kurz = await frage(api, 'POST', '/forum/boards/mead_hall/threads',
    { title: 'A', body: 'Text', characterId: 3 });
  check('zu kurzer Titel ⇒ 400', kurz.res.status === 400);
  const leer = await frage(api, 'POST', '/forum/boards/mead_hall/threads',
    { title: 'Ein Titel', body: '   ', characterId: 3 });
  check('leerer Text ⇒ 400', leer.res.status === 400);

  // ── Gueltiges Thema (Konto 1 / Runa) ───────────────────────────────
  const angelegt = await frage(api, 'POST', '/forum/boards/mead_hall/threads',
    { title: 'Erster Axtkauf', body: '**Wo** kauft man Aexte?', characterId: 3 });
  check('POST gueltiges Thema ⇒ 201', angelegt.res.status === 201);
  const threadId = Number(json(angelegt.res).threadId);
  check('Antwort nennt die Thread-Id', Number.isInteger(threadId) && threadId > 0);

  const liste = await frage(api, 'GET', '/forum/boards/mead_hall/threads');
  const themen = json(liste.res).threads as Array<Record<string, unknown>>;
  check('Thema steht in der Liste', themen.length === 1 && themen[0]!.authorName === 'Runa');

  // ── Antwort von Konto 2 / Bjorn ────────────────────────────────────
  angemeldet = 2;
  const antwort = await frage(api, 'POST', `/forum/threads/${threadId}/posts`,
    { body: 'Beim Schmied.', characterId: 5 });
  check('POST Antwort ⇒ 201', antwort.res.status === 201);

  const thema = await frage(api, 'GET', `/forum/threads/${threadId}`);
  const posts = json(thema.res).posts as Array<Record<string, unknown>>;
  check('Thema hat zwei Beitraege', posts.length === 2);
  const ersterPost = Number(posts[0]!.id); // Runa
  const zweiterPost = Number(posts[1]!.id); // Bjorn

  // ── Eigentum: Konto 1 darf Bjorns Beitrag nicht anfassen ───────────
  angemeldet = 1;
  const fremdPatch = await frage(api, 'PATCH', `/forum/posts/${zweiterPost}`,
    { body: 'geaendert', characterId: 3 });
  check('PATCH auf einen fremden Beitrag ⇒ 403', fremdPatch.res.status === 403);
  const fremdWeg = await frage(api, 'DELETE', `/forum/posts/${zweiterPost}`);
  check('DELETE auf einen fremden Beitrag ⇒ 403', fremdWeg.res.status === 403);

  // ── Eigenen Beitrag bearbeiten und loeschen ────────────────────────
  const eigen = await frage(api, 'PATCH', `/forum/posts/${ersterPost}`,
    { body: 'Korrigiert.', characterId: 3 });
  check('PATCH auf den eigenen Beitrag ⇒ 200', eigen.res.status === 200);
  const nachEdit = await frage(api, 'GET', `/forum/threads/${threadId}`);
  const p0 = (json(nachEdit.res).posts as Array<Record<string, unknown>>)[0]!;
  check('Bearbeiten setzt Text und edited_at', p0.bodyMd === 'Korrigiert.' && p0.editedAt !== null);

  const eigenWeg = await frage(api, 'DELETE', `/forum/posts/${ersterPost}`);
  check('DELETE auf den eigenen Beitrag ⇒ 200', eigenWeg.res.status === 200);
  const nachWeg = await frage(api, 'GET', `/forum/threads/${threadId}`);
  const p0weg = (json(nachWeg.res).posts as Array<Record<string, unknown>>)[0]!;
  check('geloeschter Beitrag bleibt als Platzhalter stehen',
    p0weg.deletedAt !== null && p0weg.bodyMd === 'Korrigiert.');

  // ── Drossel: nach fuenf Beitraegen ist Schluss (Konto 1) ───────────
  let letzterStatus = 0;
  for (let i = 0; i < 7; i++) {
    const r = await frage(api, 'POST', `/forum/threads/${threadId}/posts`,
      { body: `Antwort ${i}`, characterId: 3 });
    letzterStatus = r.res.status;
  }
  check('Drossel greift (429 nach zu vielen Beitraegen)', letzterStatus === 429);

  // ── Rand ───────────────────────────────────────────────────────────
  const seiteWeit = await frage(api, 'GET', `/forum/threads/${threadId}?page=999`);
  check('Seite 999 wird geklemmt, nicht 404', seiteWeit.res.status === 200);
  const unbekannt = await frage(api, 'GET', '/forum/boards/gibt-es-nicht/threads');
  check('unbekanntes Brett ⇒ 404', unbekannt.res.status === 404);

  // ── Reaktionen (M6) ────────────────────────────────────────────────
  // Ein eigenes Thema, damit die Sperr-/Loeschfaelle unten es nicht beruehren.
  angemeldet = 2;
  const rt = await frage(api, 'POST', '/forum/boards/clans/threads',
    { title: 'Reaktionen', body: 'Probe', characterId: 5 });
  check('Reaktionsthema angelegt ⇒ 201', rt.res.status === 201);
  const rThread = Number(json(rt.res).threadId);
  const rPost = Number(json(rt.res).postId);

  angemeldet = null;
  check('Reaktion ohne Token ⇒ 401',
    (await frage(api, 'POST', `/forum/posts/${rPost}/reactions`, { kind: 'hail' })).res.status === 401);

  angemeldet = 1;
  check('unbekannte Reaktion ⇒ 400',
    (await frage(api, 'POST', `/forum/posts/${rPost}/reactions`, { kind: 'quatsch' })).res.status === 400);

  const hail1 = json((await frage(api, 'POST', `/forum/posts/${rPost}/reactions`, { kind: 'hail' })).res);
  check('Reaktion setzen ⇒ count 1, me true', hail1.count === 1 && hail1.me === true);

  const mitMe = (json((await frage(api, 'GET', `/forum/threads/${rThread}`)).res)
    .posts as Array<Record<string, unknown>>)[0]!;
  check('eigene Reaktion kommt im Thema als me mit',
    (mitMe.reactions as Array<Record<string, unknown>>)
      .some((r) => r.kind === 'hail' && r.count === 1 && r.me === true));

  angemeldet = 2;
  const hail2 = json((await frage(api, 'POST', `/forum/posts/${rPost}/reactions`, { kind: 'hail' })).res);
  check('zweites Konto zaehlt hoch ⇒ count 2', hail2.count === 2 && hail2.me === true);

  angemeldet = null;
  const gastSicht = (json((await frage(api, 'GET', `/forum/threads/${rThread}`)).res)
    .posts as Array<Record<string, unknown>>)[0]!;
  check('Gast sieht die Zahl, aber kein me',
    (gastSicht.reactions as Array<Record<string, unknown>>)
      .some((r) => r.kind === 'hail' && r.count === 2 && r.me === false));

  angemeldet = 1;
  const zurueck = json((await frage(api, 'POST', `/forum/posts/${rPost}/reactions`, { kind: 'hail' })).res);
  check('nochmal klicken nimmt zurueck ⇒ count 1, me false',
    zurueck.count === 1 && zurueck.me === false);

  const themenStand = json((await frage(api, 'GET', `/forum/threads/${rThread}/reactions`)).res)
    .reactions as Array<Record<string, unknown>>;
  check('Themenstand bringt die Reaktion des Fragenden',
    themenStand.some((r) => r.postId === rPost && r.kind === 'hail' && r.me === false && r.count === 1));

  angemeldet = 2;
  check('eigenen Beitrag entfernen ⇒ 200',
    (await frage(api, 'DELETE', `/forum/posts/${rPost}`)).res.status === 200);
  angemeldet = 1;
  check('geloeschter Beitrag nimmt keine Reaktion mehr ⇒ 409',
    (await frage(api, 'POST', `/forum/posts/${rPost}/reactions`, { kind: 'hail' })).res.status === 409);

  // ── Suche (M6) ─────────────────────────────────────────────────────
  angemeldet = 2;
  const st = await frage(api, 'POST', '/forum/boards/voyages/threads',
    { title: 'Langschiff', body: 'Wir suchen den Schmied von Haithabu.', characterId: 5 });
  check('Suchthema angelegt ⇒ 201', st.res.status === 201);
  const sThread = Number(json(st.res).threadId);
  const sPost = Number(json(st.res).postId);

  const fund = json((await frage(api, 'GET', '/forum/search?q=Haithabu')).res);
  const treffer = fund.results as Array<Record<string, unknown>>;
  check('Suche findet den Beitrag',
    treffer.length === 1 && treffer[0]!.threadId === sThread && treffer[0]!.authorName === 'Bjorn');
  check('Treffer nennt Thema, Brett und Ausschnitt',
    treffer[0]!.title === 'Langschiff' && treffer[0]!.board === 'voyages'
      && String(treffer[0]!.snippet).includes('Haithabu'));

  const praefix = json((await frage(api, 'GET', '/forum/search?q=schmie')).res)
    .results as Array<Record<string, unknown>>;
  // „Beim Schmied." aus dem ersten Thema ist hier noch vorhanden — gesucht
  // wird der Praefix, also muss der neue Beitrag DARUNTER sein.
  check('Praefix findet „Schmied"', praefix.some((h) => h.threadId === sThread));

  const nichts = json((await frage(api, 'GET', '/forum/search?q=GibtEsNicht')).res).results as unknown[];
  check('kein Treffer ⇒ leere Liste', nichts.length === 0);

  const leereSuche = json((await frage(api, 'GET', '/forum/search?q=')).res);
  check('leere Anfrage ⇒ leere Liste, Seite 1',
    (leereSuche.results as unknown[]).length === 0 && leereSuche.page === 1);

  const stoerend = await frage(api, 'GET', `/forum/search?q=${encodeURIComponent('" - *')}`);
  check('FTS-Sonderzeichen zerlegen die Abfrage nicht ⇒ 200', stoerend.res.status === 200);

  angemeldet = 2;
  await frage(api, 'DELETE', `/forum/posts/${sPost}`);
  const nachSuchWeg = json((await frage(api, 'GET', '/forum/search?q=Haithabu')).res).results as unknown[];
  check('geloeschter Beitrag faellt aus der Suche', nachSuchWeg.length === 0);

  // ── Erwaehnungen, Abos, Benachrichtigungen (M6) ────────────────────
  angemeldet = 1;
  const nt = await frage(api, 'POST', '/forum/boards/steadings/threads',
    { title: 'Frage an alle', body: 'Wer kennt @Sigrid?', characterId: 3 });
  check('Thema mit Erwaehnung angelegt ⇒ 201', nt.res.status === 201);
  const nThread = Number(json(nt.res).threadId);

  angemeldet = 3;
  const sigridErste = json((await frage(api, 'GET', '/forum/notifications')).res);
  check('Erwaehnte bekommt eine Meldung (mention)',
    (sigridErste.notifications as Array<Record<string, unknown>>)
      .some((n) => n.kind === 'mention' && n.fromName === 'Runa'));
  check('ungelesen zaehlt mit', sigridErste.unread === 1);

  angemeldet = 1;
  check('Eroeffner folgt sich selbst',
    json((await frage(api, 'GET', `/forum/threads/${nThread}/subscribe`)).res).subscribed === true);

  angemeldet = 2;
  await frage(api, 'POST', `/forum/threads/${nThread}/posts`, { body: 'Ich kenne sie.', characterId: 5 });
  angemeldet = 1;
  const runaNotif = json((await frage(api, 'GET', '/forum/notifications')).res);
  check('Abonnent bekommt eine Antwort-Meldung (reply)',
    (runaNotif.notifications as Array<Record<string, unknown>>)
      .some((n) => n.kind === 'reply' && n.fromName === 'Bjorn'));

  // Runa liest ihre Meldungen, damit der naechste Zaehler eindeutig ist.
  await frage(api, 'POST', '/forum/notifications/read', {});

  angemeldet = 2;
  await frage(api, 'POST', '/forum/notifications/read', {});
  check('alles gelesen ⇒ unread 0',
    json((await frage(api, 'GET', '/forum/notifications')).res).unread === 0);

  // Abbestellen: Konto 2 will nichts mehr hoeren.
  check('Abbestellen ⇒ subscribed false',
    json((await frage(api, 'POST', `/forum/threads/${nThread}/subscribe`, { value: false })).res)
      .subscribed === false);
  const bjornVorher = (json((await frage(api, 'GET', '/forum/notifications')).res)
    .notifications as unknown[]).length;

  angemeldet = 3;
  await frage(api, 'POST', `/forum/threads/${nThread}/posts`, { body: 'Ein Nachtrag.', characterId: 7 });
  angemeldet = 2;
  const bjornNach = (json((await frage(api, 'GET', '/forum/notifications')).res)
    .notifications as unknown[]).length;
  check('Abbestellter bekommt nichts Neues', bjornNach === bjornVorher);
  angemeldet = 1;
  check('Abonnent bekommt die naechste Antwort (unread 1)',
    json((await frage(api, 'GET', '/forum/notifications')).res).unread === 1);

  // Erwaehnung eines Abonnenten: nur EINE Meldung, keine zweite.
  // Konto 2 schreibt (folgt nicht mehr), erwaehnt Sigrid — die folgt, also
  // bekommt sie die Antwort und NICHT zusaetzlich die Erwaehnung.
  angemeldet = 2;
  await frage(api, 'POST', `/forum/threads/${nThread}/posts`, { body: 'Danke @Sigrid.', characterId: 5 });
  angemeldet = 3;
  const sigridNach = json((await frage(api, 'GET', '/forum/notifications')).res)
    .notifications as Array<Record<string, unknown>>;
  check('erwaehnter Abonnent bekommt keine zweite Meldung',
    sigridNach.filter((n) => n.kind === 'mention').length === 1
      && sigridNach.filter((n) => n.kind === 'reply').length === 1);

  // ── Oeffentliches Profil (M6) ──────────────────────────────────────
  const profil = json((await frage(api, 'GET', '/forum/characters/3/activity')).res);
  check('Profil listet die Eroeffnungen des Charakters',
    (profil.threads as Array<Record<string, unknown>>)
      .some((t) => t.authorName === 'Runa' && t.authorCharacterId === 3));
  check('Profil listet nur lebende eigene Beitraege',
    (profil.posts as Array<Record<string, unknown>>)
      .every((p) => p.authorName === 'Runa' && p.deletedAt === null));

  const fremd = json((await frage(api, 'GET', '/forum/characters/999/activity')).res);
  check('unbekannter Charakter ⇒ leere Listen, kein 404',
    (fremd.threads as unknown[]).length === 0 && (fremd.posts as unknown[]).length === 0);

  // ── Moderation (M5) ────────────────────────────────────────────────
  angemeldet = 1;
  moderator = false;
  check('GET /forum/moderator ⇒ false fuer Nicht-Moderator',
    (json((await frage(api, 'GET', '/forum/moderator')).res).moderator) === false);
  check('GET /forum/reports ohne Moderator ⇒ 403',
    (await frage(api, 'GET', '/forum/reports')).res.status === 403);
  check('Anheften ohne Moderator ⇒ 403',
    (await frage(api, 'POST', `/forum/threads/${threadId}/pin`, { value: true })).res.status === 403);

  const gemeldet = await frage(api, 'POST', `/forum/posts/${zweiterPost}/report`, { reason: 'Beleidigung' });
  check('Beitrag melden ⇒ 201', gemeldet.res.status === 201);

  moderator = true;
  check('GET /forum/moderator ⇒ true fuer Moderator',
    (json((await frage(api, 'GET', '/forum/moderator')).res).moderator) === true);

  const meldungen = json((await frage(api, 'GET', '/forum/reports')).res).reports as Array<Record<string, unknown>>;
  check('offene Meldung erscheint mit Autor und Grund',
    Array.isArray(meldungen) && meldungen.length === 1
      && meldungen[0]!.authorName === 'Bjorn' && meldungen[0]!.grund === 'Beleidigung');
  check('Meldung erledigen ⇒ 200',
    (await frage(api, 'POST', `/forum/reports/${meldungen[0]!.id}/resolve`)).res.status === 200);
  check('erledigte Meldung faellt aus der Liste',
    (json((await frage(api, 'GET', '/forum/reports')).res).reports as unknown[]).length === 0);

  check('Moderator heftet an ⇒ 200',
    (await frage(api, 'POST', `/forum/threads/${threadId}/pin`, { value: true })).res.status === 200);
  const nachPin = json((await frage(api, 'GET', `/forum/threads/${threadId}`)).res).thread as { pinned?: boolean };
  check('Thema ist angeheftet', nachPin?.pinned === true);

  check('Moderator sperrt ⇒ 200',
    (await frage(api, 'POST', `/forum/threads/${threadId}/lock`, { value: true })).res.status === 200);
  angemeldet = 1;
  check('Antwort auf gesperrtes Thema ⇒ 409',
    (await frage(api, 'POST', `/forum/threads/${threadId}/posts`, { body: 'x', characterId: 3 })).res.status === 409);

  check('Moderator verschiebt ⇒ 200',
    (await frage(api, 'POST', `/forum/threads/${threadId}/move`, { board: 'forge' })).res.status === 200);
  const forgeListe = json((await frage(api, 'GET', '/forum/boards/forge/threads')).res).threads as Array<Record<string, unknown>>;
  check('Thema steht jetzt im Zielbrett', forgeListe.some((t) => t.id === threadId));

  check('Moderator loescht einen fremden Beitrag ⇒ 200',
    (await frage(api, 'DELETE', `/forum/posts/${zweiterPost}`)).res.status === 200);

  db.schliessen();
}

try {
  await main();
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (fehler > 0) {
  console.error(`\nForum-API: ${fehler} Pruefung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('\nForum-API: alles gruen.');
