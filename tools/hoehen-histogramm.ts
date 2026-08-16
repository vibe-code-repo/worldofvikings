/**
 * E9 — wie viel Land liegt in welchem Höhenband?
 *
 * Mehrere Clutter-Einträge in `GrassClutter.ts` sind über `minAlt`/`maxAlt`
 * an ein Höhenfenster über der Wasserlinie gebunden. Ob ein Eintrag damit
 * „praktisch nie" erscheint, hängt nicht an der Tabelle allein, sondern
 * daran, wie die WELT aussieht — und das ist nachrechenbar.
 *
 * Der Lauf tastet die echte Dev-Welt in einem groben Raster ab und zählt,
 * welcher Anteil der Landfläche in welchem Band liegt.
 *
 * Lauf: npx tsx mess/hoehen-histogramm.ts
 */
import { readFileSync } from 'node:fs';
import { RegionGeo, getStableHash, sanitizeWorldLayout } from '@wov/shared';

const datei = process.argv[2] ?? 'server/data/welten/dev.json';
const roh = JSON.parse(readFileSync(datei, 'utf8'));
const layout = sanitizeWorldLayout(roh);
if (!layout) throw new Error(`${datei} wurde verworfen`);

const geo = new RegionGeo(getStableHash('dev'), { worldGenVersion: 2 }, layout);

// Rasterweite: 8 m. Feiner bringt für eine Flächenstatistik nichts und
// kostet quadratisch.
const SCHRITT = 8;

// Ausdehnung aus den Regionen bestimmen, statt sie zu raten.
let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
for (const r of layout.regions) {
  const s = r.shape as { kind: string; x?: number; z?: number; radius?: number; points?: Array<{ x: number; z: number }> };
  const punkte = s.kind === 'circle'
    ? [{ x: (s.x ?? 0) - (s.radius ?? 0), z: (s.z ?? 0) - (s.radius ?? 0) }, { x: (s.x ?? 0) + (s.radius ?? 0), z: (s.z ?? 0) + (s.radius ?? 0) }]
    : (s.points ?? []);
  for (const p of punkte) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
}
console.log(`Welt ${datei}: ${layout.regions.length} Regionen, Ausdehnung ${Math.round(maxX - minX)} × ${Math.round(maxZ - minZ)} m`);

const baender: Array<[string, number, number]> = [
  ['unter Wasser', -1e9, 0],
  ['0 – 4 m', 0, 4],
  ['4 – 10 m', 4, 10],
  ['10 – 30 m', 10, 30],
  ['30 – 60 m', 30, 60],
  ['60 – 120 m', 60, 120],
  ['über 120 m', 120, 1e9],
];
const treffer = new Array(baender.length).fill(0);
let proben = 0;
let land = 0;

for (let z = minZ; z <= maxZ; z += SCHRITT) {
  for (let x = minX; x <= maxX; x += SCHRITT) {
    const h = geo.getHeight(x, z);
    proben++;
    if (h > 0) land++;
    for (let i = 0; i < baender.length; i++) {
      const [, u, o] = baender[i]!;
      if (h > u && h <= o) { treffer[i]++; break; }
    }
  }
}

const flaecheProProbe = (SCHRITT * SCHRITT) / 1e6; // km²
console.log(`\nProben: ${proben}  davon Land: ${land}  (${((100 * land) / proben).toFixed(1)} %)`);
console.log(`Landfläche: ${(land * flaecheProProbe).toFixed(2)} km²\n`);
console.log('Band            Anteil an Land   Fläche');
for (let i = 0; i < baender.length; i++) {
  const [name] = baender[i]!;
  if (name === 'unter Wasser') continue;
  const anteil = (100 * treffer[i]) / land;
  console.log(
    `  ${name.padEnd(14)} ${anteil.toFixed(2).padStart(6)} %   ${(treffer[i] * flaecheProProbe).toFixed(3)} km²`
  );
}
