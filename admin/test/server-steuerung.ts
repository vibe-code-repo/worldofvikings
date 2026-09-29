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
 *  5. Token/Origin: ohne Token -> 401, fremde Herkunft -> 403 (Nachbesserung
 *     N1: log VOR der Anfrage geleert, nicht danach -- die alte Pruefung
 *     war wirkungslos, s. Angriffsbericht).
 *  6. text/plain -> 415 (M6).
 *  7. Ein systemctl-Fehler (exit 1) gibt die Sperre trotzdem wieder frei
 *     (M4).
 *  8./9. Die Sperre ist jetzt GEMEINSAM mit /api/testwelt und
 *     /api/welt-zuruecksetzen (B2, Angriffsbefund): eine Aktion in einer
 *     dieser Routen laesst eine gleichzeitige Aktion in einer der beiden
 *     anderen mit 409 abprallen statt ihre systemctl-Aufrufe zu
 *     verschachteln.
 *  10. Ein systemctl, das das Zeitlimit reisst, liefert 504 und gibt die
 *      Sperre frei (B7) -- eigener Prozess mit kurzem Zeitlimit, damit der
 *      Test nicht 120 s wartet.
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
if [ -f "$D/fehler" ]; then echo boom >&2; exit 1; fi
if [ -f "$D/langsam" ]; then sleep 1.2; fi
if [ -f "$D/haengt" ]; then sleep 5; fi
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

function starten(
  ueberschreibung: { wurzel?: string; welten?: string; tokenDatei?: string; systemctl?: string; extraEnv?: Record<string, string> } = {}
): Promise<{ port: number; kind: ChildProcess }> {
  return new Promise((fertig, scheitern) => {
    const kind = spawn(resolve(WURZEL_PROJEKT, 'node_modules/.bin/tsx'), ['src/main.ts'], {
      cwd: ADMIN,
      env: {
        ...process.env,
        WOV_WURZEL: ueberschreibung.wurzel ?? ORDNER,
        WOV_WELT_VERZEICHNIS: ueberschreibung.welten ?? WELTEN,
        WOV_INSTANZ: 'dev',
        WOV_ADMIN_ADRESSE: '127.0.0.1',
        WOV_ADMIN_PORT: '0',
        WOV_QUITTUNG: 'aus',
        NODE_ENV: 'test',
        WOV_ADMIN_TOKEN_DATEI: ueberschreibung.tokenDatei ?? TOKEN_DATEI,
        WOV_ERLAUBTE_URSPRUENGE: 'erlaubt.example',
        // Das Stand-in — ohne dieses liefe jeder Aufruf gegen den echten systemctl.
        WOV_SYSTEMCTL: ueberschreibung.systemctl ?? FAKE_SYSTEMCTL,
        ...ueberschreibung.extraEnv,
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
    // Nachbesserung N1: Log VOR der Anfrage leeren, nicht danach -- die alte
    // Reihenfolge (leeren NACH der Anfrage, dann pruefen) war immer gruen,
    // egal was passiert war (Angriffsbericht, ~Z. 258).
    fakeLogLeeren();
    const fremdeHerkunft = await post(port, 'starten', { kopf: { origin: 'https://boese.example' } });
    check('POST von fremder Herkunft -> 403', fremdeHerkunft.code === 403, `= ${fremdeHerkunft.code} ${JSON.stringify(fremdeHerkunft.daten)}`);
    check('fremde Herkunft: kein systemctl-Aufruf', fakeLog().length === 0, fakeLog().join(','));

    // ── [6] Content-Type-Klemme (M4-Angriffsbefund) ──────────────────
    console.log('\n[6] text/plain -> 415, kein systemctl-Aufruf:');
    fakeLogLeeren();
    const textPlain = await anfrage({
      port,
      pfad: '/api/server',
      methode: 'POST',
      leib: JSON.stringify({ aktion: 'starten' }),
      kopf: { 'content-type': 'text/plain' },
    });
    check('POST mit text/plain -> 415', textPlain.code === 415, `= ${textPlain.code} ${JSON.stringify(textPlain.daten)}`);
    check('text/plain: kein systemctl-Aufruf', fakeLog().length === 0, fakeLog().join(','));

    // ── [7] Sperre wird nach einem systemctl-Fehler wieder frei (M4) ──
    console.log('\n[7] systemctl-Fehler (exit 1) -> 500, Sperre danach wieder frei:');
    fakeLogLeeren();
    fakeSchalter('fehler', true);
    const fehlgeschlagen = await post(port, 'neustart');
    fakeSchalter('fehler', false);
    check('systemctl-Fehler -> 500', fehlgeschlagen.code === 500, `= ${fehlgeschlagen.code} ${JSON.stringify(fehlgeschlagen.daten)}`);
    fakeLogLeeren();
    const nachFehler = await post(port, 'stoppen');
    check('Sperre nach Fehler wieder frei (naechster Aufruf 200, nicht 409)', nachFehler.code === 200, `= ${nachFehler.code}`);

    // ── [8]/[9] Sperre jetzt GEMEINSAM mit /api/testwelt und /api/welt-zuruecksetzen (B2) ──
    console.log('\n[8] Sperre uebergreifend -- /api/testwelt starten + 200 ms spaeter /api/server stoppen (Angriffsprobe F2c):');
    // "starten" legt NUR beiseite, wenn am Ladeort ueberhaupt eine Datei
    // liegt (existsSync(welt)) -- ein Platzhalter noetig, sonst bliebe
    // .beiseite weg und "zurueck" unten saehe keine aktive Testwelt.
    const weltDatei8 = resolve(WORLDS, 'dev.db.zst');
    writeFileSync(weltDatei8, 'platzhalter-dev-stand');
    fakeLogLeeren();
    fakeSchalter('langsam', true);
    const [t8, s8] = await Promise.all([
      anfrage({ port, pfad: '/api/testwelt', methode: 'POST', leib: JSON.stringify({ aktion: 'starten' }) }),
      warte(200).then(() => post(port, 'stoppen')),
    ]);
    fakeSchalter('langsam', false);
    check('/api/testwelt starten gewinnt die Sperre -> 200', t8.code === 200, `= ${t8.code} ${JSON.stringify(t8.daten)}`);
    check('gleichzeitiges /api/server stoppen -> 409 (gemeinsame Sperre)', s8.code === 409, `= ${s8.code} ${JSON.stringify(s8.daten)}`);
    check(
      'systemctl-Folge nur stop,start von "testwelt starten" -- kein zweiter stop von /api/server gestapelt',
      fakeLog().join(',') === 'stop wov-server,start wov-server',
      fakeLog().join(',')
    );
    fakeLogLeeren();
    const zurueck8 = await anfrage({ port, pfad: '/api/testwelt', methode: 'POST', leib: JSON.stringify({ aktion: 'zurueck' }) });
    check('aufraeumen: testwelt zurueck -> 200 (Ausgangszustand fuer die naechste Pruefung)', zurueck8.code === 200, `= ${zurueck8.code}`);

    console.log('\n[9] Sperre uebergreifend -- /api/server neustart + 200 ms spaeter /api/welt-zuruecksetzen:');
    fakeLogLeeren();
    fakeSchalter('langsam', true);
    const [n9, r9] = await Promise.all([
      post(port, 'neustart'),
      warte(200).then(() =>
        anfrage({ port, pfad: '/api/welt-zuruecksetzen', methode: 'POST', leib: JSON.stringify({ bestaetigung: 'dev', seed: 'behalten' }) })
      ),
    ]);
    fakeSchalter('langsam', false);
    check('/api/server neustart gewinnt die Sperre -> 200', n9.code === 200, `= ${n9.code}`);
    check(
      'gleichzeitiges /api/welt-zuruecksetzen -> 409 laeuft-bereits (gemeinsame Sperre)',
      r9.code === 409 && r9.daten.fehler === 'laeuft-bereits',
      `= ${r9.code} ${JSON.stringify(r9.daten)}`
    );
    check('systemctl-Folge nur restart wov-server (kein stop von Reset gestapelt)', fakeLog().join(',') === 'restart wov-server', fakeLog().join(','));
  } finally {
    kind.kill('SIGTERM');
    await warte(200);
    rmSync(ORDNER, { recursive: true, force: true });
  }

  // ── [10] Zeitlimit (B7): eigener Prozess mit kurzem Zeitlimit ────────
  //
  // Eigener Prozess statt WOV_SYSTEMCTL_ZEITLIMIT_MS im Hauptprozess zu
  // aendern: Der ist schon oben mit den ueblichen 120 s (Vorgabe)
  // gelaufen, und Abschnitt [4]/[8]/[9] verlassen sich auf ein "langsam"
  // (1,2 s), das bei einem globalen kurzen Zeitlimit selbst als
  // Zeitueberschreitung durchgegangen waere.
  console.log('\n[10] systemctl reisst das Zeitlimit -> 504, Sperre danach frei:');
  const ORDNER2 = mkdtempSync(resolve(tmpdir(), 'wov-serversteuerung-zeitlimit-'));
  try {
    const WELTEN2 = resolve(ORDNER2, 'server/data/welten');
    const WORLDS2 = resolve(ORDNER2, 'server/data/worlds');
    const FAKE2 = resolve(ORDNER2, 'fake');
    const TOKEN2 = 'pruef-token-zeitlimit';
    const TOKEN_DATEI2 = resolve(ORDNER2, 'token');
    const FAKE_SYSTEMCTL2 = resolve(FAKE2, 'systemctl');
    for (const d of [WELTEN2, WORLDS2, FAKE2]) mkdirSync(d, { recursive: true });
    writeFileSync(TOKEN_DATEI2, `${TOKEN2}\n`);
    // Haengt IMMER 2 s -- laenger als das Zeitlimit unten (300 ms), aber kurz genug fuer einen Test.
    writeFileSync(
      FAKE_SYSTEMCTL2,
      `#!/bin/sh
D="${FAKE2}"
echo "$1 $2" >> "$D/log"
sleep 2
case "$1" in
  show) echo "ActiveState=active"; echo "ActiveEnterTimestamp=Mon 2026-09-29 00:09:40 UTC" ;;
  restart) touch "$D/aktiv" ;;
esac
exit 0
`
    );
    chmodSync(FAKE_SYSTEMCTL2, 0o755);
    const { port: port2, kind: kind2 } = await starten({
      wurzel: ORDNER2,
      welten: WELTEN2,
      tokenDatei: TOKEN_DATEI2,
      systemctl: FAKE_SYSTEMCTL2,
      extraEnv: { WOV_SYSTEMCTL_ZEITLIMIT_MS: '300' },
    });
    try {
      const post2 = (aktion: unknown): Promise<Antwort> =>
        anfrage({ port: port2, pfad: '/api/server', methode: 'POST', leib: JSON.stringify({ aktion }), token: TOKEN2 });
      const fakeLog2 = (): string[] =>
        existsSync(resolve(FAKE2, 'log')) ? readFileSync(resolve(FAKE2, 'log'), 'utf-8').trim().split('\n').filter((z) => z && !z.startsWith('show')) : [];
      const zeitueberschritten = await post2('neustart');
      check('systemctl reisst das Zeitlimit -> 504', zeitueberschritten.code === 504, `= ${zeitueberschritten.code} ${JSON.stringify(zeitueberschritten.daten)}`);
      const nachZeitlimit = await post2('neustart');
      check('Sperre danach wieder frei (naechster Aufruf laeuft an, kein 409)', nachZeitlimit.code !== 409, `= ${nachZeitlimit.code}`);
      check('zweiter Versuch hat wirklich noch einmal systemctl gerufen (Beweis: Sperre war frei)', fakeLog2().length === 2, fakeLog2().join(','));
    } finally {
      kind2.kill('SIGTERM');
      await warte(200);
    }
  } finally {
    rmSync(ORDNER2, { recursive: true, force: true });
  }

  console.log(fehler === 0 ? '\nAlle Pruefungen gruen.' : `\n${fehler} Pruefung(en) fehlgeschlagen.`);
  process.exit(fehler > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
