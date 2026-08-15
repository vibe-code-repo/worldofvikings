/**
 * F4 smoke test — terrain leveling for locations (Unity TerrainModifier parity).
 *
 * The C++ reference server does NOT level terrain under locations (its
 * TerrainModifier.cpp only feeds ClearArea params). Without leveling,
 * location pieces booked relative to the feature center float up to ~5m on
 * slopes (user-reported Phase-F regression). The leveling is baked into
 * Heightmap.heights on server (ground truth) and client (rendering) with
 * identical shared math.
 *
 * Checks:
 *  1. getTerrainLeveling rule: yml entry (WoodHouse2) > clearArea rule
 *     (StartTemple: exteriorRadius, C++ defaults) > none (ShipSetting01).
 *  2. Synthetic modifier on a slope: plateau exact, band blends monotonically,
 *     far field untouched, square vs radial distance norm.
 *  3. Integration: generating zone (0,0) with worldFeatures=false spawns the
 *     StartTemple and levels the spawn plateau; every temple piece sits at
 *     its pkg offset above the plateau (pre-fix max slope error was 2.40m).
 *
 * Run: npx tsx server/test/f3-leveling.ts   (from the repo root)
 */

import {
  GeoManager,
  HeightmapProvider,
  FEATURES_BY_NAME,
  getTerrainLeveling,
  getStableHash,
} from '@wov/shared';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
// Die Pieces liegen seit dem Bundle-Schnitt nicht mehr am Feature, sondern
// in einem serverseitigen Datenmodul (shared/src/featurePieces.ts).
import { getFeaturePieces } from '@wov/shared/src/featurePieces.js';
import { ZoneManager } from '../src/world/ZoneManager.js';

const SEED = getStableHash('KxSYuZquuw');
const f32 = Math.fround;

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    failures++;
  }
}

console.log('=== F4 terrain leveling smoke test ===');

// ── [1] getTerrainLeveling rule ───────────────────────────────────
console.log('\n[1] getTerrainLeveling rule:');
const temple = FEATURES_BY_NAME.get('StartTemple')!;
const house = FEATURES_BY_NAME.get('WoodHouse2')!;
const ship = FEATURES_BY_NAME.get('ShipSetting01')!;

const templeLeveling = getTerrainLeveling(temple);
// Seit 2026-08-02 ebnet die clearArea-Regel nur noch die PIECE-Grundfläche
// (+2 m Saum, Deckel 16) statt des vollen exteriorRadius — ungekappt
// entstanden 64-m-Terrassen mit harten Kanten (Holzhaus am Steinkreis).
// StartTemple: äußerstes Piece bei ~13.85 m → levelRadius ≈ 15.85 < 16;
// smoothRadius wächst auf levelRadius mit, damit der Übergang flach bleibt.
const templePieces = getFeaturePieces('StartTemple');
const templePieceRadius = Math.max(...templePieces.map((p) => Math.hypot(p.pos.x, p.pos.z)));
// Der Kopf traegt den Radius vorberechnet — beides muss zusammenpassen,
// sonst sind featuresData.json und featurePiecesData.json auseinandergelaufen.
check(
  'StartTemple.pieceRadius passt zu den echten Pieces',
  Math.abs(temple.pieceRadius - templePieceRadius) < 1e-6,
  `Kopf ${temple.pieceRadius} vs. Pieces ${templePieceRadius}`
);
check(
  'StartTemple → clearArea rule (Piece-Grundfläche statt exteriorRadius)',
  templeLeveling !== null &&
    Math.abs(templeLeveling.levelRadius - Math.min(25, templePieceRadius + 2, 16)) < 1e-6 &&
    templeLeveling.levelRadius < 25 &&
    templeLeveling.levelOffset === -0.2 &&
    templeLeveling.smoothRadius === Math.max(7.0, templeLeveling.levelRadius) &&
    templeLeveling.smoothPower === 3.0 &&
    templeLeveling.square === true,
  JSON.stringify(templeLeveling)
);

const houseLeveling = getTerrainLeveling(house);
check(
  'WoodHouse2 → terrain_modifiers.yml entry (not in pkg clearArea)',
  houseLeveling !== null && houseLeveling.levelRadius > 0 && houseLeveling.levelRadius !== 25,
  JSON.stringify(houseLeveling)
);

check(
  'ShipSetting01 → no leveling (no yml entry, no clearArea)',
  getTerrainLeveling(ship) === null
);

// ── [2] Synthetic modifier on a slope ─────────────────────────────
console.log('\n[2] Synthetic modifier (plateau / band / far field / square):');
const geo = new GeoManager(SEED, { worldGenVersion: 2, ashlandsModernNoise: false });
const heightmaps = new HeightmapProvider(geo, {
  blendSmoothStep: true,
  bilinearSampling: false,
});

// Find a sloped spot: |ground(p) − ground(p+10m)| ≥ 1.5m
let px = 0;
let pz = 100;
outer: for (let x = 100; x <= 400; x += 10) {
  for (let z = -300; z <= 300; z += 25) {
    if (Math.abs(heightmaps.getGroundHeight(x, z) - heightmaps.getGroundHeight(x + 10, z)) >= 1.5) {
      px = x;
      pz = z;
      break outer;
    }
  }
}
check('sloped test spot found', px !== 0, `(${px}, ${pz})`);

// Pre-modifier reference heights (integer coords = exact vertices)
const preBand1 = heightmaps.getGroundHeight(px + 9, pz);
const preBand2 = heightmaps.getGroundHeight(px + 11, pz);
const preFar = heightmaps.getGroundHeight(px + 30, pz);

const target = f32(heightmaps.getGroundHeight(px, pz) + 1.25); // raised plateau
const affected = heightmaps.addTerrainModifier({
  x: px,
  z: pz,
  targetHeight: target,
  levelRadius: 8,
  smoothRadius: 4,
  smoothPower: 3,
  square: false,
});
check('affected zone list non-empty', affected.length > 0, `${affected.length} zones`);

check(
  'plateau exact inside levelRadius',
  heightmaps.getGroundHeight(px - 6, pz) === target &&
    heightmaps.getGroundHeight(px, pz) === target &&
    heightmaps.getGroundHeight(px + 6, pz) === target &&
    heightmaps.getGroundHeight(px, pz + 6) === target,
  `target ${target}`
);

const band1 = heightmaps.getGroundHeight(px + 9, pz); // t = (1/4)³ ≈ 0.016 → near plateau
const band2 = heightmaps.getGroundHeight(px + 11, pz); // t = (3/4)³ ≈ 0.42 → near original
check(
  'band blends monotonically (band1 near plateau, band2 near original)',
  band1 !== target &&
    band2 !== target &&
    Math.abs(band1 - target) < Math.abs(band2 - target) &&
    Math.abs(band2 - preBand2) < Math.abs(band1 - preBand1),
  `band1 ${band1.toFixed(3)} (pre ${preBand1.toFixed(3)}), band2 ${band2.toFixed(3)} (pre ${preBand2.toFixed(3)})`
);

check(
  'far field untouched (30m > 8+4)',
  heightmaps.getGroundHeight(px + 30, pz) === preFar,
  `${preFar}`
);

// Square norm: diagonal (5,5) → max-norm 5 ≤ 6 leveled; radial √50 ≈ 7.07 > 6 not leveled
const sx = px + 40;
const sz = pz;
const preDiag = heightmaps.getGroundHeight(sx + 5, sz + 5);
heightmaps.addTerrainModifier({
  x: sx,
  z: sz,
  targetHeight: target,
  levelRadius: 6,
  smoothRadius: 0.5,
  smoothPower: 3,
  square: true,
});
const diagSquare = heightmaps.getGroundHeight(sx + 5, sz + 5);
heightmaps.addTerrainModifier({
  x: sx + 20,
  z: sz,
  targetHeight: target,
  levelRadius: 6,
  smoothRadius: 0.5,
  smoothPower: 3,
  square: false,
});
const diagRadial = heightmaps.getGroundHeight(sx + 25, sz + 5);
check(
  'square norm levels the diagonal, radial does not',
  diagSquare === target && diagRadial !== target,
  `square ${diagSquare} (pre ${preDiag}), radial ${diagRadial}`
);

// ── [3] Integration: StartTemple levels the spawn plateau ─────────
console.log('\n[3] StartTemple integration (zone (0,0)):');
const geo2 = new GeoManager(SEED, { worldGenVersion: 2, ashlandsModernNoise: false });
const heightmaps2 = new HeightmapProvider(geo2, {
  blendSmoothStep: true,
  bilinearSampling: false,
});
const zdos = new ZDOManager(1n);
const zm = new ZoneManager(geo2, heightmaps2, zdos, SEED, {
  worldFeatures: false, // book the StartTemple only — skips the ~75s worldwide
  // placement that f2-locations.ts already covers. generateZone gates
  // tryGenerateFeature behind worldFeatures, so the temple is generated by
  // invoking the exact production path directly below.
  worldVegetation: false, // height checks only, no foliage needed
  locationOverrides: true,
  dungeonsEnabled: true,
});
zm.prepareFeatures();

const booked = zm.getFeatureInstances().find((i) => i.name === 'StartTemple');
check('StartTemple booked', booked !== undefined);
if (!booked) {
  console.error('\n=== F4: ABORTED (no temple) ===');
  process.exit(1);
}

// The real generation path (piece ZDOs + proxy + F4 terrain modifier)
(
  zm as unknown as {
    tryGenerateFeature(zone: { x: number; y: number }): unknown;
  }
).tryGenerateFeature({ x: booked.zone.x, y: booked.zone.y });

const plateau = f32(booked.pos.y + (templeLeveling!.levelOffset));
check(
  'spawn ground is the leveled plateau',
  heightmaps2.getGroundHeight(0, 0) === plateau,
  `ground(0,0) ${heightmaps2.getGroundHeight(0, 0)}, plateau ${plateau} ` +
    `(booked y ${booked.pos.y} + offset ${templeLeveling!.levelOffset})`
);

// Every temple piece must sit at its pkg offset above the plateau:
// pieceY − ground ≈ piece.pos.y − levelOffset (identity rotation, all
// pieces within 13.8m < levelRadius 25 → ground == plateau exactly).
let maxAbsDiff = 0;
let worstInvariant = 0;
for (const p of templePieces) {
  const pieceY = f32(booked.pos.y + p.pos.y);
  const ground = heightmaps2.getGroundHeight(f32(booked.pos.x + p.pos.x), f32(booked.pos.z + p.pos.z));
  const diff = f32(pieceY - ground);
  maxAbsDiff = Math.max(maxAbsDiff, Math.abs(diff));
  // diff should equal (p.pos.y − levelOffset) = p.pos.y + 0.2
  worstInvariant = Math.max(worstInvariant, Math.abs(diff - (p.pos.y - templeLeveling!.levelOffset)));
}
check(
  'all 23 pieces at exact pkg offset above the plateau (no slope float)',
  worstInvariant < 0.01,
  `max invariant violation ${worstInvariant.toFixed(4)}m, max |piece−ground| ${maxAbsDiff.toFixed(3)}m ` +
    `(pre-fix slope error was 2.40m)`
);

if (failures > 0) {
  console.error(`\n=== F4: ${failures} CHECK(S) FAILED ===`);
  process.exit(1);
}
console.log('\n=== F4: ALL PASSED ===');
