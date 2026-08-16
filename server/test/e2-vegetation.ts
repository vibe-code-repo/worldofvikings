/**
 * E2/E3 smoke test — vegetation zone population (Phase E).
 *
 * ── Der Bezugswert hat sich mit Block A geändert ─────────────────────
 * Dieser Test hielt seit Phase E einen bitgleichen ZDO-Abzug der
 * RADIALWELT gegen sich selbst: 81 Zonen um den Nullpunkt, ein paar
 * tausend Bäume aus Valheims `vegetation.pkg`, zweimal gewürfelt, Zeichen
 * für Zeichen verglichen. Diese Grundlage gibt es nicht mehr. FOLIAGE
 * enthält seit Block A nur noch eigene Modelle (shared/src/vegetation.ts),
 * und eigene Flora wächst NUR auf Bestellung durch die Kuratierungsliste
 * einer Region (shared/src/worldgen/streuung.ts). Die Radialwelt hat kein
 * Layout, also keine Regionen, also keine Bestellung.
 *
 * Der neue Bezugswert der Radialwelt ist deshalb NULL Bewuchs-ZDOs, und
 * das ist kein Defekt, sondern die Aussage: Ohne Weltdokument gibt es
 * keine Welt mehr. Der Test misst ihn als Zahl, damit er auffällt, falls
 * je wieder ein Fremdeintrag in FOLIAGE zurückkehrt — dann stünden hier
 * plötzlich Bäume, ohne dass sie jemand bestellt hätte.
 *
 * Die eigentliche Prüfsubstanz — Determinismus und Platzierungs-Sanity —
 * zieht damit auf eine KURATIERTE LAYOUTWELT um. Dort wächst etwas, und
 * dort ist der bitgleiche Abzug wieder eine Aussage über die Welt und
 * nicht über eine leere Liste.
 *
 * Geprüft wird:
 *  1. Radialwelt: 81 Zonen entstehen, aber kein Bewuchs.
 *  2. Layoutwelt mit Kuratierung: Bewuchs entsteht, und zwar reichlich.
 *  3. Determinismus: zwei frische Läufe ergeben BITGLEICHE ZDO-Abzüge
 *     (gleicher Seed ⇒ gleiche Welt, wie beim C++-Server).
 *  4. Platzierung: Positionen endlich, y in plausibler Geländespanne,
 *     Skalierung im Rahmen des Streueintrags.
 *  5. Zonenbuchhaltung — die hängt nicht am Bewuchs und bleibt radial.
 *
 * Lauf: npx tsx server/test/e2-vegetation.ts   (aus der Projektwurzel)
 */

import {
  GeoManager,
  GRASLAND_FLORA_NAMEN,
  HeightmapProvider,
  NADELWALD_FLORA_NAMEN,
  RegionGeo,
  getStableHash,
  sanitizeWorldLayout,
} from '@wov/shared';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
import { ZoneManager } from '../src/world/ZoneManager.js';
import type { ZDO } from '../src/zdo/ZDO.js';

const SEED = getStableHash('KxSYuZquuw');

/** Die Radialwelt: kein Layout, keine Kuratierung, kein Bewuchs. */
function buildWorld(): { zm: ZoneManager; zdos: ZDOManager } {
  const geo = new GeoManager(SEED, { worldGenVersion: 2 });
  const heightmaps = new HeightmapProvider(geo, {
    blendSmoothStep: true,
    bilinearSampling: false,
  });
  const zdos = new ZDOManager(1n);
  const zm = new ZoneManager(geo, heightmaps, zdos, SEED);
  return { zm, zdos };
}

/**
 * Eine kuratierte Insel um den Nullpunkt — die Welt, an der ab jetzt
 * gemessen wird.
 *
 * Radius 1600 m, damit die 9 × 9 Zonen (576 m Kantenlänge) vollständig
 * innerhalb der Region liegen; ausserhalb gälte die Ozean-Vorgabe. Die
 * Liste ist Grasland PLUS Nadelwald, weil dieser Test die ganze Tabelle
 * durchlaufen sehen will und nicht nur einen Ausschnitt davon.
 */
function buildLayoutWorld(): { zm: ZoneManager; zdos: ZDOManager } {
  const layout = sanitizeWorldLayout({
    version: 1,
    name: 'E2-Probe',
    detailSeed: 'e2',
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
  const heightmaps = new HeightmapProvider(geo, {
    blendSmoothStep: true,
    bilinearSampling: false,
  });
  const zdos = new ZDOManager(1n);
  const zm = new ZoneManager(geo, heightmaps, zdos, SEED);
  return { zm, zdos };
}

function dumpZDOs(zdos: ZDOManager): string {
  const lines: string[] = [];
  // Cover all zones a 9x9 generation around spawn could touch (ZDOManager
  // zone space is floor(x/64) — half a zone offset from heightmap zones).
  for (let zy = -6; zy <= 6; zy++) {
    for (let zx = -6; zx <= 6; zx++) {
      for (const zdo of zdos.getZDOsInZone({ x: zx, y: zy })) {
        const scale = (zdo.getMembers() as Map<number, { value: unknown }>).size;
        lines.push(
          `${zdo.prefabHash}|${zdo.position.x},${zdo.position.y},${zdo.position.z}|` +
            `${zdo.rotation.x},${zdo.rotation.y},${zdo.rotation.z},${zdo.rotation.w}|m${scale}`
        );
      }
    }
  }
  return lines.sort().join('\n');
}

function allZDOs(zdos: ZDOManager): ZDO[] {
  const out: ZDO[] = [];
  for (let zy = -6; zy <= 6; zy++) {
    for (let zx = -6; zx <= 6; zx++) {
      out.push(...zdos.getZDOsInZone({ x: zx, y: zy }));
    }
  }
  return out;
}

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    failures++;
  }
}

console.log('=== E2/E3 vegetation smoke test ===');

// ── [1] Radialwelt: Zonen ja, Bewuchs nein ──────────────────────────
// Der neue Bezugswert. `gen1 === 81` sagt, dass die Zonenerzeugung
// vollständig durchgelaufen ist — nur so ist die Null darunter eine
// Aussage über den Bewuchs und nicht über einen abgebrochenen Lauf.
const t0 = Date.now();
const w1 = buildWorld();
const gen1 = w1.zm.update([{ x: 0, y: 36.05, z: 0 }], 60_000);
const elapsed = Date.now() - t0;
const list1 = allZDOs(w1.zdos);

console.log(`\n[1] Radialwelt ohne Layout:`);
check('zones generated', gen1 === 81, `${gen1} zones in ${elapsed}ms`);
check(
  'kein Bewuchs ohne Kuratierung',
  list1.length === 0,
  `${list1.length} ZDOs (erwartet 0 — FOLIAGE ist reine Eigenflora)`
);

// ── [2] Layoutwelt mit Kuratierung: hier wächst etwas ────────────────
const tL = Date.now();
const L1 = buildLayoutWorld();
const genL = L1.zm.update([{ x: 0, y: 36.05, z: 0 }], 60_000);
const listL = allZDOs(L1.zdos);
console.log(`\n[2] Kuratierte Layoutwelt:`);
check('zones generated', genL === 81, `${genL} zones in ${Date.now() - tL}ms`);
check('ZDOs created', listL.length > 500, `${listL.length} ZDOs`);

// ── [3] Determinismus, gemessen an der Layoutwelt ────────────────────
// Zweimal frisch gebaut, gleicher Seed, Abzug Zeichen für Zeichen
// verglichen. Die Radialwelt taugt dafür nicht mehr: Zwei leere Abzüge
// sind immer gleich und beweisen nichts.
const L2 = buildLayoutWorld();
L2.zm.update([{ x: 0, y: 36.05, z: 0 }], 60_000);
const dump1 = dumpZDOs(L1.zdos);
const dump2 = dumpZDOs(L2.zdos);

console.log(`\n[3] Determinism:`);
check('bit-identical regeneration', dump1 === dump2, `${dump1.split('\n').length} ZDOs compared`);
check('Abzug ist nicht leer', dump1.length > 0);

// ── [4] Platzierung ──────────────────────────────────────────────────
console.log(`\n[4] Placement sanity:`);
let badPos = 0;
let badScale = 0;
let trees = 0;
for (const zdo of listL) {
  const { x, y, z } = zdo.position;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) badPos++;
  if (y < -50 || y > 300) badPos++;
  const scaleMember = [...(zdo.getMembers() as Map<number, { type: number; value: unknown }>).values()].find(
    (m) => m.type === 0
  );
  if (scaleMember !== undefined) {
    const s = scaleMember.value as number;
    if (!Number.isFinite(s) || s <= 0 || s > 10) badScale++;
  }
}
// Bäume heissen jetzt Eiche, Birke, Fichte, Tanne und Kiefer — die
// Valheim-Namen (Beech1, FirTree, …) gibt es in FOLIAGE nicht mehr.
const baumHashes = new Set(
  [...GRASLAND_FLORA_NAMEN, ...NADELWALD_FLORA_NAMEN]
    .filter((n) => /^(Eiche|Birke|Fichte|Tanne|Kiefer)/.test(n))
    .map((n) => getStableHash(n))
);
for (const zdo of listL) {
  if (baumHashes.has(zdo.prefabHash)) trees++;
}
check('positions finite + in range', badPos === 0, `${badPos} bad`);
check('scales plausible', badScale === 0, `${badScale} bad`);
check('trees spawned near spawn', trees > 50, `${trees} tree ZDOs`);

// Zone tracking
console.log(`\n[5] Zone tracking:`);
check('zone (0,0) generated', w1.zm.isZoneGenerated({ x: 0, y: 0 }));
check('zone (4,4) generated (radius 4)', w1.zm.isZoneGenerated({ x: 4, y: 4 }));
check('zone (5,0) NOT generated', !w1.zm.isZoneGenerated({ x: 5, y: 0 }));
check('far zone outside world radius rejected', !w1.zm.isZoneGenerated({ x: 200, y: 200 }));
// Re-update with same player pos ⇒ nothing new
const again = w1.zm.update([{ x: 0, y: 36.05, z: 0 }], 60_000);
check('re-update idempotent', again === 0, `${again} new zones`);

// Moving the player one zone east generates exactly the new column.
// C++ zone of x: floor((x+32)/64) — x=64 → zone 1, coverage x∈[-3,5]
// vs. previous [-4,4] ⇒ only column x=5 (z∈[-4,4]) is new = 9 zones.
const moved = w1.zm.update([{ x: 64, y: 36, z: 0 }], 60_000);
check('player move generates new zones', moved === 9, `${moved} new zones (expect 9)`);

console.log('');
if (failures === 0) {
  console.log('=== E2/E3: ALL PASSED ===');
} else {
  console.error(`=== E2/E3: ${failures} FAILURES ===`);
  process.exit(1);
}
