/**
 * Sockel-Diff und Gleichstand ohne Reihenfolge.
 *
 * (a) Eine laufende Geo aus Dokument A wird per sockelDiff + sockelEntfernen/
 *     sockelEinfuegen auf Dokument B gebracht und gegen eine frisch aus B
 *     kompilierte Geo verglichen: 10.000 Höhenproben je Fall, erlaubt sind 0
 *     abweichende float32-Werte. Fälle: Platte dazu, weg, verschoben,
 *     einebnen geändert, zwei gleich große, sich berührende Platten (Gleichstand).
 * (b) PlateauField.probe entscheidet exakten Gleichstand nach (Radius, x, z),
 *     nicht nach Listenposition.
 *
 *   npx tsx test/sockel-diff.ts   (aus shared/)
 */
import { createGeo, HeightmapProvider, RegionGeo } from '../src/worldgen/index.js';
import { getStableHash } from '../src/hash.js';
import { PlateauField, sockelDiff, type PlacementDef, type WorldLayout } from '../src/worldlayout/index.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) fehler++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const pl = (id: string, x: number, z: number, einebnen?: number): PlacementDef =>
  ({ id, prefab: 'Kiste', x, z, ...(einebnen !== undefined ? { einebnen } : {}) }) as PlacementDef;

function dok(placements: PlacementDef[]): WorldLayout {
  return {
    version: 1,
    name: 'sockel-diff',
    detailSeed: 'sockel-diff-test',
    continents: [{ id: 'k', name: 'K', faction: 'neutral' }],
    regions: [
      {
        id: 'land',
        biome: 'grassland',
        shape: { kind: 'circle', x: 0, z: 0, radius: 1500 },
        edgeFalloff: 300,
      },
    ],
    placements,
  } as unknown as WorldLayout;
}

function geoAus(layout: WorldLayout): { geo: RegionGeo; hm: HeightmapProvider } {
  const geo = createGeo({
    mode: 'layout',
    worldSeed: getStableHash('sockel-diff-test'),
    layout,
  }) as RegionGeo;
  return { geo, hm: new HeightmapProvider(geo, { blendSmoothStep: true }) };
}

// Fester Zufall, damit jeder Lauf dieselben Stellen misst.
function zufall(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROBEN = 10_000;

/** Bringt Geo(A) per Diff auf B und zählt die abweichenden f32-Höhen gegen Geo(B). */
function vergleiche(
  name: string,
  a: WorldLayout,
  b: WorldLayout,
  zusatz: Array<[number, number]> = []
): { abweichend: number; weg: number; dazu: number; proben: number } {
  const diff = sockelDiff(a, b);
  const live = geoAus(a);
  const frisch = geoAus(b);

  const stellen: Array<[number, number]> = [...zusatz];
  const rnd = zufall(getStableHash(name));
  const geaendert = [...diff.weg, ...diff.dazu];
  while (stellen.length < PROBEN) {
    const p = geaendert[Math.floor(rnd() * geaendert.length)];
    const reich = p.einebnen + 70;
    const w = rnd() * 2 * Math.PI;
    const r = Math.sqrt(rnd()) * reich;
    stellen.push([p.x + Math.cos(w) * r, p.z + Math.sin(w) * r]);
  }
  // Zonen der laufenden Geo mit dem alten Stand füllen, wie im Betrieb.
  for (const [x, z] of stellen) live.hm.getGroundHeight(x, z);

  for (const w of diff.weg) live.geo.sockelEntfernen(w.x, w.z);
  for (const d of diff.dazu) live.geo.sockelEinfuegen(d.x, d.z, d.einebnen);
  for (const p of geaendert) live.hm.invalidateArea(p.x, p.z, p.einebnen + 64);

  let abweichend = 0;
  for (const [x, z] of stellen) {
    const h1 = Math.fround(live.hm.getGroundHeight(x, z));
    const h2 = Math.fround(frisch.hm.getGroundHeight(x, z));
    if (h1 !== h2) abweichend++;
  }
  return { abweichend, weg: diff.weg.length, dazu: diff.dazu.length, proben: stellen.length };
}

// ── sockelDiff: reine Mengenarbeit ─────────────────────────────────────
{
  const a = dok([pl('a', 10, 10, 8), pl('b', 20, 20, 5), pl('k', 1, 1), pl('n', 2, 2, 0)]);
  const gleichB = dok([pl('x', 10, 10, 8), pl('y', 20, 20, 5)]);
  const d0 = sockelDiff(a, gleichB);
  check('Diff: gleiche Platten (andere ids, Kiste ohne einebnen) → leer', d0.weg.length === 0 && d0.dazu.length === 0);
  const d1 = sockelDiff(a, dok([pl('a', 10, 10, 8), pl('b', 20, 20, 5), pl('c', 30, 30, 9)]));
  check('Diff: neue Platte → dazu', d1.weg.length === 0 && d1.dazu.length === 1 && d1.dazu[0].x === 30 && d1.dazu[0].einebnen === 9);
  const d2 = sockelDiff(a, dok([pl('a', 10, 10, 8)]));
  check('Diff: Platte entfernt → weg', d2.weg.length === 1 && d2.weg[0].x === 20 && d2.dazu.length === 0);
  const d3 = sockelDiff(a, dok([pl('a', 11, 10, 8), pl('b', 20, 20, 5)]));
  check('Diff: verschoben → weg + dazu', d3.weg.length === 1 && d3.dazu.length === 1 && d3.weg[0].x === 10 && d3.dazu[0].x === 11);
  const d4 = sockelDiff(a, dok([pl('a', 10, 10, 9), pl('b', 20, 20, 5)]));
  check('Diff: einebnen geändert → weg + dazu', d4.weg.length === 1 && d4.dazu.length === 1 && d4.weg[0].einebnen === 8 && d4.dazu[0].einebnen === 9);
  const d5 = sockelDiff(dok([pl('a', 1, 1, 6), pl('b', 1, 1, 6)]), dok([pl('a', 1, 1, 6)]));
  check('Diff: doppelte Platte wird einzeln gezählt', d5.weg.length === 1 && d5.dazu.length === 0);
  const d6 = sockelDiff(null, dok([pl('a', 1, 1, 6)]));
  check('Diff: ohne altes Layout → alles dazu', d6.weg.length === 0 && d6.dazu.length === 1);
  const d7 = sockelDiff(dok([pl('a', 1, 1, 6)]), dok([]));
  check('Diff: Layout ohne Platzierungen → alles weg', d7.weg.length === 1 && d7.dazu.length === 0);
}

// ── (b) Gleichstand: Listenreihenfolge darf nichts ändern ──────────────
{
  const p1 = { x: 0, z: 0, r: 10 };
  const p2 = { x: 20, z: 0, r: 10 };
  const f1 = new PlateauField(dok([pl('a', p1.x, p1.z, p1.r), pl('b', p2.x, p2.z, p2.r)]));
  const f2 = new PlateauField(dok([pl('b', p2.x, p2.z, p2.r), pl('a', p1.x, p1.z, p1.r)]));
  let gleich = true;
  for (let z = -30; z <= 30; z += 1.5) {
    const a = f1.probe(10, z);
    const b = f2.probe(10, z);
    if (!a || !b || a.x !== b.x || a.z !== b.z) gleich = false;
  }
  check('Gleichstand: Reihenfolge der Platten ändert die Wahl nicht', gleich);
  const live = new PlateauField(dok([pl('b', p2.x, p2.z, p2.r)]));
  live.lege(p1.x, p1.z, p1.r);
  const l = live.probe(10, 0);
  const f = f1.probe(10, 0);
  check('Gleichstand: live angehängte Platte wie frisch kompilierte', !!l && !!f && l.x === f.x && l.z === f.z);
  const kleiner = new PlateauField(dok([pl('a', 0, 0, 12), pl('b', 30, 0, 8)]));
  const kp = kleiner.probe(15, 0); // Rand-Abstand 3 zu beiden … dist 15-12 = 3, 15-8 → 7
  check('Gleichstand: ohne Gleichstand gewinnt weiter der kleinste Randabstand', !!kp && kp.x === 0);
}

// ── (a) Diff gegen Neukompilierung ─────────────────────────────────────
const BASIS = [pl('h1', 100, 100, 14), pl('h2', -300, 200, 25), pl('h3', 400, -350, 9)];
{
  const A = dok(BASIS);
  const fall = (
    name: string,
    B: WorldLayout,
    zusatz: Array<[number, number]> = []
  ): void => {
    const e = vergleiche(name, A, B, zusatz);
    check(
      `(a) ${name}`,
      e.abweichend === 0 && e.proben >= PROBEN,
      `${e.abweichend} abweichende f32-Werte von ${e.proben} Proben (weg ${e.weg}, dazu ${e.dazu})`
    );
  };
  fall('Platte dazu', dok([...BASIS, pl('neu', -100, -100, 20)]));
  fall('Platte weg', dok([BASIS[0], BASIS[2]]));
  fall('Platte verschoben', dok([BASIS[0], pl('h2', -280, 230, 25), BASIS[2]]));
  fall('einebnen geändert', dok([BASIS[0], pl('h2', -300, 200, 40), BASIS[2]]));
  fall('Platte dazu, dicht an bestehender', dok([...BASIS, pl('neu', 115, 100, 12)]));
}
{
  // Gleichstand: zwei gleich große, sich berührende Platten. Die live angehängte
  // steht in der Geo hinten, in B aber zuerst — nur der feste Schlüssel gleicht das aus.
  const P1 = pl('links', 200, -200, 10);
  const P2 = pl('rechts', 220, -200, 10);
  const A = dok([P2]);
  const B = dok([P1, P2]);
  const linie: Array<[number, number]> = [];
  for (let z = -300; z <= -100; z += 0.05) linie.push([210, z]); // exakt auf der Mittelsenkrechten
  const e = vergleiche('Gleichstand zwei berührende Platten', A, B, linie);
  check(
    '(a) Gleichstand: zwei gleich große, sich berührende Platten',
    e.abweichend === 0,
    `${e.abweichend} abweichende f32-Werte von ${e.proben} Proben`
  );
  // Der Fall ist nur beweisend, wenn die beiden Zielhöhen wirklich verschieden sind.
  const { hm } = geoAus(dok([]));
  const dh = Math.abs(hm.getGroundHeight(200, -200) - hm.getGroundHeight(220, -200));
  check('(a) Gleichstand: Zielhöhen der beiden Platten verschieden', dh > 0.1, `= ${dh.toFixed(2)} m`);
}

if (fehler > 0) {
  console.error(`\n${fehler} Prüfung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log('\n=== SOCKEL-DIFF: ALL PASSED ===');
