/**
 * K5.5a N1/N2 — radius of the clear areas: real hulls, circle, clamps, cost.
 * Radius der Freiflächen: echte Hüllen, Kreis, Klemmen, Kosten.
 *
 *  1. Hülle aus der gemeinsamen Hilfe (`huellenAufloeser`): Store-Modell,
 *     Upload (Registry), eigenes Modell über `renderScale`; nichts davon
 *     ist ein Rückfall (1,5 m).
 *  2. Kreis statt Quadrat (`kreis`), Skala geht ein.
 *  3. Die Funktion klemmt selbst: nicht-endlich, sehr groß, sehr klein.
 *  4. Kosten von `generateZone` bei 500 und 2000 Platzierungen in einer Zone,
 *     gemessen an einer Verteilung, bei der noch gestreut wird (Funde > 0).
 *  5. N2: Manifest-Hülle statt Platzhalterbox; Radius = halbe längste Kante
 *     plus Versatz der Mitte (nicht die Diagonale); Server = Vorschau-Quelle.
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
  freiflaechenPruefer,
  platzierungenBereinigt,
  type ClearArea,
  sanitizeWorldLayout,
} from '@wov/shared';
import { readFileSync } from 'node:fs';
import { leseManifest } from '@wov/shared/src/weltbau/manifest.js';
import { ASSET_WURZEL } from '../src/world/KollisionsFormen.js';
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
const erwStore = Math.max(sh.halbX, sh.halbZ) + Math.hypot(sh.mitteX, sh.mitteZ);
const [rStore, rStore2] = radien([
  { prefab: storeName, x: 0, z: 0 },
  { prefab: storeName, x: 0, z: 0, scale: 2 },
]);
check('Store-Modell: Radius aus der Hülle', nahe(rStore, Math.min(FREIFLAECHE_MAX, erwStore)) && rStore > FREIFLAECHE_VORGABE, `${storeName} ${rStore.toFixed(2)} m`);
check('Skala geht ein', nahe(rStore2, Math.min(FREIFLAECHE_MAX, erwStore * 2)), `${rStore2.toFixed(2)} m`);

const fels = PREFABS_BY_NAME.get('Felsblock3')!;
const [rFels] = radien([{ prefab: 'Felsblock3', x: 0, z: 0 }]);
check('eigenes Modell ohne Manifest: renderScale, halbe Kante', nahe(rFels, fels.renderScale.w / 2) && rFels > FREIFLAECHE_VORGABE, `Felsblock3 w=${fels.renderScale.w} → ${rFels.toFixed(2)} m`);

registerUploadedPrefab({
  name: 'U_Steg_N1', anzeigename: 'Steg', bytes: 1, dreiecke: 1, meshes: 1, materialien: 1, bilder: 0,
  fehlendeTexturen: false, breite: 2.8, hoehe: 1, tiefe: 14, kollisionsart: 'fest',
  hatKollisionsnetz: false, kollisionsnetzAbgelehnt: false, hochgeladenVon: 'test', zeitpunkt: '2026-09-24T00:00:00Z',
});
const [rUp] = radien([{ prefab: 'U_Steg_N1', x: 0, z: 0 }]);
check('Upload: halbe längste Kante der Registry', nahe(rUp, 7), `${rUp.toFixed(2)} m`);
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
function median(n: number, freihalten: boolean): { ms: number; funde: number } {
  // Kleine Objekte (Radius = Untergrenze), Lage zufällig (feste Folge): ein Teil der
  // Zone bleibt frei, es wird also noch gestreut — sonst misst der Test eine leere Zone.
  let zufall = 12345;
  const zuf = (): number => (zufall = (zufall * 1103515245 + 12345) % 2147483648) / 2147483648;
  const placements = Array.from({ length: n }, () => ({
    prefab: 'GrabRunenstein',
    x: (zuf() - 0.5) * 64,
    z: (zuf() - 0.5) * 64,
  }));
  const layout = sanitizeWorldLayout({
    version: 1, name: 'N1-Kosten', detailSeed: 'n1', continents: [],
    regions: [{ id: 'p', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1600 }, edgeFalloff: 200, baseLevel: 0.3, vegetation: [...GRASLAND_FLORA_NAMEN] }],
    placements,
  });
  if (!layout) throw new Error('Layout verworfen');
  if (layout.placements.length < n * 0.99) throw new Error(`sanitize hat ${layout.placements.length} von ${n} behalten`);
  const geo = new RegionGeo(SEED, { worldGenVersion: 2 }, layout);
  const heightmaps = new HeightmapProvider(geo, { blendSmoothStep: true, bilinearSampling: false });
  const t: number[] = [];
  let funde = 0;
  for (let i = 0; i < 30; i++) {
    // frischer ZoneManager je Lauf: eine schon erzeugte Zone wird nicht noch einmal gestreut
    const zdos = new ZDOManager(1n);
    const zm = new ZoneManager(geo, heightmaps, zdos, SEED, { platzierungenFreihalten: freihalten });
    const gen = zm as unknown as { generateZone(z: { x: number; y: number }): boolean };
    const s = performance.now();
    gen.generateZone({ x: 0, y: 0 });
    t.push(performance.now() - s);
    funde = [...zdos.getZDOsInZone({ x: 0, y: 0 })].length;
  }
  t.sort((a, b) => a - b);
  return { ms: t[15], funde };
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
  check(`${n} kleine Platzierungen: es wird noch gestreut (Funde > 0)`, b.funde > 0 && b.funde < a.funde, `${b.funde} von ${a.funde} Objekten in der Zone`);
  console.log(`      ${n} Platzierungen: alt ${a.ms.toFixed(2)} ms (${a.funde} Objekte), neu ${b.ms.toFixed(2)} ms (${b.funde} Objekte), ${((b.ms / a.ms - 1) * 100).toFixed(1)} %`);
}

// ── [5] N2: Manifest-Hülle ───────────────────────────────────────────
console.log('\n[5] Manifest-Hülle statt Platzhalterbox:');
const manifest = leseManifest(readFileSync(`${ASSET_WURZEL}/manifest.json`, 'utf-8'));
const mh = freiflaechenHuellen(manifest);
const rM = (prefab: string, extra: Record<string, unknown> = {}): number =>
  freiflaechenAusPlatzierungen({ placements: [{ prefab, x: 0, z: 0, ...extra }] as never }, mh)[0].radius;
// Grabhügel: halbe längste Kante 21,297 + Versatz der Mitte 1,459 = 22,756 (statt Diagonale der Box w x w = 30,12)
const rGrab = rM('Grabhuegel');
check('Grabhügel: Radius aus der Manifest-Hülle, nicht 30,12', Math.abs(rGrab - 22.756) < 0.01 && rGrab < 30, `${rGrab.toFixed(3)} m (renderScale.w=${PREFABS_BY_NAME.get('Grabhuegel')!.renderScale.w})`);
const rKiefer = rM('Kiefer4');
const kh = mh('Kiefer4')!;
check('Kiefer4: halbe längste Kante + Versatz', nahe(rKiefer, Math.max(kh.halbX, kh.halbZ) + Math.hypot(kh.mitteX, kh.mitteZ)) && rKiefer < 16.76, `${rKiefer.toFixed(2)} m (vorher 16,76)`);
const rEiche = rM('Eiche2');
check('Eiche2: unter dem alten Radius 6,29', rEiche < 6.29 && rEiche > 4.5, `${rEiche.toFixed(2)} m`);
check('Skala geht in die Manifest-Hülle ein', Math.abs(rM('Grabhuegel', { scale: 2 }) - 2 * 22.756) < 0.02, `${rM('Grabhuegel', { scale: 2 }).toFixed(2)} m`);
check('Manifest ohne Eintrag: Rückfall renderScale (halbe Kante)', nahe(freiflaechenAusPlatzierungen({ placements: [{ prefab: 'Felsblock3', x: 0, z: 0 }] as never }, freiflaechenHuellen(new Map()))[0].radius, fels.renderScale.w / 2));
check('Server-Weg = Vorschau-Weg: ZoneManager rechnet mit derselben Quelle', (() => {
  const layout = sanitizeWorldLayout({
    version: 1, name: 'N2', detailSeed: 'n2', continents: [],
    regions: [{ id: 'p', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1600 }, edgeFalloff: 200, baseLevel: 0.3, vegetation: [...GRASLAND_FLORA_NAMEN] }],
    placements: [{ prefab: 'Grabhuegel', x: 0, z: 0 }],
  })!;
  const geo = new RegionGeo(SEED, { worldGenVersion: 2 }, layout);
  const hm = new HeightmapProvider(geo, { blendSmoothStep: true, bilinearSampling: false });
  const zm = new ZoneManager(geo, hm, new ZDOManager(1n), SEED, { platzierungenFreihalten: true });
  const flaechen = (zm as unknown as { platzierungsFreiflaechen: Array<{ radius: number }> }).platzierungsFreiflaechen;
  return flaechen.length === 1 && Math.abs(flaechen[0].radius - 22.756) < 0.01;
})(), 'Standard: assets/manifest.json von der Platte');
check('platzierungenBereinigt klemmt wie der Server', (() => {
  const r = platzierungenBereinigt([{ prefab: 'Grabhuegel', x: 0, z: 0, einebnen: -3, scale: 10 }, { prefab: 'Grabhuegel', x: 9, z: 0, einebnen: 0, scale: '2' }]);
  return r.length === 2 && r[0].scale === 5 && r[0].einebnen === 1 && r[1].einebnen === 1 && r[1].scale === 2;
})());

// ── [6] N2 F6: Raster und lineare Suche behandeln ungültige Radien gleich ──
console.log('\n[6] freiflaechenPruefer: ungültige Radien in beiden Wegen verwerfen:');
{
  const punkt = { x: 3, y: 0, z: 0 };
  const gut = (i: number): ClearArea => ({ center: { x: 500 + i * 40, y: 0, z: 500 }, radius: 5, kreis: true });
  const viele = (extra: ClearArea): ClearArea[] => [extra, ...Array.from({ length: 30 }, (_, i) => gut(i))]; // Raster (>= 24)
  const wenige = (extra: ClearArea): ClearArea[] => [extra, gut(0)]; // lineare Suche
  const faelle: Array<[string, ClearArea]> = [
    ['Infinity', { center: { x: 0, y: 0, z: 0 }, radius: Number.POSITIVE_INFINITY, kreis: true }],
    ['NaN', { center: { x: 0, y: 0, z: 0 }, radius: Number.NaN, kreis: true }],
    ['negativ (Kreis)', { center: { x: 0, y: 0, z: 0 }, radius: -5, kreis: true }],
    ['negativ (Quadrat)', { center: { x: 0, y: 0, z: 0 }, radius: -5 }],
    ['null', { center: { x: 0, y: 0, z: 0 }, radius: 0, kreis: true }],
    ['Mitte NaN', { center: { x: Number.NaN, y: 0, z: 0 }, radius: 5, kreis: true }],
  ];
  for (const [name, f] of faelle) {
    let raster: boolean | string;
    try { raster = freiflaechenPruefer(viele(f))(punkt); } catch (e) { raster = (e as Error).message; }
    const linear = freiflaechenPruefer(wenige(f))(punkt);
    check(`${name}: Raster = linear = verworfen`, raster === false && linear === false, `Raster ${String(raster)}, linear ${String(linear)}`);
  }
  const ok: ClearArea = { center: { x: 0, y: 0, z: 0 }, radius: 5, kreis: true };
  check('gültige Fläche trifft weiter (beide Wege)', freiflaechenPruefer(viele(ok))(punkt) && freiflaechenPruefer(wenige(ok))(punkt));
}

if (failures > 0) {
  console.error(`\n${failures} FAILED`);
  process.exit(1);
}
console.log('\nAll bewuchs-freiraum-huellen checks passed.');
