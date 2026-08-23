/**
 * Betriebsdienst — Testwelt-Umschalter, Einstellungs-Endpunkte,
 * Instanz-Fehlerpfad (G4).
 *
 * admin/test/betriebsdienst.ts deckt bereits ab: Token-Pruefung von
 * /api/worldlayout (A13, ohne Token → 401, fremde Herkunft → 403),
 * kaputtes/unlesbares JSON → 400, gueltiges Dokument → 200 mit Sicherung
 * und Rotation, GET, Server-Konsole (Obergrenze + Aufraeumen), unbekannte
 * /api/-Pfade → 404, falsche Methode → 405, fehlende Weltdatei → 404.
 * Dieser Test ERGAENZT nur, was dort fehlt:
 *
 *  1. Unbekannte WOV_INSTANZ: instanzName() bricht beim Start hart ab
 *     (shared/src/instanz.ts) — kein HTTP-Fehler, sondern ein Prozess,
 *     der gar nicht erst hochkommt. Ueber den ECHTEN Prozessstart
 *     geprueft, kein Aufruf der reinen Funktion.
 *  2. GET /status.
 *  3. GET/PUT /einstellungen/server (server.yml) — Feldvalidierung,
 *     unbekanntes Feld, Sicherung, tatsaechlich geschriebener Wert.
 *  4. GET /einstellungen/auslieferung (nur LESEN, s. Begruendung unten).
 *  5. Der Testwelt-Umschalter GET/POST /api/testwelt — die
 *     ENTSCHEIDUNGSLOGIK vor dem echten Dienstwechsel (ungueltige
 *     aktion, Konfliktzustaende), s. Begruendung unten zum bewusst
 *     ausgelassenen Erfolgspfad.
 *
 * ── Warum hier NICHT getestet wird: POST /api/testwelt (Erfolgspfad),
 *    POST /dienst, PUT /einstellungen/auslieferung ─────────────────────
 * Alle drei rufen echtes `systemctl`/`nginx` auf ECHTEN Systemzielen auf,
 * die NICHT ueber WOV_WURZEL umleitbar sind:
 *
 *  - POST /api/testwelt (aktion="starten"/"zurueck", ohne Konflikt) ruft
 *    nach den beiden fruehen 409-Weichen unbedingt
 *    `ausfuehren('systemctl', ['stop', 'wov-server'])` und danach
 *    `['start', 'wov-server']` auf (admin/src/main.ts, im testwelt-POST-
 *    Zweig) — der dienstname ist FEST verdrahtet, nicht aus WOV_WURZEL
 *    abgeleitet. Ein Testlauf wuerde den ECHTEN laufenden Spielserver
 *    stoppen und neu starten, obwohl er nur mit einer Wegwerf-Weltdatei
 *    unter WOV_WURZEL arbeitet. Verboten laut Auftrag ("Dienste ... NICHT
 *    neu starten"). Getestet wird deshalb nur die Entscheidungslogik VOR
 *    diesen Aufrufen (Zeile fuer Zeile vor `ausfuehren('systemctl', ...)`
 *    im Quelltext) — die beiden 409-Konfliktantworten kehren nachweislich
 *    zurueck, BEVOR systemctl ueberhaupt aufgerufen wird.
 *  - POST /dienst fuehrt IMMER `systemctl <aktion> <dienst>` fuer
 *    wov-server/nginx aus, sobald dienst+aktion aus der Positivliste
 *    stammen — hier gibt es keinen Weg, den echten Dienst NICHT
 *    anzufassen, ausser die beiden 400-Validierungen VOR dem Aufruf zu
 *    pruefen (unbekannter Dienst, unbekannte Aktion).
 *  - PUT /einstellungen/auslieferung schreibt in NGINX_SITE
 *    ('/etc/nginx/sites-available/wov', admin/src/main.ts — HART
 *    verdrahtet, NICHT ueber WOV_WURZEL umleitbar, anders als
 *    SERVER_YML/LAYOUT_DATEI/WELTEN_ORDNER) und ruft danach `nginx -t`
 *    plus `systemctl reload nginx` auf der echten Maschine auf. Ein
 *    Testlauf wuerde also - egal was im Body steht - die echte
 *    Auslieferungskonfiguration anfassen. GET liest dieselbe Datei nur
 *    (kein Schreibzugriff) und ist deshalb unbedenklich und Teil dieses
 *    Tests.
 *
 * Alle uebrigen Endpunkte in diesem Test lesen/schreiben ausschliesslich
 * unter einem WOV_WURZEL-Wegwerfverzeichnis (server.yml-Fixtur, eigener
 * WELTEN_ORDNER) — genau das Muster aus betriebsdienst.ts.
 *
 * ── Unerwarteter Befund (Punkt 3, kein Bestandteil der Pruefliste) ────
 * PUT /einstellungen/server liefert bei UNGUELTIGEM WERT (falscher Typ,
 * Zahl ausserhalb der Grenzen) HTTP 500, nicht 400. Der Sammel-catch am
 * Ende von admin/src/main.ts stuft nur `LayoutUngueltig`/`SyntaxError`
 * als 400 (Eingabefehler) ein — `wertPruefen()` wirft aber einen
 * gewoehnlichen `Error` (s. Kopfkommentar bei wertPruefen, admin/src/
 * main.ts). Ein falsch getippter Wert im Editor-Einstellungsformular
 * erscheint dem Aufrufer damit als "Serverfehler" statt als
 * Eingabefehler — die Textmeldung selbst ist zwar korrekt und
 * verstaendlich, aber Statuscode und Loggzeile ("[Admin] Fehler:" statt
 * "-> 400:") fuehren in die falsche Richtung. Punkt 6 unten haelt das
 * fest.
 *
 * Run: npx tsx test/testwelt-einstellungen.ts   (aus admin/)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { request, type IncomingMessage } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const ADMIN = resolve(HIER, '..');
const WURZEL_PROJEKT = resolve(ADMIN, '..');

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

const warte = (ms: number): Promise<void> => new Promise((f) => setTimeout(f, ms));

// ── Testwurzel mit eigener server.yml-Fixtur ────────────────────────────
//
// Deckt exakt die neun Felder aus FELDER (admin/src/main.ts) ab, im
// selben zweispaltig eingerueckten Format wie das echte server/data/
// server.yml — ymlLesen()/ymlSchreiben() sind absichtlich ZEILENWEISE
// und nicht ueber einen YAML-Parser gebaut (s. Kopfkommentar dort), die
// Fixtur muss also genau dieses Format treffen.
const SERVER_YML_INHALT = `# Testfixtur — s. admin/test/testwelt-einstellungen.ts
server:
  name: Testserver
  password: ""

players:
  max: 10
  everyone-admin: true

world:
  save-interval: 30min
  creatures: true
  vegetation: true
  features: false

dungeons:
  enabled: true
`;

const ORDNER = mkdtempSync(resolve(tmpdir(), 'wov-einstellungen-'));
const WELTEN = resolve(ORDNER, 'server/data/welten');
const WORLDS = resolve(ORDNER, 'server/data/worlds');
const SERVER_YML = resolve(ORDNER, 'server/data/server.yml');
const TOKEN = 'pruef-token-8123';
const TOKEN_DATEI = resolve(ORDNER, 'token');

mkdirSync(WELTEN, { recursive: true });
mkdirSync(WORLDS, { recursive: true });
writeFileSync(TOKEN_DATEI, `${TOKEN}\n`);
writeFileSync(SERVER_YML, SERVER_YML_INHALT);

const aufDerPlatteYml = (): string => readFileSync(SERVER_YML, 'utf-8');

// ── Dienst starten (Muster admin/test/betriebsdienst.ts) ────────────────

function starten(instanz = 'dev'): Promise<{ port: number; kind: ChildProcess }> {
  return new Promise((fertig, scheitern) => {
    const kind = spawn(resolve(WURZEL_PROJEKT, 'node_modules/.bin/tsx'), ['src/main.ts'], {
      cwd: ADMIN,
      env: {
        ...process.env,
        WOV_WURZEL: ORDNER,
        WOV_INSTANZ: instanz,
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
    kind.stderr.on('data', (s: Buffer) => {
      puffer += s.toString();
    });
    kind.on('exit', (code) => {
      clearTimeout(zeitgrenze);
      scheitern(new Error(`Dienst beendet mit ${code}:\n${puffer}`));
    });
  });
}

type Antwort = { code: number; daten: Record<string, unknown> };

function anfrage(opt: { port: number; pfad: string; methode?: string; leib?: string }): Promise<Antwort> {
  return new Promise((fertig, scheitern) => {
    const kopf: Record<string, string> = { 'x-wov-token': TOKEN };
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

// ── [1] Unbekannte WOV_INSTANZ ───────────────────────────────────────────

async function testUnbekannteInstanz(): Promise<void> {
  console.log('\n[1] Unbekannte WOV_INSTANZ — Prozess kommt gar nicht erst hoch:');
  try {
    await starten('quatsch');
    check('Prozess startet NICHT mit unbekannter Instanz', false, '— ist aber gestartet');
  } catch (e) {
    const meldung = (e as Error).message;
    check(
      'Prozess bricht ab statt "bereit auf" zu melden',
      meldung.includes('beendet mit') && !meldung.includes('bereit auf'),
      meldung.slice(0, 200)
    );
    check(
      'Fehlermeldung nennt den falschen Instanzwert',
      meldung.includes('quatsch') && meldung.includes('WOV_INSTANZ'),
      meldung.slice(0, 300)
    );
  }
}

// ── Hauptlauf ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await testUnbekannteInstanz();

  const { port, kind } = await starten('dev');
  console.log(`\n# Betriebsdienst auf 127.0.0.1:${port}, Wurzel ${ORDNER}`);

  try {
    // ── [2] GET /status ────────────────────────────────────────────
    console.log('\n[2] GET /status:');
    const status = await anfrage({ port, pfad: '/status' });
    check('GET /status → 200', status.code === 200, `= ${status.code}`);
    check('nennt die Instanz', status.daten.instanz === 'dev', JSON.stringify(status.daten.instanz));
    const dienste = status.daten.dienste as Record<string, { aktiv: boolean; seit: string | null }> | undefined;
    check(
      'dienste.wov-server hat die erwartete Form (nur GELESEN, s. Kopfkommentar)',
      typeof dienste?.['wov-server']?.aktiv === 'boolean'
    );
    const welt = status.daten.welt as { saves: unknown[]; layoutBytes: number } | undefined;
    check('welt.saves ist ein Array (leer, WORLDS-Fixtur ist noch leer)', Array.isArray(welt?.saves) && welt.saves.length === 0);

    // ── [3] GET/PUT /einstellungen/server ──────────────────────────
    console.log('\n[3] GET/PUT /einstellungen/server:');
    const gelesen1 = await anfrage({ port, pfad: '/einstellungen/server' });
    check('GET → 200', gelesen1.code === 200, `= ${gelesen1.code}`);
    const felder1 = gelesen1.daten.felder as Record<string, { wert: string }> | undefined;
    check(
      'liest den Fixturwert von server.name',
      felder1?.['server.name']?.wert === 'Testserver',
      JSON.stringify(felder1?.['server.name'])
    );
    check(
      'liest den Fixturwert von players.max',
      felder1?.['players.max']?.wert === '10',
      JSON.stringify(felder1?.['players.max'])
    );
    check('alle neun FELDER-Eintraege sind vorhanden', felder1 !== undefined && Object.keys(felder1).length === 9);

    // Unbekanntes Feld → 400, Datei unveraendert.
    const vorUnbekannt = aufDerPlatteYml();
    const unbekannt = await anfrage({
      port,
      pfad: '/einstellungen/server',
      methode: 'PUT',
      leib: JSON.stringify({ 'server.erfunden': 'x' }),
    });
    check('unbekanntes Feld → 400', unbekannt.code === 400, `= ${unbekannt.code} ${JSON.stringify(unbekannt.daten)}`);
    check('unbekanntes Feld: server.yml unveraendert', aufDerPlatteYml() === vorUnbekannt);

    // Gueltige Aenderung → 200, tatsaechlich geschrieben, Sicherung entstanden.
    const vorGueltig = aufDerPlatteYml();
    const gueltig = await anfrage({
      port,
      pfad: '/einstellungen/server',
      methode: 'PUT',
      leib: JSON.stringify({ 'server.name': 'Geänderter Name', 'players.max': 25, 'world.creatures': false }),
    });
    check('gueltige Aenderung → 200', gueltig.code === 200, `= ${gueltig.code} ${JSON.stringify(gueltig.daten)}`);
    check(
      'Antwort nennt alle drei geaenderten Felder',
      Array.isArray(gueltig.daten.geaendert) &&
        (gueltig.daten.geaendert as string[]).sort().join(',') === 'players.max,server.name,world.creatures'
    );
    check('server.yml tatsaechlich geaendert (Datei ist NICHT mehr wie vorher)', aufDerPlatteYml() !== vorGueltig);
    const gelesen2 = await anfrage({ port, pfad: '/einstellungen/server' });
    const felder2 = gelesen2.daten.felder as Record<string, { wert: string }> | undefined;
    check('GET zeigt den neuen Namen', felder2?.['server.name']?.wert === 'Geänderter Name', JSON.stringify(felder2?.['server.name']));
    check('GET zeigt players.max=25', felder2?.['players.max']?.wert === '25', JSON.stringify(felder2?.['players.max']));
    check('GET zeigt world.creatures=false', felder2?.['world.creatures']?.wert === 'false', JSON.stringify(felder2?.['world.creatures']));
    check(
      'unveraenderte Felder (z. B. players.everyone-admin) blieben stehen',
      felder2?.['players.everyone-admin']?.wert === 'true'
    );
    const sicherungenYml = readdirSync(dirname(SERVER_YML)).filter((f) => f.startsWith('server.yml.') && f.endsWith('.bak'));
    check('eine .bak von server.yml entstand', sicherungenYml.length === 1, `= ${sicherungenYml.length}`);

    // ── [6] BEFUND: ungueltiger Wert → 500 statt 400 ────────────────
    console.log('\n[6] BEFUND — ungueltiger Wert liefert 500, nicht 400:');
    const vorUngueltig = aufDerPlatteYml();
    const ungueltig = await anfrage({
      port,
      pfad: '/einstellungen/server',
      methode: 'PUT',
      leib: JSON.stringify({ 'players.max': 'viele' }),
    });
    check(
      'BEFUND: ungueltiger Zahlenwert liefert HEUTE 500 (Sammel-catch stuft nur LayoutUngueltig/SyntaxError als 400 ein, s. Kopfkommentar)',
      ungueltig.code === 500,
      `= ${ungueltig.code} ${JSON.stringify(ungueltig.daten)}`
    );
    check('die Fehlermeldung selbst nennt trotzdem das richtige Feld', String(ungueltig.daten.fehler ?? '').includes('players.max'));
    check('server.yml bleibt bei ungueltigem Wert unveraendert (kein Halbschreiben)', aufDerPlatteYml() === vorUngueltig);
    const ungueltigerBool = await anfrage({
      port,
      pfad: '/einstellungen/server',
      methode: 'PUT',
      leib: JSON.stringify({ 'players.everyone-admin': 'ja' }),
    });
    check(
      'BEFUND: falscher Typ (String statt Bool) liefert ebenfalls 500',
      ungueltigerBool.code === 500,
      `= ${ungueltigerBool.code}`
    );
    check('server.yml bleibt auch hier unveraendert', aufDerPlatteYml() === vorUngueltig);

    // ── [4] GET /einstellungen/auslieferung (nur lesen) ─────────────
    console.log('\n[4] GET /einstellungen/auslieferung (liest die ECHTE Datei, schreibt nichts):');
    const nginx = await anfrage({ port, pfad: '/einstellungen/auslieferung' });
    check('GET → 200 (auch wenn die Datei auf diesem Rechner fehlt — dann leere felder)', nginx.code === 200, `= ${nginx.code}`);
    check('Antwort traegt ein felder-Objekt', typeof nginx.daten.felder === 'object' && nginx.daten.felder !== null);

    // ── [5] /api/testwelt — nur die Entscheidungslogik ──────────────
    console.log('\n[5] /api/testwelt — GET und die Konflikt-/Validierungspfade VOR systemctl:');
    const testweltGet1 = await anfrage({ port, pfad: '/api/testwelt' });
    check('GET → 200', testweltGet1.code === 200, `= ${testweltGet1.code}`);
    check('aktiv=false ohne .beiseite-Datei', testweltGet1.daten.aktiv === false);
    check('weltVorhanden=false (WORLDS-Fixtur ist leer)', testweltGet1.daten.weltVorhanden === false);
    check('instanz=dev', testweltGet1.daten.instanz === 'dev');

    const testweltUngueltig = await anfrage({
      port,
      pfad: '/api/testwelt',
      methode: 'POST',
      leib: JSON.stringify({ aktion: 'explodieren' }),
    });
    check(
      'unbekannte aktion → 400 (kehrt zurueck, BEVOR systemctl aufgerufen wird)',
      testweltUngueltig.code === 400,
      `= ${testweltUngueltig.code}`
    );

    const testweltZurueckOhneAktiv = await anfrage({
      port,
      pfad: '/api/testwelt',
      methode: 'POST',
      leib: JSON.stringify({ aktion: 'zurueck' }),
    });
    check(
      'aktion="zurueck" ohne aktive Testwelt → 409 (kehrt VOR systemctl zurueck)',
      testweltZurueckOhneAktiv.code === 409,
      `= ${testweltZurueckOhneAktiv.code} ${JSON.stringify(testweltZurueckOhneAktiv.daten)}`
    );

    // Konfliktfall "starten waehrend schon aktiv": ein .beiseite-Marker
    // reicht der Weiche im Quelltext (existsSync(beiseite)) — der
    // dahinterliegende `sichern()`/systemctl-Zweig wird dabei NICHT
    // erreicht (die 409-Antwort liegt textuell VOR dem ersten
    // `ausfuehren(...)`-Aufruf im Quelltext), s. Kopfkommentar oben.
    const weltDatei = resolve(WORLDS, 'dev.db.zst');
    const beiseiteDatei = `${weltDatei}.beiseite`;
    writeFileSync(weltDatei, 'platzhalter-spielstand');
    writeFileSync(beiseiteDatei, 'platzhalter-beiseite');
    const testweltGet2 = await anfrage({ port, pfad: '/api/testwelt' });
    check('GET meldet aktiv=true, sobald .beiseite existiert', testweltGet2.daten.aktiv === true);

    const testweltStartenKonflikt = await anfrage({
      port,
      pfad: '/api/testwelt',
      methode: 'POST',
      leib: JSON.stringify({ aktion: 'starten' }),
    });
    check(
      'aktion="starten" waehrend bereits aktiv → 409 (kehrt VOR systemctl zurueck)',
      testweltStartenKonflikt.code === 409,
      `= ${testweltStartenKonflikt.code} ${JSON.stringify(testweltStartenKonflikt.daten)}`
    );
    check(
      'die Platzhalter-Dateien wurden NICHT angefasst (409 kam vor jedem Dateitausch)',
      readFileSync(weltDatei, 'utf-8') === 'platzhalter-spielstand' &&
        readFileSync(beiseiteDatei, 'utf-8') === 'platzhalter-beiseite'
    );

    // ── /dienst — nur die Validierung VOR systemctl ─────────────────
    console.log('\n[weiter] POST /dienst — nur die 400-Validierungen VOR systemctl:');
    const dienstUnbekannt = await anfrage({
      port,
      pfad: '/dienst',
      methode: 'POST',
      leib: JSON.stringify({ dienst: 'irgendwas', aktion: 'restart' }),
    });
    check('unbekannter Dienst → 400 (vor systemctl)', dienstUnbekannt.code === 400, `= ${dienstUnbekannt.code}`);
    const aktionUnbekannt = await anfrage({
      port,
      pfad: '/dienst',
      methode: 'POST',
      leib: JSON.stringify({ dienst: 'wov-server', aktion: 'explodieren' }),
    });
    check('unbekannte Aktion → 400 (vor systemctl)', aktionUnbekannt.code === 400, `= ${aktionUnbekannt.code}`);
  } finally {
    kind.kill('SIGTERM');
    await warte(200);
    rmSync(ORDNER, { recursive: true, force: true });
  }

  console.log(fehler === 0 ? '\nAlle Pruefungen gruen.' : `\n${fehler} Pruefung(en) fehlgeschlagen.`);
  process.exit(fehler > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
