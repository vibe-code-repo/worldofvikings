/**
 * Karte T1 N1 (Angriffsbefunde B1, B3): `heightDeltas` im echten Betriebsdienst
 * (POST /api/worldlayout, real service, port 0). B1 war der Kernbefund: eine
 * ungültige heightDeltas-Angabe fiel bisher durch den ganzen Fehlerzweig und
 * landete im Sammel-catch als 400 OHNE Liste, statt 422 MIT `fehlerhaft`
 * (analog Platzierungen). B3: mehr als die Obergrenze an Zonen/Punkten wurde
 * mit 200 still gekürzt statt mit 422 abgewiesen.
 *
 *   npx tsx test/weltops-hoehenkorrektur.ts   (aus admin/)
 *
 * Testliste (aus der Karte): doppelte Zone, gemischte Punkte (gültig +
 * ungültig in einer Zone), `__proto__`, Index 64 (gültig seit N1/B2), zu
 * viele Zonen, zu viele Punkte.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWovServer } from '../../server/src/WovServer.js';

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

const ORDNER = mkdtempSync(resolve(tmpdir(), 'wov-weltops-hoehenkorrektur-'));
const WELTEN = resolve(ORDNER, 'server/data/welten');
const SPIELSTAENDE = resolve(ORDNER, 'server/data/worlds');
const WELT_DATEI = resolve(WELTEN, 'dev.json');
const LAEUFT = resolve(ORDNER, 'laeuft');
const TOKEN = 'hoehenkorrektur-token';
const TOKEN_DATEI = resolve(ORDNER, 'token');
const SYSTEMCTL = resolve(ORDNER, 'systemctl');
mkdirSync(WELTEN, { recursive: true });
mkdirSync(SPIELSTAENDE, { recursive: true });
writeFileSync(TOKEN_DATEI, `${TOKEN}\n`);
writeFileSync(SYSTEMCTL, `#!/bin/sh\nif [ "$1" = show ]; then if [ -e "${LAEUFT}" ]; then echo ActiveState=active; else echo ActiveState=inactive; fi; fi\nexit 0\n`);
chmodSync(SYSTEMCTL, 0o755);

function dokument(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    name: 'Hoehenkorrektur-Dienst',
    detailSeed: 'hoehenkorrektur-dienst',
    continents: [],
    regions: [{ id: 'heim', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1600 }, edgeFalloff: 200, baseLevel: 0.3, vegetation: [] }],
    defaultSpawn: [0, 0],
    placements: [],
    ...extra,
  };
}
writeFileSync(WELT_DATEI, JSON.stringify(dokument(), null, 2));

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

const server = createWovServer({
  port: 0,
  worldName: 'dev',
  worldSeed: 'hoehenkorrektur-dienst',
  worldFeatures: false,
  worldVegetation: false,
  worldsDir: SPIELSTAENDE,
  kontenDir: resolve(ORDNER, 'konten'),
  worldMode: 'layout',
  worldLayoutPath: WELT_DATEI,
  saveIntervalMs: 3600_000,
});
server.start();
writeFileSync(LAEUFT, '');

interface Daten {
  ok?: boolean;
  hash?: string;
  fehler?: string;
  grund?: string;
  anzahl?: number;
  grenze?: number;
  message?: string;
  fehlerhaft?: { zone: string; feld: string; wert: unknown }[];
  anzahlFehlerhaft?: number;
  layout?: { heightDeltas?: unknown };
}
async function anfrage(methode: 'GET' | 'POST', pfad: string, leib?: unknown, ifMatch?: string): Promise<{ status: number; daten: Daten }> {
  const r = await fetch(`http://127.0.0.1:${port}${pfad}`, {
    method: methode,
    headers: { 'x-wov-token': TOKEN, ...(leib !== undefined ? { 'content-type': 'application/json' } : {}), ...(ifMatch ? { 'if-match': ifMatch } : {}) },
    body: leib !== undefined ? JSON.stringify(leib) : undefined,
  });
  return { status: r.status, daten: (await r.json().catch(() => ({}))) as Daten };
}
const schlafen = (ms: number): Promise<void> => new Promise((f) => setTimeout(f, ms));
const stumm = (): void => undefined;
async function aktuellerHash(): Promise<string> {
  const g = await anfrage('GET', '/api/worldlayout');
  return g.daten.hash!;
}
async function post(heightDeltas: unknown): Promise<{ status: number; daten: Daten }> {
  const basis = await aktuellerHash();
  return anfrage('POST', '/api/worldlayout', dokument({ heightDeltas }), basis);
}
const findet = (d: Daten, zone: string, feld: string): { zone: string; feld: string; wert: unknown } | undefined =>
  d.fehlerhaft?.find((f) => f.zone === zone && f.feld === feld);

const orig = { log: console.log, warn: console.warn };
try {
  console.log = stumm;
  console.warn = stumm;

  const basis0 = await aktuellerHash();
  check('set-up: GET liefert den Ausgangshash', typeof basis0 === 'string' && basis0.length > 0, basis0);

  // ── B1: doppelte Zone ──
  const doppelt = await post([{ zx: 0, zz: 0, i: '1', d: '5' }, { zx: 0, zz: 0, i: '2', d: '5' }]);
  check('doppelte Zone: 422 ungueltig', doppelt.status === 422 && doppelt.daten.fehler === 'ungueltig', `${doppelt.status} ${doppelt.daten.fehler}`);
  check('doppelte Zone: die Liste nennt Zone 0,0 und Feld "zone"="doppelt"', findet(doppelt.daten, '0,0', 'zone')?.wert === 'doppelt', JSON.stringify(doppelt.daten.fehlerhaft));

  // ── B1: gemischte Punkte (ein gültiger, ein ungültiger Punkt in einer Zone) ──
  const gemischt = await post([{ zx: 1, zz: 1, i: '10,99999', d: '50,1' }]);
  check('gemischte Punkte: 422 ungueltig, nichts teilweise gespeichert', gemischt.status === 422 && gemischt.daten.fehler === 'ungueltig', `${gemischt.status}`);
  check('gemischte Punkte: die Liste nennt den ungültigen Index (99999)', findet(gemischt.daten, '1,1', 'index')?.wert === 99999, JSON.stringify(gemischt.daten.fehlerhaft));
  const nachGemischt = await anfrage('GET', '/api/worldlayout');
  check('gemischte Punkte: nichts gespeichert (kein heightDeltas nach dem Versuch)', !nachGemischt.daten.layout?.heightDeltas);

  // ── __proto__ als Schlüssel: kein Absturz, keine Verschmutzung, normale 200-Antwort ──
  const protoRoh = { zx: 2, zz: 2, i: '5', d: '10', __proto__: { polluted: true } };
  const proto = await post([protoRoh]);
  // 202 ist der ERWARTETE, richtige Status: heightDeltas ist "geo" (K5.0), also geschrieben aber erst nach Neustart wirksam.
  check('__proto__ im Zonen-Objekt: 200/201/202, kein Absturz', [200, 201, 202].includes(proto.status), `${proto.status} ${JSON.stringify(proto.daten)}`);
  check('__proto__: Object.prototype bleibt sauber', (Object.prototype as unknown as { polluted?: unknown }).polluted === undefined);
  const nachProto = await anfrage('GET', '/api/worldlayout');
  const gespeichertProto = nachProto.daten.layout?.heightDeltas as { zx: number; zz: number; i: string; d: string }[] | undefined;
  check('__proto__: die Zone selbst (zx/zz/i/d) wurde normal gespeichert', gespeichertProto?.length === 1 && gespeichertProto[0]!.zx === 2 && gespeichertProto[0]!.i === '5', JSON.stringify(gespeichertProto));

  // ── Index 64: GÜLTIGER, gewöhnlicher Punkt seit N1/B2 (vor N1 eine tote Randadresse) ──
  const idx64 = await post([{ zx: 0, zz: 0, i: '64', d: '250' }]);
  check('Index 64: 200/201/202 (gültig seit N1/B2, 202 weil geo)', [200, 201, 202].includes(idx64.status), `${idx64.status} ${JSON.stringify(idx64.daten)}`);
  const nach64 = await anfrage('GET', '/api/worldlayout');
  const gespeichert64 = nach64.daten.layout?.heightDeltas as { zx: number; zz: number; i: string; d: string }[] | undefined;
  check('Index 64: unverändert gespeichert (i="64")', gespeichert64?.length === 1 && gespeichert64[0]!.i === '64' && gespeichert64[0]!.d === '250', JSON.stringify(gespeichert64));

  // ── B3: zu viele Zonen ──
  const zuVieleZonen = Array.from({ length: 4097 }, (_, i) => ({ zx: i, zz: 0, i: '1', d: '1' }));
  const zonenAntwort = await post(zuVieleZonen);
  check(
    'zu viele Zonen (4097 > 4096): 422 zu-viele-hoehenzonen, nicht 200 mit stiller Kürzung',
    zonenAntwort.status === 422 && zonenAntwort.daten.fehler === 'zu-viele-hoehenzonen' && zonenAntwort.daten.anzahl === 4097,
    `${zonenAntwort.status} ${zonenAntwort.daten.fehler} anzahl=${zonenAntwort.daten.anzahl}`
  );
  const nachZuVieleZonen = await anfrage('GET', '/api/worldlayout');
  check(
    'zu viele Zonen: nichts gespeichert (weiterhin nur die Index-64-Zone von vorher)',
    (nachZuVieleZonen.daten.layout?.heightDeltas as unknown[] | undefined)?.length === 1
  );

  // ── B3: zu viele Punkte insgesamt (wenige Zonen, aber riesige i/d-Listen) ──
  const riesigeListe = Array.from({ length: 4000 }, (_, i) => i).join(',');
  const riesigesDelta = Array.from({ length: 4000 }, () => '1').join(',');
  const zuVielePunkte = [
    { zx: 100, zz: 0, i: riesigeListe, d: riesigesDelta },
    { zx: 101, zz: 0, i: riesigeListe, d: riesigesDelta },
    { zx: 102, zz: 0, i: riesigeListe, d: riesigesDelta },
    { zx: 103, zz: 0, i: riesigeListe, d: riesigesDelta },
    { zx: 104, zz: 0, i: riesigeListe, d: riesigesDelta },
    { zx: 105, zz: 0, i: riesigeListe, d: riesigesDelta },
    { zx: 106, zz: 0, i: riesigeListe, d: riesigesDelta },
    { zx: 107, zz: 0, i: riesigeListe, d: riesigesDelta },
    { zx: 108, zz: 0, i: riesigeListe, d: riesigesDelta },
    { zx: 109, zz: 0, i: riesigeListe, d: riesigesDelta },
    { zx: 110, zz: 0, i: riesigeListe, d: riesigesDelta },
    { zx: 111, zz: 0, i: riesigeListe, d: riesigesDelta },
    { zx: 112, zz: 0, i: riesigeListe, d: riesigesDelta },
    { zx: 113, zz: 0, i: riesigeListe, d: riesigesDelta },
    { zx: 114, zz: 0, i: riesigeListe, d: riesigesDelta },
    { zx: 115, zz: 0, i: riesigeListe, d: riesigesDelta },
    { zx: 116, zz: 0, i: riesigeListe, d: riesigesDelta },
    { zx: 117, zz: 0, i: riesigeListe, d: riesigesDelta },
    { zx: 118, zz: 0, i: riesigeListe, d: riesigesDelta },
    { zx: 119, zz: 0, i: riesigeListe, d: riesigesDelta },
    { zx: 120, zz: 0, i: riesigeListe, d: riesigesDelta },
    { zx: 121, zz: 0, i: riesigeListe, d: riesigesDelta },
    { zx: 122, zz: 0, i: riesigeListe, d: riesigesDelta },
    { zx: 123, zz: 0, i: riesigeListe, d: riesigesDelta },
    { zx: 124, zz: 0, i: riesigeListe, d: riesigesDelta },
    { zx: 125, zz: 0, i: riesigeListe, d: riesigesDelta }, // 26 * 4000 = 104 000 > 100 000
  ];
  const punkteAntwort = await post(zuVielePunkte);
  check(
    'zu viele Punkte insgesamt (104 000 > 100 000): 422 zu-viele-hoehenpunkte',
    punkteAntwort.status === 422 && punkteAntwort.daten.fehler === 'zu-viele-hoehenpunkte' && punkteAntwort.daten.anzahl === 104_000,
    `${punkteAntwort.status} ${punkteAntwort.daten.fehler} anzahl=${punkteAntwort.daten.anzahl}`
  );
} finally {
  console.log = orig.log;
  console.warn = orig.warn;
  dienst?.kill('SIGTERM');
  try {
    server.stop();
  } catch {
    /* already stopped */
  }
  await schlafen(500);
  rmSync(ORDNER, { recursive: true, force: true });
}
console.log(fehler === 0 ? '\nall ok' : `\n${fehler} FAIL`);
process.exit(fehler === 0 ? 0 : 1);
