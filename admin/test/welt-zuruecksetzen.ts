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
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { request, type IncomingMessage } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zstdCompressSync } from 'node:zlib';
import { sanitizeWorldLayout } from '@wov/shared/src/worldlayout/sanitize.js';
import { layoutHash, layoutText } from '@wov/shared/src/worldlayout/layoutDatei.js';
import type { ResetUmgebung } from '../src/routen/weltZuruecksetzen.js';

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
const fakeLesen = (name: string): string[] => readFileSync(resolve(FAKE, name), 'utf-8').split('\n').filter(Boolean);

// ── Start the service ─────────────────────────────────────────────────

function starten(instanz: 'dev' | 'live'): Promise<{ port: number; kind: ChildProcess }> {
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
        // The stand-in. Without it these tests would stop the real game server.
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

type Antwort = { code: number; text: string; daten: Record<string, any> };

function anfrage(opt: { port: number; pfad: string; methode?: string; token?: string | null; leib?: string; basis?: string }): Promise<Antwort> {
  return new Promise((fertig, scheitern) => {
    const kopf: Record<string, string> = {};
    if (opt.token !== null) kopf['x-wov-token'] = opt.token ?? TOKEN;
    if (opt.basis) kopf['if-match'] = `"${opt.basis}"`;
    if (opt.leib !== undefined) {
      kopf['content-type'] = 'application/json';
      kopf['content-length'] = String(Buffer.byteLength(opt.leib));
    }
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
  dev = await starten('dev');
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
    ['ohne Rumpf', undefined],
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
  const liveReset3 = await reset(live.port, undefined);
  check('live: POST ohne Rumpf → 403', liveReset3.code === 403, `= ${liveReset3.code}`);
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
}

rmSync(ORDNER, { recursive: true, force: true });
console.log(fehler === 0 ? '\nAlle Pruefungen gruen.' : `\n${fehler} Pruefung(en) fehlgeschlagen.`);
process.exit(fehler > 0 ? 1 : 0);
