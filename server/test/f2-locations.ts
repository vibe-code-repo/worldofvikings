/**
 * F2 smoke test — location (feature) placement + generation (Phase F).
 *
 * ── RUHEND seit 16.08.2026, läuft in keiner Testliste ────────────────
 * Das Projekt benutzt seither ausschließlich selbst gebaute Modelle. Alle
 * 146 Locations aus features.pkg sind Valheim-Exporte und werden in
 * shared/src/features.ts gegen EIGENE_MODELLE herausgefiltert — FEATURES
 * ist leer. Jede der sieben Prüfungen unten setzt voraus, dass überhaupt
 * eine Location existiert; gemessen sind 4 von 9 rot, der Rest liefe
 * lautlos über null Instanzen.
 *
 * Die Datei bleibt ABSICHTLICH unverändert stehen. Sie ist die einzige
 * vollständige Beschreibung dessen, was das Location-System leisten muss:
 * Buchungs-Determinismus, StartTemple in Zone (0,0), 23 Piece-ZDOs plus
 * LocationProxy, Kreuzvergleich nach der Generierung, ClearArea-Unterdrückung
 * der Vegetation. Sobald es eigene Location-Modelle gibt, ist das hier die
 * Abnahmeliste — sie neu zu schreiben wäre teurer, als sie liegen zu lassen.
 *
 * Die Gegenprobe für den Zwischenzustand steht in f3-leveling.ts Punkt 3
 * (nichts gebucht, Gelände bitgleich Naturgelände) und g2-persistence.ts.
 *
 * Checks:
 *  1. prepareFeatures books a plausible number of feature instances
 *     (C++ PostGeoInit, 146 features from features.pkg).
 *  2. Placement determinism: two fresh worlds book BIT-IDENTICAL instance
 *     lists — prepareFeatures consumes no time-seeded rng.
 *  3. StartTemple is booked in zone (0,0), close to the origin, above water
 *     (centerFirst: the first 64 attempts all draw zone (0,0)).
 *  4. Generating zones around spawn materializes the StartTemple:
 *     23 piece ZDOs + 1 LocationProxy with 'location'/'seed' int members.
 *  5. Cross-world determinism after generation: vegetation + proxy ZDOs are
 *     bit-identical; piece ZDOs match as prefab multiset (randomRotation is
 *     intentionally NOT deterministic — C++ time-seeds it).
 *  6. ClearAreas suppress vegetation inside the temple clearing.
 *  7. Vegetation count drops below the E2 no-features baseline (clearAreas).
 *
 * Run: npx tsx server/test/f2-locations.ts   (from the repo root)
 */

import {
  GeoManager,
  HeightmapProvider,
  FOLIAGE,
  FEATURES_BY_NAME,
  getStableHash,
  WATER_LEVEL,
} from '@wov/shared';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
// Die Pieces liegen seit dem Bundle-Schnitt nicht mehr am Feature, sondern
// in einem serverseitigen Datenmodul (shared/src/featurePieces.ts).
import { getFeaturePieces } from '@wov/shared/src/featurePieces.js';
import { ZoneManager } from '../src/world/ZoneManager.js';
import type { ZDO } from '../src/zdo/ZDO.js';

const SEED = getStableHash('KxSYuZquuw');
const LOCATION_PROXY_HASH = getStableHash('LocationProxy');
const FOLIAGE_HASHES = new Set(FOLIAGE.map((v) => v.prefabHash));

const START_TEMPLE = FEATURES_BY_NAME.get('StartTemple')!;
const TEMPLE_PIECES = getFeaturePieces('StartTemple');
const TEMPLE_PIECE_HASHES = new Set(TEMPLE_PIECES.map((p) => p.prefabHash));

const f32 = Math.fround;

/**
 * Expected StartTemple piece world positions. StartTemple has
 * randomRotation=false (identity rot ⇒ quatMulVec3 is exact) and no
 * snap-to-terrain override ⇒ pieceWorldPos = f32(pos + piece.pos) exactly.
 */
function expectedTemplePieces(center: { x: number; y: number; z: number }): Array<{
  hash: number;
  x: number;
  y: number;
  z: number;
}> {
  return TEMPLE_PIECES.map((p) => ({
    hash: p.prefabHash,
    x: f32(center.x + p.pos.x),
    y: f32(center.y + p.pos.y),
    z: f32(center.z + p.pos.z),
  }));
}

/** Mirrors the live server (server.yml): location overrides on, legacy
 *  AshLands noise (modern FastNoise is Phase B5 — WovServer forces
 *  legacy until then; placement in AshLands deviates from C++ until B5,
 *  documented in Docs/Bekannte Einschränkungen #6). */
function buildWorld(): { zm: ZoneManager; zdos: ZDOManager } {
  const geo = new GeoManager(SEED, { worldGenVersion: 2, ashlandsModernNoise: false });
  const heightmaps = new HeightmapProvider(geo, {
    blendSmoothStep: true,
    bilinearSampling: false,
  });
  const zdos = new ZDOManager(1n);
  const zm = new ZoneManager(geo, heightmaps, zdos, SEED, {
    worldFeatures: true,
    worldVegetation: true,
    locationOverrides: true,
    dungeonsEnabled: true,
  });
  return { zm, zdos };
}

function allZDOs(zdos: ZDOManager): ZDO[] {
  const out: ZDO[] = [];
  // Same generous scan window as the E2 test (ZDOManager zone space is
  // floor(x/64) — half a zone offset from heightmap zones).
  for (let zy = -6; zy <= 6; zy++) {
    for (let zx = -6; zx <= 6; zx++) {
      out.push(...zdos.getZDOsInZone({ x: zx, y: zy }));
    }
  }
  return out;
}

function memberCount(zdo: ZDO): number {
  return (zdo.getMembers() as Map<number, unknown>).size;
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

console.log('=== F2 location placement smoke test ===');

// ── [1+2] prepareFeatures: count + determinism ────────────────────
console.log(`\n[1] prepareFeatures (C++ PostGeoInit):`);
const t0 = Date.now();
const p1 = buildWorld();
p1.zm.prepareFeatures();
const elapsed = Date.now() - t0;
const p2 = buildWorld();
p2.zm.prepareFeatures();

const inst1 = p1.zm.getFeatureInstances();
console.log(`  booked ${inst1.length} feature instances in ${elapsed}ms`);
check('plausible instance count', inst1.length > 1000, `${inst1.length} booked`);

const dumpInstances = (zm: ZoneManager): string =>
  zm
    .getFeatureInstances()
    .map((i) => `${i.zone.x},${i.zone.y}|${i.name}|${i.pos.x},${i.pos.y},${i.pos.z}`)
    .sort()
    .join('\n');
check(
  'placement bit-identical across fresh worlds',
  dumpInstances(p1.zm) === dumpInstances(p2.zm)
);

// ── [3] StartTemple booking ───────────────────────────────────────
console.log(`\n[2] StartTemple booking:`);
const temples = inst1.filter((i) => i.name === 'StartTemple');
check('exactly one StartTemple booked', temples.length === 1, `${temples.length}`);
const temple = temples[0];
if (temple) {
  const mag = Math.hypot(temple.pos.x, temple.pos.z);
  check(
    'StartTemple in zone (0,0)',
    temple.zone.x === 0 && temple.zone.y === 0,
    `zone ${temple.zone.x},${temple.zone.y}`
  );
  check(
    'StartTemple near origin',
    mag < 16,
    `(${temple.pos.x.toFixed(2)}, ${temple.pos.y.toFixed(2)}, ${temple.pos.z.toFixed(2)}) |pos|=${mag.toFixed(2)}`
  );
  check(
    'StartTemple above min altitude',
    temple.pos.y - WATER_LEVEL >= START_TEMPLE.minAltitude - 1e-4,
    `y=${temple.pos.y.toFixed(2)} (water ${WATER_LEVEL} + min ${START_TEMPLE.minAltitude})`
  );
}

// ── [4] Generation materializes the temple ────────────────────────
console.log(`\n[3] Zone generation around spawn (with features):`);
const gen1 = p1.zm.update([{ x: 0, y: 36.05, z: 0 }], 60_000);
const gen2 = p2.zm.update([{ x: 0, y: 36.05, z: 0 }], 60_000);
check('81 zones generated', gen1 === 81, `${gen1}`);

const zdos1 = allZDOs(p1.zdos);
const zdos2 = allZDOs(p2.zdos);

const proxies1 = zdos1.filter((z) => z.prefabHash === LOCATION_PROXY_HASH);
const templeProxies = proxies1.filter(
  (z) => z.getInt('location') === START_TEMPLE.hash
);
check(
  'StartTemple LocationProxy spawned',
  templeProxies.length === 1,
  `${templeProxies.length} temple proxies (${proxies1.length} total proxies)`
);
if (templeProxies.length === 1 && temple) {
  const proxy = templeProxies[0];
  check(
    'proxy at booked position',
    proxy.position.x === temple.pos.x &&
      proxy.position.y === temple.pos.y &&
      proxy.position.z === temple.pos.z
  );
  check(
    "proxy 'seed' member = zone seed",
    proxy.getInt('seed') === SEED,
    `seed=${proxy.getInt('seed')} (zone 0,0 ⇒ world seed)`
  );
  const templePieces = zdos1.filter(
    (z) =>
      TEMPLE_PIECE_HASHES.has(z.prefabHash) &&
      Math.hypot(z.position.x - temple.pos.x, z.position.z - temple.pos.z) < 20
  );
  check(
    'all 23 temple pieces spawned',
    templePieces.length === 23,
    `${templePieces.length} within 20m of center`
  );
  const maxDist = templePieces.reduce((m, z) => {
    const d = Math.hypot(z.position.x - temple.pos.x, z.position.z - temple.pos.z);
    return Math.max(m, d);
  }, 0);
  check(
    'pieces clustered around temple center',
    templePieces.length > 0 && maxDist < 20,
    `max 2D distance ${maxDist.toFixed(1)}m`
  );
  // StartTemple is rotation-free ⇒ piece positions must match the pkg
  // offsets exactly (f32 adds on top of the booked center).
  const expected = expectedTemplePieces(temple.pos);
  const unmatched = templePieces.filter(
    (z) =>
      !expected.some(
        (e) =>
          e.hash === z.prefabHash &&
          Math.abs(e.x - z.position.x) < 1e-3 &&
          Math.abs(e.y - z.position.y) < 1e-3 &&
          Math.abs(e.z - z.position.z) < 1e-3
      )
  );
  check(
    'piece positions match pkg offsets exactly',
    unmatched.length === 0,
    `${unmatched.length} unmatched`
  );
}

// ── [5] Cross-world determinism after generation ──────────────────
console.log(`\n[4] Post-generation determinism (randomRotation excluded):`);
// Location pieces share prefabs with foliage (Pickable_*, Bush01, ...) and
// randomRotation features rotate them non-deterministically (C++ time-seed).
// Exclude the footprint of every placed location from the vegetation dump.
const nearProxy = (z: ZDO, proxies: ZDO[], radius: number): boolean =>
  proxies.some(
    (p) =>
      Math.hypot(z.position.x - p.position.x, z.position.z - p.position.z) < radius
  );
const proxies2 = zdos2.filter((z) => z.prefabHash === LOCATION_PROXY_HASH);
const vegDump = (list: ZDO[], proxies: ZDO[]): string =>
  list
    .filter((z) => FOLIAGE_HASHES.has(z.prefabHash) && !nearProxy(z, proxies, 40))
    .map(
      (z) =>
        `${z.prefabHash}|${z.position.x},${z.position.y},${z.position.z}|` +
        `${z.rotation.x},${z.rotation.y},${z.rotation.z},${z.rotation.w}|m${memberCount(z)}`
    )
    .sort()
    .join('\n');
const proxyDump = (list: ZDO[]): string =>
  list
    .filter((z) => z.prefabHash === LOCATION_PROXY_HASH)
    .map(
      (z) =>
        `${z.position.x},${z.position.y},${z.position.z}|loc${z.getInt('location')}|seed${z.getInt('seed')}`
    )
    .sort()
    .join('\n');
const pieceHashDump = (list: ZDO[]): string =>
  list
    .filter((z) => !FOLIAGE_HASHES.has(z.prefabHash) && z.prefabHash !== LOCATION_PROXY_HASH)
    .map((z) => `${z.prefabHash}`)
    .sort()
    .join('\n');

check(
  'vegetation bit-identical outside location footprints',
  vegDump(zdos1, proxies1) === vegDump(zdos2, proxies2)
);
check('location proxies bit-identical', proxyDump(zdos1) === proxyDump(zdos2));
check(
  'location piece prefab multiset identical',
  pieceHashDump(zdos1) === pieceHashDump(zdos2)
);

// ── [6] ClearArea suppresses vegetation ───────────────────────────
console.log(`\n[5] ClearArea vegetation suppression:`);
if (temple) {
  // The temple's own 18 decoration pieces (Pickable_*, Bush01, ...) share
  // prefabs with foliage — exclude the exact expected piece positions.
  const expected = expectedTemplePieces(temple.pos);
  const nearTemple = zdos1.filter(
    (z) =>
      FOLIAGE_HASHES.has(z.prefabHash) &&
      Math.abs(z.position.x - temple.pos.x) < 16 &&
      Math.abs(z.position.z - temple.pos.z) < 16
  );
  const realVegetation = nearTemple.filter(
    (z) =>
      !expected.some(
        (e) =>
          e.hash === z.prefabHash &&
          Math.abs(e.x - z.position.x) < 1e-3 &&
          Math.abs(e.y - z.position.y) < 1e-3 &&
          Math.abs(e.z - z.position.z) < 1e-3
      )
  );
  check(
    'temple decoration pieces present (18 non-boss pieces)',
    nearTemple.length === 18,
    `${nearTemple.length} foliage-prefab ZDOs within 16m`
  );
  check(
    'no REAL vegetation within 16m of temple center',
    realVegetation.length === 0,
    `${realVegetation.length} intruders (clearArea radius ${START_TEMPLE.exteriorRadius})`
  );
}
const vegCount1 = zdos1.filter((z) => FOLIAGE_HASHES.has(z.prefabHash)).length;
check(
  'vegetation below E2 no-features baseline (9112)',
  vegCount1 < 9112,
  `${vegCount1} vegetation ZDOs`
);

// ── Summary ───────────────────────────────────────────────────────
console.log(
  `\n  totals: ${zdos1.length} ZDOs (${vegCount1} vegetation, ${proxies1.length} proxies, ` +
    `${zdos1.length - vegCount1 - proxies1.length} location pieces), ${inst1.length} booked instances`
);

if (failures > 0) {
  console.error(`\n=== F2: ${failures} CHECK(S) FAILED ===`);
  process.exit(1);
}
console.log('\n=== F2: ALL PASSED ===');
