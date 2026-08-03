/**
 * Phase-1-Tests des Kartengenerierungs-Umbaus: sanitizeWorldLayout und
 * RegionField (Distanz-Korrektheit, Z-Ordnung, Stetigkeit, Ozean-Default).
 *
 *   npx tsx test/worldlayout.ts
 */
import {
  RegionField,
  sanitizeWorldLayout,
  signedDistance,
  type WorldLayout,
} from '../src/worldlayout/index.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

// ── sanitize ─────────────────────────────────────────────────────────
check('sanitize: Müll → null', sanitizeWorldLayout(null) === null && sanitizeWorldLayout(42) === null);
check('sanitize: falsche Version → null', sanitizeWorldLayout({ version: 2, name: 'x' }) === null);

const roh = {
  version: 1,
  name: 'Testwelt',
  detailSeed: 'seed1',
  continents: [
    { id: 'wik', name: 'Wikingerland', faction: 'viking' },
    { id: 'wik', name: 'Duplikat', faction: 'viking' }, // Duplikat → verworfen
    { id: 'BAD ID', name: 'kaputt' }, // ungültige id → verworfen
  ],
  regions: [
    {
      id: 'insel',
      biome: 'meadows',
      shape: { kind: 'circle', x: 0, z: 0, radius: 2000 },
      edgeFalloff: 99999, // → geklemmt auf 5000
      vegetation: ['Beech1', 'Beech1', ''],
    },
    { id: 'kaputt', biome: 'lava', shape: { kind: 'circle', x: 0, z: 0, radius: 100 } }, // Biom unbekannt
    { id: 'flach', biome: 'plains', shape: { kind: 'polygon', points: [[0, 0], [1, 1], [2, 2]] } }, // Fläche ~0
  ],
};
const layout = sanitizeWorldLayout(roh);
check('sanitize: Dokument angenommen', layout !== null);
check('sanitize: Kontinent-Duplikate/Bad-IDs verworfen', layout!.continents.length === 1);
check('sanitize: ungültige Regionen verworfen', layout!.regions.length === 1, `= ${layout!.regions.length}`);
check('sanitize: edgeFalloff geklemmt', layout!.regions[0]!.edgeFalloff === 5000);
check(
  'sanitize: Vegetation dedupliziert/bereinigt',
  JSON.stringify(layout!.regions[0]!.vegetation) === JSON.stringify(['Beech1'])
);

// ── signedDistance ───────────────────────────────────────────────────
const quadrat = {
  kind: 'polygon' as const,
  points: [
    [-100, -100],
    [100, -100],
    [100, 100],
    [-100, 100],
  ] as [number, number][],
};
check('sd: Quadrat-Mitte = +100', Math.abs(signedDistance(quadrat, 0, 0) - 100) < 1e-9);
check('sd: Quadrat außen = −50', Math.abs(signedDistance(quadrat, 150, 0) + 50) < 1e-9);
check('sd: Kreis analytisch', Math.abs(signedDistance({ kind: 'circle', x: 10, z: 0, radius: 30 }, 10, 20) - 10) < 1e-9);

// ── RegionField ──────────────────────────────────────────────────────
const welt: WorldLayout = sanitizeWorldLayout({
  version: 1,
  name: 'Zwei Kontinente',
  detailSeed: 's',
  continents: [],
  regions: [
    { id: 'wiese', biome: 'meadows', shape: { kind: 'circle', x: 0, z: 0, radius: 3000 }, edgeFalloff: 300 },
    // Overlay MITTEN auf der Wiese — Z-Ordnung muss gewinnen:
    { id: 'berg', biome: 'mountain', shape: { kind: 'circle', x: 0, z: 0, radius: 800 }, edgeFalloff: 200 },
    // Zweiter Kontinent weit im Osten:
    { id: 'ost', biome: 'plains', shape: { kind: 'circle', x: 20000, z: 0, radius: 2500 }, edgeFalloff: 300 },
  ],
})!;
const feld = new RegionField(welt);

check('feld: Chunks kompiliert', feld.chunkCount > 0, `= ${feld.chunkCount}`);
// Nur ~Umgebung der Regionen kompiliert, nicht die Riesen-Bbox dazwischen:
// Kontinent1 ~ (7km)² + Berg + Kontinent2 ~ (6km)² ⇒ deutlich unter 200 Chunks.
check('feld: leere See kostet nichts', feld.chunkCount < 200, `= ${feld.chunkCount}`);

const mitte = feld.sample(0, 0);
check('feld: Overlay gewinnt per Z-Ordnung', mitte.regionA?.id === 'berg', `= ${mitte.regionA?.id}`);
check('feld: Untergrund als Zweitplatzierter', mitte.regionB?.id === 'wiese', `= ${mitte.regionB?.id}`);

const rand = feld.sample(2000, 0); // in der Wiese, außerhalb des Bergs
check('feld: außerhalb des Overlays gilt der Untergrund', rand.regionA?.id === 'wiese');
check('feld: Berg dort außen (dist < 0)', rand.regionB?.id !== 'berg' || rand.distB < 0);

const see = feld.sample(10000, 0); // zwischen den Kontinenten
check('feld: offene See → keine Region', see.regionA === null);

const ost = feld.sample(20000, 100);
check('feld: zweiter Kontinent gefunden', ost.regionA?.id === 'ost' && ost.distA > 0);

// Stetigkeit: distA entlang einer Küstenquerung darf nie schneller wachsen
// als die Schrittweite (Distanzfelder sind 1-Lipschitz). Gilt nur solange
// eine Region in Reichweite ist — dahinter endet das Feld VERTRAGSGEMÄSS
// (offene See), dort muss die Höhe längst auf Ozeanboden sein (s. unten).
let stetig = true;
let vorher: number | null = null;
for (let x = 2500; x <= 3500; x += 4) {
  const s = feld.sample(x, 0);
  if (!s.regionA) break;
  if (vorher !== null && Math.abs(s.distA - vorher) > 4 + 1e-6) {
    stetig = false;
    console.error(`  Sprung bei x=${x}: ${vorher} → ${s.distA}`);
    break;
  }
  vorher = s.distA;
}
check('feld: Distanz 1-Lipschitz über die Küste', stetig);

// Übergangs-Vertrag Feldende ↔ offene See: Wo das Feld noch antwortet, aber
// die Region weiter weg ist als ihr edgeFalloff, gilt der Punkt als voller
// Ozean — identisch zur Antwort "keine Region". RegionGeo darf sich darauf
// verlassen, dass am Feldrand kein Höhensprung entsteht.
let vertrag = true;
for (let x = 2500; x <= 4000; x += 8) {
  const s = feld.sample(x, 0);
  if (!s.regionA) continue;
  const wieOzean = s.distA <= -s.regionA.edgeFalloff;
  const nochLand = s.distA > -s.regionA.edgeFalloff;
  if (!wieOzean && !nochLand) vertrag = false;
  // Feldende erst NACH dem Falloff: solange Land-Anteil möglich ist, muss
  // das Feld antworten.
  if (nochLand && x > 3000 + 300) {
    vertrag = false;
    console.error(`  Land-Anteil außerhalb des Falloffs bei x=${x} (dist ${s.distA})`);
  }
}
check('feld: Feldende liegt jenseits des Falloffs', vertrag);

if (fehler > 0) {
  console.error(`\n${fehler} Prüfung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log('\n=== WORLDLAYOUT: ALL PASSED ===');
