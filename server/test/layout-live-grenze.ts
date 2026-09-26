/**
 * Live sync of the world document (Editor E2, card K5.0 N2, finding Z6): the WHOLE guard tick at the limit of
 * live-applied changes (100 new / changed entries in ONE write), median in ms. The limit is only worth what this
 * measures: above 250 ms the limit (`AENDERUNGEN_MAX`) has to come down.
 *
 *  1. 100 new entries per write, close together (400 m); the document grows from 700 to 1900 placements
 *  2. 100 new entries, spread wide (1800 m)
 *  3. 100 existing entries moved by 1 m, wide
 *  4. 100 existing entries switch prefab (each ZDO is replaced), wide
 *  5. 101 changes: the limit refuses, the tick is cheap (no scan, nothing applied)
 *
 * Every tick is checked against the receipt (applied for 1-4, `zu-viele-aenderungen` for 5), so a cheap tick
 * that did nothing does not count. Each case: 12 ticks; the median and maximum are printed.
 *
 * Run: npx tsx test/layout-live-grenze.ts   (from server/)
 */
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { quittungLesen, quittungsDatei } from '@wov/shared/src/worldlayout/quittung.js';
import { createWovServer } from '../src/WovServer.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  } else console.log(`ok   ${name}${detail ? ` (${detail})` : ''}`);
}

const WURZEL = mkdtempSync(join(tmpdir(), 'wov-layout-grenze-'));
/** Card N2: above 250 ms the limit comes down. */
const GRENZE_MEDIAN_MS = 250;
const LAEUFE = 12;
const ARTEN = ['Eiche1', 'Tanne1', 'BirkeDicht2', 'Ginster2', 'Felsblock3', 'Findling3', 'Steinkreis', 'Grabhuegel'];
const WECHSEL = ['Eiche1', 'Tanne1'];

type Platz = { id: string; prefab: string; x: number; z: number };

let s = 12345;
const zufall = (): number => {
  s = (s * 1103515245 + 12345) & 0x7fffffff;
  return s / 0x7fffffff;
};
function verteilt(n: number, halbe: number, ab: number, kennung: string, arten: readonly string[] = ARTEN): Platz[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${kennung}-${ab + i}`,
    prefab: arten[(ab + i) % arten.length]!,
    x: Math.round((zufall() * 2 - 1) * halbe),
    z: Math.round((zufall() * 2 - 1) * halbe),
  }));
}
function dokument(placements: Platz[]): Record<string, unknown> {
  return {
    version: 1,
    name: 'Layout-Grenze',
    detailSeed: 'Grenze1',
    continents: [],
    regions: [{ id: 'probe', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1900 }, edgeFalloff: 200, baseLevel: 0.3, vegetation: [] }],
    defaultSpawn: [0, 0],
    placements,
  };
}
function schreibe(datei: string, d: unknown): void {
  const temp = `${datei}.probe.tmp`;
  writeFileSync(temp, JSON.stringify(d));
  renameSync(temp, datei);
}

/** `aendern(lauf)` liefert das Dokument des Laufs; erwartet wird die Quittung `erwartet` (Grund oder `angewendet`). */
async function fall(name: string, basis: Platz[], aendern: (lauf: number) => Platz[], erwartet: string, anzahl: number): Promise<void> {
  const ordner = mkdtempSync(join(WURZEL, 'f-'));
  const welten = join(ordner, 'worlds');
  mkdirSync(welten, { recursive: true });
  const layout = join(ordner, 'layout.json');
  schreibe(layout, dokument(basis));
  const server = createWovServer({
    port: 0,
    everyoneAdmin: true,
    worldName: 'grenze',
    worldSeed: 'Grenze1',
    worldFeatures: false,
    worldVegetation: false,
    worldsDir: welten,
    kontenDir: join(ordner, 'konten'),
    worldMode: 'layout',
    worldLayoutPath: layout,
    saveIntervalMs: 3600_000,
  });
  const orig = { log: console.log, warn: console.warn };
  console.log = () => undefined;
  console.warn = () => undefined;
  try {
    server.start();
    const wache = (server as unknown as { layoutWache: { tick(): void } }).layoutWache;
    wache.tick(); // takes the boot state
    const dauern: number[] = [];
    let richtig = 0;
    for (let i = 0; i < LAEUFE; i++) {
      schreibe(layout, dokument(aendern(i)));
      const t0 = performance.now();
      wache.tick();
      dauern.push(performance.now() - t0);
      const q = quittungLesen(quittungsDatei(welten, 'grenze'));
      if (process.env.GRENZE_DEBUG) process.stderr.write(`t${i} ${dauern[i]!.toFixed(0)}ms ${q?.grund} ${JSON.stringify(q?.zaehler)} ${q?.detail ?? ''}\n`);
      if (erwartet === 'angewendet' ? q?.ergebnis === 'angewendet' && q.grund === null && q.zaehler !== null && (q.zaehler.gespawnt ?? 0) + (q.zaehler.aktualisiert ?? 0) >= 100 : q?.grund === erwartet) richtig++;
    }
    const sortiert = [...dauern].sort((a, b) => a - b);
    const median = (sortiert[LAEUFE / 2 - 1]! + sortiert[LAEUFE / 2]!) / 2;
    console.log = orig.log;
    console.log(`MESSUNG ${name}: ${basis.length} placements, ${anzahl} changes per write, ${LAEUFE} ticks, median ${median.toFixed(1)} ms, max ${sortiert[LAEUFE - 1]!.toFixed(1)} ms`);
    check(`${name}: every tick ended with the receipt "${erwartet}"`, richtig === LAEUFE, `${richtig}/${LAEUFE}`);
    check(`${name}: median <= ${GRENZE_MEDIAN_MS} ms`, median <= GRENZE_MEDIAN_MS, `${median.toFixed(1)} ms`);
  } finally {
    console.log = orig.log;
    console.warn = orig.warn;
    server.stop();
    await new Promise((r) => setTimeout(r, 200));
  }
}

try {
  for (const [ort, halbe] of [['close (400 m)', 200], ['wide (1800 m)', 900]] as const) {
    const basis = verteilt(700, halbe, 0, 'b'); // + 12 x 100 new = 1900, below the sanitizer's 2000
    const neue = verteilt(LAEUFE * 100, halbe, 10_000, 'n'); // each tick appends the next 100 to what is applied
    await fall(`1/2 100 NEW entries, ${ort}`, basis, (lauf) => [...basis, ...neue.slice(0, (lauf + 1) * 100)], 'angewendet', 100);
  }
  const bewegt = verteilt(1900, 900, 0, 'b');
  const beweglich = verteilt(100, 900, 0, 'm');
  await fall('3 100 existing entries moved by 1 m, wide', [...bewegt, ...beweglich], (lauf) => [...bewegt, ...beweglich.map((p) => ({ ...p, x: p.x + (lauf % 2 === 0 ? 1 : 0) }))], 'angewendet', 100);
  // Lauf 0 already moves (base = x, run 0 = x+1), so every tick changes all 100.
  const wechselBasis = verteilt(1900, 900, 0, 'b');
  const wechsler = verteilt(100, 900, 0, 'w').map((p) => ({ ...p, prefab: WECHSEL[0]! }));
  await fall('4 100 existing entries switch prefab (100 ZDOs replaced), wide', [...wechselBasis, ...wechsler], (lauf) => [...wechselBasis, ...wechsler.map((p) => ({ ...p, prefab: WECHSEL[(lauf + 1) % 2]! }))], 'angewendet', 100);
  const grenzBasis = verteilt(1800, 900, 0, 'b');
  const grenzBeweglich = verteilt(101, 900, 0, 'g');
  await fall('5 101 changes: refused by the limit', [...grenzBasis, ...grenzBeweglich], (lauf) => [...grenzBasis, ...grenzBeweglich.map((p) => ({ ...p, x: p.x + lauf + 1 }))], 'zu-viele-aenderungen', 101);
} finally {
  if (existsSync(WURZEL)) rmSync(WURZEL, { recursive: true, force: true });
}
console.log(fehler === 0 ? '\nall ok' : `\n${fehler} FAIL`);
process.exit(fehler === 0 ? 0 : 1);
