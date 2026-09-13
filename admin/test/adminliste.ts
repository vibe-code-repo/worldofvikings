/**
 * Betriebsdienst — Adminliste als Notausgang (S6, Roadmap-Karte 0.1,
 * zweiter Weg).
 *
 *   npx tsx test/adminliste.ts      (aus admin/)
 *
 * Gefahren wird der ECHTE Prozess (wie admin/test/betriebsdienst.ts),
 * nicht die importierten Funktionen: Herkunfts-Riegel und Token muessen
 * VOR jeder Adminliste-Aenderung greifen, und das laesst sich nur ueber
 * eine echte Anfrage ehrlich pruefen.
 *
 * Nachweis, den der Auftrag ausdruecklich verlangt:
 *   1. ohne Token → 401, Datei unveraendert
 *   2. mit Token → GET liefert, was auf der Platte steht
 *   3. hinzufuegen (per Name UND per spielerId) → Datei traegt den neuen
 *      Eintrag, Antwort nennt den Neustart-Hinweis
 *   4. entfernen (per Name UND per spielerId) → Eintrag verschwindet
 *      wieder aus der Datei
 *   5. kaputte Eingabe (ungueltige spielerId, leeres Objekt, unbekannter
 *      Name) → 400/404, Datei bleibt unveraendert
 *
 * Dazu die Namenssuche (GET /admin/spieler), ohne die die Route nur mit
 * einer 128-Bit-Zufallszahl bedienbar waere (Auftrag, Punkt 2).
 *
 * ── Warum eine eigene, kleine Kontendatenbank statt Kontendatenbank.ts ──
 * admin/src/main.ts liest die Datei absichtlich MIT ROHEM node:sqlite
 * statt mit der Klasse aus server/src/konto/ (Begruendung: Barrel-Import
 * ueber Identitaet.ts, s. Kommentar bei ADMINS_DATEI in main.ts). Dieser
 * Test haelt sich an dieselbe Abstinenz und legt das Testschema selbst
 * an — es ist ohnehin nur SELECT, das main.ts ausfuehrt, und dieses
 * Schema muss exakt zu `charaktere(name, spieler_id, zuletzt_gespielt)`
 * passen, damit der Test etwas ueber die echte Kopplung aussagt.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { request, type IncomingMessage } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const HIER = dirname(fileURLToPath(import.meta.url));
const ADMIN = resolve(HIER, '..');
const WURZEL = resolve(ADMIN, '..');

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

const ORDNER = mkdtempSync(resolve(tmpdir(), 'wov-adminliste-'));
const WELTEN = resolve(ORDNER, 'server/data/worlds');
const KONTEN = resolve(ORDNER, 'server/data/konten');
const ADMINS_DATEI = resolve(WELTEN, 'admins.dev.json');
const KONTEN_DB = resolve(KONTEN, 'dev.db');
const TOKEN = 'pruef-token-admin-4711';
const TOKEN_DATEI = resolve(ORDNER, 'token');

mkdirSync(WELTEN, { recursive: true });
mkdirSync(KONTEN, { recursive: true });
writeFileSync(TOKEN_DATEI, `${TOKEN}\n`);

// ── Kontendatenbank fuer die Namenssuche ────────────────────────────────
// Zwei Charaktere, damit sich echte Namensaufloesung UND Nicht-Treffer
// pruefen lassen. spieler_id in der echten Form (Identitaet.ts:
// "sp_" + 22 Zeichen Base64url) — main.ts prueft genau dieses Muster.
const ERIK_ID = 'sp_' + 'A'.repeat(22);
const ASTRID_ID = 'sp_' + 'B'.repeat(22);
{
  const db = new DatabaseSync(KONTEN_DB);
  db.exec(`
    CREATE TABLE konten (
      id INTEGER PRIMARY KEY, benutzername TEXT NOT NULL UNIQUE COLLATE NOCASE,
      email TEXT NOT NULL, passwort TEXT NOT NULL, erstellt INTEGER NOT NULL
    );
    CREATE TABLE charaktere (
      id INTEGER PRIMARY KEY,
      konto_id INTEGER NOT NULL,
      spieler_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      erstellt INTEGER NOT NULL,
      zuletzt_gespielt INTEGER
    );
  `);
  db.prepare('INSERT INTO konten (id, benutzername, email, passwort, erstellt) VALUES (1, ?, ?, ?, ?)')
    .run('mike', 'mike@example.invalid', 'x', Date.now());
  db.prepare(
    'INSERT INTO charaktere (id, konto_id, spieler_id, name, erstellt, zuletzt_gespielt) VALUES (?, 1, ?, ?, ?, ?)'
  ).run(1, ERIK_ID, 'Erik', Date.now(), Date.now());
  db.prepare(
    'INSERT INTO charaktere (id, konto_id, spieler_id, name, erstellt, zuletzt_gespielt) VALUES (?, 1, ?, ?, ?, NULL)'
  ).run(2, ASTRID_ID, 'Astrid', Date.now());
  db.close();
}

const admins = (): { spielerId: string; name: string; seit: string }[] =>
  existsSync(ADMINS_DATEI) ? JSON.parse(readFileSync(ADMINS_DATEI, 'utf-8')) : [];
const adminsRoh = (): string => (existsSync(ADMINS_DATEI) ? readFileSync(ADMINS_DATEI, 'utf-8') : '<fehlt>');

function starten(): Promise<{ port: number; kind: ChildProcess }> {
  return new Promise((fertig, scheitern) => {
    const kind = spawn(resolve(WURZEL, 'node_modules/.bin/tsx'), ['src/main.ts'], {
      cwd: ADMIN,
      env: {
        ...process.env,
        WOV_WURZEL: ORDNER,
        WOV_INSTANZ: 'dev',
        WOV_ADMIN_ADRESSE: '127.0.0.1',
        WOV_ADMIN_PORT: '0',
        WOV_ADMIN_TOKEN_DATEI: TOKEN_DATEI,
        WOV_LOG_STROEME_MAX: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let puffer = '';
    const zeitgrenze = setTimeout(() => scheitern(new Error(`Dienst startet nicht:\n${puffer}`)), 30_000);
    kind.stdout.on('data', (s: Buffer) => {
      puffer += s.toString();
      const t = /bereit auf 127\.0\.0\.1:(\d+)/.exec(puffer);
      if (t) {
        clearTimeout(zeitgrenze);
        fertig({ port: Number(t[1]), kind });
      }
    });
    kind.stderr.on('data', (s: Buffer) => (puffer += s.toString()));
    kind.on('exit', (code) => {
      clearTimeout(zeitgrenze);
      scheitern(new Error(`Dienst beendet mit ${code}:\n${puffer}`));
    });
  });
}

type Antwort = { code: number; daten: Record<string, unknown> };

function anfrage(opt: {
  port: number;
  pfad: string;
  methode?: string;
  token?: string | null;
  leib?: string;
}): Promise<Antwort> {
  return new Promise((fertig, scheitern) => {
    const kopf: Record<string, string> = {};
    if (opt.token !== null) kopf['x-wov-token'] = opt.token ?? TOKEN;
    if (opt.leib !== undefined) {
      kopf['content-type'] = 'application/json';
      kopf['content-length'] = String(Buffer.byteLength(opt.leib));
    }
    const req = request(
      { host: '127.0.0.1', port: opt.port, path: opt.pfad, method: opt.methode ?? 'GET', headers: kopf },
      (res: IncomingMessage) => {
        let text = '';
        res.setEncoding('utf-8');
        res.on('data', (s: string) => (text += s));
        res.on('end', () => {
          let daten: Record<string, unknown> = {};
          try {
            daten = JSON.parse(text) as Record<string, unknown>;
          } catch {
            /* kein JSON */
          }
          fertig({ code: res.statusCode ?? 0, daten });
        });
      }
    );
    req.on('error', scheitern);
    if (opt.leib !== undefined) req.write(opt.leib);
    req.end();
  });
}

const { port, kind } = await starten();
console.log(`# Betriebsdienst (Adminliste) auf 127.0.0.1:${port}, Wurzel ${ORDNER}`);

try {
  // 1) Ohne Token: 401, nichts angelegt.
  const ohneToken = await anfrage({ port, pfad: '/admin/liste', token: null });
  check('GET ohne Token → 401', ohneToken.code === 401, `= ${ohneToken.code}`);
  check('ohne Token: keine Datei angelegt', !existsSync(ADMINS_DATEI));

  const ohneTokenPost = await anfrage({
    port, pfad: '/admin/liste', methode: 'POST', token: null, leib: JSON.stringify({ name: 'Erik' }),
  });
  check('POST ohne Token → 401', ohneTokenPost.code === 401, `= ${ohneTokenPost.code}`);
  check('POST ohne Token: keine Datei angelegt', !existsSync(ADMINS_DATEI));

  // 2) Mit Token, leere Liste.
  const leer = await anfrage({ port, pfad: '/admin/liste' });
  check('GET mit Token → 200', leer.code === 200, `= ${leer.code}`);
  check('leere Liste am Anfang', Array.isArray(leer.daten.admins) && (leer.daten.admins as unknown[]).length === 0);
  check('Neustart-Hinweis ist Teil der Antwort', String(leer.daten.hinweis ?? '').includes('Neustart'));

  // 3) Namenssuche — der Weg, wie ein Betreiber ueberhaupt an eine
  //    spielerId kommt (Auftrag, Punkt 2).
  const ohneSuche = await anfrage({ port, pfad: '/admin/spieler' });
  check('GET /admin/spieler ohne Parameter → 400', ohneSuche.code === 400, `= ${ohneSuche.code}`);

  const suche = await anfrage({ port, pfad: '/admin/spieler?suche=eri' });
  check('GET /admin/spieler?suche=eri → 200', suche.code === 200, `= ${suche.code}`);
  const treffer = (suche.daten.treffer ?? []) as { name: string; spielerId: string }[];
  check('Namenssuche findet Erik', treffer.some((t) => t.name === 'Erik' && t.spielerId === ERIK_ID), JSON.stringify(treffer));
  check('Namenssuche findet Astrid NICHT bei "eri"', !treffer.some((t) => t.name === 'Astrid'));

  // 4) Hinzufuegen per Name (Kontendatenbank-Aufloesung).
  const addName = await anfrage({
    port, pfad: '/admin/liste', methode: 'POST', leib: JSON.stringify({ name: 'erik' }), // Gross-/Kleinschreibung frei
  });
  check('POST per Name → 200', addName.code === 200, `= ${addName.code} ${JSON.stringify(addName.daten)}`);
  check('POST per Name: hinzugefuegt', addName.daten.hinzugefuegt === true);
  check('Datei traegt Erik mit der richtigen spielerId', admins().some((e) => e.spielerId === ERIK_ID && e.name === 'Erik'), adminsRoh());
  check('Neustart-Hinweis in der Add-Antwort', String(addName.daten.hinweis ?? '').includes('Neustart'));

  // Erneutes Hinzufuegen desselben Spielers: kein zweiter Eintrag.
  const addNochmal = await anfrage({
    port, pfad: '/admin/liste', methode: 'POST', leib: JSON.stringify({ spielerId: ERIK_ID }),
  });
  check('erneutes POST → 200', addNochmal.code === 200);
  check('erneutes POST: hinzugefuegt=false (war schon Admin)', addNochmal.daten.hinzugefuegt === false);
  check('kein doppelter Eintrag', admins().length === 1, JSON.stringify(admins()));

  // 5) Hinzufuegen per spielerId direkt (der Weg aus `admin liste`-Text).
  const addId = await anfrage({
    port, pfad: '/admin/liste', methode: 'POST', leib: JSON.stringify({ spielerId: ASTRID_ID }),
  });
  check('POST per spielerId → 200', addId.code === 200, `= ${addId.code} ${JSON.stringify(addId.daten)}`);
  check(
    'Name wird aus der Kontendatenbank nachgezogen, wenn keiner mitgeschickt wurde',
    admins().some((e) => e.spielerId === ASTRID_ID && e.name === 'Astrid'),
    adminsRoh()
  );
  check('jetzt zwei Admins', admins().length === 2, adminsRoh());

  // 6) Kaputte Eingaben — die Datei darf sich NICHT veraendern.
  const vorKaputt = adminsRoh();
  const leeresObjekt = await anfrage({ port, pfad: '/admin/liste', methode: 'POST', leib: '{}' });
  check('POST ohne name/spielerId → 400', leeresObjekt.code === 400, `= ${leeresObjekt.code}`);

  const ungueltigeId = await anfrage({
    port, pfad: '/admin/liste', methode: 'POST', leib: JSON.stringify({ spielerId: 'sp_zukurz' }),
  });
  check('POST mit ungueltiger spielerId → 400', ungueltigeId.code === 400, `= ${ungueltigeId.code}`);

  const unbekannterName = await anfrage({
    port, pfad: '/admin/liste', methode: 'POST', leib: JSON.stringify({ name: 'Bjoern-gibt-es-nicht' }),
  });
  check('POST mit unbekanntem Namen → 404', unbekannterName.code === 404, `= ${unbekannterName.code}`);
  check('kaputte Eingaben aendern die Datei nicht', adminsRoh() === vorKaputt);

  // 7) Entfernen per Name.
  const removeName = await anfrage({
    port, pfad: '/admin/liste', methode: 'DELETE', leib: JSON.stringify({ name: 'ERIK' }), // Gross-/Kleinschreibung frei
  });
  check('DELETE per Name → 200', removeName.code === 200, `= ${removeName.code}`);
  check('DELETE per Name: entfernt=true', removeName.daten.entfernt === true);
  check('Erik ist aus der Datei verschwunden', !admins().some((e) => e.spielerId === ERIK_ID), adminsRoh());
  check('Astrid bleibt stehen', admins().some((e) => e.spielerId === ASTRID_ID), adminsRoh());

  // 8) Entfernen per spielerId.
  const removeId = await anfrage({
    port, pfad: '/admin/liste', methode: 'DELETE', leib: JSON.stringify({ spielerId: ASTRID_ID }),
  });
  check('DELETE per spielerId → 200', removeId.code === 200, `= ${removeId.code}`);
  check('Liste ist wieder leer', admins().length === 0, adminsRoh());

  // Entfernen von etwas, das nicht (mehr) in der Liste steht: kein Fehler,
  // nur entfernt=false — dieselbe Ehrlichkeit wie AdminListe.entfernen().
  const removeNochmal = await anfrage({
    port, pfad: '/admin/liste', methode: 'DELETE', leib: JSON.stringify({ spielerId: ASTRID_ID }),
  });
  check('erneutes DELETE → 200, entfernt=false', removeNochmal.code === 200 && removeNochmal.daten.entfernt === false);

  const removeKaputt = await anfrage({
    port, pfad: '/admin/liste', methode: 'DELETE', leib: '{}',
  });
  check('DELETE ohne name/spielerId → 400', removeKaputt.code === 400, `= ${removeKaputt.code}`);
} finally {
  kind.kill('SIGTERM');
  rmSync(ORDNER, { recursive: true, force: true });
}

console.log(fehler === 0 ? '\nAlle Pruefungen gruen.' : `\n${fehler} Pruefung(en) fehlgeschlagen.`);
process.exit(fehler > 0 ? 1 : 0);
