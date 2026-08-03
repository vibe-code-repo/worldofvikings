/**
 * Phase-2-Tests: RegionGeo — Biome aus dem Layout, Küsten ohne Klippen,
 * Heightmap-Integration und Boot-Zeit.
 *
 *   npx tsx test/region-geo.ts
 */
import { createGeo, HeightmapProvider, RegionGeo } from '../src/worldgen/index.js';
import { getStableHash } from '../src/hash.js';
import { Biome } from '../src/types.js';
import { WATER_LEVEL } from '../src/worldgen/Heightmap.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

const layout = {
  version: 1,
  name: 'Zwei Kontinente',
  detailSeed: 'wov-test',
  continents: [
    { id: 'wik', name: 'Wikingerland', faction: 'viking' },
    { id: 'sax', name: 'Angelland', faction: 'saxon' },
  ],
  regions: [
    // Wikinger-Kontinent im Westen: Wiese mit Gebirgs-Overlay.
    {
      id: 'wik-land',
      continentId: 'wik',
      biome: 'meadows',
      shape: {
        kind: 'polygon',
        points: [
          [-9000, -4000],
          [-2000, -4500],
          [-1500, 3500],
          [-8500, 4000],
        ],
      },
      edgeFalloff: 400,
    },
    {
      id: 'wik-gebirge',
      continentId: 'wik',
      biome: 'mountain',
      shape: { kind: 'circle', x: -6000, z: 0, radius: 1500 },
      edgeFalloff: 500,
    },
    // Angelsachsen-Kontinent im Osten: Ebene, kahl kuratiert.
    {
      id: 'sax-land',
      continentId: 'sax',
      biome: 'plains',
      shape: { kind: 'circle', x: 7000, z: 0, radius: 3000 },
      edgeFalloff: 400,
      forestDensity: 0,
    },
  ],
};

const t0 = Date.now();
const geo = createGeo({ mode: 'layout', worldSeed: getStableHash('wov-test'), layout });
const bootMs = Date.now() - t0;
check('Boot in Sekunden statt Minuten', bootMs < 5000, `= ${bootMs} ms`);
check('Factory liefert RegionGeo', geo instanceof RegionGeo);

// ── Biome ────────────────────────────────────────────────────────────
check('Meer zwischen den Kontinenten', geo.getBiome(2500, 0) === Biome.Ocean);
check('Weit draußen: Ozean', geo.getBiome(40000, 40000) === Biome.Ocean);
check('Wiese auf dem Westkontinent', geo.getBiome(-3000, 0) === Biome.Meadows);
check('Gebirgs-Overlay gewinnt', geo.getBiome(-6000, 0) === Biome.Mountain);
check('Ebene im Osten', geo.getBiome(7000, 0) === Biome.Plains);

// ── Höhen ────────────────────────────────────────────────────────────
const seeTiefe = geo.getHeight(2500, 0);
check('Meeresboden unter dem Pegel', seeTiefe < WATER_LEVEL - 10, `= ${seeTiefe.toFixed(1)}`);
const wiese = geo.getHeight(-3000, 0);
check('Wiese über Wasser', wiese > WATER_LEVEL, `= ${wiese.toFixed(1)}`);
const berg = geo.getHeight(-6000, 0);
check('Gebirge deutlich höher', berg > wiese + 20, `Berg ${berg.toFixed(1)} vs Wiese ${wiese.toFixed(1)}`);

// Determinismus: zweite Instanz, identische Werte.
const geo2 = createGeo({ mode: 'layout', worldSeed: getStableHash('wov-test'), layout });
let deterministisch = true;
for (let i = 0; i < 200; i++) {
  const x = -9500 + i * 90;
  if (geo.getHeight(x, 123) !== geo2.getHeight(x, 123)) deterministisch = false;
}
check('deterministisch (zwei Instanzen identisch)', deterministisch);

// ── Küste: keine Klippen ─────────────────────────────────────────────
// Gemessen wird die HEIGHTMAP (der 64-m-Eckbiom-Blend), nicht das rohe
// getHeight: Das rohe Feld wechselt am Meadows→Ocean-Übergang diskret die
// Biomhöhenfunktion — wie im Original; die Spieloberfläche glättet das.
// Provider entsteht unten ohnehin — hier vorziehen.
const kuestenProvider = new HeightmapProvider(geo, { blendSmoothStep: true });
let maxSprung = 0;
let vorher = kuestenProvider.getGroundHeight(-2600, 0);
for (let x = -2598; x <= 500; x += 2) {
  const h = kuestenProvider.getGroundHeight(x, 0);
  maxSprung = Math.max(maxSprung, Math.abs(h - vorher));
  vorher = h;
}
check('Küste ohne Abrisskanten', maxSprung < 4, `max ${maxSprung.toFixed(2)} m / 2 m Schritt`);

// ── Heightmap-Integration (Zonenbau + Eckbiom-Blend) ─────────────────
const provider = new HeightmapProvider(geo, { blendSmoothStep: true });
const tZone = Date.now();
const hoehe = provider.getGroundHeight(-3000, 0);
const zoneMs = Date.now() - tZone;
check('Heightmap-Zone baut', Number.isFinite(hoehe), `h = ${hoehe.toFixed(1)}`);
check('Zonenbau schnell genug', zoneMs < 500, `= ${zoneMs} ms`);
check(
  'Zone ≈ Rohhöhe (nearest-vertex)',
  Math.abs(hoehe - geo.getHeight(-3000, 0)) < 5,
  `${hoehe.toFixed(1)} vs ${geo.getHeight(-3000, 0).toFixed(1)}`
);

// Blend über eine Biomgrenze (Berg→Wiese): Heightmap-Werte entlang der
// Linie dürfen keine Sprünge über die Zonengrenzen zeigen.
let maxZonenSprung = 0;
let vorherZ = provider.getGroundHeight(-7600, 0);
for (let x = -7599; x <= -4400; x += 1) {
  const h = provider.getGroundHeight(x, 0);
  maxZonenSprung = Math.max(maxZonenSprung, Math.abs(h - vorherZ));
  vorherZ = h;
}
check('Heightmap stetig über Biomgrenze', maxZonenSprung < 6, `max ${maxZonenSprung.toFixed(2)} m/m`);

// ── Wald-Kuratierung ─────────────────────────────────────────────────
let kahl = 0;
for (let i = 0; i < 100; i++) {
  if (!geo.inForest(6500 + (i % 10) * 60, -270 + Math.floor(i / 10) * 60)) kahl++;
}
check('forestDensity 0 → praktisch kahl', kahl > 90, `${kahl}/100 waldfrei`);

if (fehler > 0) {
  console.error(`\n${fehler} Prüfung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log('\n=== REGION-GEO: ALL PASSED ===');
