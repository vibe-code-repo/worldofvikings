/**
 * K5.5a N1 — radius of the clear areas: real hulls, circle, clamps, cost.
 * Radius der Freiflächen: echte Hüllen, Kreis, Klemmen, Kosten.
 *
 *  1. Hülle aus der gemeinsamen Hilfe (`huellenAufloeser`): Store-Modell,
 *     Upload (Registry), eigenes Modell über `renderScale`; nichts davon
 *     ist ein Rückfall (1,5 m).
 *  2. Kreis statt Quadrat (`kreis`), Skala geht ein.
 *  3. Die Funktion klemmt selbst: nicht-endlich, sehr groß, sehr klein.
 *  4. Kosten von `generateZone` bei 500 und 2000 Platzierungen in einer Zone.
 *
 * Lauf: npx tsx server/test/bewuchs-freiraum-huellen.ts   (aus der Projektwurzel)
 */

import {
  FREIFLAECHE_MAX,
  FREIFLAECHE_MIN,
  FREIFLAECHE_VORGABE,
  GRASLAND_FLORA_NAMEN,
  HeightmapProvider,
  PREFABS_BY_NAME,
  RegionGeo,
  freiflaechenAusPlatzierungen,
  freiflaechenHuellen,
  getStableHash,
  sanitizeWorldLayout,
} from '@wov/shared';
import { STORE_KATALOG_NACH_PREFAB } from '@wov/shared/src/storeKatalogDaten.js';
import { registerUploadedPrefab } from '@wov/shared/src/uploadedModelRegistry.js';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
import { ZoneManager } from '../src/world/ZoneManager.js';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    failures++;
  }
}
const radien = (p: Array<Record<string, unknown>>): number[] =>
  freiflaechenAusPlatzierungen({ placements: p as never }).map((a) => a.radius);
const nahe = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

console.log('=== K5.5a N1 Hüllen ===');

// ── [1] Hüllen ───────────────────────────────────────────────────────
console.log('\n[1] Hüllen statt Rückfall:');
const huellen = freiflaechenHuellen();
// Store-Modell mit Hüllbox, das kein Baum ist (Kollisionskiste des Stamms zählt nicht).
const storeName = [...STORE_KATALOG_NACH_PREFAB.keys()].find((n) => {
  const h = huellen(n);
  return h !== null && h.halbX > 2 && h.halbX < 20 && h.halbZ < 20 && PREFABS_BY_NAME.has(n) && !n.startsWith('vegetation-');
});
if (storeName === undefined) throw new Error('kein Store-Modell mit Hülle gefunden');
const sh = huellen(storeName)!;
const erwStore = Math.hypot(Math.abs(sh.mitteX) + sh.halbX, Math.abs(sh.mitteZ) + sh.halbZ);
const [rStore, rStore2] = radien([
  { prefab: storeName, x: 0, z: 0 },
  { prefab: storeName, x: 0, z: 0, scale: 2 },
]);
check('Store-Modell: Radius aus der Hülle', nahe(rStore, Math.min(FREIFLAECHE_MAX, erwStore)) && rStore > FREIFLAECHE_VORGABE, `${storeName} ${rStore.toFixed(2)} m`);
check('Skala geht ein', nahe(rStore2, Math.min(FREIFLAECHE_MAX, erwStore * 2)), `${rStore2.toFixed(2)} m`);

const fels = PREFABS_BY_NAME.get('Felsblock3')!;
const [rFels] = radien([{ prefab: 'Felsblock3', x: 0, z: 0 }]);
check('eigenes Modell: renderScale-Breite', nahe(rFels, Math.hypot(fels.renderScale.w / 2, fels.renderScale.w / 2)) && rFels > FREIFLAECHE_VORGABE, `Felsblock3 w=${fels.renderScale.w} → ${rFels.toFixed(2)} m`);

registerUploadedPrefab({
  name: 'U_Steg_N1', anzeigename: 'Steg', bytes: 1, dreiecke: 1, meshes: 1, materialien: 1, bilder: 0,
  fehlendeTexturen: false, breite: 2.8, hoehe: 1, tiefe: 14, kollisionsart: 'fest',
  hatKollisionsnetz: false, kollisionsnetzAbgelehnt: false, hochgeladenVon: 'test', zeitpunkt: '2026-09-24T00:00:00Z',
});
const [rUp] = radien([{ prefab: 'U_Steg_N1', x: 0, z: 0 }]);
check('Upload: Breite/Tiefe der Registry', nahe(rUp, Math.hypot(1.4, 7)), `${rUp.toFixed(2)} m`);
const [rUnbekannt] = radien([{ prefab: 'gibt-es-nicht', x: 0, z: 0 }]);
check('keine Hülle: fester Rückfall', rUnbekannt === FREIFLAECHE_VORGABE, `${rUnbekannt}`);

// ── [3] Klemmen ──────────────────────────────────────────────────────
console.log('\n[3] Die Funktion klemmt selbst:');
const [k1, k2, k3, k4, k5, k6, k7] = radien([
  { prefab: storeName, x: 0, z: 0, scale: 1000 },
  { prefab: storeName, x: 0, z: 0, scale: 1e308 },
  { prefab: 'x', x: 0, z: 0, einebnen: 10000 },
  { prefab: 'x', x: 0, z: 0, einebnen: 1e-9 },
  { prefab: 'x', x: 0, z: 0, einebnen: 1 },
  { prefab: storeName, x: 0, z: 0, scale: Number.NaN },
  { prefab: 'x', x: 0, z: 0, einebnen: Number.POSITIVE_INFINITY },
]);
check('scale 1000 → Obergrenze', k1 === FREIFLAECHE_MAX, `${k1}`);
check('scale 1e308 → endlich, Obergrenze', k2 === FREIFLAECHE_MAX, `${k2}`);
check('einebnen 10000 → Obergrenze', k3 === FREIFLAECHE_MAX, `${k3}`);
check('einebnen 1e-9 → Rückfall als Untergrenze', k4 === FREIFLAECHE_VORGABE, `${k4}`);
check('einebnen 1 (< Rückfall) → Rückfall', k5 === FREIFLAECHE_VORGABE, `${k5}`);
check('scale NaN wird ignoriert (Skala 1)', nahe(k6, Math.min(FREIFLAECHE_MAX, erwStore)), `${k6.toFixed(2)}`);
check('einebnen Infinity wird ignoriert', k7 === FREIFLAECHE_VORGABE, `${k7}`);
const ohnePunkt = freiflaechenAusPlatzierungen({
  placements: [
    { prefab: 'x', x: Number.NaN, z: 0 },
    { prefab: 'x', x: 0, z: Number.POSITIVE_INFINITY },
    { prefab: 'x', x: 1, z: 1 },
  ] as never,
});
check('Platzierung mit nicht-endlicher Lage entfällt', ohnePunkt.length === 1);
check('Untergrenze der Hülle', FREIFLAECHE_MIN <= FREIFLAECHE_VORGABE);

// ── [4] Kosten ───────────────────────────────────────────────────────
console.log('\n[4] Kosten generateZone (Median, alle Platzierungen in Zone 0/0):');
const SEED = getStableHash('KxSYuZquuw');
function median(n: number, freihalten: boolean): number {
  const placements = Array.from({ length: n }, (_, i) => ({
    prefab: i % 3 === 0 ? 'Felsblock3' : 'BirkeDicht1',
    x: (i % 50) * 1.2 - 30,
    z: Math.floor(i / 50) * 1.5 - 30,
  }));
  const layout = sanitizeWorldLayout({
    version: 1, name: 'N1-Kosten', detailSeed: 'n1', continents: [],
    regions: [{ id: 'p', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1600 }, edgeFalloff: 200, baseLevel: 0.3, vegetation: [...GRASLAND_FLORA_NAMEN] }],
    placements,
  });
  if (!layout) throw new Error('Layout verworfen');
  if (layout.placements.length !== n) throw new Error(`sanitize hat ${layout.placements.length} von ${n} behalten`);
  const geo = new RegionGeo(SEED, { worldGenVersion: 2 }, layout);
  const heightmaps = new HeightmapProvider(geo, { blendSmoothStep: true, bilinearSampling: false });
  const t: number[] = [];
  for (let i = 0; i < 30; i++) {
    // frischer ZoneManager je Lauf: eine schon erzeugte Zone wird nicht noch einmal gestreut
    const zm = new ZoneManager(geo, heightmaps, new ZDOManager(1n), SEED, { platzierungenFreihalten: freihalten });
    const gen = zm as unknown as { generateZone(z: { x: number; y: number }): boolean };
    const s = performance.now();
    gen.generateZone({ x: 0, y: 0 });
    t.push(performance.now() - s);
  }
  t.sort((a, b) => a - b);
  return t[15];
}
// Raster im Streuer (ab 24 Flächen): dasselbe Ergebnis wie die lineare Suche.
{
  const placements = Array.from({ length: 500 }, (_, i) => ({ prefab: 'Felsblock3', x: (i % 25) * 2.4 - 30, z: Math.floor(i / 25) * 3 - 30 }));
  const layout = sanitizeWorldLayout({
    version: 1, name: 'N1-Raster', detailSeed: 'n1', continents: [],
    regions: [{ id: 'p', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1600 }, edgeFalloff: 200, baseLevel: 0.3, vegetation: [...GRASLAND_FLORA_NAMEN] }],
    placements,
  })!;
  const flaechen = freiflaechenAusPlatzierungen(layout);
  const geo = new RegionGeo(SEED, { worldGenVersion: 2 }, layout);
  const hm = new HeightmapProvider(geo, { blendSmoothStep: true, bilinearSampling: false });
  const zaehle = (freihalten: boolean): { gesamt: number; drin: number } => {
    const zdos = new ZDOManager(1n);
    const zm = new ZoneManager(geo, hm, zdos, SEED, { platzierungenFreihalten: freihalten });
    (zm as unknown as { generateZone(z: { x: number; y: number }): boolean }).generateZone({ x: 0, y: 0 });
    let gesamt = 0;
    let drin = 0;
    for (const z of zdos.getZDOsInZone({ x: 0, y: 0 })) {
      gesamt++;
      if (flaechen.some((a) => Math.hypot(z.position.x - a.center.x, z.position.z - a.center.z) <= a.radius)) drin++;
    }
    return { gesamt, drin };
  };
  const ohne = zaehle(false);
  const mit = zaehle(true);
  check('500 Felsblöcke in einer Zone: ohne Option stehen Pflanzen darin', ohne.drin > 0, `${ohne.drin} von ${ohne.gesamt}`);
  check('mit Option (Raster): keine Pflanze in einer Fläche, Rest bleibt', mit.drin === 0 && mit.gesamt > 0 && mit.gesamt < ohne.gesamt, `${mit.drin} von ${mit.gesamt}`);
}
median(50, false);
for (const n of [500, 2000]) {
  const a = median(n, false);
  const b = median(n, true);
  console.log(`      ${n} Platzierungen: alt ${a.toFixed(2)} ms, neu ${b.toFixed(2)} ms (${((b / a - 1) * 100).toFixed(1)} %)`);
}

if (failures > 0) {
  console.error(`\n${failures} FAILED`);
  process.exit(1);
}
console.log('\nAll bewuchs-freiraum-huellen checks passed.');
