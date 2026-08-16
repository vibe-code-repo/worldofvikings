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
 *  3. Integration: mit leerer Feature-Tabelle wird nichts gebucht und
 *     nichts geebnet — das Gelände an der Weltmitte bleibt Naturgelände.
 *
 * BLOCK A: Punkt 3 hieß bis hierher "StartTemple ebnet das Spawn-Plateau,
 * und alle 23 Pieces sitzen in ihrem pkg-Abstand darüber". Diese Erwartung
 * ist überholt: `FEATURES` ist gegen die Whitelist `EIGENE_MODELLE`
 * gefiltert und leer, es wird keine Location mehr platziert. Geprüft wird
 * jetzt die Gegenprobe — nichts gebucht, Gelände unberührt. Das ist keine
 * Verlegenheitslösung, sondern der Wächter dagegen, dass sich über
 * irgendeinen Pfad doch wieder eine Valheim-Location in die Welt schiebt
 * und Terrassen ins Gelände schneidet.
 *
 * Punkt 1 prüft weiter alle drei Zweige der Regel. Er zieht seine drei
 * Feature-Köpfe seit Block A aus `featuresData.json` statt aus `FEATURES`:
 * Die REGEL ist eine Eigenschaft von locationConfig.ts und der Kopfdaten
 * und gilt unverändert — nur ausgeliefert wird gerade keiner der Köpfe.
 * Über die leere Tabelle geprüft wäre der Punkt lautlos verschwunden.
 *
 * Run: npx tsx server/test/f3-leveling.ts   (from the repo root)
 */

import {
  GeoManager,
  HeightmapProvider,
  getTerrainLeveling,
  getStableHash,
  type Feature,
} from '@wov/shared';
import featuresData from '@wov/shared/src/featuresData.json';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
// Die Pieces liegen seit dem Bundle-Schnitt nicht mehr am Feature, sondern
// in einem serverseitigen Datenmodul (shared/src/featurePieces.ts).
import { getFeaturePieces } from '@wov/shared/src/featurePieces.js';
import { ZoneManager } from '../src/world/ZoneManager.js';

const SEED = getStableHash('KxSYuZquuw');
const f32 = Math.fround;

/** Ein Feature-Kopf aus der Rohdatei, so wie `features.ts` ihn baut. */
function kopf(name: string): Feature {
  const roh = (featuresData.features as ReadonlyArray<Omit<Feature, 'hash'>>).find(
    (f) => f.name === name
  );
  if (!roh) throw new Error(`Feature-Kopf '${name}' fehlt in featuresData.json`);
  return { ...roh, hash: getStableHash(name) };
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

console.log('=== F4 terrain leveling smoke test ===');

// ── [1] getTerrainLeveling rule ───────────────────────────────────
console.log('\n[1] getTerrainLeveling rule:');
const temple = kopf('StartTemple');
const house = kopf('WoodHouse2');
const ship = kopf('ShipSetting01');

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

// ── [3] Gegenprobe: leere Feature-Tabelle ebnet nichts ────────────
console.log('\n[3] Leere Feature-Tabelle (zone (0,0)):');
const geo2 = new GeoManager(SEED, { worldGenVersion: 2, ashlandsModernNoise: false });
const heightmaps2 = new HeightmapProvider(geo2, {
  blendSmoothStep: true,
  bilinearSampling: false,
});
// Zweiter Provider auf derselben Geo, an dem kein ZoneManager haengt: Er
// traegt nie einen Modifikator und ist damit das Naturgelaende als Mass.
const naturgelaende = new HeightmapProvider(geo2, {
  blendSmoothStep: true,
  bilinearSampling: false,
});
const zdos = new ZDOManager(1n);
const zm = new ZoneManager(geo2, heightmaps2, zdos, SEED, {
  // worldFeatures BEWUSST an: Der volle Durchlauf ueber FEATURES ist auf
  // eine leere Liste zusammengeschrumpft und kostet nichts mehr. Frueher
  // stand hier false, um die ~75 s weltweite Platzierung zu sparen.
  worldFeatures: true,
  worldVegetation: false, // height checks only, no foliage needed
  locationOverrides: true,
  dungeonsEnabled: true,
});
zm.prepareFeatures();

check('keine Location gebucht', zm.getFeatureInstances().length === 0, `${zm.getFeatureInstances().length}`);

// Der Produktionspfad laeuft trotzdem — er darf am leeren Bestand nichts tun.
(
  zm as unknown as {
    tryGenerateFeature(zone: { x: number; y: number }): unknown;
  }
).tryGenerateFeature({ x: 0, y: 0 });

check('keine ZDOs aus Locations', zdos.totalZDOCount === 0, `${zdos.totalZDOCount}`);

// Kein Modifikator heisst: Der Boden ist an jeder Stelle das, was die
// Hoehenfunktion liefert. Bit-genau geprueft, nicht "ungefaehr gleich" —
// eine Ebnung, die 20 cm abtraegt, waere sonst nicht zu sehen.
let abweichung = 0;
let schlimmster = '';
for (let x = -32; x <= 32; x += 8) {
  for (let z = -32; z <= 32; z += 8) {
    const d = Math.abs(heightmaps2.getGroundHeight(x, z) - naturgelaende.getGroundHeight(x, z));
    if (d > abweichung) {
      abweichung = d;
      schlimmster = `(${x}, ${z})`;
    }
  }
}
check(
  'Gelaende um die Weltmitte ist unveraendertes Naturgelaende',
  abweichung === 0,
  abweichung === 0 ? '81 Punkte bitgleich' : `${abweichung}m bei ${schlimmster}`
);

if (failures > 0) {
  console.error(`\n=== F4: ${failures} CHECK(S) FAILED ===`);
  process.exit(1);
}
console.log('\n=== F4: ALL PASSED ===');
