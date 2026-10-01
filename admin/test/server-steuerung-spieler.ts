/**
 * GET /api/server: the number of connected players, read from the game server's
 * metrics snapshot (`peers`). Pure functions of `routen/serverSteuerung.ts`; the
 * file read itself is one line in `main.ts`.
 *
 *  1. A fresh snapshot gives `peers`; missing, unreadable, wrong-typed, negative, stale or
 *     future-dated snapshots give `null` (a stopped server must not show a number).
 *  2. `serverStatusLesen` carries `spieler` only while the service runs; without a source it is `null`.
 *  3. The field is added, nothing else changed (`dienst`, `zustand`, `instanz` stay).
 *  4. The REAL service as a process (systemctl stand-in): `main.ts` reads `server/data/metriken.json` — fresh file,
 *     peers 3 → 3; no file, stale file, stopped service → null (N1, M3: the wiring in main.ts had no witness).
 *
 * Run: npx tsx test/server-steuerung-spieler.ts   (from admin/)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { request } from 'node:http';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { METRIK_ALTER_MAX_MS, serverStatusLesen, spielerAusMetriken, type ServerSteuerungUmgebung } from '../src/routen/serverSteuerung.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else console.log(`ok   ${name}`);
}

const JETZT = 5_000_000;
const snap = (zeitMs: unknown, peers: unknown): string => JSON.stringify({ zeitMs, peers, tickAnzahl: 30 });

check('frischer Schnappschuss: peers', spielerAusMetriken(snap(JETZT - 1000, 3), JETZT) === 3);
check('0 Spieler ist eine Zahl, kein null', spielerAusMetriken(snap(JETZT, 0), JETZT) === 0);
check('Datei fehlt → null', spielerAusMetriken(null, JETZT) === null);
check('kein JSON → null', spielerAusMetriken('{kaputt', JETZT) === null);
check('peers fehlt → null', spielerAusMetriken(JSON.stringify({ zeitMs: JETZT }), JETZT) === null);
check('peers als Text → null', spielerAusMetriken(snap(JETZT, '3'), JETZT) === null);
check('peers negativ → null', spielerAusMetriken(snap(JETZT, -1), JETZT) === null);
check('peers gebrochen → null', spielerAusMetriken(snap(JETZT, 1.5), JETZT) === null);
check('zeitMs fehlt → null', spielerAusMetriken(JSON.stringify({ peers: 2 }), JETZT) === null);
check('Schnappschuss genau an der Altersgrenze zählt noch', spielerAusMetriken(snap(JETZT - METRIK_ALTER_MAX_MS, 2), JETZT) === 2);
check('veralteter Schnappschuss (Server aus) → null', spielerAusMetriken(snap(JETZT - METRIK_ALTER_MAX_MS - 1, 2), JETZT) === null);
check('Schnappschuss aus der Zukunft → null', spielerAusMetriken(snap(JETZT + METRIK_ALTER_MAX_MS + 1, 2), JETZT) === null);

function umg(aktiv: boolean, spieler?: () => number | null): ServerSteuerungUmgebung {
  return {
    instanz: 'dev',
    zustand: async () => ({ aktiv, seit: 'x', roh: aktiv ? 'active' : 'inactive' }),
    neustart: async () => {},
    stoppen: async () => {},
    starten: async () => {},
    ...(spieler ? { spieler } : {}),
  };
}

const laeuft = await serverStatusLesen(umg(true, () => 7));
check('laufender Dienst: spieler = 7', (laeuft.daten as { spieler?: unknown }).spieler === 7);
check('Form bleibt: dienst, zustand, instanz', laeuft.code === 200 && (laeuft.daten as { dienst?: string; instanz?: string }).dienst === 'wov-server' && (laeuft.daten as { instanz?: string }).instanz === 'dev' && (laeuft.daten as { zustand?: { aktiv?: boolean } }).zustand?.aktiv === true);
const aus = await serverStatusLesen(umg(false, () => 7));
check('gestoppter Dienst: spieler = null', (aus.daten as { spieler?: unknown }).spieler === null);
const ohne = await serverStatusLesen(umg(true));
check('ohne Quelle: spieler = null', (ohne.daten as { spieler?: unknown }).spieler === null);
const unbekannt = await serverStatusLesen(umg(true, () => null));
check('Quelle ohne Zahl: spieler = null', (unbekannt.daten as { spieler?: unknown }).spieler === null);


// ── 4. der echte Betriebsdienst ─────────────────────────────────────────

const HIER = dirname(fileURLToPath(import.meta.url));
const ADMIN = resolve(HIER, '..');
const ORDNER = mkdtempSync(resolve(tmpdir(), 'wov-spieler-'));
const DATEN = resolve(ORDNER, 'server/data');
const FAKE = resolve(ORDNER, 'fake');
const TOKEN = 'spieler-token-5512';
const TOKEN_DATEI = resolve(ORDNER, 'token');
const FAKE_SYSTEMCTL = resolve(FAKE, 'systemctl');
for (const d of [resolve(DATEN, 'welten'), resolve(DATEN, 'worlds'), FAKE]) mkdirSync(d, { recursive: true });
writeFileSync(TOKEN_DATEI, `${TOKEN}\n`);
writeFileSync(
  FAKE_SYSTEMCTL,
  `#!/bin/sh
D="${FAKE}"
case "$1" in
  show) if [ -f "$D/aktiv" ]; then echo "ActiveState=active"; echo "ActiveEnterTimestamp=Mon 2026-09-29 00:09:40 UTC"; else echo "ActiveState=inactive"; fi ;;
esac
exit 0
`
);
chmodSync(FAKE_SYSTEMCTL, 0o755);
const METRIK = resolve(DATEN, 'metriken.json');
const aktiv = (an: boolean): void => (an ? writeFileSync(resolve(FAKE, 'aktiv'), '') : rmSync(resolve(FAKE, 'aktiv'), { force: true }));

function starten(): Promise<{ port: number; kind: ChildProcess }> {
  return new Promise((fertig, scheitern) => {
    const kind = spawn(resolve(ADMIN, '../node_modules/.bin/tsx'), ['src/main.ts'], {
      cwd: ADMIN,
      env: {
        ...process.env,
        WOV_WURZEL: ORDNER,
        WOV_WELT_VERZEICHNIS: resolve(DATEN, 'welten'),
        WOV_INSTANZ: 'dev',
        WOV_ADMIN_ADRESSE: '127.0.0.1',
        WOV_ADMIN_PORT: '0',
        WOV_QUITTUNG: 'aus',
        NODE_ENV: 'test',
        WOV_ADMIN_TOKEN_DATEI: TOKEN_DATEI,
        WOV_SYSTEMCTL: FAKE_SYSTEMCTL,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let puffer = '';
    const zeitgrenze = setTimeout(() => scheitern(new Error(`Dienst startet nicht:\n${puffer}`)), 30_000);
    kind.stdout!.on('data', (s: Buffer) => {
      puffer += s.toString();
      const t = /bereit auf 127\.0\.0\.1:(\d+)/.exec(puffer);
      if (t) {
        clearTimeout(zeitgrenze);
        fertig({ port: Number(t[1]), kind });
      }
    });
    kind.stderr!.on('data', (s: Buffer) => (puffer += s.toString()));
    kind.on('exit', (code) => {
      clearTimeout(zeitgrenze);
      scheitern(new Error(`Dienst beendet mit ${code}:\n${puffer}`));
    });
  });
}

function holeServer(port: number): Promise<{ code: number; daten: Record<string, unknown> }> {
  return new Promise((fertig, scheitern) => {
    const req = request({ host: '127.0.0.1', port, path: '/api/server', method: 'GET', headers: { 'x-wov-token': TOKEN } }, (res) => {
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
    });
    req.on('error', scheitern);
    req.end();
  });
}

aktiv(true);
const { port, kind } = await starten();
try {
  const frisch = (peers: unknown, alterMs = 0): void => writeFileSync(METRIK, JSON.stringify({ zeitMs: Date.now() - alterMs, peers, tickAnzahl: 30 }));
  rmSync(METRIK, { force: true });
  const fehlt = await holeServer(port);
  check('Dienst: Metrikdatei fehlt → 200, spieler null', fehlt.code === 200 && fehlt.daten.spieler === null);
  frisch(3);
  const gut = await holeServer(port);
  check('Dienst: frische Datei, peers 3 → spieler 3 (main.ts liest die Datei)', gut.daten.spieler === 3, JSON.stringify(gut.daten));
  check('Dienst: Antwort trägt nur dienst, instanz, spieler, zustand', Object.keys(gut.daten).sort().join(',') === 'dienst,instanz,spieler,zustand');
  frisch(4, METRIK_ALTER_MAX_MS + 2_000);
  check('Dienst: veraltete Datei → null', (await holeServer(port)).daten.spieler === null);
  frisch(5);
  aktiv(false);
  check('Dienst: frische Datei, Dienst inaktiv → null', (await holeServer(port)).daten.spieler === null);
} finally {
  kind.removeAllListeners('exit');
  const beendet = new Promise<void>((f) => kind.once('exit', () => f()));
  kind.kill('SIGTERM');
  await Promise.race([beendet, new Promise((f) => setTimeout(f, 5000))]);
  rmSync(ORDNER, { recursive: true, force: true });
}

process.exit(fehler === 0 ? 0 : 1);
