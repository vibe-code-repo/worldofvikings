/**
 * Bodenmischung (shared/src/worldgen/bodenMischung.ts) gegen eine
 * UNABHÄNGIGE Nachrechnung der Shaderformel.
 *
 * Unabhängig heißt: Die Nachrechnung hier benutzt für Rampen, Rauschmaske und
 * Regelwerte eigene Literale (15/30/40/50 Grad, 0,4/0,1, Rauschen 24 m · 1,45 ·
 * zwei Glättungen · 1,04132, Sand 2,5/3/0,8, Schnee 80/20/0,9 und 0,4/0,65,
 * Lava 0,9) und faltet die Schichten anders als der Code (Endgewicht je
 * Schicht = k · Produkt der späteren (1−k)). Dreht jemand an einer Rampen-
 * konstante, aus der auch der Shader gebaut wird, weicht die Mischung ab und
 * der Test wird rot. Ein zweiter Teil prüft am Quelltext des Shaders, dass er
 * diese Konstanten tatsächlich benutzt und keine eigenen Zahlen mitführt.
 *
 * Lauf: npx tsx shared/test/boden-mischung.ts   (aus dem Repo-Wurzel)
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GeoManager } from '../src/worldgen/GeoManager.js';
import { HeightmapProvider, WATER_LEVEL, ZONE_UNITS } from '../src/worldgen/Heightmap.js';
import {
  BODENARTEN,
  bodenMischungBei,
  ueberwiegendeBodenart,
  type Bodenart,
  type BodenQuelle,
  type BodenZone,
} from '../src/worldgen/bodenMischung.js';
import { TILE, BIOME_TILE, HANG_TILE, FELS_TILE, RAU_TILE } from '../src/worldgen/bodenKacheln.js';
import { getStableHash } from '../src/hash.js';
import { Biome } from '../src/types.js';

let fehler = 0;
function pruefe(name: string, an: boolean, detail = ''): void {
  if (an) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    fehler += 1;
  }
}

// ── Unabhängige Nachrechnung ─────────────────────────────────────────
const cl = (t: number): number => Math.min(1, Math.max(0, t));
const gl = (t: number): number => {
  const u = cl(t);
  return u * u * (3 - 2 * u);
};
const ny = (deg: number): number => Math.cos((deg * Math.PI) / 180);
const frac = (v: number): number => v - Math.floor(v);

function hash(px: number, py: number): number {
  let qx = frac(px * 123.34);
  let qy = frac(py * 456.21);
  const d = qx * (qx + 45.32) + qy * (qy + 45.32);
  qx += d;
  qy += d;
  return frac(qx * qy);
}
function wert(px: number, py: number): number {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = gl(frac(px));
  const fy = gl(frac(py));
  const o1 = hash(ix, iy) * (1 - fx) + hash(ix + 1, iy) * fx;
  const o2 = hash(ix, iy + 1) * (1 - fx) + hash(ix + 1, iy + 1) * fx;
  return o1 * (1 - fy) + o2 * fy;
}
function maske(x: number, z: number): number {
  let n = wert(x / 24, z / 24) * 0.65 + wert((x / 24) * 2.7, (z / 24) * 2.7) * 0.35;
  n = gl(gl(n));
  return Math.max(0, 1 + 1.45 * (n * 2 - 1)) / 1.04132;
}

// Kachel → Art, unabhängig hingeschrieben (Namen des TILE-Enums).
const ART: Record<number, Bodenart> = {
  0: 'gras', 1: 'gras', 2: 'erde', 3: 'erde', 4: 'fels', 5: 'fels', 6: 'fels', 7: 'erde',
  8: 'gras', 9: 'sand', 10: 'erde', 11: 'gras', 12: 'pflaster', 13: 'erde', 14: 'fels', 15: 'fels',
};

function nachrechnen(x: number, z: number, q: BodenQuelle): Record<Bodenart, number> {
  const zone = q.getZoneAt(x, z);
  const h = q.getGroundHeight(x, z);
  const nx = (q.getGroundHeight(x - 1, z) - q.getGroundHeight(x + 1, z)) / 2;
  const nz = (q.getGroundHeight(x, z - 1) - q.getGroundHeight(x, z + 1)) / 2;
  const n = 1 / Math.sqrt(nx * nx + 1 + nz * nz);

  const rx = x - (zone.zoneX * 64 - 32);
  const rz = z - (zone.zoneY * 64 - 32);
  const tx = gl(rx / 64);
  const ty = gl(rz / 64);
  const w = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
  const kach = zone.cornerBiomes.map((b) => BIOME_TILE[b] ?? 4);
  let dom = 0;
  for (let i = 1; i < 4; i++) if (w[i] >= w[dom]) dom = i;
  const biom = zone.getBiome(x, z);
  const m = maske(x, z);

  const schichten: Array<{ art: Bodenart; k: number }> = [];
  schichten.push({ art: 'sand', k: cl((WATER_LEVEL + 2.5 - h) / 3) * 0.8 });
  schichten.push({ art: ART[HANG_TILE[kach[dom]]], k: cl((ny(15) - n) / (ny(15) - ny(30))) });
  schichten.push({
    art: ART[FELS_TILE[BIOME_TILE[biom] ?? 4]],
    k: cl((ny(30) - n) / (ny(30) - ny(40))) * 0.4 * m,
  });
  schichten.push({ art: ART[RAU_TILE[kach[dom]]], k: cl((ny(40) - n) / (ny(40) - ny(50))) * 0.1 * m });
  const schnee =
    biom === Biome.Mountain && h > 80 ? Math.min(1, (h - 80) / 20) : biom === Biome.DeepNorth ? 0.9 : 0;
  const s = gl((n - 0.4) / (0.65 - 0.4));
  schichten.push({ art: 'schnee', k: schnee * s });
  schichten.push({ art: 'fels', k: (biom === Biome.AshLands ? cl(zone.getVegetationMask(x, z)) : 0) * 0.9 });

  const out: Record<Bodenart, number> = { gras: 0, erde: 0, sand: 0, fels: 0, schnee: 0, pflaster: 0 };
  // Grundschicht: Produkt aller (1−k); Schicht i: k_i mal Produkt der späteren (1−k).
  const rest = schichten.reduce((p, l) => p * (1 - l.k), 1);
  for (let i = 0; i < 4; i++) out[ART[kach[i]]] += w[i] * rest;
  schichten.forEach((l, i) => {
    let f = l.k;
    for (let j = i + 1; j < schichten.length; j++) f *= 1 - schichten[j].k;
    out[l.art] += f;
  });
  return out;
}

// ── Echte Welt: >= 200 Punkte ────────────────────────────────────────
console.log('=== Bodenmischung gegen unabhängige Nachrechnung ===');
const geo = new GeoManager(getStableHash('KxSYuZquuw'), {});
const welt = new HeightmapProvider(geo, { blendSmoothStep: true, bilinearSampling: false }, 2048);
const quelle: BodenQuelle = welt;

const punkte: Array<[number, number]> = [];
for (let gx = -6000; gx <= 6000; gx += 480) {
  for (let gz = -9000; gz <= 3000; gz += 480) punkte.push([gx + ((gz / 480) % 7) * 13.7, gz + ((gx / 480) % 5) * 9.3]);
}
let maxAbw = 0;
let summeAbw = 0;
const dom: Record<string, number> = {};
const bioms = new Set<number>();
let steil = 0;
let uferPunkte = 0;
for (const [x, z] of punkte) {
  const a = bodenMischungBei(x, z, quelle);
  const b = nachrechnen(x, z, quelle);
  for (const art of BODENARTEN) maxAbw = Math.max(maxAbw, Math.abs(a[art] - b[art]));
  summeAbw += BODENARTEN.reduce((s, art) => s + a[art], 0);
  const d = ueberwiegendeBodenart(a);
  dom[d] = (dom[d] ?? 0) + 1;
  bioms.add(quelle.getZoneAt(x, z).getBiome(x, z));
  const nn = 1 / Math.sqrt(1 + ((quelle.getGroundHeight(x - 1, z) - quelle.getGroundHeight(x + 1, z)) / 2) ** 2 + ((quelle.getGroundHeight(x, z - 1) - quelle.getGroundHeight(x, z + 1)) / 2) ** 2);
  if (nn < ny(15)) steil++;
  const h = quelle.getGroundHeight(x, z);
  if (h > WATER_LEVEL - 3 && h < WATER_LEVEL + 3) uferPunkte++;
}
console.log(`  Punkte ${punkte.length}, Biome ${[...bioms].join(',')}, überwiegend ${JSON.stringify(dom)}, Hang>15° ${steil}, Ufer ${uferPunkte}`);
pruefe('mindestens 200 Punkte', punkte.length >= 200, String(punkte.length));
pruefe('mindestens 3 verschiedene Biome getroffen', bioms.size >= 3, [...bioms].join(','));
pruefe('mindestens 20 Hangpunkte (>15°) und 5 Ufer-Punkte', steil >= 20 && uferPunkte >= 5, `${steil} / ${uferPunkte}`);
pruefe('mindestens 3 Bodenarten überwiegen irgendwo', Object.keys(dom).length >= 3, Object.keys(dom).join(','));
pruefe(`größte Abweichung je Anteil <= 1e-6`, maxAbw <= 1e-6, maxAbw.toExponential(3));
pruefe('Summe der Anteile = 1 an jedem Punkt', Math.abs(summeAbw / punkte.length - 1) < 1e-9, (summeAbw / punkte.length).toString());

// ── Synthetische Hänge: jede Schicht wird erreicht ───────────────────
function ebene(biom: Biome, hoehe: (x: number, z: number) => number, veg = 0): BodenQuelle {
  const zone: BodenZone = {
    zoneX: 0,
    zoneY: 0,
    cornerBiomes: [biom, biom, biom, biom],
    getBiome: () => biom,
    getVegetationMask: () => veg,
  };
  return { getGroundHeight: hoehe, getZoneAt: () => zone };
}
function hangQuelle(biom: Biome, grad: number, basis = 60): BodenQuelle {
  const steigung = Math.tan((grad * Math.PI) / 180);
  return ebene(biom, (x) => basis + steigung * x);
}

console.log('\n[2] Synthetische Hänge (Wiese/Gebirge/Sumpf):');
{
  const flach = bodenMischungBei(5, 5, hangQuelle(Biome.Meadows, 0));
  pruefe('flache Wiese: 100 % Gras', Math.abs(flach.gras - 1) < 1e-12, JSON.stringify(flach));
  let besteFelsPunkt: [number, number] | null = null;
  let besterFels = -1;
  const q = hangQuelle(Biome.Meadows, 55);
  for (let x = -30; x <= 30; x += 0.5) {
    for (let z = -30; z <= 30; z += 0.5) {
      const f = bodenMischungBei(x, z, q).fels;
      if (f > besterFels) {
        besterFels = f;
        besteFelsPunkt = [x, z];
      }
    }
  }
  pruefe('55°-Hang auf der Wiese hat Stellen mit deutlichem Felsanteil', besterFels > 0.3, besterFels.toFixed(3));
  pruefe('… und Stellen, an denen Fels überwiegt', besteFelsPunkt !== null &&
    ueberwiegendeBodenart(bodenMischungBei(besteFelsPunkt[0], besteFelsPunkt[1], q)) === 'fels', JSON.stringify(besteFelsPunkt));
  const gebirge = bodenMischungBei(5, 5, ebene(Biome.Mountain, () => 120));
  pruefe('Gebirge über der Schneelinie, flach: Schnee überwiegt', ueberwiegendeBodenart(gebirge) === 'schnee', JSON.stringify(gebirge));
  const ufer = bodenMischungBei(5, 5, ebene(Biome.Meadows, () => WATER_LEVEL + 0.2));
  pruefe('Wiese am Ufer (0,2 m über Wasser): Sand ist beteiligt', ufer.sand > 0.5, ufer.sand.toFixed(3));
  const unter = bodenMischungBei(5, 5, ebene(Biome.Meadows, () => WATER_LEVEL - 5));
  pruefe('unter Wasser: Sand überwiegt', ueberwiegendeBodenart(unter) === 'sand');
  const lava = bodenMischungBei(5, 5, ebene(Biome.AshLands, () => 50, 1));
  pruefe('Aschelande mit voller Lavamaske: Stein überwiegt', ueberwiegendeBodenart(lava) === 'fels', JSON.stringify(lava));
}

// ── Der Shader benutzt die Konstanten, nicht eigene Zahlen ───────────
console.log('\n[3] Quelltext des Shaders:');
{
  const wurzel = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const splat = readFileSync(resolve(wurzel, 'client/src/engine/TerrainSplat.ts'), 'utf-8');
  const soll = [
    'nyBeiGrad(RAMPEN.hang.beginn)', 'nyBeiGrad(RAMPEN.hang.voll)',
    'nyBeiGrad(RAMPEN.fels.beginn)', 'nyBeiGrad(RAMPEN.fels.voll)',
    'nyBeiGrad(RAMPEN.rau.beginn)', 'nyBeiGrad(RAMPEN.rau.voll)',
    'RAMPEN.fels.anteil', 'RAMPEN.rau.anteil', 'felsRauschenGlsl()',
    'BODEN_REGELN.sandUeberWasser', 'BODEN_REGELN.sandSpanne', 'BODEN_REGELN.sandAnteil',
    'BODEN_REGELN.schneeNyKante0', 'BODEN_REGELN.schneeNyKante1', 'BODEN_REGELN.lavaAnteil',
    "glslTabelle('VB_HANG', HANG_TILE)", "glslTabelle('VB_RAU', RAU_TILE)",
  ];
  for (const s of soll) pruefe(`Shader nutzt ${s}`, splat.includes(s));
  pruefe('TerrainSplat importiert Tabellen und Regeln aus dem shared-Paket',
    splat.includes("from '@wov/shared/src/worldgen/bodenKacheln.js'"));
  pruefe('Kachel-Enum TILE ist unverändert (Gras 0 … LavaCrust 15)', TILE.Grass === 0 && TILE.LavaCrust === 15 && Object.keys(TILE).length === 16);
  pruefe('ZONE_UNITS ist 64 (die Nachrechnung setzt 64/32 als Literal)', ZONE_UNITS === 64);
}

if (fehler > 0) {
  console.error(`\n${fehler} FEHLER`);
  process.exit(1);
}
console.log('\nALLE GRÜN');
