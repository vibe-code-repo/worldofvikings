/**
 * K5.5a — placements keep their ground free of scatter (server + preview).
 * Platzierungen halten ihren Grund frei (Streuung).
 *
 * Geprüft wird an einer kuratierten Layoutwelt (9 × 9 Zonen um den Nullpunkt):
 *  1. Ohne Option streut der Server unter der Platzierung (n > 0 Funde im Radius),
 *     mit `platzierungenFreihalten` sind es 0.
 *  2. Außerhalb des Radius ist der Bestand bitgleich zum alten Stand
 *     (gleiche Prefabs, gleiche Positionen, gezählt).
 *  3. Ohne Platzierung (und mit einer Platzierung weit weg) ist die Zone
 *     bitgleich zum alten Stand — über alle 81 Zonen.
 *  4. Vorschau und Server liefern für dieselbe Zone dieselben Funde.
 *  5. Radiusregeln der gemeinsamen Funktion (Grundfälle; Hüllen im Schwestertest).
 *  6. Dauer von `generateZone` vorher/nachher (Median über 50 Zonen).
 *
 * Lauf: npx tsx server/test/bewuchs-freiraum.ts   (aus der Projektwurzel)
 */

import {
  FREIFLAECHE_VORGABE,
  GRASLAND_FLORA_NAMEN,
  HeightmapProvider,
  NADELWALD_FLORA_NAMEN,
  RegionGeo,
  freiflaechenAusPlatzierungen,
  freiflaechenFuerZone,
  getStableHash,
  sanitizeWorldLayout,
} from '@wov/shared';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
import { ZoneManager } from '../src/world/ZoneManager.js';
import { BewuchsVorschau } from '../../client/src/editor/BewuchsVorschau.js';

const SEED = getStableHash('KxSYuZquuw');
const RADIUS = 20;
const MITTE = { x: 10, z: 10 };

interface Placement {
  prefab: string;
  x: number;
  z: number;
  einebnen?: number;
}

function layoutMit(placements: Placement[]) {
  const layout = sanitizeWorldLayout({
    version: 1,
    name: 'K5.5a-Probe',
    detailSeed: 'k55a',
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
    placements,
  });
  if (!layout) throw new Error('Testlayout wurde verworfen');
  return layout;
}

function baue(placements: Placement[], freihalten: boolean) {
  const layout = layoutMit(placements);
  const geo = new RegionGeo(SEED, { worldGenVersion: 2 }, layout);
  const heightmaps = new HeightmapProvider(geo, { blendSmoothStep: true, bilinearSampling: false });
  const zdos = new ZDOManager(1n);
  const zm = new ZoneManager(geo, heightmaps, zdos, SEED, { platzierungenFreihalten: freihalten });
  return { zm, zdos, geo, heightmaps, layout };
}

interface Fund {
  hash: number;
  x: number;
  y: number;
  z: number;
  q: string;
}

function funde(zdos: ZDOManager): Fund[] {
  const out: Fund[] = [];
  for (let zy = -6; zy <= 6; zy++) {
    for (let zx = -6; zx <= 6; zx++) {
      for (const zdo of zdos.getZDOsInZone({ x: zx, y: zy })) {
        const r = zdo.rotation;
        out.push({
          hash: zdo.prefabHash,
          x: zdo.position.x,
          y: zdo.position.y,
          z: zdo.position.z,
          q: `${r.x},${r.y},${r.z},${r.w}`,
        });
      }
    }
  }
  return out;
}
const schluessel = (f: Fund): string => `${f.hash}|${f.x},${f.y},${f.z}|${f.q}`;
const sortiert = (l: Fund[]): string[] => l.map(schluessel).sort();
const gleich = (a: Fund[], b: Fund[]): boolean => {
  const x = sortiert(a);
  const y = sortiert(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};
const imRadius = (f: Fund, m: { x: number; z: number }, r: number): boolean =>
  Math.hypot(f.x - m.x, f.z - m.z) <= r;
const imQuadrat = (f: Fund, m: { x: number; z: number }, r: number): boolean =>
  Math.abs(f.x - m.x) < r && Math.abs(f.z - m.z) < r;

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    failures++;
  }
}

const SPIELER = [{ x: 0, y: 36.05, z: 0 }];
const platz: Placement = { prefab: 'BirkeDicht1', x: MITTE.x, z: MITTE.z, einebnen: RADIUS };

console.log('=== K5.5a bewuchs-freiraum ===');

// ── [1]+[2] eine Platzierung ─────────────────────────────────────────
const alt = baue([platz], false);
alt.zm.update(SPIELER, 60_000);
const neu = baue([platz], true);
neu.zm.update(SPIELER, 60_000);
const altFunde = funde(alt.zdos);
const neuFunde = funde(neu.zdos);
const nAltIm = altFunde.filter((f) => imRadius(f, MITTE, RADIUS)).length;
const nNeuIm = neuFunde.filter((f) => imRadius(f, MITTE, RADIUS)).length;
console.log('\n[1] Eine Platzierung (einebnen ' + RADIUS + ' m):');
check('vorher Streuobjekte im Radius', nAltIm > 0, `${nAltIm}`);
check('nachher 0 im Radius', nNeuIm === 0, `${nNeuIm}`);

console.log('\n[2] Außerhalb bitgleich:');
const altAussen = altFunde.filter((f) => !imQuadrat(f, MITTE, RADIUS + 8));
const neuAussen = neuFunde.filter((f) => !imQuadrat(f, MITTE, RADIUS + 8));
check(
  'außerhalb des Radius (+8 m Pflanzenrand) bitgleich',
  gleich(altAussen, neuAussen),
  `${altAussen.length} vs ${neuAussen.length}`
);
const eckenNeu = neuFunde.filter((f) => imQuadrat(f, MITTE, RADIUS) && !imRadius(f, MITTE, RADIUS)).length;
check('Ecken des Quadrats bleiben bepflanzt (Kreis, kein Quadrat)', eckenNeu > 0, `${eckenNeu}`);
const altZone = altFunde.filter((f) => Math.abs(f.x) < 32 && Math.abs(f.z) < 32).length;
console.log(`      gesamt alt ${altFunde.length}, neu ${neuFunde.length}; Zone (0,0) alt ${altZone}`);

// ── [3] Zonen ohne Platzierung ───────────────────────────────────────
console.log('\n[3] Zonen ohne Platzierung:');
const leerAlt = baue([], false);
const gA = leerAlt.zm.update(SPIELER, 60_000);
const leerNeu = baue([], true);
const gN = leerNeu.zm.update(SPIELER, 60_000);
check('81 Zonen beide', gA === 81 && gN === 81, `${gA}/${gN}`);
check(
  'ohne Platzierung bitgleich (81 Zonen)',
  gleich(funde(leerAlt.zdos), funde(leerNeu.zdos)),
  `${funde(leerAlt.zdos).length} ZDOs`
);
const fern: Placement = { prefab: 'BirkeDicht1', x: 900, z: 900, einebnen: 10 };
const fernNeu = baue([fern], true);
fernNeu.zm.update(SPIELER, 60_000);
check(
  'Platzierung weit weg (>200 m): alle Zonen ausser deren Umgebung bitgleich',
  gleich(
    funde(leerAlt.zdos).filter((f) => !imQuadrat(f, fern, 40)),
    funde(fernNeu.zdos).filter((f) => !imQuadrat(f, fern, 40))
  )
);
const fernLeer = funde(leerAlt.zdos).filter((f) => Math.abs(f.x) < 300 && Math.abs(f.z) < 300);
const fernNeuN = funde(fernNeu.zdos).filter((f) => Math.abs(f.x) < 300 && Math.abs(f.z) < 300);
check('Zonen um den Ursprung (>= 20 Zonen) bitgleich', gleich(fernLeer, fernNeuN), `${fernLeer.length}`);

// ── [4] Vorschau = Server ────────────────────────────────────────────
console.log('\n[4] Vorschau und Server:');
{
  const w = neu;
  const live = new Map<string, { prefabHash: number; position: { x: number; y: number; z: number } }>();
  const ent = {
    applyUpdate(u: { key: string; prefabHash: number; position: { x: number; y: number; z: number } }) {
      live.set(u.key, u);
    },
    removeZDO(k: string) {
      live.delete(k);
    },
    flush() {},
  };
  const v = new BewuchsVorschau(
    { seed: SEED, geo: w.geo, heightmaps: w.heightmaps, regionGeo: w.geo },
    ent as never
  );
  const innen = v as unknown as { zoneStreuen(x: number, y: number): void };
  let zonen = 0;
  let gleicheZonen = 0;
  let summe = 0;
  for (let zy = -1; zy <= 1; zy++) {
    for (let zx = -1; zx <= 1; zx++) {
      live.clear();
      innen.zoneStreuen(zx, zy);
      const vorschau = [...live.values()].map((u) => ({
        hash: u.prefabHash,
        x: u.position.x,
        y: u.position.y,
        z: u.position.z,
      }));
      // Server: dieselbe Zone, aus den ZDOs nach Heightmap-Zone (Mitte zx*64, Kante 64).
      const server = funde(neu.zdos).filter(
        (f) => Math.abs(f.x - zx * 64) <= 32 && Math.abs(f.z - zy * 64) <= 32
      );
      // Rand: Funde einer Nachbarzone liegen nie in dieser Zone (Streu-Punkte
      // bleiben in ihrer Zone), daher reicht der Positionsvergleich als Menge.
      const a = vorschau.map((f) => `${f.hash}|${f.x},${f.y},${f.z}`).sort();
      const b = server.map((f) => `${f.hash}|${f.x},${f.y},${f.z}`).sort();
      zonen++;
      summe += a.length;
      if (a.length === b.length && a.every((s, i) => s === b[i])) gleicheZonen++;
    }
  }
  check('9 Zonen: Vorschau-Funde = Server-Funde (Zahl und Position)', gleicheZonen === zonen, `${gleicheZonen}/${zonen} Zonen, ${summe} Funde`);
}

// ── [5] Radiusregeln ─────────────────────────────────────────────────
// Hüllen, Kreisform und Klemmen: server/test/bewuchs-freiraum-huellen.ts.
console.log('\n[5] Radiusregeln (Grundfälle; Hüllen siehe bewuchs-freiraum-huellen.ts):');
{
  const l = {
    placements: [
      { prefab: 'BirkeDicht1', x: 1, z: 2, einebnen: 12 },
      { prefab: 'kein-katalogeintrag', x: 5, z: 6 },
    ],
  };
  const flaechen = freiflaechenAusPlatzierungen(l);
  const r = flaechen.map((x) => x.radius);
  check('einebnen gewinnt', r[0] === 12, `${r[0]}`);
  check('ohne Hülle: feste Vorgabe', r[1] === FREIFLAECHE_VORGABE, `${r[1]}`);
  check('Freifläche ist ein Kreis', flaechen.every((x) => x.kreis === true));
  check(
    'Zonenfilter: fernes Objekt fällt heraus, nahes bleibt',
    freiflaechenFuerZone(flaechen, 0, 0).length === 2 && freiflaechenFuerZone(flaechen, 5, 5).length === 0
  );
}

// ── [6] Dauer von generateZone ───────────────────────────────────────
console.log('\n[6] Dauer generateZone (Median über 50 Zonen):');
{
  const medianMs = (freihalten: boolean, placements: Placement[]): number => {
    const w = baue(placements, freihalten);
    const gen = w.zm as unknown as { generateZone(z: { x: number; y: number }): boolean };
    const zeiten: number[] = [];
    for (let i = 0; i < 50; i++) {
      const zone = { x: (i % 7) - 3, y: Math.floor(i / 7) - 3 };
      const t = performance.now();
      gen.generateZone(zone);
      zeiten.push(performance.now() - t);
    }
    zeiten.sort((a, b) => a - b);
    return zeiten[25];
  };
  const viele: Placement[] = Array.from({ length: 30 }, (_, i) => ({
    prefab: 'BirkeDicht1',
    x: ((i * 37) % 300) - 150,
    z: ((i * 91) % 300) - 150,
    einebnen: 6,
  }));
  medianMs(false, []); // warm-up
  const a1 = medianMs(false, []);
  const b1 = medianMs(true, []);
  const a2 = medianMs(false, viele);
  const b2 = medianMs(true, viele);
  console.log(`      ohne Platzierung: alt ${a1.toFixed(2)} ms, neu ${b1.toFixed(2)} ms (${((b1 / a1 - 1) * 100).toFixed(1)} %)`);
  console.log(`      30 Platzierungen: alt ${a2.toFixed(2)} ms, neu ${b2.toFixed(2)} ms (${((b2 / a2 - 1) * 100).toFixed(1)} %)`);
  check('ohne Platzierung höchstens +10 %', b1 <= a1 * 1.1 + 0.05);
}

if (failures > 0) {
  console.error(`\n${failures} FAILED`);
  process.exit(1);
}
console.log('\nAll bewuchs-freiraum checks passed.');
