/**
 * E2 K5.0 N5 (finding N4-C): the test flight's Sockel radius (`einebnen`) is never above the service's limit of 100.
 * Der Sockel-Radius des Testflugs liegt nie über der Grenze des Betriebsdienstes (100).
 *
 * The REAL test flight code (`sockelRadiusFuer` as Testflug.ts calls it, `TestflugAktionen`, `opsPersistenz`) talks
 * to the REAL operations service (admin/src/main.ts, temp WOV_WURZEL, port 0, no game server: 202 `server-aus` is the
 * "written" answer). Before the fix a large building (Gravemound from x4.65, cave domes from x4.13, terrain tiles at x1)
 * was refused with 422 `einebnen=101`, the building could not be placed at all.
 *
 * Run: npx tsx test/testflug-sockel-dienst.ts   (from client/)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let fehler = 0;
let geprueft = 0;
const pruefe = (ok: boolean, text: string): void => {
  geprueft++;
  if (!ok) {
    fehler++;
    console.error(`  FAIL: ${text}`);
  } else console.log(`  ok   ${text}`);
};

const CLIENT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN = resolve(CLIENT, '..', 'admin');
const TSX = resolve(CLIENT, '..', 'node_modules/.bin/tsx');
const ORDNER = mkdtempSync(resolve(tmpdir(), 'wov-testflug-sockel-'));
const WELTEN = resolve(ORDNER, 'server/data/welten');
const WELT_DATEI = resolve(WELTEN, 'dev.json');
const TOKEN = 'sockel-token';
const TOKEN_DATEI = resolve(ORDNER, 'token');
const SYSTEMCTL = resolve(ORDNER, 'systemctl');
mkdirSync(WELTEN, { recursive: true });
writeFileSync(TOKEN_DATEI, `${TOKEN}\n`);
writeFileSync(SYSTEMCTL, '#!/bin/sh\nif [ "$1" = show ]; then echo ActiveState=inactive; fi\nexit 0\n');
chmodSync(SYSTEMCTL, 0o755);
const START = {
  version: 1,
  name: 'sockel',
  detailSeed: 'sockel',
  continents: [],
  regions: [{ id: 'heim', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1600 }, edgeFalloff: 200, baseLevel: 0.3, vegetation: [] }],
  defaultSpawn: [0, 0],
  placements: [],
};
writeFileSync(WELT_DATEI, JSON.stringify(START, null, 2));

let dienst = null as ChildProcess | null;
const port = await new Promise<number>((fertig, scheitern) => {
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

const speicher = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => speicher.get(k) ?? null,
  setItem: (k: string, v: string) => void speicher.set(k, v),
};
console.warn = (): void => undefined;
const { localStoragePersistenz, ENTWURF_SCHLUESSEL } = await import('../src/editor/testflug/LocalStoragePersistenz');
const { opsPersistenz } = await import('../src/editor/testflug/OpsPersistenz');
const { TestflugAktionen } = await import('../src/editor/testflug/TestflugAktionen');
const { sockelRadiusFuer } = await import('../src/editor/testflug/sockel');
const { findPrefabByName } = await import('@wov/shared/src/prefabs.js');
speicher.set(ENTWURF_SCHLUESSEL, JSON.stringify(START));
const dienstFetch = ((url: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${url}`, { ...init, headers: { ...(init?.headers as Record<string, string>), 'x-wov-token': TOKEN } })) as typeof fetch;
const aktionen = new TestflugAktionen(opsPersistenz(localStoragePersistenz(), { fetchFn: dienstFetch }));

const FAELLE: [string, number[]][] = [
  ['Grabhuegel', [4.65, 4.7, 4.8, 4.9, 5]],
  ['cave_dome_roof', [4.15, 4.2, 4.5, 4.8, 5]],
  ['terrain-terrainl1', [1]],
  ['Beech1', [1]], // a small one: the value must stay the plain formula
];
try {
  let nr = 0;
  for (const [prefab, skalen] of FAELLE) {
    const w = findPrefabByName(prefab)?.renderScale.w;
    pruefe(w !== undefined, `${prefab}: known prefab (w ${w})`);
    if (w === undefined) continue;
    for (const skala of skalen) {
      const roh = Math.round((w * skala) / 2 + 1);
      const sockel = sockelRadiusFuer(w, skala);
      pruefe(sockel <= 100 && sockel === Math.min(100, roh) && sockel >= 1, `${prefab} x${skala}: raw ${roh} -> Sockel ${sockel} (<= 100, plain formula below the limit)`);
      const id = `sockel-${++nr}`;
      const antwort = aktionen.setzen({ id, prefab, x: 100 + nr * 50, z: 100, yaw: 0, scale: skala, einebnen: sockel });
      const ant = antwort.ok ? await antwort.antwort : null;
      const ok = ant !== null && (ant.art === 'angewendet' || (ant.art === 'nur-geschrieben' && ant.grund === 'server-aus'));
      pruefe(ok, `${prefab} x${skala} (Sockel ${sockel}): service answers written/applied, not 422 — ${ant ? JSON.stringify(ant) : 'local refusal'}`);
      const inDatei = (JSON.parse(readFileSync(WELT_DATEI, 'utf-8')) as { placements: { id: string; einebnen?: number }[] }).placements.find((p) => p.id === id);
      pruefe(inDatei?.einebnen === sockel, `${prefab} x${skala}: the FILE holds einebnen ${inDatei?.einebnen} (sent ${sockel})`);
    }
  }
  const gross = FAELLE.flatMap(([p, sk]) => sk.map((s) => Math.round(((findPrefabByName(p)?.renderScale.w ?? 0) * s) / 2 + 1))).filter((r) => r > 100).length;
  pruefe(gross >= 10, `the probe set really has raw radii above 100 (${gross} of them), so the cap is exercised`);
} finally {
  dienst?.kill('SIGTERM');
  await new Promise((f) => setTimeout(f, 300));
  rmSync(ORDNER, { recursive: true, force: true });
}
console.log(fehler === 0 ? `\ntestflug-sockel-dienst: ALL PASSED (${geprueft} checks)` : `\ntestflug-sockel-dienst: ${fehler} FAIL of ${geprueft}`);
process.exit(fehler === 0 ? 0 : 1);
