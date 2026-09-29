/**
 * GET/POST /api/server — Serversteuerung des Editors (Mikes Befund: der
 * Neustart-Knopf blieb gesperrt, sobald eine Testwelt lief).
 *
 * Der ECHTE Betriebsdienst als Prozess, mit einem Stand-in fuer `systemctl`
 * (WOV_SYSTEMCTL, ein eigenes Shell-Skript), das NUR eine Log- und eine
 * Zustandsdatei im Temp-Ordner anfasst. Anders als bei /api/testwelt und
 * /dienst (s. admin/test/testwelt-einstellungen.ts, Kopfkommentar) ist der
 * Dienstname bei /api/server NIE aus der Anfrage ableitbar (fest
 * "wov-server" in serverSteuerungUmgebung(), admin/src/main.ts) — ein
 * Testlauf ohne dieses Stand-in wuerde also, anders als bei jenen beiden,
 * NICHT deshalb den echten Dienst anfassen, sondern weil WOV_SYSTEMCTL
 * fehlt. Das Stand-in bleibt trotzdem gesetzt, wie ueberall sonst in
 * diesen Tests.
 *
 * Geprueft:
 *  1. GET -> 200, Form { dienst, zustand, instanz }.
 *  2. POST unbekannte aktion -> 400, kein systemctl-Aufruf.
 *  3. POST neustart/stoppen/starten -> genau EIN systemctl-Aufruf mit
 *     "wov-server", nie mit einem fremden Dienstnamen aus dem Leib.
 *  4. Gleichzeitige Anfragen: die zweite waehrend die erste noch laeuft
 *     -> 409, kein zweiter systemctl-Aufruf gestapelt.
 *  5. Token/Origin: ohne Token -> 401, fremde Herkunft -> 403.
 *  6. Testwelt (.beiseite-Marker) bleibt bei jeder der drei Aktionen
 *     unberuehrt.
 *
 * Run: npx tsx test/server-steuerung.ts   (aus admin/)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { request, type IncomingMessage } from 'node:http';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// ── Testwurzel ────────────────────────────────────────────────────────

const ORDNER = mkdtempSync(resolve(tmpdir(), 'wov-serversteuerung-'));
process.on('exit', () => rmSync(ORDNER, { recursive: true, force: true }));
const WELTEN = resolve(ORDNER, 'server/data/welten');
const WORLDS = resolve(ORDNER, 'server/data/worlds');
const FAKE = resolve(ORDNER, 'fake');
const TOKEN = 'pruef-token-7391';
const TOKEN_DATEI = resolve(ORDNER, 'token');
const FAKE_SYSTEMCTL = resolve(FAKE, 'systemctl');
for (const d of [WELTEN, WORLDS, FAKE]) mkdirSync(d, { recursive: true });
writeFileSync(TOKEN_DATEI, `${TOKEN}\n`);

// ── Stand-in fuer systemctl ───────────────────────────────────────────
//
// `show` beantwortet den Zustand aus der Datei "aktiv" (existiert = laeuft).
// `restart`/`stop`/`start` protokollieren "<aktion> <dienst>" nach log,
// warten bei gesetztem Schalter "langsam" 1,2 s (fuer den 409-Test), und
// setzen/loeschen "aktiv" — restart setzt es (der Dienst laeuft danach).
writeFileSync(
  FAKE_SYSTEMCTL,
  `#!/bin/sh
D="${FAKE}"
echo "$1 $2" >> "$D/log"
if [ -f "$D/langsam" ]; then sleep 1.2; fi
case "$1" in
  show) if [ -f "$D/aktiv" ]; then echo "ActiveState=active"; echo "ActiveEnterTimestamp=Mon 2026-09-29 00:09:40 UTC"; else echo "ActiveState=inactive"; fi ;;
  restart) touch "$D/aktiv" ;;
  start) touch "$D/aktiv" ;;
  stop) rm -f "$D/aktiv" ;;
esac
exit 0
`
);
chmodSync(FAKE_SYSTEMCTL, 0o755);

const fakeLog = (): string[] =>
  existsSync(resolve(FAKE, 'log'))
    ? readFileSync(resolve(FAKE, 'log'), 'utf-8').trim().split('\n').filter((z) => z && !z.startsWith('show'))
    : [];
const fakeLogLeeren = (): void => rmSync(resolve(FAKE, 'log'), { force: true });
const fakeSchalter = (name: string, an: boolean): void => (an ? writeFileSync(resolve(FAKE, name), '') : rmSync(resolve(FAKE, name), { force: true }));
fakeSchalter('aktiv', true); // Dienst gilt zu Beginn als aktiv (der ueblichste Fall).

// ── Dienst starten ────────────────────────────────────────────────────

function starten(): Promise<{ port: number; kind: ChildProcess }> {
  return new Promise((fertig, scheitern) => {
    const kind = spawn(resolve(WURZEL_PROJEKT, 'node_modules/.bin/tsx'), ['src/main.ts'], {
      cwd: ADMIN,
      env: {
        ...process.env,
        WOV_WURZEL: ORDNER,
        WOV_WELT_VERZEICHNIS: WELTEN,
        WOV_INSTANZ: 'dev',
        WOV_ADMIN_ADRESSE: '127.0.0.1',
        WOV_ADMIN_PORT: '0',
        WOV_QUITTUNG: 'aus',
        NODE_ENV: 'test',
        WOV_ADMIN_TOKEN_DATEI: TOKEN_DATEI,
        WOV_ERLAUBTE_URSPRUENGE: 'erlaubt.example',
        // Das Stand-in — ohne dieses liefe jeder Aufruf gegen den echten systemctl.
        WOV_SYSTEMCTL: FAKE_SYSTEMCTL,
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

type Antwort = { code: number; daten: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any -- parsed JSON, gepruefte Felder einzeln

function anfrage(opt: {
  port: number;
  pfad: string;
  methode?: string;
  leib?: string;
  token?: string | null;
  kopf?: Record<string, string>;
}): Promise<Antwort> {
  return new Promise((fertig, scheitern) => {
    const kopf: Record<string, string> = {};
    if (opt.token !== null) kopf['x-wov-token'] = opt.token ?? TOKEN;
    if (opt.leib !== undefined) {
      kopf['content-type'] = 'application/json';
      kopf['content-length'] = String(Buffer.byteLength(opt.leib));
    }
    Object.assign(kopf, opt.kopf ?? {});
    const req = request({ host: '127.0.0.1', port: opt.port, path: opt.pfad, method: opt.methode ?? 'GET', headers: kopf }, (res: IncomingMessage) => {
      let text = '';
      res.setEncoding('utf-8');
      res.on('data', (s: string) => (text += s));
      res.on('end', () => {
        let daten: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
        try {
          daten = JSON.parse(text) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
        } catch {
          /* kein JSON */
        }
        fertig({ code: res.statusCode ?? 0, daten });
      });
    });
    req.on('error', scheitern);
    if (opt.leib !== undefined) req.write(opt.leib);
    req.end();
  });
}

const post = (port: number, aktion: unknown, extra: { token?: string | null; kopf?: Record<string, string> } = {}): Promise<Antwort> =>
  anfrage({ port, pfad: '/api/server', methode: 'POST', leib: JSON.stringify({ aktion }), token: extra.token, kopf: extra.kopf });

async function main(): Promise<void> {
  const { port, kind } = await starten();
  console.log(`\n# Betriebsdienst auf 127.0.0.1:${port}, Wurzel ${ORDNER}`);

  try {
    // ── [1] GET /api/server ────────────────────────────────────────
    console.log('\n[1] GET /api/server:');
    const g1 = await anfrage({ port, pfad: '/api/server' });
    check('GET -> 200', g1.code === 200, `= ${g1.code}`);
    check('dienst = wov-server', g1.daten.dienst === 'wov-server', JSON.stringify(g1.daten.dienst));
    check('instanz = dev', g1.daten.instanz === 'dev', JSON.stringify(g1.daten.instanz));
    check('zustand.aktiv ist ein bool (hier true, Fixtur startet aktiv)', g1.daten.zustand?.aktiv === true, JSON.stringify(g1.daten.zustand));

    // ── [2] Unbekannte aktion -> 400, kein systemctl-Aufruf ─────────
    console.log('\n[2] POST unbekannte aktion:');
    fakeLogLeeren();
    const unbekannt = await post(port, 'explodieren');
    check('unbekannte aktion -> 400', unbekannt.code === 400, `= ${unbekannt.code}`);
    check('kein systemctl-Aufruf davor', fakeLog().length === 0, fakeLog().join(','));
    const ohneAktion = await post(port, undefined);
    check('aktion fehlt -> 400', ohneAktion.code === 400, `= ${ohneAktion.code}`);

    // ── [3] neustart/stoppen/starten -> genau EIN Aufruf, fremder Dienst ignoriert ──
    console.log('\n[3] neustart/stoppen/starten -- genau ein systemctl-Aufruf mit wov-server:');
    fakeLogLeeren();
    const beiseiteDatei = resolve(WORLDS, 'dev.db.zst.beiseite');
    writeFileSync(beiseiteDatei, 'platzhalter-testwelt-beiseite');

    const r1 = await anfrage({
      port,
      pfad: '/api/server',
      methode: 'POST',
      leib: JSON.stringify({ aktion: 'neustart', dienst: 'nginx' }),
    });
    check('neustart -> 200', r1.code === 200, `= ${r1.code} ${JSON.stringify(r1.daten)}`);
    check('genau ein Aufruf: restart wov-server (fremder Dienstname "nginx" im Leib ignoriert)', fakeLog().join(',') === 'restart wov-server', fakeLog().join(','));
    check('Antwort nennt den neuen Zustand (aktiv, Fixtur touch bei restart)', r1.daten.zustand?.aktiv === true);
    check('Testwelt-Marker unberuehrt nach neustart', existsSync(beiseiteDatei) && readFileSync(beiseiteDatei, 'utf-8') === 'platzhalter-testwelt-beiseite');

    fakeLogLeeren();
    const r2 = await post(port, 'stoppen');
    check('stoppen -> 200', r2.code === 200, `= ${r2.code}`);
    check('genau ein Aufruf: stop wov-server', fakeLog().join(',') === 'stop wov-server', fakeLog().join(','));
    check('Antwort nennt aktiv=false nach stoppen', r2.daten.zustand?.aktiv === false, JSON.stringify(r2.daten.zustand));
    check('Testwelt-Marker unberuehrt nach stoppen', existsSync(beiseiteDatei) && readFileSync(beiseiteDatei, 'utf-8') === 'platzhalter-testwelt-beiseite');

    fakeLogLeeren();
    const r3 = await post(port, 'starten');
    check('starten -> 200', r3.code === 200, `= ${r3.code}`);
    check('genau ein Aufruf: start wov-server', fakeLog().join(',') === 'start wov-server', fakeLog().join(','));
    check('Antwort nennt aktiv=true nach starten', r3.daten.zustand?.aktiv === true);
    check('Testwelt-Marker unberuehrt nach starten', existsSync(beiseiteDatei) && readFileSync(beiseiteDatei, 'utf-8') === 'platzhalter-testwelt-beiseite');
    rmSync(beiseiteDatei);

    // ── [4] Gleichzeitige Anfragen -> 409, kein gestapelter Aufruf ──
    console.log('\n[4] Zwei POSTs gleichzeitig -- die zweite waehrend die erste noch laeuft:');
    fakeLogLeeren();
    fakeSchalter('langsam', true);
    const [a, b] = await Promise.all([post(port, 'neustart'), warte(150).then(() => post(port, 'neustart'))]);
    fakeSchalter('langsam', false);
    const codes = [a.code, b.code].sort();
    check('eine 200, eine 409 (kein zweiter systemctl-Aufruf gestapelt)', codes[0] === 200 && codes[1] === 409, `= ${JSON.stringify(codes)}`);
    const spaete = a.code === 409 ? a : b;
    check('409 nennt einen verstaendlichen Grund', typeof spaete.daten.message === 'string' && spaete.daten.message.length > 0, JSON.stringify(spaete.daten));
    check('trotz zweier Anfragen nur EIN systemctl-Aufruf', fakeLog().join(',') === 'restart wov-server', fakeLog().join(','));
    // Nach der laufenden Aktion muss die Sperre wieder frei sein.
    await warte(100);
    fakeLogLeeren();
    const nachDanach = await post(port, 'stoppen');
    check('Sperre danach wieder frei (naechster Aufruf geht durch)', nachDanach.code === 200, `= ${nachDanach.code}`);

    // ── [5] Token/Origin ─────────────────────────────────────────────
    console.log('\n[5] Token und Herkunft:');
    const ohneToken = await anfrage({ port, pfad: '/api/server', token: null });
    check('GET ohne Token -> 401', ohneToken.code === 401, `= ${ohneToken.code}`);
    const postOhneToken = await post(port, 'starten', { token: null });
    check('POST ohne Token -> 401', postOhneToken.code === 401, `= ${postOhneToken.code}`);
    const fremdeHerkunft = await post(port, 'starten', { kopf: { origin: 'https://boese.example' } });
    check('POST von fremder Herkunft -> 403', fremdeHerkunft.code === 403, `= ${fremdeHerkunft.code} ${JSON.stringify(fremdeHerkunft.daten)}`);
    fakeLogLeeren();
    check('fremde Herkunft: kein systemctl-Aufruf', fakeLog().length === 0, fakeLog().join(','));
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
