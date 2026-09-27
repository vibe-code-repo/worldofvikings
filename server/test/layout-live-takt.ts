/**
 * Live sync of the world document (Editor E2, card K5.0 N1, finding B2): the WHOLE guard tick in the game
 * thread (stat, read, parse, sanitize, diff, height of the changed placements, comparison, hand-over) after
 * ONE changed placement, not only the comparison.
 *
 *  1. 2000 placements close together (400 m), one changed
 *  2. 2000 placements spread wide (1800 m), one changed
 *  3. 2000 placements spread wide, a third of them with an unknown prefab, one changed
 *  4. the same, but the ONE change is a placement with an unknown prefab (the "protect what might belong
 *     to it" scan runs for that one placement only)
 *  5. 2000 placements of ONE prefab, spread wide: the worst case of the sanitizer's duplicate folding (quadratic
 *     per prefab); reported, only a loose limit (250 ms)
 *  6. (with WOV_LIVE_KOPIE=<dir with dev.json and worlds/dev.db.zst>, optional) a copy of a DEV save
 *
 * Each case: 12 ticks, each after changing one entry; median and maximum are printed. The limit that fails the
 * test is 100 ms for the median (target 50 ms, see GRENZE_MEDIAN_MS); the worst case (5) has a loose one.
 *
 * Run: npx tsx test/layout-live-takt.ts   (from server/)
 */
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWovServer } from '../src/WovServer.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  } else console.log(`ok   ${name}${detail ? ` (${detail})` : ''}`);
}

const WURZEL = mkdtempSync(join(tmpdir(), 'wov-layout-takt-'));
const KOPIE = process.env.WOV_LIVE_KOPIE;
/** The card's target is 50 ms; the test fails at 100 ms so that a busy machine (other tests) does not make it flaky, while the old 550-2900 ms would. */
const GRENZE_MEDIAN_MS = 100;
const LAEUFE = 12;

type Platz = { id: string; prefab: string; x: number; z: number };

/** Eight kinds of objects, like a real document (a single prefab 2000 times is the sanitizer's worst case, case 5). */
const ARTEN = ['Eiche1', 'Tanne1', 'BirkeDicht2', 'Ginster2', 'Felsblock3', 'Findling3', 'Steinkreis', 'Grabhuegel'];

/** Deterministic spread (no Math.random: a run is repeatable). */
function verteilt(n: number, halbe: number, unbekannteJeDrei: boolean, arten: readonly string[] = ARTEN): Platz[] {
  const out: Platz[] = [];
  let s = 12345;
  const zufall = (): number => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let i = 0; i < n; i++) {
    out.push({
      id: `p-${i}`,
      prefab: unbekannteJeDrei && i % 3 === 0 ? 'U_Unbekannt' : arten[i % arten.length]!,
      x: Math.round((zufall() * 2 - 1) * halbe),
      z: Math.round((zufall() * 2 - 1) * halbe),
    });
  }
  return out;
}

function dokument(placements: Platz[]): Record<string, unknown> {
  return {
    version: 1,
    name: 'Layout-Takt',
    detailSeed: 'Takt1',
    continents: [],
    regions: [{ id: 'probe', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1900 }, edgeFalloff: 200, baseLevel: 0.3, vegetation: [] }],
    defaultSpawn: [0, 0],
    placements,
  };
}

async function fall(name: string, ordner: string, layout: string, welten: string, instanz: string, seed: string, aendern: () => void, ziele: number): Promise<{ median: number; max: number }> {
  const server = createWovServer({
    port: 0,
    everyoneAdmin: true,
    worldName: instanz,
    worldSeed: seed,
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
    const zdoAnzahl = server.zdos.getAllZDOs().length;
    const dauern: number[] = [];
    for (let i = 0; i < LAEUFE; i++) {
      aendern();
      const t0 = performance.now();
      wache.tick();
      dauern.push(performance.now() - t0);
    }
    const sortiert = [...dauern].sort((a, b) => a - b);
    const median = (sortiert[LAEUFE / 2 - 1]! + sortiert[LAEUFE / 2]!) / 2;
    const max = sortiert[LAEUFE - 1]!;
    console.log = orig.log;
    console.log(`MESSUNG ${name}: ${zdoAnzahl} ZDOs, ${ziele} placements, ${LAEUFE} ticks, median ${median.toFixed(1)} ms, max ${max.toFixed(1)} ms`);
    return { median, max };
  } finally {
    console.log = orig.log;
    console.warn = orig.warn;
    server.stop();
    await new Promise((r) => setTimeout(r, 200));
  }
}

function schreibe(datei: string, d: unknown): void {
  const temp = `${datei}.probe.tmp`;
  writeFileSync(temp, JSON.stringify(d));
  renameSync(temp, datei);
}

async function synthetisch(name: string, liste: Platz[], welcher: (i: number) => number, grenze = GRENZE_MEDIAN_MS): Promise<void> {
  const ordner = mkdtempSync(join(WURZEL, 'f-'));
  const welten = join(ordner, 'worlds');
  mkdirSync(welten, { recursive: true });
  const layout = join(ordner, 'layout.json');
  const d = dokument(liste);
  schreibe(layout, d);
  let lauf = 0;
  const r = await fall(name, ordner, layout, welten, 'takt', 'Takt1', () => {
    const p = liste[welcher(lauf)]!;
    p.x += lauf % 2 === 0 ? 1 : -1;
    lauf++;
    schreibe(layout, dokument(liste));
  }, liste.length);
  check(`${name}: median <= ${grenze} ms`, r.median <= grenze, `${r.median.toFixed(1)} ms, max ${r.max.toFixed(1)} ms`);
}

try {
  await synthetisch('1 close (400 m), 2000 placements, one changed', verteilt(2000, 200, false), () => 1000);
  await synthetisch('2 wide (1800 m), 2000 placements, one changed', verteilt(2000, 900, false), () => 1000);
  await synthetisch('3 wide, a third with unknown prefab, one known changed', verteilt(2000, 900, true), () => 1001);
  await synthetisch('4 wide, a third with unknown prefab, the changed one is unknown', verteilt(2000, 900, true), () => 999);
  await synthetisch('5 wide, 2000 placements of ONE prefab (worst case of the duplicate folding), one changed', verteilt(2000, 900, false, ['Eiche1']), () => 1000, 250);
  if (KOPIE) {
    const ordner = mkdtempSync(join(WURZEL, 'k-'));
    const welten = join(ordner, 'worlds');
    cpSync(join(KOPIE, 'worlds'), welten, { recursive: true });
    const layout = join(ordner, 'dev.json');
    cpSync(join(KOPIE, 'dev.json'), layout);
    const dok = JSON.parse(readFileSync(layout, 'utf-8')) as { placements: Array<{ x: number; einebnen?: number; route?: string }> };
    const ziel = dok.placements.find((p) => !p.einebnen && !p.route) ?? dok.placements[0]!;
    let lauf = 0;
    const r = await fall('6 DEV copy', ordner, layout, welten, 'dev', process.env.WOV_LIVE_SEED ?? 'KxSYuZquuw', () => {
      ziel.x += lauf++ % 2 === 0 ? 1 : -1;
      schreibe(layout, dok);
    }, dok.placements.length);
    check(`6 DEV copy: median <= ${GRENZE_MEDIAN_MS} ms`, r.median <= GRENZE_MEDIAN_MS, `${r.median.toFixed(1)} ms, max ${r.max.toFixed(1)} ms`);
  }
} finally {
  if (existsSync(WURZEL)) rmSync(WURZEL, { recursive: true, force: true });
}
console.log(fehler === 0 ? '\nall ok' : `\n${fehler} FAIL`);
process.exit(fehler === 0 ? 0 : 1);
