/**
 * area_describe: drei feste Punkte mit erwarteten Werten auf einer
 * Attrappen-Geo (schiefe Ebene h = 40 + 0,5·x, Biom nach dem Vorzeichen von x).
 *
 * Lauf: npx tsx shared/test/weltbau-beschreiben.ts   (aus shared/)
 */
import type { WorldLayout } from '../src/worldlayout/types.js';
import { Biome } from '../src/types.js';
import { BereichFehler } from '../src/weltbau/pruefungen.js';
import { beschreibeOrt, type GeoLese } from '../src/weltbau/beschreiben.js';
import type { Huelle } from '../src/weltbau/huelle.js';

let fehler = 0;
function pruefe(name: string, bedingung: boolean, detail = ''): void {
  if (!bedingung) fehler++;
  console.log(`${bedingung ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const nah = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;

const geo: GeoLese = {
  getHeight: (x) => 40 + 0.5 * x,
  getBiome: (x) => (x < -50 ? Biome.Meadows : x > 50 ? Biome.Mountain : Biome.Swamp),
  getForestFactor: () => 0.3,
  regionAt: (x) => (x < 0 ? { id: 'west', biome: 'grassland', tier: 2, bewuchsDichte: 1.5 } : null),
};
const huelle = (fest: boolean): Huelle => ({ fest, mitteX: 0, mitteZ: 0, halbX: 1, halbZ: 1, minY: 0, maxY: 1, gebaeude: false, quelle: 'extern' });
const layout = {
  version: 1,
  name: 'b',
  detailSeed: 's',
  continents: [],
  regions: [],
  placements: [
    { id: 'k1', prefab: 'A_Fest', x: 2, z: 1 },
    { id: 'k2', prefab: 'B_Offen', x: 8, z: 0 },
    { id: 'k3', prefab: 'A_Fest', x: 11, z: 0 },
    { id: 'k4', prefab: 'A_Fest', x: 100, z: 3 },
  ],
  routes: [{ id: 'weg', points: [[0, 20], [0, 50]], mode: 'pingpong' }],
} as unknown as WorldLayout;
const aufloeser = (n: string): Huelle | null => (n === 'A_Fest' ? huelle(true) : n === 'B_Offen' ? huelle(false) : null);

// Punkt A: (0, 0), r = 10 — Ebene, Übergangsbiom
const a = beschreibeOrt(layout, geo, 0, 0, 10, aufloeser);
pruefe('A: mittlere Höhe 40 (Ebene, symmetrisch)', nah(a.hoehe.mittel, 40, 0.01), `${a.hoehe.mittel}`);
pruefe('A: Höhe min 35 / max 45', a.hoehe.min === 35 && a.hoehe.max === 45, `${a.hoehe.min}/${a.hoehe.max}`);
pruefe('A: größter Hang = atan(0,5) = 26,57°', nah(a.hangMaxGrad, 26.57, 0.01), `${a.hangMaxGrad}`);
pruefe('A: kein Wasser', a.wasserAnteil === 0);
pruefe('A: nur Biom Swamp (100 %)', Object.keys(a.biome).join() === 'Swamp' && a.biome.Swamp === 1);
pruefe('A: Waldfaktor 0,3', a.wald === 0.3);
pruefe('A: Region an der Mitte (x = 0) = keine → null', a.region === null);
pruefe('A: 2 Objekte im Radius (k1 bei 2,2 und k2 bei 8; k3 bei 11 nicht)', a.objekte.anzahl === 2 && a.objekte.naechste.map((o) => o.id).join() === 'k1,k2', a.objekte.naechste.map((o) => `${o.id}:${o.abstand}`).join());
pruefe('A: fest-Kennzeichen k1 fest, k2 nicht', a.objekte.naechste[0].fest === true && a.objekte.naechste[1].fest === false);
pruefe('A: nächste Route weg bei Abstand 20 am Punkt (0, 20)', a.naechsteRoute?.id === 'weg' && a.naechsteRoute.abstand === 20 && a.naechsteRoute.punkt.z === 20);
pruefe('A: Zone (0, 0) mit 3 Platzierungen', a.zone.x === 0 && a.zone.z === 0 && a.zone.objekte === 3);

// Punkt B: (100, 0), r = 10 — Berg, Höhe 90
const b = beschreibeOrt(layout, geo, 100, 0, 10, aufloeser);
pruefe('B: mittlere Höhe 90, min 85, max 95', nah(b.hoehe.mittel, 90, 0.01) && b.hoehe.min === 85 && b.hoehe.max === 95, JSON.stringify(b.hoehe));
pruefe('B: nur Mountain', Object.keys(b.biome).join() === 'Mountain');
pruefe('B: 1 Objekt (k4 bei Abstand 3)', b.objekte.anzahl === 1 && b.objekte.naechste[0].id === 'k4' && b.objekte.naechste[0].abstand === 3);
pruefe('B: Zone (1, 0) mit 1 Platzierung', b.zone.x === 1 && b.zone.objekte === 1);

// Punkt C: (−100, 0), r = 10 — unter Wasser (Höhe −10), Region west
const c = beschreibeOrt(layout, geo, -100, 0, 10, aufloeser);
pruefe('C: mittlere Höhe −10, Wasseranteil 100 %', nah(c.hoehe.mittel, -10, 0.01) && c.wasserAnteil === 1, `${c.hoehe.mittel} / ${c.wasserAnteil}`);
pruefe('C: nur Meadows, Region west mit Regler', Object.keys(c.biome).join() === 'Meadows' && c.region?.id === 'west' && c.region.tier === 2 && c.region.bewuchsDichte === 1.5);
pruefe('C: keine Objekte', c.objekte.anzahl === 0 && c.objekte.naechste.length === 0);
pruefe('C: Zone (−2, 0) leer', c.zone.x === -2 && c.zone.objekte === 0);

// Grenzen und Fehler
let f1 = '';
try {
  beschreibeOrt(layout, geo, 0, 0, 257, aufloeser);
} catch (f) {
  f1 = f instanceof BereichFehler ? f.message : 'falscher Fehlertyp';
}
pruefe('Radius 257 abgelehnt', f1.includes('257') && f1.includes('256'), f1);
let f2 = '';
try {
  beschreibeOrt(layout, geo, 0, Number.NaN, 10, aufloeser);
} catch (f) {
  f2 = f instanceof BereichFehler ? f.message : 'falscher Fehlertyp';
}
pruefe('NaN abgelehnt', f2.startsWith('area_describe'), f2);
const gross = beschreibeOrt(layout, geo, 0, 0, 256, aufloeser);
pruefe('Radius 256: höchstens 4096 Proben', gross.proben <= 4096 && gross.proben > 3000, `${gross.proben}`);
pruefe('Determinismus', JSON.stringify(beschreibeOrt(layout, geo, 0, 0, 10, aufloeser)) === JSON.stringify(a));
const viele = { ...layout, placements: Array.from({ length: 80 }, (_, i) => ({ id: `p${i}`, prefab: 'A_Fest', x: i * 0.1, z: 0 })) } as unknown as WorldLayout;
const v = beschreibeOrt(viele, geo, 0, 0, 20, aufloeser);
pruefe('mehr als 50 Objekte: Zahl 80, Liste 50', v.objekte.anzahl === 80 && v.objekte.naechste.length === 50);

console.log(`\n${fehler === 0 ? 'ALLE GRUEN' : `${fehler} FEHLGESCHLAGEN`}`);
process.exit(fehler > 0 ? 1 : 0);
