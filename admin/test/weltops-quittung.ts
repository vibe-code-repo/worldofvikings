/**
 * Editor E2, card K5.0: the operations service answers 200 only when the RUNNING game server has applied
 * the world file, and 202 (with a reason) when it was written but not applied.
 *
 *   npx tsx test/weltops-quittung.ts      (from admin/)
 *
 * The real operations service (admin/src/main.ts, WOV_WURZEL = temp directory, port 0) runs against a
 * REAL game server (in this process, layout mode, its own temp world directory, port 0). `systemctl` is a
 * stand-in script (WOV_SYSTEMCTL) that says "active" while a flag file exists, so "server off" can be
 * played without touching any real service. Nothing is written to server/data/.
 *
 * Numbers:
 *  1. PATCH (place a Beech1) with the server running: 200, `angewendet`, gespawnt = 1, one ZDO with the
 *     layoutId, answered within 3 s
 *  2. PATCH (move it): 200, aktualisiert = 1, the SAME zdoid
 *  3. POST (whole document with If-Match, one more placement): 200, applied, gespawnt = 1
 *  4. PATCH that changes a region: 202 `geo`, the file IS written (hash of the answer = hash of the file),
 *     0 ZDOs changed
 *  5. server off (systemctl says inactive): PATCH answers 202 `server-aus`, never 200, the file is written,
 *     in under 1 s (no waiting for a receipt nobody writes)
 *  6. service "active" but nobody quits (no game server): 202 `keine-quittung` after about 3 s
 *  7. an old receipt with the hash of the NEW file does not turn a 202 into a 200 when the service is off
 *  8. restart with a geo change: the receipt of the previous run ("applied" for hash X) is gone at the boot,
 *     so writing X back inside the boot window never answers 200 (it answers 202 geo)
 *  9. the wait loop uses a monotonic clock: a wall clock that jumps back an hour does not stretch it
 * 10. WOV_QUITTUNG=aus is refused unless NODE_ENV is exactly `test` (empty, development, production: the service does not start)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAYOUT_ID_MEMBER } from '@wov/shared';
import { layoutHash, layoutText } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { quittungLesen, quittungSchreiben, quittungsDatei } from '@wov/shared/src/worldlayout/quittung.js';
import { sanitizeWorldLayout } from '@wov/shared/src/worldlayout/sanitize.js';
import { createWovServer } from '../../server/src/WovServer.js';
import { quittungAbwarten } from '../src/routen/anwendung.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const ADMIN = resolve(HIER, '..');
const TSX = resolve(ADMIN, '..', 'node_modules/.bin/tsx');

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  } else console.log(`ok   ${name}${detail ? ` (${detail})` : ''}`);
}

const ORDNER = mkdtempSync(resolve(tmpdir(), 'wov-weltops-quittung-'));
const WELTEN = resolve(ORDNER, 'server/data/welten');
const SPIELSTAENDE = resolve(ORDNER, 'server/data/worlds');
const WELT_DATEI = resolve(WELTEN, 'dev.json');
const LAEUFT = resolve(ORDNER, 'laeuft');
const TOKEN = 'quittung-token';
const TOKEN_DATEI = resolve(ORDNER, 'token');
const SYSTEMCTL = resolve(ORDNER, 'systemctl');
mkdirSync(WELTEN, { recursive: true });
mkdirSync(SPIELSTAENDE, { recursive: true });
writeFileSync(TOKEN_DATEI, `${TOKEN}\n`);
// Stand-in: `show wov-server --property=...` says active while the flag file exists.
writeFileSync(SYSTEMCTL, `#!/bin/sh\nif [ "$1" = show ]; then if [ -e "${LAEUFT}" ]; then echo ActiveState=active; else echo ActiveState=inactive; fi; fi\nexit 0\n`);
chmodSync(SYSTEMCTL, 0o755);

const AUSGANG = layoutText(
  sanitizeWorldLayout({
    version: 1,
    name: 'Quittung',
    detailSeed: 'quittung',
    continents: [],
    regions: [{ id: 'heim', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1600 }, edgeFalloff: 200, baseLevel: 0.3, vegetation: [] }],
    defaultSpawn: [0, 0],
    placements: [],
  })!
);
writeFileSync(WELT_DATEI, AUSGANG);

let dienst = null as ChildProcess | null;
function dienstStarten(): Promise<number> {
  return new Promise((fertig, scheitern) => {
    let protokoll = '';
    dienst = spawn(TSX, ['src/main.ts'], {
      cwd: ADMIN,
      env: { ...process.env, WOV_WURZEL: ORDNER, WOV_WELT_VERZEICHNIS: WELTEN, NODE_ENV: 'test', WOV_INSTANZ: 'dev', WOV_ADMIN_ADRESSE: '127.0.0.1', WOV_ADMIN_PORT: '0', WOV_ADMIN_TOKEN_DATEI: TOKEN_DATEI, WOV_SYSTEMCTL: SYSTEMCTL },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const zeit = setTimeout(() => scheitern(new Error(`service does not start:\n${protokoll}`)), 30_000);
    const auf = (s: Buffer): void => {
      protokoll += s.toString();
      const t = /bereit auf 127\.0\.0\.1:(\d+)/.exec(protokoll);
      if (t) {
        clearTimeout(zeit);
        fertig(Number(t[1]));
      }
    };
    dienst.stdout!.on('data', auf);
    dienst.stderr!.on('data', auf);
  });
}
const port = await dienstStarten();

const neuerServer = (): ReturnType<typeof createWovServer> =>
  createWovServer({
    port: 0,
    worldName: 'dev',
    worldSeed: 'quittung',
    worldFeatures: false,
    worldVegetation: false,
    worldsDir: SPIELSTAENDE,
    kontenDir: resolve(ORDNER, 'konten'),
    worldMode: 'layout',
    worldLayoutPath: WELT_DATEI,
    saveIntervalMs: 3600_000,
  });
let server = neuerServer();
server.start();
writeFileSync(LAEUFT, '');

type Eintrag = Record<string, unknown> & { id: string };
interface Daten {
  hash?: string;
  angewendet?: boolean;
  grund?: string;
  zaehler?: Record<string, number>;
  layout: { placements: Eintrag[]; regions: Eintrag[] };
}

async function anfrage(methode: 'GET' | 'POST' | 'PATCH', pfad: string, leib?: unknown, ifMatch?: string) {
  const t0 = Date.now();
  const r = await fetch(`http://127.0.0.1:${port}${pfad}`, {
    method: methode,
    headers: { 'x-wov-token': TOKEN, ...(leib !== undefined ? { 'content-type': 'application/json' } : {}), ...(ifMatch ? { 'if-match': ifMatch } : {}) },
    body: leib !== undefined ? JSON.stringify(leib) : undefined,
  });
  return { status: r.status, daten: (await r.json().catch(() => ({}))) as Daten, ms: Date.now() - t0 };
}
const zdosMit = (id: string) => server.zdos.getAllZDOs().filter((z) => z.getString(LAYOUT_ID_MEMBER) === id);
const dateiHash = (): string => layoutHash(readFileSync(WELT_DATEI));

try {
  // wait for the guard's boot receipt (the first 1-second tick)
  const q = quittungsDatei(SPIELSTAENDE, 'dev');
  for (let i = 0; i < 300 && !existsSync(q); i++) await new Promise((f) => setTimeout(f, 20));

  // 1) place
  const platz = { id: 'baum-1', prefab: 'Beech1', x: 30, z: 20 };
  const r1 = await anfrage('PATCH', '/api/worldlayout/ops', { vorgangId: 'v1', ops: [{ art: 'setze', sammlung: 'placements', id: 'baum-1', nachher: platz }] });
  check('1 PATCH place: 200, angewendet, gespawnt = 1', r1.status === 200 && r1.daten.angewendet === true && r1.daten.zaehler?.gespawnt === 1, `${r1.status} ${JSON.stringify(r1.daten.zaehler)} ${r1.ms} ms`);
  check('1 within 3 s, one ZDO with the layoutId', r1.ms <= 3000 && zdosMit('baum-1').length === 1);
  const zdoid = zdosMit('baum-1')[0]?.zdoid.toString();

  // 2) move
  const vorher = ((await anfrage('GET', '/api/worldlayout')).daten.layout.placements as Eintrag[]).find((p) => p.id === 'baum-1');
  const r2 = await anfrage('PATCH', '/api/worldlayout/ops', { vorgangId: 'v2', ops: [{ art: 'aendere', sammlung: 'placements', id: 'baum-1', vorher, nachher: { ...vorher, x: 35.5 } }] });
  check('2 PATCH move: 200, aktualisiert = 1, same zdoid', r2.status === 200 && r2.daten.zaehler?.aktualisiert === 1 && zdosMit('baum-1')[0]?.zdoid.toString() === zdoid, `${r2.status} ${r2.ms} ms`);

  // 3) POST whole document
  const g = await anfrage('GET', '/api/worldlayout');
  const doc3 = { ...g.daten.layout, placements: [...g.daten.layout.placements, { id: 'baum-2', prefab: 'Beech1', x: 50, z: 20 }] };
  const r3 = await anfrage('POST', '/api/worldlayout', doc3, String(g.daten.hash));
  check('3 POST: 200, applied, gespawnt = 1', r3.status === 200 && r3.daten.angewendet === true && r3.daten.zaehler?.gespawnt === 1 && zdosMit('baum-2').length === 1, `${r3.status} ${r3.ms} ms`);

  // 4) geo
  const g4 = await anfrage('GET', '/api/worldlayout');
  const region = g4.daten.layout.regions[0]!;
  const anzahl = server.zdos.getAllZDOs().length;
  const r4 = await anfrage('PATCH', '/api/worldlayout/ops', { vorgangId: 'v4', ops: [{ art: 'aendere', sammlung: 'regions', id: 'heim', vorher: region, nachher: { ...region, edgeFalloff: 300 } }] });
  check('4 PATCH region: 202 geo, file written, 0 ZDOs changed', r4.status === 202 && r4.daten.grund === 'geo' && r4.daten.hash === dateiHash() && server.zdos.getAllZDOs().length === anzahl, `${r4.status} ${r4.daten.grund}`);

  // 5) server off
  server.stop();
  rmSync(LAEUFT);
  const g5 = await anfrage('GET', '/api/worldlayout');
  const vorher5 = (g5.daten.layout.placements as Eintrag[]).find((p) => p.id === 'baum-1');
  const r5 = await anfrage('PATCH', '/api/worldlayout/ops', { vorgangId: 'v5', ops: [{ art: 'aendere', sammlung: 'placements', id: 'baum-1', vorher: vorher5, nachher: { ...vorher5, x: 41 } }] });
  check('5 server off: 202 server-aus (never 200), file written, under 1 s', r5.status === 202 && r5.daten.grund === 'server-aus' && r5.daten.hash === dateiHash() && r5.ms < 1000, `${r5.status} ${r5.daten.grund} ${r5.ms} ms`);

  // 7) an old receipt with the hash of the new file must not turn "server off" into 200
  const g7 = await anfrage('GET', '/api/worldlayout');
  quittungSchreiben(q, { hash: dateiHash(), ergebnis: 'angewendet', grund: null, zaehler: null, zeit: new Date().toISOString() });
  const vorher7 = (g7.daten.layout.placements as Eintrag[]).find((p) => p.id === 'baum-1');
  const r7 = await anfrage('PATCH', '/api/worldlayout/ops', { vorgangId: 'v7', ops: [{ art: 'aendere', sammlung: 'placements', id: 'baum-1', vorher: vorher7, nachher: { ...vorher7, x: 42 } }] });
  check('7 stale receipt (other hash) + server off: still 202 server-aus', r7.status === 202 && r7.daten.grund === 'server-aus', `${r7.status}`);

  // 6) "active" service, nobody quits
  writeFileSync(LAEUFT, '');
  const g6 = await anfrage('GET', '/api/worldlayout');
  const vorher6 = (g6.daten.layout.placements as Eintrag[]).find((p) => p.id === 'baum-1');
  const r6 = await anfrage('PATCH', '/api/worldlayout/ops', { vorgangId: 'v6', ops: [{ art: 'aendere', sammlung: 'placements', id: 'baum-1', vorher: vorher6, nachher: { ...vorher6, x: 43 } }] });
  check('6 active but silent: 202 keine-quittung after about 3 s', r6.status === 202 && r6.daten.grund === 'keine-quittung' && r6.ms >= 2900 && r6.ms < 6000, `${r6.status} ${r6.daten.grund} ${r6.ms} ms`);

  // 8) restart with a geo change: the old "applied" receipt must not survive the boot
  server = neuerServer();
  server.start();
  await new Promise((f) => setTimeout(f, 1500)); // boot receipt for the file as it is now (X)
  const hashX = dateiHash();
  const textX = readFileSync(WELT_DATEI, 'utf-8');
  check('8 set-up: the running server holds a receipt "applied" for X', quittungLesen(q)?.hash === hashX && quittungLesen(q)?.ergebnis === 'angewendet');
  server.stop();
  await new Promise((f) => setTimeout(f, 300));
  const docX = JSON.parse(textX) as { regions: Array<Record<string, unknown>> };
  const docY = { ...docX, regions: docX.regions.map((r) => ({ ...r, edgeFalloff: 250 })) };
  writeFileSync(`${WELT_DATEI}.tmp`, JSON.stringify(docY, null, 2));
  renameSync(`${WELT_DATEI}.tmp`, WELT_DATEI);
  const hashY = dateiHash();
  server = neuerServer(); // boots with Y; the receipt of the previous run still says "applied" for X
  server.start();
  const r8 = await anfrage('POST', '/api/worldlayout', docX, hashY); // "undo": X comes back inside the boot window
  check('8 X written back inside the boot window: never 200, 202 geo', r8.status === 202 && r8.daten.grund === 'geo' && r8.daten.hash === hashX, `${r8.status} ${r8.daten.grund} ${r8.ms} ms`);

  // 9) monotonic clock: a wall clock that jumps back an hour must not stretch the wait
  const echt = Date.now;
  let aufrufe = 0;
  Date.now = (): number => (aufrufe++ === 0 ? echt() : echt() - 3_600_000);
  const t9 = performance.now();
  const stand9 = await Promise.race([
    quittungAbwarten({ hash: 'x'.repeat(64), quittungsPfad: `${q}.gibtsnicht`, dienstAktiv: async () => true, warteMs: 300, intervallMs: 20 }),
    new Promise<'haengt'>((f) => setTimeout(() => f('haengt'), 2500)),
  ]);
  Date.now = echt;
  const dauer9 = performance.now() - t9;
  check('9 wall clock jumps back 1 h: the wait still ends after about 0.3 s (keine-quittung)', stand9 !== 'haengt' && stand9.angewendet === false && stand9.grund === 'keine-quittung' && dauer9 < 1500, `${stand9 === 'haengt' ? 'haengt' : stand9.angewendet === false ? stand9.grund : 'ok'} ${dauer9.toFixed(0)} ms`);

  // 10) WOV_QUITTUNG=aus only under an explicit NODE_ENV=test
  const start10 = (nodeEnv: string | null): Promise<{ code: number | null; text: string }> =>
    new Promise((fertig) => {
      const env: Record<string, string | undefined> = { ...process.env, WOV_WURZEL: ORDNER, WOV_WELT_VERZEICHNIS: WELTEN, WOV_INSTANZ: 'dev', WOV_ADMIN_ADRESSE: '127.0.0.1', WOV_ADMIN_PORT: '0', WOV_ADMIN_TOKEN_DATEI: TOKEN_DATEI, WOV_QUITTUNG: 'aus' };
      if (nodeEnv !== 'production') env.WOV_SYSTEMCTL = SYSTEMCTL; // under production a stand-in is refused for its own reason
      if (nodeEnv === null) delete env.NODE_ENV;
      else env.NODE_ENV = nodeEnv;
      const kind = spawn(TSX, ['src/main.ts'], { cwd: ADMIN, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let text = '';
      const frist = setTimeout(() => {
        kind.kill('SIGTERM');
        fertig({ code: null, text: `${text}\n(lebt nach 15 s: gestartet)` });
      }, 15_000);
      const auf = (s: Buffer): void => {
        text += s.toString();
        if (/bereit auf/.test(text)) {
          clearTimeout(frist);
          kind.kill('SIGTERM');
          fertig({ code: null, text });
        }
      };
      kind.stdout.on('data', auf);
      kind.stderr.on('data', auf);
      kind.on('exit', (code) => {
        clearTimeout(frist);
        fertig({ code, text });
      });
    });
  for (const [name, wert] of [['unset', null], ['empty', ''], ['development', 'development'], ['production', 'production']] as const) {
    const a = await start10(wert);
    check(`10 NODE_ENV ${name} + WOV_QUITTUNG=aus: the service does not start (exit 1, says why)`, a.code === 1 && /WOV_QUITTUNG=aus/.test(a.text) && !/bereit auf/.test(a.text), `code ${a.code}: ${a.text.slice(0, 120).replace(/\n/g, ' ')}`);
  }
  const ok10 = await start10('test');
  check('10 NODE_ENV=test + WOV_QUITTUNG=aus: the service starts', /bereit auf/.test(ok10.text), ok10.text.slice(0, 120).replace(/\n/g, ' '));
} finally {
  dienst?.kill('SIGTERM');
  try {
    server.stop();
  } catch {
    /* already stopped */
  }
  await new Promise((f) => setTimeout(f, 500));
  rmSync(ORDNER, { recursive: true, force: true });
}
console.log(fehler === 0 ? '\nall ok' : `\n${fehler} FAIL`);
process.exit(fehler === 0 ? 0 : 1);
