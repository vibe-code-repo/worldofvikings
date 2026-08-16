/**
 * Der Betriebsdienst als Ganzes — gefahren wie im Betrieb, nicht in
 * Einzelteilen.
 *
 *   npx tsx test/betriebsdienst.ts      (aus admin/)
 *
 * ── Warum der ECHTE Prozess und keine importierten Funktionen ────────
 * Geprueft wird der Weg, den eine Anfrage wirklich nimmt: Herkunfts-
 * Riegel, Token, Weiche, Sanitizer, Sicherung, atomares Schreiben. Die
 * Reihenfolge dieser Schritte IST die Zusicherung. Ruft man die Bausteine
 * einzeln auf, prueft man die Bausteine und nicht die Reihenfolge — und
 * genau in der Reihenfolge steckt die Aussage, dass ein misslungener
 * Speichervorgang die Welt nicht anfasst.
 *
 * Der Dienst wird dafuer mit einem eigenen WOV_WURZEL, einem
 * Wegwerf-Token und WOV_ADMIN_PORT=0 (freier Port vom Kern) gestartet.
 *
 * ── Warum NICHT gegen server/data/welten/ ────────────────────────────
 * Das ist die Welt des Nutzers, nicht Testmaterial. Ein Test, der sie
 * beschreibt, zerstoert beim ersten Fehlschlag genau das, was er
 * schuetzen soll. Alles hier passiert in einem Verzeichnis unter
 * os.tmpdir(), das am Ende wieder verschwindet.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { request, type IncomingMessage } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeWorldLayout } from '@wov/shared/src/worldlayout/sanitize.js';
import { layoutSichern, layoutText } from '@wov/shared/src/worldlayout/layoutDatei.js';
import type { WorldLayout } from '@wov/shared/src/worldlayout/types.js';

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

// ── Testwelt ──────────────────────────────────────────────────────────
// Klein, aber mit allem, was der Sanitizer anfasst: eine Region mit
// Kreisform, eine Platzierung mit NPC-Block. Beim Speichern muss GENAU
// das wieder herauskommen, was der Sanitizer daraus macht.
const WELT = {
  version: 1,
  name: 'Pruefwelt',
  detailSeed: 'pruef',
  continents: [{ id: 'nord', name: 'Nordland', faction: 'viking' }],
  regions: [
    {
      id: 'heim',
      biome: 'grassland',
      shape: { kind: 'circle', x: 0, z: 0, radius: 1200 },
      edgeFalloff: 300,
    },
  ],
  placements: [{ prefab: 'Beech1', x: 12.5, z: -30, npc: { name: 'Alte Buche' } }],
};

const ORDNER = mkdtempSync(resolve(tmpdir(), 'wov-betriebsdienst-'));
const WELTEN = resolve(ORDNER, 'server/data/welten');
const WELT_DATEI = resolve(WELTEN, 'dev.json');
const TOKEN = 'pruef-token-4711';
const TOKEN_DATEI = resolve(ORDNER, 'token');

mkdirSync(WELTEN, { recursive: true });
writeFileSync(TOKEN_DATEI, `${TOKEN}\n`);

/** Die Byte-Form, die auf der Platte stehen MUSS. */
const SOLL = layoutText(sanitizeWorldLayout(WELT)!);
writeFileSync(WELT_DATEI, SOLL);

const aufDerPlatte = (): string => readFileSync(WELT_DATEI, 'utf-8');
const sicherungen = (): string[] => readdirSync(WELTEN).filter((f) => f.endsWith('.bak'));

// ── Dienst starten ────────────────────────────────────────────────────

// Gibt den Kindprozess mit heraus, statt ihn in eine Modulvariable zu
// legen: Nur so ist er im finally-Zweig unten garantiert vorhanden und
// muss nicht auf null geprueft werden.
function starten(): Promise<{ port: number; kind: ChildProcess }> {
  return new Promise((fertig, scheitern) => {
    const kind = spawn(resolve(WURZEL, 'node_modules/.bin/tsx'), ['src/main.ts'], {
      cwd: ADMIN,
      env: {
        ...process.env,
        WOV_WURZEL: ORDNER,
        WOV_INSTANZ: 'dev',
        WOV_ADMIN_ADRESSE: '127.0.0.1',
        // 0 = der Kern sucht einen freien Port. Ein fest gewaehlter
        // Testport waere ein Wettlauf mit allem, was sonst lauscht.
        WOV_ADMIN_PORT: '0',
        WOV_ADMIN_TOKEN_DATEI: TOKEN_DATEI,
        // Eine einzige Konsole gleichzeitig — damit die Obergrenze mit
        // zwei Anfragen pruefbar ist statt mit fuenf.
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

// ── Anfragen ──────────────────────────────────────────────────────────
//
// node:http statt fetch, weil zwei Dinge gebraucht werden, die fetch
// nicht hergibt: `localAddress` (um von einer FREMDEN Peer-Adresse zu
// kommen — 127.0.0.0/8 ist unter Linux vollstaendig lokal, 127.0.0.2 ist
// also erreichbar und liegt trotzdem nicht in der erlaubten Liste) und
// ein offen gehaltener Antwortstrom fuer die Server-Konsole.

type Antwort = { code: number; typ: string; text: string; daten: Record<string, unknown> };

function anfrage(opt: {
  port: number;
  pfad: string;
  methode?: string;
  token?: string | null;
  weiter?: string;
  quelle?: string;
  leib?: string;
}): Promise<Antwort> {
  return new Promise((fertig, scheitern) => {
    const kopf: Record<string, string> = {};
    if (opt.token !== null) kopf['x-wov-token'] = opt.token ?? TOKEN;
    if (opt.weiter) kopf['x-forwarded-for'] = opt.weiter;
    if (opt.leib !== undefined) {
      kopf['content-type'] = 'application/json';
      kopf['content-length'] = String(Buffer.byteLength(opt.leib));
    }
    const req = request(
      {
        host: '127.0.0.1',
        port: opt.port,
        path: opt.pfad,
        method: opt.methode ?? 'GET',
        headers: kopf,
        localAddress: opt.quelle,
      },
      (res: IncomingMessage) => {
        let text = '';
        res.setEncoding('utf-8');
        res.on('data', (s: string) => (text += s));
        res.on('end', () => {
          let daten: Record<string, unknown> = {};
          try {
            daten = JSON.parse(text) as Record<string, unknown>;
          } catch {
            /* kein JSON — die Rohantwort steht in `text` */
          }
          fertig({ code: res.statusCode ?? 0, typ: String(res.headers['content-type'] ?? ''), text, daten });
        });
      }
    );
    req.on('error', scheitern);
    if (opt.leib !== undefined) req.write(opt.leib);
    req.end();
  });
}

/** Server-Sent-Events: Kopf abwarten, Strom offen lassen, spaeter schliessen. */
function strom(port: number): Promise<{ code: number; typ: string; schliessen: () => void; offen: () => boolean }> {
  return new Promise((fertig, scheitern) => {
    let beendet = false;
    const req = request(
      { host: '127.0.0.1', port, path: '/api/serverlog', method: 'GET', headers: { 'x-wov-token': TOKEN } },
      (res) => {
        res.on('data', () => undefined);
        res.on('end', () => (beendet = true));
        res.on('close', () => (beendet = true));
        fertig({
          code: res.statusCode ?? 0,
          typ: String(res.headers['content-type'] ?? ''),
          schliessen: () => req.destroy(),
          offen: () => !beendet,
        });
      }
    );
    req.on('error', scheitern);
    req.end();
  });
}

const warte = (ms: number): Promise<void> => new Promise((f) => setTimeout(f, ms));

// ── Lauf ──────────────────────────────────────────────────────────────

const { port, kind } = await starten();
console.log(`# Betriebsdienst auf 127.0.0.1:${port}, Wurzel ${ORDNER}`);

try {
  // 1) Ohne Token: 401 — und die Welt liegt unberuehrt da.
  const ohneToken = await anfrage({
    port,
    pfad: '/api/worldlayout',
    methode: 'POST',
    token: null,
    leib: JSON.stringify(WELT),
  });
  check('ohne Token → 401', ohneToken.code === 401, `= ${ohneToken.code}`);
  check('ohne Token: Datei unveraendert', aufDerPlatte() === SOLL);
  check('ohne Token: keine Sicherung angelegt', sicherungen().length === 0);

  // 2) Fremde Herkunft. Zwei Wege, beide muessen zu 403 fuehren:
  //    a) die TCP-Gegenstelle liegt ausserhalb der erlaubten Liste,
  //    b) ein Vorschalter meldet eine fremde Klient-Adresse.
  const fremderPeer = await anfrage({
    port,
    pfad: '/api/worldlayout',
    methode: 'POST',
    quelle: '127.0.0.2',
    leib: JSON.stringify(WELT),
  });
  check('fremde Peer-Adresse → 403', fremderPeer.code === 403, `= ${fremderPeer.code}`);
  check('fremde Peer-Adresse: Datei unveraendert', aufDerPlatte() === SOLL);

  const fremderKlient = await anfrage({
    port,
    pfad: '/api/worldlayout',
    methode: 'POST',
    weiter: '203.0.113.7',
    leib: JSON.stringify(WELT),
  });
  check('fremde Klient-Adresse (X-Forwarded-For) → 403', fremderKlient.code === 403, `= ${fremderKlient.code}`);
  check('fremde Klient-Adresse: Datei unveraendert', aufDerPlatte() === SOLL);
  check('keine Sicherung durch abgewiesene Anfragen', sicherungen().length === 0);

  // 3) Kaputtes Dokument. Die wichtigste Zusicherung des Endpunkts: Ein
  //    misslungener Speichervorgang darf die Welt nicht beschaedigen —
  //    weder halb ueberschreiben noch leeren noch eine Sicherung
  //    verbrauchen.
  const kaputt = await anfrage({
    port,
    pfad: '/api/worldlayout',
    methode: 'POST',
    leib: JSON.stringify({ version: 1, name: 'ohne alles', regions: 'keine Liste' }),
  });
  check('kaputtes Dokument → 400', kaputt.code === 400, `= ${kaputt.code} ${kaputt.text}`);
  check('kaputtes Dokument: Datei unveraendert', aufDerPlatte() === SOLL);
  check('kaputtes Dokument: keine Sicherung angelegt', sicherungen().length === 0);

  const kaputtesJson = await anfrage({
    port,
    pfad: '/api/worldlayout',
    methode: 'POST',
    leib: '{ das ist kein json',
  });
  check('unlesbares JSON → 400', kaputtesJson.code === 400, `= ${kaputtesJson.code}`);
  check('unlesbares JSON: Datei unveraendert', aufDerPlatte() === SOLL);

  const falscheVersion = await anfrage({
    port,
    pfad: '/api/worldlayout',
    methode: 'POST',
    leib: JSON.stringify({ ...WELT, version: 2 }),
  });
  check('falsche Dokumentversion → 400', falscheVersion.code === 400, `= ${falscheVersion.code}`);
  check('falsche Dokumentversion: Datei unveraendert', aufDerPlatte() === SOLL);

  // 4) Gueltiges Dokument. Der Test schickt absichtlich ROHE Werte, die
  //    der Sanitizer noch anfassen muss (Nachkommastellen jenseits von
  //    Millimetern, ein unbekanntes Feld, ein alter Biomname) — sonst
  //    wuerde "bytegleich" nur beweisen, dass JSON.stringify funktioniert.
  const roh = {
    ...WELT,
    regions: [{ ...WELT.regions[0], biome: 'meadows', erfundenesFeld: 42 }],
    placements: [{ prefab: 'Beech1', x: 12.5000004, z: -30, npc: { name: 'Alte Buche' } }],
  };
  const gespeichert = await anfrage({
    port,
    pfad: '/api/worldlayout',
    methode: 'POST',
    leib: JSON.stringify(roh),
  });
  check('gueltiges Dokument → 200', gespeichert.code === 200, `= ${gespeichert.code} ${gespeichert.text}`);
  check('Antwort traegt ok:true', gespeichert.daten.ok === true);
  check('Antwort nennt die Instanz', gespeichert.daten.instanz === 'dev');

  const nachher = sicherungen();
  check('eine .bak entstanden', nachher.length === 1, `= ${nachher.length}`);
  check(
    '.bak traegt den vorherigen Stand',
    nachher.length === 1 && readFileSync(resolve(WELTEN, nachher[0]!), 'utf-8') === SOLL
  );

  const erwartet = layoutText(sanitizeWorldLayout(roh)!);
  check('Ergebnis bytegleich zum Sanitizer', aufDerPlatte() === erwartet);
  check('kein abschliessender Zeilenumbruch', !aufDerPlatte().endsWith('\n'));
  check('kein .tmp zurueckgeblieben', !readdirSync(WELTEN).some((f) => f.endsWith('.tmp')));

  // 5) Lesen liefert dasselbe Dokument. Voraussetzung fuer Phase 2: Der
  //    Editor muss oeffnen koennen, was er gespeichert hat.
  const gelesen = await anfrage({ port, pfad: '/api/worldlayout' });
  check('GET → 200', gelesen.code === 200, `= ${gelesen.code}`);
  check('GET liefert dasselbe Dokument', layoutText(gelesen.daten.layout as WorldLayout) === erwartet);
  check('GET nennt Instanz und Datei', gelesen.daten.instanz === 'dev' && gelesen.daten.datei === 'dev.json');

  // 6) Server-Konsole: Obergrenze und Aufraeumen.
  //    Der Endpunkt haengt an journalctl. Fehlt es (Container ohne
  //    systemd), beendet sich der Strom sofort von selbst — dann sagt die
  //    Obergrenze nichts aus und die Pruefung wird uebersprungen, statt
  //    aus einem fremden Grund rot zu werden.
  const konsole1 = await strom(port);
  check('Server-Konsole → 200', konsole1.code === 200, `= ${konsole1.code}`);
  check('Server-Konsole ist ein SSE-Strom', konsole1.typ.startsWith('text/event-stream'));
  if (konsole1.offen()) {
    const konsole2 = await anfrage({ port, pfad: '/api/serverlog' });
    check('zweite Konsole ueber der Grenze → 503', konsole2.code === 503, `= ${konsole2.code}`);
    konsole1.schliessen();
    // Der Platz muss beim Schliessen frei werden — sonst sammeln sich
    // journalctl-Prozesse an, jedes Mal wenn jemand den Editor-Tab
    // schliesst, und irgendwann geht die Konsole gar nicht mehr auf.
    await warte(300);
    const konsole3 = await strom(port);
    check('nach dem Schliessen wieder frei → 200', konsole3.code === 200, `= ${konsole3.code}`);
    konsole3.schliessen();
  } else {
    console.log('ok   Server-Konsole: Obergrenze uebersprungen (kein journalctl)');
    konsole1.schliessen();
  }

  // 7) Rotation der Sicherungen. Bewusst OHNE HTTP und ohne Warten: Die
  //    Namen tragen Millisekunden-Zeitstempel, zwoelf Speichervorgaenge
  //    hintereinander landeten leicht in derselben Millisekunde und
  //    ueberschrieben sich gegenseitig — der Test haette dann nichts
  //    geprueft. Also zwoelf Staende von Hand hinlegen und einmal
  //    sichern lassen.
  const rotationsOrdner = resolve(ORDNER, 'rotation');
  mkdirSync(rotationsOrdner, { recursive: true });
  const rotationsDatei = resolve(rotationsOrdner, 'dev.json');
  writeFileSync(rotationsDatei, SOLL);
  for (let i = 0; i < 12; i++) {
    writeFileSync(`${rotationsDatei}.2026-01-01T00-00-${String(i).padStart(2, '0')}-000Z.bak`, 'alt');
  }
  layoutSichern(rotationsDatei, 10);
  const uebrig = readdirSync(rotationsOrdner).filter((f) => f.endsWith('.bak'));
  check('Rotation behaelt genau 10 Sicherungen', uebrig.length === 10, `= ${uebrig.length}`);
  check(
    'Rotation wirft die AELTESTEN weg',
    !uebrig.includes('dev.json.2026-01-01T00-00-00-000Z.bak') &&
      uebrig.includes('dev.json.2026-01-01T00-00-11-000Z.bak')
  );

  // 8) Unbekannte Pfade bleiben unbekannt — der Umbau soll keine neue
  //    Angriffsflaeche unter /api/ aufgemacht haben.
  const unbekannt = await anfrage({ port, pfad: '/api/irgendwas' });
  check('unbekannter /api/-Pfad → 404', unbekannt.code === 404, `= ${unbekannt.code}`);
  const falscheMethode = await anfrage({ port, pfad: '/api/serverlog', methode: 'POST', leib: '{}' });
  check('POST auf die Konsole → 405', falscheMethode.code === 405, `= ${falscheMethode.code}`);

  // 9) Fehlende Weltdatei ist ein Zustand des Containers, kein Fehler des
  //    Aufrufers — 404, nicht 400. Die Unterscheidung entscheidet, ob man
  //    beim naechsten Mal im Editor oder in /etc/wov.env sucht.
  rmSync(WELT_DATEI);
  const ohneDatei = await anfrage({ port, pfad: '/api/worldlayout' });
  check('fehlende Weltdatei → 404', ohneDatei.code === 404, `= ${ohneDatei.code}`);
} finally {
  kind.kill('SIGTERM');
  rmSync(ORDNER, { recursive: true, force: true });
}

console.log(fehler === 0 ? '\nAlle Pruefungen gruen.' : `\n${fehler} Pruefung(en) fehlgeschlagen.`);
process.exit(fehler > 0 ? 1 : 0);
