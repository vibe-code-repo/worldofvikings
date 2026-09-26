/**
 * Reset the world to zero (Editor K4.0): POST/GET /api/welt-zuruecksetzen.
 *
 *   npx tsx test/welt-zuruecksetzen.ts      (from admin/)
 *
 * Two layers, because they prove different things:
 *
 *  A. The REAL operations service as a process, driven over HTTP. It is given
 *     a stand-in for `systemctl` (WOV_SYSTEMCTL, a shell script of ours) that
 *     touches nothing but a state file and a log in the temp folder, and that
 *     writes down what the save folder looked like at the moment of `stop` and
 *     of `start`. That is the witness for the order "stopped while swapped".
 *     Nothing here may reach the real `wov-server`: the stand-in is set for
 *     every process this test starts (a missing WOV_SYSTEMCTL would run the
 *     real systemctl and stop the running game server).
 *  B. The route module itself with a fake service, for the cases a process
 *     cannot stage: a step that throws in the middle (undo), a start that
 *     fails, a second request while one is running, taken names.
 *
 * Everything happens in a folder under os.tmpdir(), never in server/data/.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- the answers are parsed JSON whose fields this test asserts one by one; a full type per answer would restate the route. */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { request, type IncomingMessage } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import { sanitizeWorldLayout } from '@wov/shared/src/worldlayout/sanitize.js';
import { layoutHash, layoutText } from '@wov/shared/src/worldlayout/layoutDatei.js';
import * as ts from 'typescript';
import type { ResetUmgebung } from '../src/routen/weltZuruecksetzen.js';

// ── Helper mode: the reset in a process of its own, killed hard at a chosen step ─────────
// The parent (section D) starts this file again with WOV_ZUR_HELFER set. It runs the real route module against the folder
// it is given, with a service stand-in that only writes a log, and `SIGKILL`s ITSELF when the chosen step is reached:
// no `finally`, no exit handler, exactly what an OOM kill or `kill -9` does to the operations service.
if (process.env.WOV_ZUR_HELFER) {
  const wurzel = process.env.WOV_ZUR_WURZEL!;
  const schritt = process.env.WOV_ZUR_SCHRITT!;
  const { weltZuruecksetzenBehandeln } = await import('../src/routen/weltZuruecksetzen.js');
  const protokoll = resolve(wurzel, 'dienst.log');
  await weltZuruecksetzenBehandeln(
    { bestaetigung: 'dev', seed: 'behalten', konten: false },
    {
      instanz: 'dev',
      instanzBestimmt: true,
      layoutDatei: resolve(wurzel, 'server/data/welten/dev.json'),
      spielstand: resolve(wurzel, 'server/data/worlds/dev.db.zst'),
      kontenDb: resolve(wurzel, 'server/data/konten/dev.db'),
      dienstStoppen: async () => void writeFileSync(protokoll, 'stop\n', { flag: 'a' }),
      dienstStarten: async () => void writeFileSync(protokoll, 'start\n', { flag: 'a' }),
      dienstZustand: async () => ({ aktiv: false, seit: null }),
      sichern: (datei) => {
        const ziel = `${datei}.helfer.bak`;
        copyFileSync(datei, ziel);
        return ziel;
      },
      vorSchritt: (s) => {
        if (s === schritt) process.kill(process.pid, 'SIGKILL');
      },
    }
  );
  process.exit(0);
}

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

const sha = (datei: string): string => createHash('sha256').update(readFileSync(datei)).digest('hex');
const warte = (ms: number): Promise<void> => new Promise((f) => setTimeout(f, ms));

// ── Fixtures ──────────────────────────────────────────────────────────

const ORDNER = mkdtempSync(resolve(tmpdir(), 'wov-zuruecksetzen-'));
// Also when a check throws halfway (e.g. against a service without the route): the temp folder must not stay behind.
process.on('exit', () => rmSync(ORDNER, { recursive: true, force: true }));
const WELTEN = resolve(ORDNER, 'server/data/welten');
const SAVES = resolve(ORDNER, 'server/data/worlds');
const KONTEN = resolve(ORDNER, 'server/data/konten');
const FAKE = resolve(ORDNER, 'fake');
const TOKEN = 'pruef-token-9042';
const TOKEN_DATEI = resolve(ORDNER, 'token');
const FAKE_SYSTEMCTL = resolve(FAKE, 'systemctl');
for (const d of [WELTEN, SAVES, KONTEN, FAKE]) mkdirSync(d, { recursive: true });
writeFileSync(TOKEN_DATEI, `${TOKEN}\n`);

const ZDOS = 137;

const WELT_ROH = {
  version: 1,
  name: 'Pruefwelt',
  detailSeed: 'pruefseed',
  continents: [{ id: 'nord', name: 'Nordland', faction: 'viking' }],
  regions: [
    { id: 'heim', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1200 }, edgeFalloff: 300 },
    { id: 'fern', biome: 'blackforest', shape: { kind: 'circle', x: 4000, z: 0, radius: 800 }, edgeFalloff: 200 },
  ],
  placements: [
    { prefab: 'Beech1', x: 12.5, z: -30 },
    { prefab: 'Beech1', x: 40, z: 22 },
    { prefab: 'Beech1', x: 80, z: -5, npc: { name: 'Alte Buche' } },
  ],
  rivers: [{ id: 'fluss', points: [[0, 0], [300, 200], [600, 250]] }],
  lakes: [{ id: 'see', x: 100, z: 100, radius: 60 }],
  defaultSpawn: [10, 10],
};
const WELT_TEXT = layoutText(sanitizeWorldLayout(WELT_ROH)!);

function saveBytes(zdos = ZDOS): Buffer {
  const umschlag = {
    version: 3,
    meta: { worldName: 'dev', worldSeed: 1, worldGenVersion: 1, savedAt: '2026-09-20T20:00:00.000Z' },
    zdos: Array.from({ length: zdos }, (_, i) => ({ id: i, prefab: 'Beech1' })),
  };
  return zstdCompressSync(Buffer.from(JSON.stringify(umschlag), 'utf-8'));
}

/** ZDOs in a save, counted here with the same format knowledge as the game server's writer (independent of the route). */
const zdosDatei = (pfad: string): number => {
  try {
    return (JSON.parse(zstdDecompressSync(readFileSync(pfad)).toString('utf-8')) as { zdos: unknown[] }).zdos.length;
  } catch {
    return -1;
  }
};

/** A real account database in WAL mode; the handle stays open so `-wal` and `-shm` exist like on a running server. */
function kontenBauen(instanz: string): DatabaseSync {
  const db = new DatabaseSync(resolve(KONTEN, `${instanz}.db`));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('CREATE TABLE konten (id INTEGER PRIMARY KEY, benutzername TEXT); CREATE TABLE charaktere (id INTEGER PRIMARY KEY, konto_id INTEGER, name TEXT);');
  for (let i = 1; i <= 3; i++) db.prepare('INSERT INTO konten (id, benutzername) VALUES (?, ?)').run(i, `konto${i}`);
  for (let i = 1; i <= 5; i++) db.prepare('INSERT INTO charaktere (id, konto_id, name) VALUES (?, ?, ?)').run(i, (i % 3) + 1, `figur${i}`);
  return db;
}

function fixturenSchreiben(instanz = 'dev'): void {
  writeFileSync(resolve(WELTEN, `${instanz}.json`), WELT_TEXT);
  writeFileSync(resolve(SAVES, `${instanz}.db.zst`), saveBytes());
  writeFileSync(resolve(SAVES, `${instanz}.db.zst.prev`), saveBytes(ZDOS - 7));
}

/** Path → size, mtime and hash of every file under server/data: "nothing touched" means this map is equal. */
function abbild(): string {
  const zeilen: string[] = [];
  const geh = (ordner: string): void => {
    for (const name of readdirSync(ordner).sort()) {
      const pfad = resolve(ordner, name);
      const s = statSync(pfad);
      if (s.isDirectory()) geh(pfad);
      // The service reads the account database read-only; SQLite writes into the shared-memory file (`-shm`) even for that. Only its name counts.
      else zeilen.push(pfad.endsWith('-shm') ? relative(ORDNER, pfad) : `${relative(ORDNER, pfad)} ${s.size} ${s.mtimeMs} ${sha(pfad)}`);
    }
  };
  geh(resolve(ORDNER, 'server/data'));
  return zeilen.join('\n');
}

// ── Stand-in for systemctl ────────────────────────────────────────────

writeFileSync(
  FAKE_SYSTEMCTL,
  `#!/bin/sh
D="${FAKE}"
echo "$1 $2" >> "$D/log"
case "$1" in
  show)
    if [ -f "$D/aktiv" ]; then echo "ActiveState=active"; echo "ActiveEnterTimestamp=Sun 2026-09-20 20:00:00 UTC"; else echo "ActiveState=inactive"; fi ;;
  stop)
    if [ -f "$D/stop-fehler" ]; then echo "boom" >&2; exit 1; fi
    if [ -f "$D/stop-langsam" ]; then sleep 1.5; fi
    ls "${SAVES}" > "$D/beim-stop-saves.txt"; ls "${KONTEN}" > "$D/beim-stop-konten.txt"; cp "${WELTEN}/dev.json" "$D/beim-stop-dev.json" 2>/dev/null
    # The real game server writes its save when it stops (SIGTERM): the file is there only AFTER this line.
    if [ -f "$D/stop-schreibt-save" ]; then cp "$D/save-vorlage" "${SAVES}/dev.db.zst"; fi
    rm -f "$D/aktiv" ;;
  start)
    ls "${SAVES}" > "$D/beim-start-saves.txt"; ls "${KONTEN}" > "$D/beim-start-konten.txt"; cp "${WELTEN}/dev.json" "$D/beim-start-dev.json" 2>/dev/null
    touch "$D/aktiv" ;;
esac
exit 0
`
);
chmodSync(FAKE_SYSTEMCTL, 0o755);

const fakeLog = (): string[] => (existsSync(resolve(FAKE, 'log')) ? readFileSync(resolve(FAKE, 'log'), 'utf-8').trim().split('\n').filter((z) => z && !z.startsWith('show')) : []);
const fakeLogLeeren = (): void => rmSync(resolve(FAKE, 'log'), { force: true });
const fakeSchalter = (name: string, an: boolean): void => (an ? writeFileSync(resolve(FAKE, name), '') : rmSync(resolve(FAKE, name), { force: true }));
const fakeAktiv = (): boolean => existsSync(resolve(FAKE, 'aktiv'));
const fakeLesen = (name: string): string[] => (existsSync(resolve(FAKE, name)) ? readFileSync(resolve(FAKE, name), 'utf-8').split('\n').filter(Boolean) : []);

// ── Start the service ─────────────────────────────────────────────────

function starten(instanz: 'dev' | 'live' | string | null, wurzel = ORDNER, extraEnv: Record<string, string | null> = {}): Promise<{ port: number; kind: ChildProcess; log: () => string }> {
  return new Promise((fertig, scheitern) => {
    const env: Record<string, string | undefined> = {
      ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'WOV_INSTANZ' || instanz !== null)),
      WOV_WURZEL: wurzel,
      // K5.7: die Welt liegt als Arbeitskopie im Weltverzeichnis; hier dasselbe wie die Wurzel-Datei (kein Abgleich, nie /var/lib/wov).
      WOV_WELT_VERZEICHNIS: resolve(wurzel, 'server/data/welten'),
      // null: the variable is not in the environment at all
      ...(instanz === null ? {} : { WOV_INSTANZ: instanz }),
      WOV_ADMIN_ADRESSE: '127.0.0.1',
      WOV_ADMIN_PORT: '0',
      WOV_ADMIN_TOKEN_DATEI: TOKEN_DATEI,
      // Not 'production' unless a test says so: with a stand-in set, the service refuses to start there.
      NODE_ENV: 'test',
      // The stand-in. Without it these tests would stop the real game server.
      WOV_SYSTEMCTL: FAKE_SYSTEMCTL,
    };
    for (const [k, v] of Object.entries(extraEnv)) {
      if (v === null) delete env[k];
      else env[k] = v;
    }
    const kind = spawn(resolve(WURZEL_PROJEKT, 'node_modules/.bin/tsx'), ['src/main.ts'], { cwd: ADMIN, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let puffer = '';
    const zeitgrenze = setTimeout(() => scheitern(new Error(`Dienst startet nicht:\n${puffer}`)), 30_000);
    kind.stdout.on('data', (s: Buffer) => {
      puffer += s.toString();
      const t = /bereit auf 127\.0\.0\.1:(\d+)/.exec(puffer);
      if (t) {
        clearTimeout(zeitgrenze);
        fertig({ port: Number(t[1]), kind, log: () => puffer });
      }
    });
    kind.stderr.on('data', (s: Buffer) => (puffer += s.toString()));
    kind.on('exit', (code) => {
      clearTimeout(zeitgrenze);
      scheitern(new Error(`Dienst beendet mit ${code}:\n${puffer}`));
    });
  });
}

type Antwort = { code: number; text: string; daten: Record<string, any> };

function anfrage(opt: { port: number; pfad: string; methode?: string; token?: string | null; leib?: string; basis?: string; kopf?: Record<string, string>; ohneContentType?: boolean }): Promise<Antwort> {
  return new Promise((fertig, scheitern) => {
    const kopf: Record<string, string> = {};
    if (opt.token !== null) kopf['x-wov-token'] = opt.token ?? TOKEN;
    if (opt.basis) kopf['if-match'] = `"${opt.basis}"`;
    if (opt.leib !== undefined) {
      kopf['content-type'] = 'application/json';
      kopf['content-length'] = String(Buffer.byteLength(opt.leib));
    }
    Object.assign(kopf, opt.kopf ?? {});
    if (opt.ohneContentType) delete kopf['content-type'];
    const req = request({ host: '127.0.0.1', port: opt.port, path: opt.pfad, method: opt.methode ?? 'GET', headers: kopf }, (res: IncomingMessage) => {
      let text = '';
      res.setEncoding('utf-8');
      res.on('data', (s: string) => (text += s));
      res.on('end', () => {
        let daten: Record<string, any> = {};
        try {
          daten = JSON.parse(text) as Record<string, any>;
        } catch {
          /* not JSON: the raw text stays in `text` */
        }
        fertig({ code: res.statusCode ?? 0, text, daten });
      });
    });
    req.on('error', scheitern);
    if (opt.leib !== undefined) req.write(opt.leib);
    req.end();
  });
}

const PFAD = '/api/welt-zuruecksetzen';
const reset = (port: number, leib: unknown, extra: { token?: string | null; methode?: string } = {}): Promise<Antwort> =>
  anfrage({ port, pfad: PFAD, methode: extra.methode ?? 'POST', token: extra.token, leib: leib === undefined ? undefined : JSON.stringify(leib) });

const sicherungsName = (a: Antwort, feld: 'spielstand' | 'weltdokument'): string | null => (a.daten.sicherung as Record<string, string | null> | undefined)?.[feld] ?? null;

// ══ A. The real service ═══════════════════════════════════════════════

let dev: { port: number; kind: ChildProcess } | null = null;
let live: { port: number; kind: ChildProcess } | null = null;
let kontenDb: DatabaseSync | null = null;
try {
  dev = await starten('dev', ORDNER, { WOV_ERLAUBTE_URSPRUENGE: 'erlaubt.example' });
  live = await starten('live');
  const port = dev.port;

  // ── A1. Safeguards: nothing may be touched ──────────────────────────
  console.log('\n[A1] Absicherung — jede Ablehnung laesst die Platte unangetastet:');
  fixturenSchreiben('dev');
  fixturenSchreiben('live');
  kontenDb = kontenBauen('dev');
  fakeSchalter('aktiv', true);
  fakeLogLeeren();
  const vorher = abbild();

  const ohneToken = await reset(port, { bestaetigung: 'dev', seed: 'behalten' }, { token: null });
  check('ohne Token → 401', ohneToken.code === 401, `= ${ohneToken.code}`);
  const falschesToken = await reset(port, { bestaetigung: 'dev', seed: 'behalten' }, { token: 'falsch' });
  check('falsches Token → 401', falschesToken.code === 401, `= ${falschesToken.code}`);
  const ohneGet = await anfrage({ port, pfad: PFAD, token: null });
  check('GET ohne Token → 401', ohneGet.code === 401, `= ${ohneGet.code}`);

  const schlechte: [string, unknown][] = [
    ['leeres Objekt', {}],
    ['bestaetigung fehlt', { seed: 'behalten' }],
    ['bestaetigung "live"', { bestaetigung: 'live', seed: 'behalten' }],
    ['bestaetigung "DEV" (Gross)', { bestaetigung: 'DEV', seed: 'behalten' }],
    ['bestaetigung "dev " (Leerzeichen)', { bestaetigung: 'dev ', seed: 'behalten' }],
    ['bestaetigung " dev"', { bestaetigung: ' dev', seed: 'behalten' }],
    ['bestaetigung als Zahl', { bestaetigung: 0, seed: 'behalten' }],
    ['bestaetigung als Liste', { bestaetigung: ['dev'], seed: 'behalten' }],
    ['bestaetigung true', { bestaetigung: true, seed: 'behalten' }],
    ['seed fehlt', { bestaetigung: 'dev' }],
    ['seed "alle"', { bestaetigung: 'dev', seed: 'alle' }],
    ['konten als Text', { bestaetigung: 'dev', seed: 'behalten', konten: 'ja' }],
    ['konten als Zahl 1', { bestaetigung: 'dev', seed: 'behalten', konten: 1 }],
    ['Rumpf ist eine Liste', ['dev']],
    ['Rumpf ist null', null],
  ];
  for (const [name, leib] of schlechte) {
    const a = await reset(port, leib);
    check(`400 bei ${name}`, a.code === 400, `= ${a.code} ${a.text.slice(0, 100)}`);
  }
  const ohneRumpf = await reset(port, undefined);
  check('ohne Rumpf und ohne Content-Type → 415 (die Anfrage ist gar keine JSON-Anfrage)', ohneRumpf.code === 415, `= ${ohneRumpf.code}`);
  const kaputtesJson = await anfrage({ port, pfad: PFAD, methode: 'POST', leib: '{"bestaetigung":' });
  check('kaputtes JSON → 400', kaputtesJson.code === 400, `= ${kaputtesJson.code}`);
  const falscheMethode = await anfrage({ port, pfad: PFAD, methode: 'PUT', leib: '{}' });
  check('PUT → 405', falscheMethode.code === 405, `= ${falscheMethode.code}`);
  check('Platte nach allen Ablehnungen bitgleich, mtime unveraendert', abbild() === vorher);
  check('kein einziger systemctl-Aufruf (stop/start) bei Ablehnungen', fakeLog().length === 0, fakeLog().join(' | '));
  check('Server lief die ganze Zeit', fakeAktiv());

  // live
  const liveVorher = abbild();
  const liveVorschau = await anfrage({ port: live.port, pfad: PFAD });
  check('live: GET → erlaubt=false mit Grund', liveVorschau.code === 200 && liveVorschau.daten.erlaubt === false && typeof liveVorschau.daten.grund === 'string', JSON.stringify(liveVorschau.daten).slice(0, 160));
  const liveReset = await reset(live.port, { bestaetigung: 'live', seed: 'behalten', konten: true });
  check('live: POST mit korrekter Bestaetigung → 403', liveReset.code === 403, `= ${liveReset.code}`);
  const liveReset2 = await reset(live.port, { bestaetigung: 'dev', seed: 'behalten' });
  check('live: POST mit falscher Bestaetigung → ebenfalls 403 (Sperre zuerst)', liveReset2.code === 403, `= ${liveReset2.code}`);
  const liveReset3 = await reset(live.port, {});
  check('live: POST mit leerem Objekt → 403 (die Sperre kommt vor der Rumpfpruefung)', liveReset3.code === 403, `= ${liveReset3.code}`);
  check('live: Platte bitgleich, kein systemctl-Aufruf', abbild() === liveVorher && fakeLog().length === 0);

  // active test world
  writeFileSync(resolve(SAVES, 'dev.db.zst.beiseite'), 'echte welt');
  const mitTestwelt = abbild();
  const testwelt = await reset(port, { bestaetigung: 'dev', seed: 'behalten' });
  check('aktive Testwelt → 409', testwelt.code === 409 && testwelt.daten.fehler === 'testwelt-aktiv', `= ${testwelt.code} ${testwelt.text.slice(0, 100)}`);
  check('aktive Testwelt: Platte bitgleich, kein systemctl-Aufruf', abbild() === mitTestwelt && fakeLog().length === 0);
  unlinkSync(resolve(SAVES, 'dev.db.zst.beiseite'));

  // ── A2. Preview ──────────────────────────────────────────────────────
  console.log('\n[A2] GET — die Zahlen:');
  const vorschau = await anfrage({ port, pfad: PFAD });
  const z = vorschau.daten.zahlen as Record<string, any> | undefined;
  check('GET → 200, erlaubt=true, testweltAktiv=false', vorschau.code === 200 && vorschau.daten.erlaubt === true && vorschau.daten.testweltAktiv === false, JSON.stringify(vorschau.daten).slice(0, 200));
  check('Zahlen: 3 Platzierungen, 2 Regionen, 1 Fluss, 1 See, 1 Kontinent', z?.weltdokument?.platzierungen === 3 && z?.weltdokument?.regionen === 2 && z?.weltdokument?.fluesse === 1 && z?.weltdokument?.seen === 1 && z?.weltdokument?.kontinente === 1, JSON.stringify(z?.weltdokument));
  check(`Zahlen: Spielstand ${ZDOS} ZDOs, Groesse = Dateigroesse`, z?.spielstand?.zdos === ZDOS && z?.spielstand?.bytes === statSync(resolve(SAVES, 'dev.db.zst')).size, JSON.stringify(z?.spielstand));
  check('Zahlen: 3 Konten, 5 Charaktere', z?.konten?.konten === 3 && z?.konten?.charaktere === 5, JSON.stringify(z?.konten));
  const nachGet = abbild();
  check('GET aendert nichts und ruft kein systemctl stop/start', nachGet === vorher && fakeLog().length === 0, nachGet.split('\n').filter((zeile) => !vorher.includes(zeile)).join(' || '));

  // ── A2b. The guard for every other writer stays ────────────────────
  const leerDoku = { version: 1, name: 'Pruefwelt', detailSeed: 'x', continents: [], regions: [], placements: [] };
  const vorLeer = abbild();
  const leerSpeichern = await anfrage({ port, pfad: '/api/worldlayout', methode: 'POST', leib: JSON.stringify(leerDoku), basis: layoutHash(readFileSync(resolve(WELTEN, 'dev.json'))) });
  check('POST /api/worldlayout mit 0 Regionen bleibt abgelehnt (400)', leerSpeichern.code === 400 && abbild() === vorLeer, `= ${leerSpeichern.code} ${leerSpeichern.text.slice(0, 100)}`);

  // ── A3. The reset: seed kept, no accounts ────────────────────────────
  console.log('\n[A3] Zuruecksetzen (seed behalten, ohne Konten):');
  const dateiVorher = { save: sha(resolve(SAVES, 'dev.db.zst')), prev: sha(resolve(SAVES, 'dev.db.zst.prev')), welt: sha(resolve(WELTEN, 'dev.json')), konten: sha(resolve(KONTEN, 'dev.db')) };
  const kontenAbbild = readdirSync(KONTEN).sort().join(',');
  fakeLogLeeren();
  const a3 = await reset(port, { bestaetigung: 'dev', seed: 'behalten' });
  check('200 ok', a3.code === 200 && a3.daten.ok === true, `= ${a3.code} ${a3.text.slice(0, 200)}`);
  const kennung = String(a3.daten.kennung ?? '');
  check('Kennung hat die Form JJJJ-MM-TT_HHMM', /^\d{4}-\d{2}-\d{2}_\d{4}(-\d+)?$/.test(kennung), kennung);
  check('Antwort nennt die Zahlen von vorher (3 / 2 / 1 / 137)', a3.daten.vorher?.weltdokument?.platzierungen === 3 && a3.daten.vorher?.weltdokument?.regionen === 2 && a3.daten.vorher?.spielstand?.zdos === ZDOS, JSON.stringify(a3.daten.vorher));
  check('stop VOR start, je genau einmal', fakeLog().join(',') === 'stop wov-server,start wov-server', fakeLog().join(','));
  check('Server laeuft danach', fakeAktiv() && a3.daten.zustand?.aktiv === true);
  const beimStop = fakeLesen('beim-stop-saves.txt');
  const beimStart = fakeLesen('beim-start-saves.txt');
  check('beim Stoppen lag der Spielstand noch da (Tausch erst danach)', beimStop.includes('dev.db.zst') && beimStop.includes('dev.db.zst.prev'), beimStop.join(' '));
  check('beim Start war er weg, beiseite lag da', !beimStart.includes('dev.db.zst') && !beimStart.includes('dev.db.zst.prev') && beimStart.includes(`dev.db.zst.vor-reset-${kennung}`), beimStart.join(' '));
  check('beim Stoppen stand noch das alte Weltdokument da', sha(resolve(FAKE, 'beim-stop-dev.json')) === dateiVorher.welt);
  check('beim Start stand das neue Weltdokument da (Hash der Antwort)', layoutHash(readFileSync(resolve(FAKE, 'beim-start-dev.json'))) === a3.daten.hash);
  check('Spielstand beiseite, Bytes unveraendert', sha(resolve(SAVES, `dev.db.zst.vor-reset-${kennung}`)) === dateiVorher.save);
  check('.prev beiseite, Bytes unveraendert', sha(resolve(SAVES, `dev.db.zst.prev.vor-reset-${kennung}`)) === dateiVorher.prev);
  check('Spielstand und .prev liegen NICHT mehr unter dem Originalnamen', !existsSync(resolve(SAVES, 'dev.db.zst')) && !existsSync(resolve(SAVES, 'dev.db.zst.prev')));
  const sSave = sicherungsName(a3, 'spielstand');
  const sWelt = sicherungsName(a3, 'weltdokument');
  check('Sicherung Spielstand (.bak) genannt, vorhanden, Bytes gleich', !!sSave && /\.bak$/.test(sSave) && existsSync(resolve(SAVES, sSave)) && sha(resolve(SAVES, sSave)) === dateiVorher.save, String(sSave));
  check('Sicherung Weltdokument genannt (<instanz>.json.<Kennung>), vorhanden, Bytes gleich dem alten Dokument', sWelt === `dev.json.${kennung}` && existsSync(resolve(SAVES, sWelt)) && sha(resolve(SAVES, sWelt)) === dateiVorher.welt, String(sWelt));
  check('die Weltdokument-Kopie liegt NICHT in server/data/welten/ (git-Schmutz)', !readdirSync(WELTEN).some((f) => f.startsWith('dev.json.') && !f.endsWith('.bak')), readdirSync(WELTEN).join(' '));
  const neu = JSON.parse(readFileSync(resolve(WELTEN, 'dev.json'), 'utf-8')) as Record<string, unknown[]> & { name: string; detailSeed: string; version: number };
  check('neues Dokument: 0 Regionen, 0 Fluesse, 0 Platzierungen, 0 Seen, 0 Routen, 0 Kontinente', neu.regions.length === 0 && (neu.rivers?.length ?? 0) === 0 && (neu.placements?.length ?? 0) === 0 && (neu.lakes?.length ?? 0) === 0 && (neu.routes?.length ?? 0) === 0 && neu.continents.length === 0, JSON.stringify(neu).slice(0, 200));
  check('neues Dokument: kein Startpunkt mehr', !('defaultSpawn' in neu));
  check('neues Dokument: Name und Seed bleiben, Version stimmt', neu.name === 'Pruefwelt' && neu.detailSeed === 'pruefseed' && neu.version === 1, `${neu.name} ${neu.detailSeed}`);
  check('neues Dokument besteht den Sanitizer (nicht null)', sanitizeWorldLayout(neu) !== null);
  check('neues Dokument nicht gleich dem alten (Bytes)', sha(resolve(WELTEN, 'dev.json')) !== dateiVorher.welt);
  const hashDatei = layoutHash(readFileSync(resolve(WELTEN, 'dev.json')));
  check('Antwort.hash = Hash der Bytes auf der Platte', a3.daten.hash === hashDatei, `${a3.daten.hash} vs ${hashDatei}`);
  check('Antwort.dokument = das geschriebene Dokument (0 Regionen)', Array.isArray(a3.daten.dokument?.regions) && a3.daten.dokument.regions.length === 0 && a3.daten.dokument.detailSeed === 'pruefseed');
  check('Konten unberuehrt (Dateien und Bytes)', readdirSync(KONTEN).sort().join(',') === kontenAbbild && sha(resolve(KONTEN, 'dev.db')) === dateiVorher.konten);
  check('Antwort listet die beiseite gelegten Namen (2 Dateien)', Array.isArray(a3.daten.beiseite) && a3.daten.beiseite.length === 2, JSON.stringify(a3.daten.beiseite));

  // the base of the next save
  console.log('\n[A4] Der naechste Speichervorgang mit der neuen Basis:');
  const mitRegion = { ...neu, regions: [WELT_ROH.regions[0]], continents: WELT_ROH.continents };
  const speichernAlt = await anfrage({ port, pfad: '/api/worldlayout', methode: 'POST', leib: JSON.stringify(mitRegion), basis: dateiVorher.welt });
  check('mit der ALTEN Basis (vor dem Reset) → 409', speichernAlt.code === 409, `= ${speichernAlt.code}`);
  const speichernNeu = await anfrage({ port, pfad: '/api/worldlayout', methode: 'POST', leib: JSON.stringify(mitRegion), basis: String(a3.daten.hash) });
  check('mit der Basis aus der Antwort → 200 (nicht 409, nicht 428)', speichernNeu.code === 200, `= ${speichernNeu.code} ${speichernNeu.text.slice(0, 120)}`);
  const ohneBasis = await anfrage({ port, pfad: '/api/worldlayout', methode: 'POST', leib: JSON.stringify(mitRegion) });
  check('ohne Basis → 428 (der Vertrag gilt weiter)', ohneBasis.code === 428, `= ${ohneBasis.code}`);

  // ── A5. Second reset in the same minute: no name is reused ───────────
  console.log('\n[A5] Zweites Zuruecksetzen in derselben Minute (kein Name wird ueberschrieben):');
  writeFileSync(resolve(SAVES, 'dev.db.zst'), saveBytes(50));
  const zweiterSave = sha(resolve(SAVES, 'dev.db.zst'));
  const a5 = await reset(port, { bestaetigung: 'dev', seed: 'behalten' });
  check('200', a5.code === 200, `= ${a5.code} ${a5.text.slice(0, 160)}`);
  check('andere Kennung als beim ersten Mal', typeof a5.daten.kennung === 'string' && a5.daten.kennung !== kennung, `${a5.daten.kennung} vs ${kennung}`);
  check('der erste Satz beiseite liegt unveraendert da', sha(resolve(SAVES, `dev.db.zst.vor-reset-${kennung}`)) === dateiVorher.save && sha(resolve(SAVES, `dev.db.zst.prev.vor-reset-${kennung}`)) === dateiVorher.prev && sha(resolve(SAVES, `dev.json.${kennung}`)) === dateiVorher.welt);
  check('der zweite Satz ist der neue Spielstand (50 ZDOs)', sha(resolve(SAVES, `dev.db.zst.vor-reset-${a5.daten.kennung}`)) === zweiterSave && a5.daten.vorher?.spielstand?.zdos === 50, JSON.stringify(a5.daten.vorher?.spielstand));
  check('ohne .prev: nur 1 Datei beiseite', a5.daten.beiseite?.length === 1, JSON.stringify(a5.daten.beiseite));

  // ── A6. seed neu, no save at all, no test-world leftovers ────────────
  console.log('\n[A6] seed neu, ohne Spielstand:');
  fixturenSchreiben('dev');
  rmSync(resolve(SAVES, 'dev.db.zst'));
  rmSync(resolve(SAVES, 'dev.db.zst.prev'));
  const a6 = await reset(port, { bestaetigung: 'dev', seed: 'neu' });
  const neu6 = JSON.parse(readFileSync(resolve(WELTEN, 'dev.json'), 'utf-8')) as { detailSeed: string; name: string };
  check('200, kein Spielstand: vorher.spielstand=null, sicherung.spielstand=null, 0 Dateien beiseite', a6.code === 200 && a6.daten.vorher?.spielstand === null && sicherungsName(a6, 'spielstand') === null && a6.daten.beiseite?.length === 0, `= ${a6.code} ${a6.text.slice(0, 200)}`);
  check('seed neu: anderer Seed, nicht leer, hoechstens 64 Zeichen', neu6.detailSeed !== 'pruefseed' && neu6.detailSeed.length > 0 && neu6.detailSeed.length <= 64, neu6.detailSeed);
  check('Name bleibt', neu6.name === 'Pruefwelt');
  const a6b = await reset(port, { bestaetigung: 'dev', seed: 'neu' });
  const neu6b = JSON.parse(readFileSync(resolve(WELTEN, 'dev.json'), 'utf-8')) as { detailSeed: string };
  check('noch einmal seed neu: wieder ein anderer Seed', a6b.code === 200 && neu6b.detailSeed !== neu6.detailSeed, `${neu6.detailSeed} → ${neu6b.detailSeed}`);

  // ── A7. With accounts ────────────────────────────────────────────────
  console.log('\n[A7] konten: true:');
  fixturenSchreiben('dev');
  const kontenVorher = readdirSync(KONTEN).sort();
  const kontenShaVorher = { db: sha(resolve(KONTEN, 'dev.db')), wal: existsSync(resolve(KONTEN, 'dev.db-wal')) ? sha(resolve(KONTEN, 'dev.db-wal')) : null };
  check('Vorbedingung: dev.db, -wal und -shm liegen da', ['dev.db', 'dev.db-wal', 'dev.db-shm'].every((f) => kontenVorher.includes(f)), kontenVorher.join(' '));
  const a7 = await reset(port, { bestaetigung: 'dev', seed: 'behalten', konten: true });
  const k7 = String(a7.daten.kennung);
  check('200, Konten-Zahlen stehen in vorher (3 / 5)', a7.code === 200 && a7.daten.vorher?.konten?.konten === 3 && a7.daten.vorher?.konten?.charaktere === 5, `= ${a7.code} ${a7.text.slice(0, 200)}`);
  const kontenNachher = readdirSync(KONTEN).sort();
  check('dev.db, -wal, -shm sind weg vom Originalnamen', !kontenNachher.includes('dev.db') && !kontenNachher.includes('dev.db-wal') && !kontenNachher.includes('dev.db-shm'), kontenNachher.join(' '));
  check('alle drei liegen mit demselben Anhang da', ['dev.db', 'dev.db-wal', 'dev.db-shm'].every((f) => kontenNachher.includes(`${f}.vor-reset-${k7}`)), kontenNachher.join(' '));
  check('dev.db beiseite, Bytes unveraendert', sha(resolve(KONTEN, `dev.db.vor-reset-${k7}`)) === kontenShaVorher.db);
  check('-wal beiseite, Bytes unveraendert', kontenShaVorher.wal !== null && sha(resolve(KONTEN, `dev.db-wal.vor-reset-${k7}`)) === kontenShaVorher.wal);
  check('Antwort: konten=true, 5 Dateien beiseite (Spielstand, prev, db, wal, shm)', a7.daten.konten === true && a7.daten.beiseite?.length === 5, JSON.stringify(a7.daten.beiseite));
  const nachKonten = await anfrage({ port, pfad: PFAD });
  check('GET danach: keine Konten mehr (null)', nachKonten.daten.zahlen?.konten === null, JSON.stringify(nachKonten.daten.zahlen?.konten));
  // the moved files are a complete database: restore them by name and count
  const kopieDir = resolve(ORDNER, 'kontenkopie');
  mkdirSync(kopieDir);
  for (const f of ['dev.db', 'dev.db-wal', 'dev.db-shm']) copyFileSync(resolve(KONTEN, `${f}.vor-reset-${k7}`), resolve(kopieDir, f));
  {
    const rueck = new DatabaseSync(resolve(kopieDir, 'dev.db'), { readOnly: true });
    const n = (rueck.prepare('SELECT COUNT(*) AS n FROM charaktere').get() as { n: number }).n;
    rueck.close();
    check('die beiseite gelegte Kontendatenbank ist vollstaendig lesbar (5 Charaktere)', n === 5, `n=${n}`);
  }
  kontenDb.close();
  kontenDb = null;

  // ── A8. Failing stop; two at once ────────────────────────────────────
  console.log('\n[A8] Dienst laesst sich nicht stoppen / zwei Anfragen gleichzeitig:');
  fixturenSchreiben('dev');
  fakeSchalter('aktiv', true);
  fakeLogLeeren();
  const beiseiteVorher = readdirSync(SAVES).filter((f) => f.includes('vor-reset')).length;
  fakeSchalter('stop-fehler', true);
  const a8 = await reset(port, { bestaetigung: 'dev', seed: 'behalten' });
  fakeSchalter('stop-fehler', false);
  check('stop scheitert → 500 stopp-fehlgeschlagen', a8.code === 500 && a8.daten.fehler === 'stopp-fehlgeschlagen', `= ${a8.code} ${a8.text.slice(0, 160)}`);
  check('nichts getauscht: Spielstand und .prev noch da, Weltdokument noch das alte', existsSync(resolve(SAVES, 'dev.db.zst')) && existsSync(resolve(SAVES, 'dev.db.zst.prev')) && readFileSync(resolve(WELTEN, 'dev.json'), 'utf-8') === WELT_TEXT && readdirSync(SAVES).filter((f) => f.includes('vor-reset')).length === beiseiteVorher, readdirSync(SAVES).join(' '));
  check('trotzdem wurde start versucht (Server nicht liegen lassen)', fakeLog().join(',') === 'stop wov-server,start wov-server', fakeLog().join(','));

  fakeLogLeeren();
  fakeSchalter('stop-langsam', true);
  const [b1, b2] = await Promise.all([reset(port, { bestaetigung: 'dev', seed: 'behalten' }), (async () => (await warte(300), reset(port, { bestaetigung: 'dev', seed: 'behalten' })))()]);
  fakeSchalter('stop-langsam', false);
  const codes = [b1.code, b2.code].sort();
  check('zwei gleichzeitige Anfragen: einmal 200, einmal 409', codes[0] === 200 && codes[1] === 409, `= ${b1.code}, ${b2.code}`);
  check('die zweite meldet laeuft-bereits', [b1, b2].some((b) => b.daten.fehler === 'laeuft-bereits'));
  check('genau ein stop und ein start', fakeLog().join(',') === 'stop wov-server,start wov-server', fakeLog().join(','));
  const nachDoppel = await reset(port, { bestaetigung: 'dev', seed: 'behalten' });
  check('danach geht ein weiteres Zuruecksetzen wieder (Sperre frei)', nachDoppel.code === 200, `= ${nachDoppel.code}`);

  // ── A9. The save that is not there yet ──────────────────────────────
  // The game server writes its save when it STOPS (and every 30 minutes). Right after a reset, or a first start, there is no
  // save until the stop makes one: the file to move is the one that appears at the stop, not the one there before it.
  console.log('\n[A9] Kein Spielstand vor dem Stopp — der Server schreibt ihn erst beim Stopp:');
  fixturenSchreiben('dev');
  rmSync(resolve(SAVES, 'dev.db.zst'));
  rmSync(resolve(SAVES, 'dev.db.zst.prev'));
  const VORLAGE_ZDOS = 1371;
  writeFileSync(resolve(FAKE, 'save-vorlage'), saveBytes(VORLAGE_ZDOS));
  fakeSchalter('stop-schreibt-save', true);
  fakeSchalter('aktiv', true);
  fakeLogLeeren();
  const a9 = await reset(port, { bestaetigung: 'dev', seed: 'behalten' });
  fakeSchalter('stop-schreibt-save', false);
  const kennung9 = String(a9.daten.kennung);
  check('200 ok', a9.code === 200 && a9.daten.ok === true, `= ${a9.code} ${a9.text.slice(0, 160)}`);
  check('der beim Stopp entstandene Spielstand liegt NICHT mehr unter dem Originalnamen', !existsSync(resolve(SAVES, 'dev.db.zst')));
  check('… der Server hat beim Start keinen Spielstand mehr gefunden', !fakeLesen('beim-start-saves.txt').includes('dev.db.zst'), fakeLesen('beim-start-saves.txt').join(' '));
  check('… er liegt beiseite, Bytes gleich dem, was der Stopp geschrieben hat', existsSync(resolve(SAVES, `dev.db.zst.vor-reset-${kennung9}`)) && sha(resolve(SAVES, `dev.db.zst.vor-reset-${kennung9}`)) === sha(resolve(FAKE, 'save-vorlage')));
  check(`… mit ${VORLAGE_ZDOS} Objekten (unabhaengig gezaehlt)`, zdosDatei(resolve(SAVES, `dev.db.zst.vor-reset-${kennung9}`)) === VORLAGE_ZDOS);
  check('Antwort: beiseite nennt die Datei, spielstandBeiseite traegt die Zahl aus der Datei nach dem Stopp', Array.isArray(a9.daten.beiseite) && a9.daten.beiseite.length === 1 && a9.daten.spielstandBeiseite?.zdos === VORLAGE_ZDOS, JSON.stringify(a9.daten.beiseite));
  check('Antwort: vorher.spielstand ist null (vor dem Stopp gab es keinen)', a9.daten.vorher?.spielstand === null);
  const sSave9 = sicherungsName(a9, 'spielstand');
  check('es gibt trotzdem eine Sicherung des Spielstands (.bak, nach dem Stopp gemacht), Bytes gleich', !!sSave9 && existsSync(resolve(SAVES, sSave9)) && sha(resolve(SAVES, sSave9)) === sha(resolve(FAKE, 'save-vorlage')), String(sSave9));
  check(`die Meldung nennt ${VORLAGE_ZDOS} Objekte und kein Fragezeichen`, String(a9.daten.message).includes(`${VORLAGE_ZDOS} Objekte`) && !String(a9.daten.message).includes('?'), String(a9.daten.message));

  // ── A10. Requests from other sites ────────────────────────────────────
  // A browser on a foreign page can make the user's editor tab send a request here; the proxy in front sets the token for it.
  console.log('\n[A10] Anfragen von fremden Seiten:');
  fixturenSchreiben('dev');
  fakeSchalter('aktiv', true);
  fakeLogLeeren();
  const vor10 = abbild();
  const gueltig = JSON.stringify({ bestaetigung: 'dev', seed: 'behalten', konten: false });
  const senden = (kopf: Record<string, string>, pfad = PFAD, methode = 'POST', leib: string | undefined = gueltig): Promise<Antwort> => anfrage({ port, pfad, methode, leib, kopf });
  const fremd: [string, Record<string, string>][] = [
    ['Origin fremd, Content-Type text/plain (das Beispiel des Angreifers)', { origin: 'https://boese.example', 'content-type': 'text/plain' }],
    ['Sec-Fetch-Site: cross-site', { 'sec-fetch-site': 'cross-site' }],
    ['Sec-Fetch-Site: same-site (Nachbar-Subdomain)', { 'sec-fetch-site': 'same-site' }],
    ['Sec-Fetch-Site: none', { 'sec-fetch-site': 'none' }],
    ['Sec-Fetch-Site cross-site, aber Origin sieht eigen aus (der Browser-Kopf gilt)', { 'sec-fetch-site': 'cross-site', origin: `http://127.0.0.1:${port}` }],
    ['nur Referer fremd', { referer: 'https://boese.example/seite' }],
    ['Origin: null (Sandbox-iframe)', { origin: 'null' }],
    ['Origin 127.0.0.1.boese.example (Namenstrick)', { origin: 'http://127.0.0.1.boese.example' }],
    ['Origin localhost.boese.example (Namenstrick)', { origin: 'http://localhost.boese.example' }],
  ];
  for (const [name, kopf] of fremd) {
    const a = await senden(kopf);
    check(`fremd → 403 fremde-herkunft: ${name}`, a.code === 403 && a.daten.fehler === 'fremde-herkunft', `= ${a.code} ${a.text.slice(0, 90)}`);
  }
  // NOT listed: PUT /einstellungen/auslieferung. It writes the real nginx site file (fixed path, not under WOV_WURZEL); a test
  // that reaches it when the origin check regresses would touch the machine's nginx.
  const andere: [string, string, string | undefined][] = [
    ['POST', '/api/worldlayout', JSON.stringify(sanitizeWorldLayout(WELT_ROH))],
    ['PATCH', '/api/worldlayout/ops', '{}'],
    ['POST', '/api/testwelt', '{"aktion":"starten"}'],
    ['POST', '/dienst', '{"dienst":"wov-server","aktion":"restart"}'],
    ['PUT', '/einstellungen/server', '{}'],
    ['POST', '/admin/liste', '{"name":"x"}'],
    ['DELETE', '/admin/liste', '{"name":"x"}'],
    ['POST', '/sicherung', '{"name":"dev.db.zst"}'],
  ];
  for (const [methode, pfad, leib] of andere) {
    const a = await senden({ origin: 'https://boese.example' }, pfad, methode, leib);
    check(`fremd → 403 auch bei ${methode} ${pfad}`, a.code === 403 && a.daten.fehler === 'fremde-herkunft', `= ${a.code} ${a.text.slice(0, 80)}`);
  }
  check('nach allen fremden Anfragen: Platte identisch, kein stop/start/restart', abbild() === vor10 && fakeLog().length === 0, fakeLog().join(' | '));
  const lesen = await anfrage({ port, pfad: PFAD, kopf: { 'sec-fetch-site': 'cross-site' } });
  check('GET bleibt frei (lesen aendert nichts), auch von fremder Seite', lesen.code === 200);
  const erlaubt: [string, Record<string, string>][] = [
    ['Sec-Fetch-Site: same-origin', { 'sec-fetch-site': 'same-origin' }],
    ['same-origin + Origin eigener Host', { 'sec-fetch-site': 'same-origin', origin: `http://127.0.0.1:${port}` }],
    ['nur Origin, Loopback (Vite auf anderem Port)', { origin: 'http://localhost:5274' }],
    ['nur Origin = Host-Kopf (Vorschalter reicht den Host durch)', { origin: 'https://editor.example', host: 'editor.example' }],
    ['nur Origin = X-Forwarded-Host', { origin: 'https://editor.example', 'x-forwarded-host': 'editor.example' }],
    ['Origin in WOV_ERLAUBTE_URSPRUENGE', { origin: 'https://erlaubt.example' }],
    ['nur Referer eigen', { referer: `http://127.0.0.1:${port}/play/editor.html` }],
    ['ohne jede Herkunft, mit Token (curl, MCP-Werkzeuge)', {}],
  ];
  for (const [name, kopf] of erlaubt) {
    const a = await senden(kopf, PFAD, 'POST', '{}');
    check(`erlaubt (kommt bis zur Pruefung des Rumpfs: 400): ${name}`, a.code === 400 && a.daten.fehler === 'bestaetigung', `= ${a.code} ${a.text.slice(0, 80)}`);
  }
  const echt = await senden({ 'sec-fetch-site': 'same-origin', origin: `http://127.0.0.1:${port}` });
  check('same-origin: das echte Zuruecksetzen laeuft durch (200)', echt.code === 200 && echt.daten.ok === true, `= ${echt.code} ${echt.text.slice(0, 100)}`);
} finally {
  kontenDb?.close();
  for (const p of [dev, live]) p?.kind.kill('SIGTERM');
  await warte(200);
}

// ══ B. The route module with a fake service ═══════════════════════════

console.log('\n[B] Modul mit falschem Dienst — Schritte, die scheitern:');
const modul = await import('../src/routen/weltZuruecksetzen.js').catch((e: unknown) => {
  check('Modul admin/src/routen/weltZuruecksetzen.ts laesst sich laden', false, String(e));
  return null;
});

if (modul) {
  const { weltZuruecksetzenBehandeln, leeresWeltdokument, zdosZaehlen, zeitmarke } = modul;

  // pure parts
  const alt = sanitizeWorldLayout(WELT_ROH)!;
  const leerBehalten = leeresWeltdokument(alt, 'behalten');
  check('leeresWeltdokument(behalten): gueltig, leer, Seed und Name bleiben', sanitizeWorldLayout(leerBehalten) !== null && leerBehalten.regions.length === 0 && leerBehalten.detailSeed === 'pruefseed' && leerBehalten.name === 'Pruefwelt');
  const leerNeu = leeresWeltdokument(alt, 'neu');
  check('leeresWeltdokument(neu): gueltig, anderer Seed', sanitizeWorldLayout(leerNeu) !== null && leerNeu.detailSeed !== 'pruefseed');
  const leerOhneAlt = leeresWeltdokument(null, 'behalten');
  check('leeresWeltdokument(ohne altes Dokument): gueltig, Vorgabename, Zufallsseed', sanitizeWorldLayout(leerOhneAlt) !== null && leerOhneAlt.name.length > 0 && leerOhneAlt.detailSeed.length > 0);
  check('zeitmarke(2026-09-20T20:05:59Z) = 2026-09-20_2005', zeitmarke(new Date('2026-09-20T20:05:59Z')) === '2026-09-20_2005');
  const zdoDatei = resolve(ORDNER, 'zdo-probe.db.zst');
  writeFileSync(zdoDatei, saveBytes(11));
  check('zdosZaehlen: 11', zdosZaehlen(zdoDatei) === 11);
  writeFileSync(zdoDatei, 'kein zstd');
  check('zdosZaehlen: unlesbar → null, kein Wurf', zdosZaehlen(zdoDatei) === null);
  check('zdosZaehlen: fehlende Datei → null', zdosZaehlen(resolve(ORDNER, 'gibt-es-nicht')) === null);

  // A folder of its own per run
  let lauf = 0;
  function bauen(opt: { instanz?: string; vorSchritt?: ResetUmgebung['vorSchritt']; startWirft?: boolean; stoppWirft?: boolean; mitKonten?: boolean; datum?: string } = {}) {
    const wurzel = resolve(ORDNER, `b${++lauf}`);
    const welten = resolve(wurzel, 'welten');
    const saves = resolve(wurzel, 'worlds');
    const konten = resolve(wurzel, 'konten');
    for (const d of [welten, saves, konten]) mkdirSync(d, { recursive: true });
    const instanz = opt.instanz ?? 'dev';
    writeFileSync(resolve(welten, `${instanz}.json`), WELT_TEXT);
    writeFileSync(resolve(saves, `${instanz}.db.zst`), saveBytes());
    writeFileSync(resolve(saves, `${instanz}.db.zst.prev`), saveBytes(3));
    for (const s of ['', '-wal', '-shm']) writeFileSync(resolve(konten, `${instanz}.db${s}`), `konten${s}`);
    const aufrufe: string[] = [];
    const umg: ResetUmgebung = {
      instanz,
      instanzBestimmt: true,
      layoutDatei: resolve(welten, `${instanz}.json`),
      spielstand: resolve(saves, `${instanz}.db.zst`),
      kontenDb: resolve(konten, `${instanz}.db`),
      dienstStoppen: async () => {
        aufrufe.push('stop');
        if (opt.stoppWirft) throw new Error('stop kaputt');
      },
      dienstStarten: async () => {
        aufrufe.push('start');
        if (opt.startWirft) throw new Error('start kaputt');
      },
      dienstZustand: async () => ({ aktiv: aufrufe[aufrufe.length - 1] === 'start', seit: null }),
      sichern: (datei) => {
        if (!existsSync(datei)) return null; // like the real sichern()
        const ziel = `${datei}.test.bak`;
        copyFileSync(datei, ziel);
        return ziel;
      },
      jetzt: () => new Date(opt.datum ?? '2026-09-20T20:15:30Z'),
      vorSchritt: opt.vorSchritt,
    };
    return { umg, aufrufe, welten, saves, konten };
  }
  // The two safety copies (fake `.test.bak`, `dev.json.<Kennung>`) are new files by design; everything else must stay byte-identical.
  const dateiSummen = (ordner: string): string =>
    readdirSync(ordner)
      .filter((f) => !f.endsWith('.test.bak') && !/^dev\.json\.\d{4}-/.test(f))
      .sort()
      .map((f) => (f.endsWith('-shm') ? f : `${f}:${sha(resolve(ordner, f))}`))
      .join('|');
  const alles = (b: ReturnType<typeof bauen>): string => [dateiSummen(b.welten), dateiSummen(b.saves), dateiSummen(b.konten)].join('##');
  const gut = { bestaetigung: 'dev', seed: 'behalten' as const };

  {
    const b = bauen();
    const a = (await weltZuruecksetzenBehandeln({ ...gut, konten: true }, b.umg)) as { code: number; daten: Record<string, any> };
    check('B1: mit Konten → 200, feste Namen nach Zeitmarke', a.code === 200 && a.daten.kennung === '2026-09-20_2015', `= ${a.code} ${JSON.stringify(a.daten).slice(0, 160)}`);
    check('B1: alle fuenf Dateien tragen .vor-reset-2026-09-20_2015', ['dev.db.zst', 'dev.db.zst.prev'].every((f) => existsSync(resolve(b.saves, `${f}.vor-reset-2026-09-20_2015`))) && ['dev.db', 'dev.db-wal', 'dev.db-shm'].every((f) => existsSync(resolve(b.konten, `${f}.vor-reset-2026-09-20_2015`))));
    check('B1: Kopie des Weltdokuments dev.json.2026-09-20_2015 im Save-Ordner', existsSync(resolve(b.saves, 'dev.json.2026-09-20_2015')));
    check('B1: stop, dann start', b.aufrufe.join(',') === 'stop,start');
  }
  {
    // the same minute twice: the names of the first set stay
    const b = bauen();
    await weltZuruecksetzenBehandeln(gut, b.umg);
    writeFileSync(b.umg.spielstand, saveBytes(9));
    const a = (await weltZuruecksetzenBehandeln(gut, b.umg)) as { code: number; daten: Record<string, any> };
    check('B2: zweites Mal in derselben Minute → Kennung -2', a.code === 200 && a.daten.kennung === '2026-09-20_2015-2', String(a.daten.kennung));
    const ersteAufSatz = readFileSync(resolve(b.saves, 'dev.db.zst.vor-reset-2026-09-20_2015'));
    check('B2: die erste Sicherung ist unveraendert (137 ZDOs)', zdosZaehlen(resolve(b.saves, 'dev.db.zst.vor-reset-2026-09-20_2015')) === ZDOS && ersteAufSatz.length > 0);
  }
  for (const schritt of ['spielstand', 'konten', 'dokument'] as const) {
    const b = bauen({
      vorSchritt: (s) => {
        if (s === schritt) throw new Error(`Schritt ${s} kaputt`);
      },
    });
    const vorher = alles(b);
    const a = (await weltZuruecksetzenBehandeln({ ...gut, konten: true }, b.umg)) as { code: number; daten: Record<string, any> };
    const nachher = alles(b);
    const ohneKopien = (x: string): string => x;
    check(`B3[${schritt}]: 500 tausch-fehlgeschlagen, zurueckgerollt`, a.code === 500 && a.daten.fehler === 'tausch-fehlgeschlagen' && a.daten.zurueckgerollt === true, `= ${a.code} ${JSON.stringify(a.daten).slice(0, 200)}`);
    check(`B3[${schritt}]: alle Originaldateien wieder an ihrem Platz, Bytes gleich (Spielstand, prev, Konten, Dokument)`, ohneKopien(nachher) === ohneKopien(vorher), `\nnur vorher: ${vorher.split(/[|#]+/).filter((e) => !nachher.includes(e)).join(' ')}\nnur nachher: ${nachher.split(/[|#]+/).filter((e) => !vorher.includes(e)).join(' ')}`);
    check(`B3[${schritt}]: kein .vor-reset-Rest`, !nachher.includes('vor-reset'));
    check(`B3[${schritt}]: start lief trotzdem, nach dem stop`, b.aufrufe.join(',') === 'stop,start', b.aufrufe.join(','));
    check(`B3[${schritt}]: die Antwort sagt, dass der Server laeuft`, a.daten.zustand?.aktiv === true && String(a.daten.message).includes('Server läuft'), String(a.daten.message));
  }
  {
    // the undo itself fails: everything that stays put is named
    const ref: { saves: string } = { saves: '' };
    const b = bauen({
      vorSchritt: (s) => {
        if (s === 'dokument') {
          unlinkSync(resolve(ref.saves, 'dev.db.zst.prev.vor-reset-2026-09-20_2015'));
          throw new Error('dokument kaputt');
        }
      },
    });
    ref.saves = b.saves;
    const a = (await weltZuruecksetzenBehandeln(gut, b.umg)) as { code: number; daten: Record<string, any> };
    check('B4: Rueckrollen scheitert → zurueckgerollt=false, 500', a.code === 500 && a.daten.zurueckgerollt === false, JSON.stringify(a.daten).slice(0, 200));
    check('B4: die Meldung nennt die Datei, die nicht zurueckkam', String(a.daten.message).includes('dev.db.zst.prev.vor-reset-2026-09-20_2015'), String(a.daten.message));
    check('B4: start lief trotzdem', b.aufrufe.join(',') === 'stop,start');
    check('B4: der Spielstand (Schritt davor) ist zurueckgekommen', existsSync(b.umg.spielstand));
  }
  {
    const b = bauen({ startWirft: true });
    const a = (await weltZuruecksetzenBehandeln(gut, b.umg)) as { code: number; daten: Record<string, any> };
    check('B5: start wirft nach gelungenem Tausch → 500 start-fehlgeschlagen, ok=false', a.code === 500 && a.daten.fehler === 'start-fehlgeschlagen' && a.daten.ok === false, `= ${a.code} ${JSON.stringify(a.daten).slice(0, 160)}`);
    check('B5: der Tausch ist trotzdem geschehen und die Antwort nennt ihn (Kennung, Sicherungen)', a.daten.kennung === '2026-09-20_2015' && a.daten.beiseite?.length === 2 && String(a.daten.message).includes('von Hand'));
  }
  {
    const b = bauen({ stoppWirft: true });
    const a = (await weltZuruecksetzenBehandeln(gut, b.umg)) as { code: number; daten: Record<string, any> };
    check('B6: stop wirft → 500 stopp-fehlgeschlagen, nichts getauscht', a.code === 500 && a.daten.fehler === 'stopp-fehlgeschlagen' && !alles(b).includes('vor-reset'), `= ${a.code}`);
    check('B6: start wird trotzdem versucht', b.aufrufe.join(',') === 'stop,start');
  }
  {
    // a second request while one is inside the swap
    let freigeben: () => void = () => undefined;
    const haelt = new Promise<void>((f) => (freigeben = f));
    let drin: () => void = () => undefined;
    const istDrin = new Promise<void>((f) => (drin = f));
    const b = bauen({
      vorSchritt: async (s) => {
        if (s === 'stop') {
          drin();
          await haelt;
        }
      },
    });
    const erste = weltZuruecksetzenBehandeln(gut, b.umg);
    await istDrin;
    const zweite = (await weltZuruecksetzenBehandeln(gut, b.umg)) as { code: number; daten: Record<string, any> };
    check('B7: zweite Anfrage waehrend der ersten → 409 laeuft-bereits, kein zweites stop', zweite.code === 409 && zweite.daten.fehler === 'laeuft-bereits' && b.aufrufe.length === 0, `= ${zweite.code} ${b.aufrufe.join(',')}`);
    freigeben();
    const e = (await erste) as { code: number };
    check('B7: die erste laeuft zu Ende (200)', e.code === 200);
    const b2 = bauen({ vorSchritt: () => { throw new Error('x'); } });
    await weltZuruecksetzenBehandeln(gut, b2.umg);
    const danach = (await weltZuruecksetzenBehandeln(gut, bauen().umg)) as { code: number };
    check('B7: die Sperre wird auch nach einem Fehler freigegeben', danach.code === 200, `= ${danach.code}`);
  }
  {
    // unreadable world document: a reset still works, the copy is a byte copy
    const b = bauen();
    writeFileSync(b.umg.layoutDatei, '{ das ist kein json');
    const a = (await weltZuruecksetzenBehandeln(gut, b.umg)) as { code: number; daten: Record<string, any> };
    const neu = sanitizeWorldLayout(JSON.parse(readFileSync(b.umg.layoutDatei, 'utf-8')));
    check('B8: kaputtes Weltdokument → Reset klappt (200), neues Dokument gueltig und leer', a.code === 200 && neu !== null && neu.regions.length === 0, `= ${a.code}`);
    check('B8: vorher.weltdokument = null, Kopie der kaputten Datei liegt da', a.daten.vorher?.weltdokument === null && readFileSync(resolve(b.saves, 'dev.json.2026-09-20_2015'), 'utf-8') === '{ das ist kein json');
    const c = bauen();
    unlinkSync(c.umg.layoutDatei);
    const a2 = (await weltZuruecksetzenBehandeln(gut, c.umg)) as { code: number; daten: Record<string, any> };
    check('B8: fehlendes Weltdokument → 200, Datei entsteht, keine Kopie', a2.code === 200 && existsSync(c.umg.layoutDatei) && a2.daten.sicherung?.weltdokument === null, `= ${a2.code} ${JSON.stringify(a2.daten).slice(0, 160)}`);
  }
  {
    const b = bauen({ instanz: 'live' });
    const vorher = alles(b);
    const a = (await weltZuruecksetzenBehandeln({ bestaetigung: 'live', seed: 'behalten', konten: true }, b.umg)) as { code: number };
    check('B9: instanz live → 403, nichts angefasst, kein Dienstaufruf', a.code === 403 && alles(b) === vorher && b.aufrufe.length === 0);
  }
  {
    // the safety copy fails: nothing changed, the service is not stopped
    const b = bauen();
    b.umg.sichern = () => {
      throw new Error('Platte voll');
    };
    const vorher = alles(b);
    const a = (await weltZuruecksetzenBehandeln(gut, b.umg)) as { code: number; daten: Record<string, any> };
    check('B10: Sicherung scheitert → 500 sicherung-fehlgeschlagen, Platte bitgleich, Server NICHT gestoppt', a.code === 500 && a.daten.fehler === 'sicherung-fehlgeschlagen' && alles(b) === vorher && b.aufrufe.length === 0, `= ${a.code} ${JSON.stringify(a.daten).slice(0, 120)} ${b.aufrufe.join(',')}`);
  }
  {
    // A copy of the world document from an earlier attempt in the same minute (a reset that failed leaves its copies):
    // the next one takes `-2` for EVERY name, so the copy and the moved files keep sharing one suffix.
    const b = bauen();
    writeFileSync(resolve(b.saves, 'dev.json.2026-09-20_2015'), 'Rest eines frueheren Versuchs');
    const a = (await weltZuruecksetzenBehandeln({ ...gut, konten: true }, b.umg)) as { code: number; daten: Record<string, any> };
    check('B11: Kopie des Weltdokuments schon vergeben → Kennung -2 fuer ALLES', a.code === 200 && a.daten.kennung === '2026-09-20_2015-2' && a.daten.sicherung?.weltdokument === 'dev.json.2026-09-20_2015-2', JSON.stringify(a.daten.sicherung));
    check('B11: alle fuenf beiseite gelegten Dateien tragen dieselbe Kennung -2', a.daten.beiseite?.length === 5 && a.daten.beiseite.every((n: string) => n.endsWith('.vor-reset-2026-09-20_2015-2')), JSON.stringify(a.daten.beiseite));
    check('B11: der Rest des frueheren Versuchs bleibt unberuehrt', readFileSync(resolve(b.saves, 'dev.json.2026-09-20_2015'), 'utf-8') === 'Rest eines frueheren Versuchs');
  }
  {
    // The blocker: no save when the request comes, the stop makes one. It must be found, moved and counted.
    const b = bauen();
    rmSync(b.umg.spielstand);
    rmSync(`${b.umg.spielstand}.prev`);
    b.umg.dienstStoppen = async () => {
      b.aufrufe.push('stop');
      writeFileSync(b.umg.spielstand, saveBytes(77));
      writeFileSync(`${b.umg.spielstand}.prev`, saveBytes(5));
    };
    const a = (await weltZuruecksetzenBehandeln(gut, b.umg)) as { code: number; daten: Record<string, any> };
    check('B12: Spielstand erst beim Stopp da → 200, liegt danach NICHT mehr unter dem Originalnamen (auch .prev nicht)', a.code === 200 && !existsSync(b.umg.spielstand) && !existsSync(`${b.umg.spielstand}.prev`), `= ${a.code}`);
    check('B12: beide beiseite, 77 Objekte gezaehlt, Sicherung (.bak) gemacht', a.daten.beiseite?.length === 2 && a.daten.spielstandBeiseite?.zdos === 77 && !!a.daten.sicherung?.spielstand && existsSync(resolve(b.saves, a.daten.sicherung.spielstand)), JSON.stringify(a.daten.beiseite));
    check('B12: die Meldung sagt 77 Objekte, kein Fragezeichen', String(a.daten.message).includes('77 Objekte') && !String(a.daten.message).includes('?'), String(a.daten.message));
    check('B12: vorher.spielstand null, die Kennung ist frei fuer alle moeglichen Namen', a.daten.vorher?.spielstand === null && a.daten.kennung === '2026-09-20_2015');
  }
  {
    // Not countable (damaged save): said in words, not "?".
    const b = bauen();
    writeFileSync(b.umg.spielstand, 'kein zstd');
    const a = (await weltZuruecksetzenBehandeln(gut, b.umg)) as { code: number; daten: Record<string, any> };
    check('B12b: nicht zaehlbarer Spielstand → trotzdem beiseite, Meldung „nicht ermittelbar“, kein Fragezeichen', a.code === 200 && a.daten.beiseite?.length === 2 && String(a.daten.message).includes('nicht ermittelbar') && !String(a.daten.message).includes('?'), String(a.daten.message));
    const c = bauen();
    rmSync(c.umg.spielstand);
    rmSync(`${c.umg.spielstand}.prev`);
    const a2 = (await weltZuruecksetzenBehandeln(gut, c.umg)) as { code: number; daten: Record<string, any> };
    check('B12c: wirklich kein Spielstand (auch nicht nach dem Stopp) → 200, Meldung „kein Spielstand“, kein Fragezeichen', a2.code === 200 && a2.daten.beiseite?.length === 0 && String(a2.daten.message).includes('keinen Spielstand') && !String(a2.daten.message).includes('?'), String(a2.daten.message));
  }
  {
    // The marker: there while the reset runs, gone when the state is known again, kept when it is not.
    const { markerPfad } = modul;
    const zustaende: string[] = [];
    const b: ReturnType<typeof bauen> = bauen({
      vorSchritt: (s) => {
        const m = markerPfad(b.umg);
        zustaende.push(`${s}:${existsSync(m) ? (JSON.parse(readFileSync(m, 'utf-8')) as { schritt: string }).schritt : 'kein-marker'}`);
      },
    });
    const a = (await weltZuruecksetzenBehandeln({ ...gut, konten: true }, b.umg)) as { code: number };
    check('B13: Marker steht vor dem Stopp und wird je Schritt nachgefuehrt (VOR dem Beiseitelegen, VOR dem Schreiben des Dokuments)', zustaende.join(' ') === 'stop:vor-stopp spielstand:gestoppt konten:beiseite dokument:beiseite start:dokument', zustaende.join(' '));
    check('B13: nach dem Erfolg ist der Marker weg', a.code === 200 && !existsSync(markerPfad(b.umg)));
  }
  {
    const { markerPfad } = modul;
    const b = bauen({ startWirft: true });
    const a = (await weltZuruecksetzenBehandeln(gut, b.umg)) as { code: number };
    check('B13: Start scheitert nach gelungenem Tausch → Marker BLEIBT (Schritt dokument)', a.code === 500 && existsSync(markerPfad(b.umg)) && (JSON.parse(readFileSync(markerPfad(b.umg), 'utf-8')) as { schritt: string }).schritt === 'dokument');
  }
  {
    const { markerPfad } = modul;
    const c = bauen({ stoppWirft: true });
    const a = (await weltZuruecksetzenBehandeln(gut, c.umg)) as { code: number };
    check('B13: Stopp scheitert, Start klappt → Zustand bekannt, Marker weg', a.code === 500 && !existsSync(markerPfad(c.umg)));
    const d = bauen({
      vorSchritt: (s) => {
        if (s === 'dokument') throw new Error('dokument kaputt');
      },
    });
    const a2 = (await weltZuruecksetzenBehandeln(gut, d.umg)) as { code: number; daten: Record<string, any> };
    check('B13: Tausch scheitert, sauber zurueckgerollt, Server laeuft → Marker weg', a2.code === 500 && a2.daten.zurueckgerollt === true && !existsSync(markerPfad(d.umg)));
    const ref: { saves: string } = { saves: '' };
    const e = bauen({
      vorSchritt: (s) => {
        if (s === 'dokument') {
          unlinkSync(resolve(ref.saves, 'dev.db.zst.prev.vor-reset-2026-09-20_2015'));
          throw new Error('dokument kaputt');
        }
      },
    });
    ref.saves = e.saves;
    const a3 = (await weltZuruecksetzenBehandeln(gut, e.umg)) as { code: number; daten: Record<string, any> };
    check('B13: Rueckrollen unvollstaendig → Marker BLEIBT', a3.daten.zurueckgerollt === false && existsSync(markerPfad(e.umg)));
  }
  {
    // Start-up check.
    const { markerPfad, unfertigenResetMelden, zuruecksetzenStatus } = modul;
    const b = bauen();
    check('B14: ohne Marker tut die Pruefung nichts (kein start)', (await unfertigenResetMelden(b.umg)) === null && b.aufrufe.length === 0 && zuruecksetzenStatus(b.umg).unfertige.length === 0);
    // planned: two files; only one of them was moved when the process died
    const beiseiteEins = `${b.umg.spielstand}.vor-reset-2026-09-20_2015`;
    writeFileSync(beiseiteEins, 'schon beiseite');
    writeFileSync(markerPfad(b.umg), JSON.stringify({ zeit: '2026-09-20T20:15:00.000Z', instanz: 'dev', kennung: '2026-09-20_2015', seed: 'behalten', konten: false, schritt: 'beiseite', beiseite: [beiseiteEins, `${b.umg.spielstand}.prev.vor-reset-2026-09-20_2015`], sicherung: { spielstand: null, weltdokument: null } }));
    const r = await unfertigenResetMelden(b.umg);
    check('B14: mit Marker: Server wird gestartet (genau 1 start), der Zustand ist in Worten benannt', r !== null && b.aufrufe.join(',') === 'start' && r.zustand.includes('nach dem Beiseitelegen') && r.zustand.includes('Beiseite gelegt: dev.db.zst.vor-reset-2026-09-20_2015.') && !r.zustand.includes('prev.vor-reset') && r.zustand.includes('noch das alte'), r?.zustand);
    check('B14: der Marker ist umbenannt (abgebrochen-…), nicht geloescht, und steht im Status', !existsSync(markerPfad(b.umg)) && zuruecksetzenStatus(b.umg).unfertige.length === 1 && zuruecksetzenStatus(b.umg).unfertige[0]!.marker?.schritt === 'beiseite');
    check('B14: ein zweiter Start meldet ihn nicht noch einmal (kein weiteres start)', (await unfertigenResetMelden(b.umg)) === null && b.aufrufe.length === 1);
    const c = bauen();
    writeFileSync(markerPfad(c.umg), '{ kaputt');
    const r2 = await unfertigenResetMelden(c.umg);
    check('B14: unlesbarer Marker: Server wird trotzdem gestartet, Meldung sagt „unlesbar“', r2 !== null && c.aufrufe.join(',') === 'start' && r2.zustand.includes('unlesbar'), r2?.zustand);
    const d = bauen({ startWirft: true });
    writeFileSync(markerPfad(d.umg), JSON.stringify({ zeit: 'x', instanz: 'dev', kennung: 'k', seed: 'behalten', konten: false, schritt: 'gestoppt', beiseite: [], sicherung: { spielstand: null, weltdokument: null } }));
    const r3 = await unfertigenResetMelden(d.umg);
    check('B14: Start schlaegt fehl → die Meldung sagt es, kein Wurf', r3 !== null && r3.zustand.includes('nicht starten'), r3?.zustand);
  }
  {
    // Fail closed: an instance nobody named is not `dev` just because that is the fallback.
    const { weltZuruecksetzenVorschau } = modul;
    const b = bauen();
    b.umg.instanzBestimmt = false;
    const vorher = alles(b);
    const a = (await weltZuruecksetzenBehandeln(gut, b.umg)) as { code: number; daten: Record<string, any> };
    check('B15: Instanz nicht bestimmt → 403 instanz-unbestimmt, Meldung sagt was fehlt, nichts angefasst, kein Dienstaufruf', a.code === 403 && a.daten.fehler === 'instanz-unbestimmt' && String(a.daten.message).includes('WOV_INSTANZ') && alles(b) === vorher && b.aufrufe.length === 0, JSON.stringify(a.daten).slice(0, 160));
    const v = (await weltZuruecksetzenVorschau(b.umg)) as { daten: Record<string, any> };
    check('B15: GET meldet erlaubt=false mit demselben Grund', v.daten.erlaubt === false && String(v.daten.grund).includes('WOV_INSTANZ'));
  }

}

// ══ C. The opt-in of the shared write path has exactly one caller ═════

console.log('\n[C] leereWelt: genau eine Stelle setzt die Option (Syntaxbaum ueber alle Quelltexte):');
{
  const setzer: string[] = [];
  const geh = (ordner: string): void => {
    for (const eintrag of readdirSync(ordner, { withFileTypes: true })) {
      if (eintrag.name === 'node_modules' || eintrag.name === 'dist' || eintrag.name.startsWith('.')) continue;
      const pfad = resolve(ordner, eintrag.name);
      if (eintrag.isDirectory()) geh(pfad);
      else if (/\.(ts|tsx|mts|mjs|js)$/.test(eintrag.name) && !pfad.includes('/test/')) {
        const text = readFileSync(pfad, 'utf-8');
        if (!text.includes('leereWelt')) continue;
        const sf = ts.createSourceFile(pfad, text, ts.ScriptTarget.Latest, true);
        const besuche = (n: ts.Node): void => {
          const istName = (x: ts.PropertyName): boolean => ts.isIdentifier(x) && x.text === 'leereWelt';
          // `leereWelt: <not the literal false>` in an object literal, or the shorthand `{ leereWelt }`.
          if (ts.isPropertyAssignment(n) && istName(n.name) && n.initializer.kind !== ts.SyntaxKind.FalseKeyword) setzer.push(relative(WURZEL_PROJEKT, pfad));
          if (ts.isShorthandPropertyAssignment(n) && n.name.text === 'leereWelt') setzer.push(relative(WURZEL_PROJEKT, pfad));
          ts.forEachChild(n, besuche);
        };
        besuche(sf);
      }
    }
  };
  for (const d of ['admin/src', 'server/src', 'shared/src', 'client/src', 'tools']) if (existsSync(resolve(WURZEL_PROJEKT, d))) geh(resolve(WURZEL_PROJEKT, d));
  check('genau eine Stelle setzt leereWelt, und zwar das Zuruecksetzen', setzer.length === 1 && setzer[0] === 'admin/src/routen/weltZuruecksetzen.ts', setzer.join(' | '));
}

// ══ D. The operations service is killed halfway ═══════════════════════

console.log('\n[D] Betriebsdienst hart beendet (SIGKILL) mitten im Zuruecksetzen — danach neu gestartet:');
{
  // Each case: (1) the reset runs in a helper process that kills ITSELF at the chosen step, (2) the state on disk is what the
  // step implies and the game server was stopped and never started, (3) the REAL operations service is started on that folder,
  // (4) it starts the game server and names the state (log line and /status), (5) a second start does nothing.
  const stubDir = resolve(ORDNER, 'stub');
  mkdirSync(stubDir, { recursive: true });
  const stub = resolve(stubDir, 'systemctl');
  writeFileSync(stub, '#!/bin/sh\necho "$1 $2" >> "$FAKE_LOG"\ncase "$1" in show) echo "ActiveState=inactive";; esac\nexit 0\n');
  chmodSync(stub, 0o755);
  const faelle: { schritt: 'spielstand' | 'dokument' | 'start'; marker: string; satz: string; wo: (cr: string) => boolean }[] = [
    {
      schritt: 'spielstand',
      marker: 'gestoppt',
      satz: 'nach dem Stoppen des Servers',
      wo: (cr) => existsSync(resolve(cr, 'server/data/worlds/dev.db.zst')) && readFileSync(resolve(cr, 'server/data/welten/dev.json'), 'utf-8') === WELT_TEXT,
    },
    {
      schritt: 'dokument',
      marker: 'beiseite',
      satz: 'nach dem Beiseitelegen',
      wo: (cr) => !existsSync(resolve(cr, 'server/data/worlds/dev.db.zst')) && readdirSync(resolve(cr, 'server/data/worlds')).filter((f) => f.includes('.vor-reset-')).length === 2 && readFileSync(resolve(cr, 'server/data/welten/dev.json'), 'utf-8') === WELT_TEXT,
    },
    {
      schritt: 'start',
      marker: 'dokument',
      satz: 'nach dem Schreiben des leeren Weltdokuments',
      wo: (cr) => !existsSync(resolve(cr, 'server/data/worlds/dev.db.zst')) && (JSON.parse(readFileSync(resolve(cr, 'server/data/welten/dev.json'), 'utf-8')) as { regions: unknown[] }).regions.length === 0,
    },
  ];
  for (const f of faelle) {
    const cr = resolve(ORDNER, `absturz-${f.schritt}`);
    for (const d of ['welten', 'worlds', 'konten']) mkdirSync(resolve(cr, 'server/data', d), { recursive: true });
    writeFileSync(resolve(cr, 'server/data/welten/dev.json'), WELT_TEXT);
    writeFileSync(resolve(cr, 'server/data/worlds/dev.db.zst'), saveBytes());
    writeFileSync(resolve(cr, 'server/data/worlds/dev.db.zst.prev'), saveBytes(3));
    const helfer = spawnSync(resolve(WURZEL_PROJEKT, 'node_modules/.bin/tsx'), [fileURLToPath(import.meta.url)], {
      cwd: ADMIN,
      env: { ...process.env, WOV_ZUR_HELFER: '1', WOV_ZUR_WURZEL: cr, WOV_ZUR_SCHRITT: f.schritt },
      encoding: 'utf-8',
    });
    const dienstLog = existsSync(resolve(cr, 'dienst.log')) ? readFileSync(resolve(cr, 'dienst.log'), 'utf-8').trim().split('\n') : [];
    check(`D[${f.schritt}]: der Helfer ist hart gestorben (SIGKILL), nicht ordentlich beendet`, helfer.signal === 'SIGKILL' || helfer.status === 137, `signal=${helfer.signal} status=${helfer.status} ${helfer.stderr?.slice(0, 200)}`);
    check(`D[${f.schritt}]: der Dienst wurde gestoppt und NIE gestartet`, dienstLog.join(',') === 'stop', dienstLog.join(','));
    const markerDatei = resolve(cr, 'server/data/worlds/dev.zuruecksetzen.marker');
    const marker = existsSync(markerDatei) ? (JSON.parse(readFileSync(markerDatei, 'utf-8')) as { schritt: string; beiseite: string[] }) : null;
    check(`D[${f.schritt}]: Marker liegt da und nennt den Schritt „${f.marker}“`, marker !== null && marker.schritt === f.marker, JSON.stringify(marker));
    check(`D[${f.schritt}]: die Platte steht so, wie der Schritt es verlangt`, f.wo(cr));

    // start the real operations service on that folder
    const log1 = resolve(cr, 'admin-dienst.log');
    const admin = await starten('dev', cr, { WOV_SYSTEMCTL: stub, FAKE_LOG: log1 });
    let gestartet = false;
    for (let i = 0; i < 50 && !gestartet; i++) {
      gestartet = existsSync(log1) && readFileSync(log1, 'utf-8').includes('start wov-server');
      if (!gestartet) await warte(200);
    }
    check(`D[${f.schritt}]: der neu gestartete Betriebsdienst startet den Spielserver`, gestartet, existsSync(log1) ? readFileSync(log1, 'utf-8') : 'kein Protokoll');
    const status = await anfrage({ port: admin.port, pfad: '/status' });
    const unf = (status.daten.zuruecksetzen?.unfertige ?? []) as { marker: { schritt: string } | null; zustand: string }[];
    check(`D[${f.schritt}]: /status nennt den unfertigen Reset und seinen Zustand (${f.satz})`, unf.length === 1 && unf[0]!.marker?.schritt === f.marker && unf[0]!.zustand.includes(f.satz), JSON.stringify(status.daten.zuruecksetzen).slice(0, 300));
    check(`D[${f.schritt}]: der Marker ist umbenannt, nicht geloescht`, !existsSync(markerDatei) && readdirSync(resolve(cr, 'server/data/worlds')).some((n) => n.startsWith('dev.zuruecksetzen.abgebrochen-')));
    admin.kind.kill('SIGTERM');
    await warte(500);

    // a second start: nothing left to do
    const log2 = resolve(cr, 'admin-dienst2.log');
    const admin2 = await starten('dev', cr, { WOV_SYSTEMCTL: stub, FAKE_LOG: log2 });
    await warte(1500);
    const start2 = existsSync(log2) ? readFileSync(log2, 'utf-8').split('\n').filter((z) => z.startsWith('start')).length : 0;
    check(`D[${f.schritt}]: der zweite Start des Betriebsdienstes startet den Spielserver NICHT noch einmal`, start2 === 0, `starts=${start2}`);
    admin2.kind.kill('SIGTERM');
    await warte(300);
  }
  // an operations service that starts with no marker never touches the game server (this is every normal start)
  const leer = resolve(ORDNER, 'ohne-marker');
  for (const d of ['welten', 'worlds', 'konten']) mkdirSync(resolve(leer, 'server/data', d), { recursive: true });
  writeFileSync(resolve(leer, 'server/data/welten/dev.json'), WELT_TEXT);
  const logL = resolve(leer, 'admin-dienst.log');
  const adminL = await starten('dev', leer, { WOV_SYSTEMCTL: stub, FAKE_LOG: logL });
  await warte(1500);
  const startL = existsSync(logL) ? readFileSync(logL, 'utf-8').split('\n').filter((z) => z.startsWith('start') || z.startsWith('stop')).length : 0;
  check('D: ohne Marker fasst ein Start des Betriebsdienstes den Spielserver nicht an', startL === 0, `n=${startL}`);
  adminL.kind.kill('SIGTERM');
}

// ══ E. The instance is not named: the lock stays shut ═════════════════

console.log('\n[E] WOV_INSTANZ fehlt, ist leer oder unbekannt — der Riegel bleibt zu:');
{
  const stub = resolve(ORDNER, 'stub/systemctl');
  const faelle: [string, string | null][] = [
    ['WOV_INSTANZ fehlt ganz', null],
    ['WOV_INSTANZ leer', ''],
    ['WOV_INSTANZ nur Leerzeichen', '   '],
  ];
  let n = 0;
  for (const [name, wert] of faelle) {
    const cr = resolve(ORDNER, `unbestimmt-${++n}`);
    for (const d of ['welten', 'worlds', 'konten']) mkdirSync(resolve(cr, 'server/data', d), { recursive: true });
    writeFileSync(resolve(cr, 'server/data/welten/dev.json'), WELT_TEXT);
    writeFileSync(resolve(cr, 'server/data/worlds/dev.db.zst'), saveBytes());
    const logE = resolve(cr, 'admin-dienst.log');
    const listeVorher = (): string => [resolve(cr, 'server/data/welten/dev.json'), resolve(cr, 'server/data/worlds/dev.db.zst')].map((f) => `${f}:${sha(f)}`).join('|') + readdirSync(resolve(cr, 'server/data/worlds')).join(',') + readdirSync(resolve(cr, 'server/data/welten')).join(',');
    const vor = listeVorher();
    const admin = await starten(wert, cr, { WOV_SYSTEMCTL: stub, FAKE_LOG: logE });
    const get = await anfrage({ port: admin.port, pfad: PFAD });
    check(`E[${name}]: GET meldet erlaubt=false, der Grund nennt WOV_INSTANZ`, get.code === 200 && get.daten.erlaubt === false && String(get.daten.grund).includes('WOV_INSTANZ'), JSON.stringify(get.daten).slice(0, 160));
    const post = await reset(admin.port, { bestaetigung: 'dev', seed: 'behalten', konten: true });
    check(`E[${name}]: POST mit richtiger Bestaetigung → 403 instanz-unbestimmt`, post.code === 403 && post.daten.fehler === 'instanz-unbestimmt', `= ${post.code} ${post.text.slice(0, 120)}`);
    const post2 = await reset(admin.port, {});
    check(`E[${name}]: POST mit leerem Objekt → ebenfalls 403 (der Riegel kommt zuerst)`, post2.code === 403);
    const dienst = existsSync(logE) ? readFileSync(logE, 'utf-8').split('\n').filter((z) => z && !z.startsWith('show')) : [];
    check(`E[${name}]: Platte unveraendert, kein stop/start`, listeVorher() === vor && dienst.length === 0, dienst.join(' | '));
    admin.kind.kill('SIGTERM');
    await warte(300);
  }
  // an instance name that is neither dev nor live: the process refuses to start at all (shared/src/instanz.ts)
  let gestartet = false;
  try {
    const admin = await starten('prod', resolve(ORDNER, 'unbestimmt-1'), { WOV_SYSTEMCTL: stub, FAKE_LOG: resolve(ORDNER, 'unbestimmt-1/x.log') });
    gestartet = true;
    admin.kind.kill('SIGTERM');
  } catch (e) {
    check('E[unbekannter Name „prod“]: der Dienst startet gar nicht (bricht mit Meldung ab)', String(e).includes('weder "dev" noch "live"'), String(e).slice(0, 200));
  }
  if (gestartet) check('E[unbekannter Name „prod“]: der Dienst startet gar nicht', false);
}

// ══ F. A stand-in for systemctl never goes unnoticed ══════════════════

console.log('\n[F] WOV_SYSTEMCTL: laute Warnung, Feld in /status, keine Startfreigabe unter production:');
{
  const cr = resolve(ORDNER, 'ersatz');
  for (const d of ['welten', 'worlds', 'konten']) mkdirSync(resolve(cr, 'server/data', d), { recursive: true });
  writeFileSync(resolve(cr, 'server/data/welten/dev.json'), WELT_TEXT);
  const stub = resolve(ORDNER, 'stub/systemctl');

  const gesetzt = await starten('dev', cr, { WOV_SYSTEMCTL: stub, FAKE_LOG: resolve(cr, 'log') });
  const st1 = await anfrage({ port: gesetzt.port, pfad: '/status' });
  check('F: gesetzt → /status.systemctlErsatz nennt das Programm', st1.code === 200 && st1.daten.systemctlErsatz === stub, JSON.stringify(st1.daten.systemctlErsatz));
  check('F: gesetzt → laute Startzeile (WARNUNG, Variable, „nur fuer Tests“)', /WARNUNG: WOV_SYSTEMCTL=/.test(gesetzt.log()) && gesetzt.log().includes(stub) && gesetzt.log().includes('Nur fuer Tests und Probelaeufe'), gesetzt.log().slice(0, 300));
  gesetzt.kind.kill('SIGTERM');

  const ungesetzt = await starten('dev', cr, { WOV_SYSTEMCTL: null });
  const st2 = await anfrage({ port: ungesetzt.port, pfad: '/status' });
  check('F: nicht gesetzt → /status.systemctlErsatz ist null', st2.code === 200 && st2.daten.systemctlErsatz === null, JSON.stringify(st2.daten.systemctlErsatz));
  check('F: nicht gesetzt → keine Warnzeile', !ungesetzt.log().includes('WOV_SYSTEMCTL'), ungesetzt.log().slice(0, 200));
  ungesetzt.kind.kill('SIGTERM');

  const leer = await starten('dev', cr, { WOV_SYSTEMCTL: '' });
  const st3 = await anfrage({ port: leer.port, pfad: '/status' });
  check('F: leer gesetzt zaehlt als nicht gesetzt (ein leerer Name ist kein Programm)', st3.daten.systemctlErsatz === null && !leer.log().includes('WARNUNG'));
  leer.kind.kill('SIGTERM');

  let hochgekommen = false;
  let meldung = '';
  try {
    const p = await starten('dev', cr, { WOV_SYSTEMCTL: stub, NODE_ENV: 'production' });
    hochgekommen = true;
    p.kind.kill('SIGTERM');
  } catch (e) {
    meldung = String(e);
  }
  check('F: unter NODE_ENV=production mit gesetzter Variable kommt der Dienst GAR NICHT hoch', !hochgekommen && meldung.includes('Dienst beendet mit 1') && meldung.includes('NODE_ENV=production') && !meldung.includes('bereit auf'), meldung.slice(0, 300));
  const produktiv = await starten('dev', cr, { WOV_SYSTEMCTL: null, NODE_ENV: 'production' });
  const st4 = await anfrage({ port: produktiv.port, pfad: '/status' });
  check('F: unter production OHNE die Variable startet er normal (der Betrieb)', st4.code === 200 && st4.daten.systemctlErsatz === null);
  produktiv.kind.kill('SIGTERM');
  await warte(300);
}

// ══ G. State-changing requests must be JSON ═══════════════════════════

console.log('\n[G] Content-Type: application/json ist Pflicht fuer POST/PUT/PATCH/DELETE:');
{
  const cr = resolve(ORDNER, 'ct');
  for (const d of ['welten', 'worlds', 'konten']) mkdirSync(resolve(cr, 'server/data', d), { recursive: true });
  writeFileSync(resolve(cr, 'server/data/welten/dev.json'), WELT_TEXT);
  writeFileSync(resolve(cr, 'server/data/worlds/dev.db.zst'), saveBytes());
  const logG = resolve(cr, 'dienst.log');
  const stub = resolve(ORDNER, 'stub/systemctl');
  const admin = await starten('dev', cr, { WOV_SYSTEMCTL: stub, FAKE_LOG: logG });
  const dateien = (): string => readdirSync(resolve(cr, 'server/data/worlds')).join(',') + readFileSync(resolve(cr, 'server/data/welten/dev.json'), 'utf-8').length;
  const vor = dateien();
  const gueltig = JSON.stringify({ bestaetigung: 'dev', seed: 'behalten', konten: false });
  const ohneOrigin = (kopf: Record<string, string>, leib: string | undefined = gueltig, methode = 'POST', pfad = PFAD, ohneCt = false): Promise<Antwort> =>
    anfrage({ port: admin.port, pfad, methode, leib, kopf, ohneContentType: ohneCt });
  const falsch: [string, Record<string, string>, boolean][] = [
    ['text/plain', { 'content-type': 'text/plain' }, false],
    ['application/x-www-form-urlencoded (das <form>)', { 'content-type': 'application/x-www-form-urlencoded' }, false],
    ['multipart/form-data', { 'content-type': 'multipart/form-data; boundary=x' }, false],
    ['application/jsonx (Namenstrick)', { 'content-type': 'application/jsonx' }, false],
    ['application/json-patch+json', { 'content-type': 'application/json-patch+json' }, false],
    ['gar kein Content-Type, mit Rumpf', {}, true],
  ];
  for (const [name, kopf, ohne] of falsch) {
    const a = await ohneOrigin(kopf, gueltig, 'POST', PFAD, ohne);
    check(`POST ${name} → 415, nichts geaendert`, a.code === 415 && a.daten.fehler === 'content-type', `= ${a.code} ${a.text.slice(0, 80)}`);
  }
  for (const [methode, pfad] of [['PUT', '/einstellungen/server'], ['PATCH', '/api/worldlayout/ops'], ['DELETE', '/admin/liste'], ['POST', '/dienst'], ['POST', '/api/testwelt']] as const) {
    const a = await ohneOrigin({ 'content-type': 'text/plain' }, '{}', methode, pfad);
    check(`${methode} ${pfad} mit text/plain → 415`, a.code === 415, `= ${a.code}`);
  }
  check('Platte unveraendert, kein stop/start/restart', dateien() === vor && !(existsSync(logG) && readFileSync(logG, 'utf-8').split('\n').some((z) => z && !z.startsWith('show'))));
  for (const [name, ct] of [['application/json', 'application/json'], ['mit charset', 'application/json; charset=utf-8'], ['gross geschrieben', 'Application/JSON']] as const) {
    const a = await ohneOrigin({ 'content-type': ct }, '{}');
    check(`erlaubt: ${name} → kommt bis zur Rumpfpruefung (400)`, a.code === 400 && a.daten.fehler === 'bestaetigung', `= ${a.code} ${a.text.slice(0, 60)}`);
  }
  const lesen = await anfrage({ port: admin.port, pfad: PFAD });
  check('GET braucht keinen Content-Type', lesen.code === 200);
  const echt = await ohneOrigin({ 'content-type': 'application/json; charset=utf-8' });
  check('ein echtes Zuruecksetzen mit application/json laeuft durch (200)', echt.code === 200 && echt.daten.ok === true, `= ${echt.code} ${echt.text.slice(0, 100)}`);
  admin.kind.kill('SIGTERM');
  await warte(300);
}

rmSync(ORDNER, { recursive: true, force: true });
console.log(fehler === 0 ? '\nAlle Pruefungen gruen.' : `\n${fehler} Pruefung(en) fehlgeschlagen.`);
process.exit(fehler > 0 ? 1 : 0);
