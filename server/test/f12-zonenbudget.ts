/**
 * F12 — Zonenbudget je Spieler: reihum statt global nach Entfernung.
 *
 * Neue Zonen (Bäume, Fels, Kreaturen) entstehen je Tick höchstens im Zeitbudget
 * (12 ms). Früher gab es EINE globale Warteschlange, nach dem Abstand zum
 * nächsten Spieler sortiert: ein Spieler in unbekanntem Gelände füllte das
 * Budget, ein zweiter mit wenigen offenen Zonen kam spät dran, und die
 * Sortierung kostete O(Schlange × Spieler). Jetzt: je Spieler eine Schlange
 * in Ringordnung, mindestens 2 ms je Spieler und Tick, der Rest an die
 * nächste offene Zone, Startpunkt wandert.
 *
 * Geprüft, mit Zahlen:
 *  1. Spieler A steht in ungenerierter Fläche (81 offene Zonen), Spieler B
 *     1 km entfernt hat 3 offene: B ist mit einer simulierten Uhr (0,5 ms je
 *     Uhrablesung, Konstruktor-Option `zeit`) in höchstens 2 Ticks fertig.
 *     Auf main (globale Sortierung) dauert es mehr als 2 Ticks.
 *  2. 25 Spieler, gut 1000 offene Zonen: Zeit der Vorbereitungsarbeit je Tick
 *     (Budget 0) und, wo die neue Diagnose da ist, die Zahl der Abstands-
 *     vergleiche (≤ Q, nicht Q×P). Die Zahlen werden ausgegeben.
 *  3. Gleiche Menge erzeugter Zonen wie vorher: generatedZoneCount, ZDO-Zahl
 *     und Prüfsumme (Prefab + Lage, reihenfolgeunabhängig) gleich dem Golden
 *     aus dem Lauf auf main.
 *  4. Ein Spieler verlässt die Gegend: seine Zonen fallen aus `pending`,
 *     nach dem Abarbeiten ist `pending` leer; eine Zone in zwei Schlangen
 *     wird genau einmal erzeugt.
 *
 *  5. Zonen teurer als der Anteil je Spieler (5 Spieler, 8 ms je Zone): jeder
 *     Spieler kommt in höchstens n Ticks dran (Reihum wandert), die Summe je
 *     Tick bleibt ≤ Budget + eine Zone (der Deckel gilt auch im Mindestanteil).
 *
 * Lauf: npx tsx server/test/f12-zonenbudget.ts   (aus der Wurzel)
 */

import {
  GRASLAND_FLORA_NAMEN,
  GeoManager,
  HeightmapProvider,
  NADELWALD_FLORA_NAMEN,
  RegionGeo,
  getStableHash,
  sanitizeWorldLayout,
} from '@wov/shared';
import type { Vector3 } from '@wov/shared';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
import { ZoneManager } from '../src/world/ZoneManager.js';

const SEED = getStableHash('KxSYuZquuw');
// Golden aus dem Lauf auf main (be04dc1d); der Inhalt einer Zone hängt nur an ihrem Seed.
const GOLDEN = { zonen: 195, zdos: 18925, summe: 2331920032 };

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

interface Spieler {
  id: string;
  pos: Vector3;
}
interface Innen {
  generated: Set<string>;
  pending: { size: number };
  queue: { x: number; y: number }[];
  diagnose?: { abstandsvergleiche: number };
  updateJeSpieler?: (s: readonly Spieler[], budgetMs?: number) => number;
}

function neu(zeit?: () => number): { zm: ZoneManager; zdos: ZDOManager; innen: Innen } {
  const geo = new GeoManager(SEED, { worldGenVersion: 2 });
  const heightmaps = new HeightmapProvider(geo, { blendSmoothStep: true, bilinearSampling: false });
  const zdos = new ZDOManager(1n);
  const zm = new ZoneManager(geo, heightmaps, zdos, SEED, zeit ? { zeit } : {});
  return { zm, zdos, innen: zm as unknown as Innen };
}

/**
 * Kuratierte Layoutwelt (wie in e2-vegetation.ts): nur dort wächst Bewuchs,
 * die Radialwelt erzeugt Zonen ohne ZDOs. Radius 1600 m deckt ±25 Zonen.
 */
function neuLayout(): { zm: ZoneManager; zdos: ZDOManager; innen: Innen } {
  const layout = sanitizeWorldLayout({
    version: 1,
    name: 'F12-Probe',
    detailSeed: 'f12',
    continents: [],
    regions: [
      {
        id: 'probe',
        biome: 'grassland',
        shape: { kind: 'circle', x: 0, z: 0, radius: 1600 },
        edgeFalloff: 200,
        baseLevel: 0.3,
        vegetation: [
          ...GRASLAND_FLORA_NAMEN,
          ...NADELWALD_FLORA_NAMEN.filter((n) => !GRASLAND_FLORA_NAMEN.includes(n)),
        ],
      },
    ],
  });
  if (!layout) throw new Error('Testlayout wurde verworfen');
  const geo = new RegionGeo(SEED, { worldGenVersion: 2 }, layout);
  const heightmaps = new HeightmapProvider(geo, { blendSmoothStep: true, bilinearSampling: false });
  const zdos = new ZDOManager(1n);
  const zm = new ZoneManager(geo, heightmaps, zdos, SEED);
  return { zm, zdos, innen: zm as unknown as Innen };
}

/** Ein Tick: neuer Weg mit Kennung, auf main (ohne ihn) der Positionsaufruf. */
function tick(m: { zm: ZoneManager; innen: Innen }, s: readonly Spieler[], budgetMs: number): number {
  return m.innen.updateJeSpieler
    ? m.innen.updateJeSpieler(s, budgetMs)
    : m.zm.update(
        s.map((x) => x.pos),
        budgetMs
      );
}

const p = (zx: number, zy: number): Vector3 => ({ x: zx * 64 + 10, y: 0, z: zy * 64 + 10 });
const key = (x: number, y: number): string => `${x},${y}`;

// ── 1. Der zweite Spieler wartet nicht auf die Schlange des ersten ─────
console.log('== 1. B mit 3 offenen Zonen neben A mit 81 ==');
{
  let t = 0;
  const m = neu(() => (t += 0.5)); // jede Uhrablesung kostet 0,5 ms
  const A = p(0, 0);
  const B = p(16, 0); // 1 km entfernt
  // B's Fenster bis auf drei Eckzonen als erzeugt markieren.
  const offenB = [key(20, 4), key(20, -4), key(12, 4)];
  for (let zx = 12; zx <= 20; zx++) {
    for (let zy = -4; zy <= 4; zy++) {
      const k = key(zx, zy);
      if (!offenB.includes(k)) m.innen.generated.add(k);
    }
  }
  const spieler: Spieler[] = [
    { id: 'A', pos: A },
    { id: 'B', pos: B },
  ];
  let ticks = 0;
  let bFertigNach = -1;
  for (; ticks < 40; ) {
    tick(m, spieler, 12);
    ticks++;
    if (bFertigNach < 0 && offenB.every((k) => m.innen.generated.has(k))) bFertigNach = ticks;
    if (bFertigNach >= 0) break;
  }
  check('B bekommt seine 3 Zonen in höchstens 2 Ticks', bFertigNach >= 1 && bFertigNach <= 2, `Ticks bis fertig=${bFertigNach}`);
}

// ── 2. Kosten der Auswahl bei 25 Spielern / gut 1000 offenen Zonen ─────
console.log('== 2. 25 Spieler, ~1000 offene Zonen, Budget 0 (nur Vorbereitung) ==');
{
  const m = neu();
  const spieler: Spieler[] = [];
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) spieler.push({ id: `s${i}${j}`, pos: p(i * 6 - 12, j * 6 - 12) });
  }
  const t0 = performance.now();
  tick(m, spieler, 0);
  const erster = performance.now() - t0;
  const Q = m.innen.queue.length;
  const P = spieler.length;
  const N = 50;
  const t1 = performance.now();
  for (let i = 0; i < N; i++) tick(m, spieler, 0);
  const jeTick = (performance.now() - t1) / N;
  console.log(`  Q=${Q} offene Zonen, P=${P} Spieler, erster Tick ${erster.toFixed(2)} ms, Folgetick ${jeTick.toFixed(3)} ms`);
  check('gut 1000 offene Zonen', Q >= 1000, `Q=${Q}`);
  if (m.innen.diagnose) {
    const v = m.innen.diagnose.abstandsvergleiche;
    console.log(`  Abstandsvergleiche im Tick: ${v} (Q×P wären ${Q * P})`);
    check('Abstandsvergleiche ≤ Q (nicht Q×P)', v <= Q, `${v} ≤ ${Q}`);
  } else {
    console.log('  (kein diagnose-Zähler: Stand vor F12)');
  }
}

// ── 3. Dieselbe Menge erzeugter Zonen wie auf main ─────────────────────
console.log('== 3. Alles abarbeiten: gleiche Zonen, gleiche ZDOs ==');
{
  const m = neuLayout();
  const spieler: Spieler[] = [
    { id: 'a', pos: p(0, 0) },
    { id: 'b', pos: p(3, 1) },
    { id: 'c', pos: p(-9, 5) },
  ];
  let summe = 0;
  for (let i = 0; i < 400; i++) {
    const n = tick(m, spieler, 200);
    summe += n;
    if (n === 0) break;
  }
  const zonen = m.zm.generatedZoneCount;
  const alle = m.zdos.getAllZDOs();
  let pruefsumme = 0;
  for (const z of alle) {
    // FNV-1a über Prefab + Lage (0,01 m); Summe, also unabhängig von der Reihenfolge.
    let h = 2166136261;
    for (const v of [z.prefabHash, Math.round(z.position.x * 100), Math.round(z.position.z * 100)]) {
      h = Math.imul(h ^ (v | 0), 16777619) >>> 0;
    }
    pruefsumme = (pruefsumme + h) >>> 0;
  }
  console.log(`  generatedZoneCount=${zonen} erzeugt=${summe} ZDOs=${alle.length} Prüfsumme=${pruefsumme}`);
  check('Golden generatedZoneCount', zonen === GOLDEN.zonen, `${zonen} vs ${GOLDEN.zonen}`);
  check('ZDOs entstehen (Layoutwelt)', alle.length > 500, `${alle.length} ZDOs`);
  check('Golden ZDO-Zahl', alle.length === GOLDEN.zdos, `${alle.length} vs ${GOLDEN.zdos}`);
  check('Golden Prüfsumme', pruefsumme === GOLDEN.summe, `${pruefsumme} vs ${GOLDEN.summe}`);
  check('pending leer nach dem Abarbeiten', m.innen.pending.size === 0, `pending=${m.innen.pending.size}`);
}

// ── 4. Spieler geht, Zone in zwei Schlangen ────────────────────────────
console.log('== 4. Abgang, kein Leck; geteilte Zone einmal ==');
{
  const m = neu();
  const A: Spieler = { id: 'A', pos: p(0, 0) };
  const B: Spieler = { id: 'B', pos: p(30, 0) };
  tick(m, [A, B], 0);
  const beide = m.innen.pending.size;
  tick(m, [B], 0);
  check('nach dem Abgang von A bleiben nur B\'s 81 Zonen offen', m.innen.pending.size === 81, `vorher ${beide}, nachher ${m.innen.pending.size}`);
  for (let i = 0; i < 400 && tick(m, [B], 200) > 0; i++);
  check('pending leer nach Abarbeiten', m.innen.pending.size === 0, `pending=${m.innen.pending.size}`);
  check('nur B\'s Fenster erzeugt', m.zm.generatedZoneCount === 81, `zonen=${m.zm.generatedZoneCount}`);

  const n = neu();
  const C: Spieler = { id: 'C', pos: p(0, 0) };
  const D: Spieler = { id: 'D', pos: p(2, 0) }; // Fenster überlappen: 11×9 = 99 Zonen
  for (let i = 0; i < 400 && tick(n, [C, D], 200) > 0; i++);
  check('geteilte Zonen genau einmal (11×9 = 99)', n.zm.generatedZoneCount === 99, `zonen=${n.zm.generatedZoneCount}`);
  check('pending leer (geteilt)', n.innen.pending.size === 0, `pending=${n.innen.pending.size}`);
}

// ── 5. Zonen teurer als der Anteil je Spieler: reihum, Deckel je Tick ──
console.log('== 5. 5 Spieler, eine Zone = 8 ms (Anteil je Spieler 2,4 ms), Budget 12 ms ==');
{
  let t = 0;
  const m = neu(() => t);
  const zm = m.zm as unknown as { generateZone: (z: { x: number; y: number }) => boolean };
  const N = 5;
  const KOSTEN = 8;
  const BUDGET = 12;
  const echte = zm.generateZone.bind(zm);
  let erzeugt: string[] = [];
  zm.generateZone = (z): boolean => {
    const ok = echte(z);
    if (ok) {
      erzeugt.push(key(z.x, z.y));
      t += KOSTEN;
    }
    return ok;
  };
  // Fenster weit auseinander (20 Zonen), damit jede erzeugte Zone einem Spieler gehört.
  const zentrum = (i: number): number => i * 20;
  const spieler: Spieler[] = [];
  for (let i = 0; i < N; i++) spieler.push({ id: 's' + i, pos: p(zentrum(i), 0) });
  const gehoert = (k: string, i: number): boolean => Math.abs(Number(k.split(',')[0]) - zentrum(i)) <= 4;
  const proTick: number[][] = [];
  let maxMs = 0;
  for (let k = 0; k < 20; k++) {
    erzeugt = [];
    const t0 = t;
    tick(m, spieler, BUDGET);
    maxMs = Math.max(maxMs, t - t0);
    proTick.push(spieler.map((_, i) => erzeugt.filter((z) => gehoert(z, i)).length));
  }
  // Kein Spieler geht in n aufeinanderfolgenden Ticks leer aus (jeder hat noch offene Zonen: 81 > 20).
  let laengsteLuecke = 0;
  for (let i = 0; i < N; i++) {
    let luecke = 0;
    for (const z of proTick) {
      luecke = z[i] === 0 ? luecke + 1 : 0;
      laengsteLuecke = Math.max(laengsteLuecke, luecke);
    }
  }
  check(`jeder Spieler kommt in höchstens n=${N} Ticks dran (längste Lücke < n)`, laengsteLuecke < N, `längste Lücke=${laengsteLuecke} Ticks`);
  const jeSpieler = spieler.map((_, i) => proTick.reduce((a, z) => a + z[i], 0));
  check('nach 20 Ticks hat jeder Spieler Zonen bekommen, verteilt ±2', Math.min(...jeSpieler) >= 1 && Math.max(...jeSpieler) - Math.min(...jeSpieler) <= 2, `Zonen je Spieler=${jeSpieler.join('/')}`);
  check('Summe je Tick ≤ Budget + eine Zone', maxMs <= BUDGET + KOSTEN, `max ${maxMs} ms (Grenze ${BUDGET + KOSTEN})`);
}

console.log(failures === 0 ? '\n=== F12: ALL PASSED ===' : `\n=== F12: ${failures} FAILURES ===`);
process.exit(failures === 0 ? 0 : 1);
