/**
 * Greyglen (Biom-Bit 128), Karte K3: eigener Boden.
 *
 * Fuenf Dinge werden festgehalten:
 *
 *  1. TABELLEN: Greyglen hat eine eigene Grundkachel (`GreyGrass`) und eigene
 *     Hang-, Fels- und Rau-Kachel; die Zeilen 16–19 des Texturstapels haengen an
 *     den Quellschichten Gras, Moos, Fels und Rock_Moss (mit EIGENER Normale).
 *  2. RAMPEN JE GRUNDKACHEL: Greyglen traegt `RAMPEN_JE_KACHEL`, jede andere
 *     Kachel die globale `RAMPEN`.
 *  3. FLAECHENANTEILE: Auf einem synthetischen Gelaende mit dem Hang-Histogramm
 *     eines steilen Hochland-Tals (0–8° 24,1 %, 8–15° 18,2 %, 15–22° 13,9 %,
 *     22–30° 11,7 %, 30–40° 11,4 %, 40–50° 7,9 %, ueber 50° 12,8 %; Mittel 24°)
 *     misst die CPU-Bodenmischung Gras 57 %, Fels 17 %, Moos 15 %, rauer Fels
 *     7 %, Sand 3,5 % (± 5 Prozentpunkte; die Eichung liegt unter 1).
 *  4. BITGLEICH: Alle aelteren Biome liefern dieselbe Mischung wie vor K3
 *     (Golden-Datei `shared/test/golden/boden-mischung-alte-biome.json`,
 *     erzeugt auf dem Stand vor K3).
 *  5. SHADER: Der Shader liest die Rampen aus `rampenTabelle()`.
 *
 * Das Gelaende: 36 Streifen von 40 m, jeder mit einer festen Neigung (35 Neigungen
 * aus den sieben Baendern, je 5 je Band, dazu ein ebener Uferstreifen). Gemessen
 * wird in den Streifen, mit dem echten Felsrauschen an wechselnden Orten; jede
 * Neigung traegt das Gewicht ihres Bandes.
 *
 * Der Sand haengt NICHT an der Rampe, sondern am Ufer (`BODEN_REGELN`): sein
 * Anteil ist hier durch die Breite des Uferstreifens (8,75 % der Flaeche) gesetzt.
 *
 * Lauf: npx tsx tools/test/boden-greyglen.ts   (aus dem Repo-Wurzel)
 *       npx tsx tools/test/boden-greyglen.ts --golden-schreiben   (nur auf dem Stand VOR K3!)
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as BM from '../../shared/src/worldgen/bodenMischung.js';
import type { BodenQuelle, BodenZone } from '../../shared/src/worldgen/bodenMischung.js';
import * as BK from '../../shared/src/worldgen/bodenKacheln.js';
import * as TR from '../../shared/src/worldgen/terrainRampen.js';
import { WATER_LEVEL } from '../../shared/src/worldgen/Heightmap.js';
import { Biome } from '../../shared/src/types.js';
import { SCHICHTEN, ZUORDNUNG, tabelle } from '../store-terrain-schichten.mjs';
import { SCHICHT_OBERFLAECHE } from '../../client/src/engine/TerrainSplat.js';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const GOLDEN = resolve(WURZEL, 'shared/test/golden/boden-mischung-alte-biome.json');

let fehler = 0;
function pruefe(name: string, an: boolean, detail = ''): void {
  if (an) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    fehler += 1;
  }
}

// ── Das Gelaende ─────────────────────────────────────────────────────

/** Flaechenanteile der Neigungsbaender des Referenzgelaendes und ihre Grenzen in Grad. */
const BAENDER = [
  { von: 0, bis: 8, anteil: 0.2413 },
  { von: 8, bis: 15, anteil: 0.1818 },
  { von: 15, bis: 22, anteil: 0.1388 },
  { von: 22, bis: 30, anteil: 0.1174 },
  { von: 30, bis: 40, anteil: 0.1138 },
  { von: 40, bis: 50, anteil: 0.0787 },
] as const;
const LETZTES_BAND = { von: 50, bis: 90, anteil: 0.1282, neigungen: [52, 56, 60, 66, 76] } as const;
const UFER_ANTEIL = 0.0875;
const STREIFEN = 40;

interface Streifen {
  readonly grad: number;
  readonly gewicht: number;
  readonly band: number;
  readonly ufer: boolean;
}
const streifen: Streifen[] = [];
BAENDER.forEach((b, band) => {
  for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    streifen.push({ grad: b.von + f * (b.bis - b.von), gewicht: ((1 - UFER_ANTEIL) * b.anteil) / 5, band, ufer: false });
  }
});
for (const g of LETZTES_BAND.neigungen) {
  streifen.push({ grad: g, gewicht: ((1 - UFER_ANTEIL) * LETZTES_BAND.anteil) / 5, band: 6, ufer: false });
}
streifen.push({ grad: 0, gewicht: UFER_ANTEIL, band: 0, ufer: true });

function gelaende(biom: number, grad: (x: number) => number, hoehe: (x: number) => number): BodenQuelle {
  const zone: BodenZone = {
    zoneX: 0,
    zoneY: 0,
    cornerBiomes: [biom, biom, biom, biom] as unknown as BodenZone['cornerBiomes'],
    getBiome: () => biom as Biome,
    getVegetationMask: () => 0,
  };
  return {
    getGroundHeight: (x) => hoehe(x) + Math.tan((grad(x) * Math.PI) / 180) * (x - STREIFEN * Math.floor(x / STREIFEN)),
    getZoneAt: () => zone,
  };
}

const referenz = gelaende(
  Biome.Greyglen,
  (x) => streifen[Math.floor(x / STREIFEN)]!.grad,
  (x) => (streifen[Math.floor(x / STREIFEN)]!.ufer ? WATER_LEVEL + 1 : WATER_LEVEL + 20),
);

let saat = 20260103;
const zufall = (): number => {
  saat = (Math.imul(saat, 1664525) + 1013904223) >>> 0;
  return saat / 4294967296;
};

// ── Golden: aeltere Biome bitgleich ──────────────────────────────────
const ALTE_BIOME = [1, 2, 4, 8, 16, 32, 64, 256, 512];
function alteBiomeHashes(): Record<string, string> {
  const hashes: Record<string, string> = {};
  const grade = [0, 10, 18, 24, 28, 33, 38, 42, 48, 55, 62, 75];
  const hoehen = [WATER_LEVEL - 3, WATER_LEVEL + 1, WATER_LEVEL + 20, WATER_LEVEL + 100];
  const orte: [number, number][] = [[2, 3], [17.5, 40.25], [301.7, 12.1], [555.5, 777.7], [1234.5, 321.1]];
  for (const biom of ALTE_BIOME) {
    const h = createHash('sha256');
    for (const g of grade) {
      for (const hh of hoehen) {
        for (const [ox, oz] of orte) {
          const x0 = ox + 4;
          const q = gelaende(biom, () => g, () => hh);
          // Je Ort die ganze Mischung, jede Zahl ohne Rundung.
          const a = BM.bodenMischungBei(x0, oz, q);
          h.update(JSON.stringify(BM.BODENARTEN.map((k) => a[k])));
        }
      }
    }
    hashes[String(biom)] = h.digest('hex');
  }
  return hashes;
}

/** Die Tabellen der 16 alten Kacheln und der alten Biome, wie sie vor K3 standen. */
function alteTabellen(): unknown {
  const biomTile: Record<string, number> = {};
  for (const b of ALTE_BIOME) biomTile[String(b)] = BK.BIOME_TILE[b]!;
  return {
    biomTile,
    hang: BK.HANG_TILE.slice(0, 16),
    fels: BK.FELS_TILE.slice(0, 16),
    rau: BK.RAU_TILE.slice(0, 16),
    rampen: TR.RAMPEN,
    bodenart: BM.TILE_BODENART.slice(0, 16),
    regeln: BK.BODEN_REGELN,
  };
}

if (process.argv.includes('--golden-schreiben')) {
  writeFileSync(GOLDEN, JSON.stringify({ biome: alteBiomeHashes(), tabellen: alteTabellen() }, null, 2) + '\n');
  console.log('Golden geschrieben:', GOLDEN);
  process.exit(0);
}

// ── 1. Tabellen ──────────────────────────────────────────────────────
console.log('\n[1] Tabellen:');
pruefe('TILE_ANZAHL ist 20', BK.TILE_ANZAHL === 20);
pruefe('Greyglen-Kacheln 16–19 in der Reihenfolge Gras, Moos, Fels, rauer Fels',
  BK.TILE.GreyGrass === 16 && BK.TILE.GreyMoss === 17 && BK.TILE.GreyRock === 18 && BK.TILE.GreyRockMoss === 19);
pruefe('BIOME_TILE[128] = GreyGrass', BK.BIOME_TILE[128] === BK.TILE.GreyGrass);
pruefe('Hangkachel von GreyGrass = Moos', BK.HANG_TILE[BK.TILE.GreyGrass] === BK.TILE.GreyMoss);
pruefe('Felskachel von GreyGrass = Fels', BK.FELS_TILE[BK.TILE.GreyGrass] === BK.TILE.GreyRock);
pruefe('Raukachel von GreyGrass = rauer Fels', BK.RAU_TILE[BK.TILE.GreyGrass] === BK.TILE.GreyRockMoss);
pruefe('die drei Tabellen haben 20 Zeilen',
  BK.HANG_TILE.length === 20 && BK.FELS_TILE.length === 20 && BK.RAU_TILE.length === 20);
pruefe('TILE_BODENART: 16/17 Gras, 18/19 Fels',
  BM.TILE_BODENART.length === 20 && BM.TILE_BODENART[16] === 'gras' && BM.TILE_BODENART[17] === 'gras'
    && BM.TILE_BODENART[18] === 'fels' && BM.TILE_BODENART[19] === 'fels');
{
  const zeile = (i: number) => (ZUORDNUNG as Array<{ name: string; schicht?: string; toenung?: number[] }>)[i]!;
  pruefe('Stapelzeile 16 = Gras-Schicht', zeile(16).schicht === 'grass-a', zeile(16).name);
  pruefe('Stapelzeile 17 = Moos-Schicht (moss-village)', zeile(17).schicht === 'moss-village');
  pruefe('Stapelzeile 18 = Fels-Schicht (Rockwall)', zeile(18).schicht === 'rock-a');
  pruefe('Stapelzeile 19 = rauer Fels mit eigener Normale', zeile(19).schicht === 'rock-moss-grey');
  pruefe('keine Toenung auf den neuen Zeilen', [16, 17, 18, 19].every((i) => (zeile(i).toenung ?? []).every((f) => f === 1)));
}
{
  const s = (SCHICHTEN as Record<string, { farbe: string; normale: string; normaleErsatz?: string; kachelMeter: number; normalStaerke: number; metallic: number; smoothness: number }>)['rock-moss-grey']!;
  pruefe('rauer Fels von Greyglen: Farbe Rock_Moss, eigene Normale Rock_Moss',
    s.farbe === 'terrain-rock-moss' && s.normale === 'terrain-rock-moss-normal', `${s.farbe} / ${s.normale}`);
  pruefe('… mit benanntem Ersatz fuer die Normale, solange sie nicht im Speicher liegt', s.normaleErsatz === 'terrain-rock-rough-normal');
  pruefe('… Kachel 7 m, Normalstaerke 2, Metallic 0, Glaette 0',
    s.kachelMeter === 7 && s.normalStaerke === 2 && s.metallic === 0 && s.smoothness === 0);
  const t = (tabelle(256) as { tiles: Array<{ tile: number; normale: string; normaleGewuenscht?: string }> }).tiles;
  pruefe('Tabelle: Zeile 19 nennt die gewuenschte Normale', t[19]?.normaleGewuenscht === 'terrain-rock-moss-normal');
  pruefe('der Stapel hat 20 Zeilen (Tabelle und ZUORDNUNG)',
    (tabelle(256) as { zeilen: number }).zeilen === 20 && (ZUORDNUNG as unknown[]).length === 20);
  pruefe('Tabelle: nur Zeile 19 fuehrt eine Ersatz-Normale (die anderen Zeilen unveraendert)',
    t.filter((z) => z.normaleGewuenscht !== undefined).length === 1);
  // Werkzeug und Shader nennen fuer die neuen Zeilen dieselben vier Zahlen.
  const voll = (tabelle(256) as { tiles: Array<{ tile: number; kachelMeter: number; normalStaerke: number; metallic: number; smoothness: number }> }).tiles;
  const soll: Record<number, [number, number, number, number]> = { 16: [2, 2, 0.7, 0], 17: [2, 1.2, 0, 0], 18: [5, 1.5, 0.2, 0.2], 19: [7, 2, 0, 0] };
  for (const k of [16, 17, 18, 19]) {
    const o = SCHICHT_OBERFLAECHE[k]!;
    const w = voll[k]!;
    pruefe(`Zeile ${k}: Shader und Werkzeug nennen Kachel, Normalstaerke, Metallic, Glaette wie die Quellschicht`,
      o.kachelMeter === soll[k]![0] && o.normalStaerke === soll[k]![1] && o.metallic === soll[k]![2] && o.smoothness === soll[k]![3]
        && w.kachelMeter === o.kachelMeter && w.normalStaerke === o.normalStaerke && w.metallic === o.metallic && w.smoothness === o.smoothness,
      `${o.kachelMeter}/${o.normalStaerke}/${o.metallic}/${o.smoothness}`);
  }
  pruefe('SCHICHT_OBERFLAECHE hat 20 Zeilen', SCHICHT_OBERFLAECHE.length === 20);
}

// ── 2. Rampen je Grundkachel ─────────────────────────────────────────
console.log('\n[2] Rampen je Grundkachel:');
{
  const g = TR.RAMPEN_JE_KACHEL[BK.TILE.GreyGrass]!;
  pruefe('Greyglen hat eine eigene Rampenzeile', g !== undefined);
  pruefe('Hang 19° → 26°', g.hang.beginn === 19 && g.hang.voll === 26);
  pruefe('Fels 26° → 34°, Deckel 0,94', g.fels.beginn === 26 && g.fels.voll === 34 && g.fels.anteil === 0.94);
  pruefe('rauer Fels 36° → 50°, Deckel 0,42', g.rau.beginn === 36 && g.rau.voll === 50 && g.rau.anteil === 0.42);
  pruefe('jede Stufe laeuft aufwaerts (beginn < voll)',
    g.hang.beginn < g.hang.voll && g.fels.beginn < g.fels.voll && g.rau.beginn < g.rau.voll);
  pruefe('die Stufen stapeln sich (Ende ≤ naechster Beginn)', g.hang.voll <= g.fels.beginn && g.fels.voll <= g.rau.beginn);
  pruefe('die Deckel liegen in (0, 1]', g.fels.anteil > 0 && g.fels.anteil <= 1 && g.rau.anteil > 0 && g.rau.anteil <= 1);
  pruefe('die oberste Stufe ist voll unter 56° (auf dem Gelaende erreichbar)', g.rau.voll < 56);
  pruefe('jede andere Kachel hat KEINE eigene Zeile und bekommt RAMPEN',
    Object.keys(TR.RAMPEN_JE_KACHEL).length === 1
      && Array.from({ length: 20 }, (_, k) => k).filter((k) => k !== 16).every((k) => TR.rampenFuerKachel(k) === TR.RAMPEN));
  const tab = TR.rampenTabelle();
  pruefe('rampenTabelle() hat 20 Saetze, Zeile 16 eigen, alle anderen RAMPEN',
    tab.length === 20 && tab[16] === g && tab.filter((_, k) => k !== 16).every((r) => r === TR.RAMPEN));
  pruefe('RAMPEN selbst unveraendert (15/30, 30/40/0,4, 40/50/0,1)',
    TR.RAMPEN.hang.beginn === 15 && TR.RAMPEN.hang.voll === 30 && TR.RAMPEN.fels.beginn === 30 && TR.RAMPEN.fels.voll === 40
      && TR.RAMPEN.fels.anteil === 0.4 && TR.RAMPEN.rau.beginn === 40 && TR.RAMPEN.rau.voll === 50 && TR.RAMPEN.rau.anteil === 0.1);
}

// ── 3. Flaechenanteile auf dem Hochland-Gelaende ─────────────────────
console.log('\n[3] Flaechenanteile (CPU-Bodenmischung, Greyglen):');
const ZIEL = { gras: 0.57, moos: 0.15, fels: 0.17, rauer: 0.07, sand: 0.035 };
const SPALTEN = [
  ['gras', 16], ['moos', 17], ['fels', 18], ['rauer', 19], ['sand', 9],
] as const;
const N = 600;
const summe: Record<string, number> = { gras: 0, moos: 0, fels: 0, rauer: 0, sand: 0, rest: 0 };
const jeBand: Array<Record<string, number>> = Array.from({ length: 7 }, () => ({ gras: 0, moos: 0, fels: 0, rauer: 0, sand: 0, rest: 0, w: 0 }));
let summeEins = 0;
streifen.forEach((s, j) => {
  for (let i = 0; i < N; i++) {
    const x = j * STREIFEN + 2 + zufall() * (STREIFEN - 4);
    const z = zufall() * 2000;
    const a = BM.kachelMischungBei(x, z, referenz);
    const w = s.gewicht / N;
    let erfasst = 0;
    for (const [name, kachel] of SPALTEN) {
      const v = a[`kachel${kachel}`] * w;
      summe[name]! += v;
      jeBand[s.band]![name]! += v;
      erfasst += a[`kachel${kachel}`];
    }
    // Was nicht in den fuenf Schichten steht (Schnee, andere Kacheln): muss null sein.
    summe['rest']! += (1 - erfasst) * w;
    jeBand[s.band]!['rest']! += (1 - erfasst) * w;
    jeBand[s.band]!['w']! += w;
    summeEins += Object.values(a).reduce((p, c) => p + c, 0) * w;
  }
});
pruefe('die Anteile eines Punktes summieren sich auf 1', Math.abs(summeEins - 1) < 1e-9, summeEins.toFixed(12));
pruefe('ausser den fuenf Schichten steht nichts im Boden (Rest < 0,0001)', Math.abs(summe['rest']!) < 1e-4, summe['rest']!.toExponential(2));
console.log('  Schicht      gemessen   Ziel    Abweichung (Punkte)');
for (const [name] of SPALTEN) {
  const gemessen = summe[name]!;
  const ziel = ZIEL[name];
  const d = (gemessen - ziel) * 100;
  console.log(`  ${name.padEnd(10)} ${(gemessen * 100).toFixed(2).padStart(7)} %  ${(ziel * 100).toFixed(1).padStart(5)} %  ${d >= 0 ? '+' : ''}${d.toFixed(2)}`);
  pruefe(`${name}: Anteil innerhalb ± 5 Punkte vom Ziel`, Math.abs(d) <= 5, `${(gemessen * 100).toFixed(2)} % gegen ${(ziel * 100).toFixed(1)} %`);
  pruefe(`${name}: Anteil innerhalb ± 2 Punkte (Eichung)`, Math.abs(d) <= 2, `${d.toFixed(2)}`);
}

console.log('\n  Neigung × Schicht (Anteil der Schicht an der Flaeche des Bandes, %):');
const NAMEN = ['0–8°', '8–15°', '15–22°', '22–30°', '30–40°', '40–50°', '>50°'];
console.log('  Band       Gras   Moos   Fels  Rauer  Sand   (Anteil des Bandes am Gelaende)');
jeBand.forEach((b, i) => {
  const f = (k: string) => ((b[k]! / b['w']!) * 100).toFixed(1).padStart(6);
  console.log(`  ${NAMEN[i]!.padEnd(8)} ${f('gras')} ${f('moos')} ${f('fels')} ${f('rauer')} ${f('sand')}   ${(b['w']! * 100).toFixed(1)} %`);
});
{
  const anteil = (i: number, k: string): number => jeBand[i]![k]! / jeBand[i]!['w']!;
  // Das 0–8°-Band enthaelt den Uferstreifen: ohne ihn waere es reines Gras.
  const grasBand = (i: number): number => anteil(i, 'gras');
  pruefe('unter 15° bleibt der Boden Gras (≥ 85 % in den zwei flachsten Baendern, der Rest ist Ufersand)', grasBand(0) >= 0.85 && grasBand(1) >= 0.99);
  pruefe('Gras nimmt mit der Neigung ab (Baender 1 → 6, ohne das Ufer-Band)',
    [1, 2, 3, 4, 5].every((i) => grasBand(i) > grasBand(i + 1) || grasBand(i) < 0.2));
  pruefe('Moos dominiert zwischen 22° und 34° (22–30°: mehr Moos als Fels)', anteil(3, 'moos') > anteil(3, 'fels'));
  pruefe('ueber 50° ist der Boden zu mehr als der Haelfte Stein (Fels + rauer Fels ≥ 50 %)',
    anteil(6, 'fels') + anteil(6, 'rauer') >= 0.5, `${((anteil(6, 'fels') + anteil(6, 'rauer')) * 100).toFixed(1)} %`);
  pruefe('rauer Fels kommt erst ab 36° vor (unter 30° kein rauer Fels)',
    [0, 1, 2, 3].every((i) => anteil(i, 'rauer') < 1e-9));
  pruefe('Sand kommt nur am Ufer vor (hoechstens im Uferband 0–8°)', [1, 2, 3, 4, 5, 6].every((i) => anteil(i, 'sand') < 1e-9));
}

// ── 4. Aeltere Biome bitgleich ───────────────────────────────────────
console.log('\n[4] Aeltere Biome bitgleich (Golden vor K3):');
{
  if (!existsSync(GOLDEN)) {
    pruefe('Golden-Datei vorhanden', false, GOLDEN);
  } else {
    const soll = (JSON.parse(readFileSync(GOLDEN, 'utf-8')) as { biome: Record<string, string> }).biome;
    const ist = alteBiomeHashes();
    for (const biom of ALTE_BIOME) {
      pruefe(`Biom ${biom}: Mischung an 240 Punkten bitgleich`, soll[String(biom)] === ist[String(biom)]);
    }
    pruefe('Golden fuehrt genau die neun aelteren Biome', Object.keys(soll).length === ALTE_BIOME.length);
    const tabSoll = (JSON.parse(readFileSync(GOLDEN, 'utf-8')) as { tabellen: unknown }).tabellen;
    pruefe('die Tabellen der 16 alten Kacheln (BIOME_TILE ohne 128, Hang/Fels/Rau, RAMPEN, Bodenart, Regeln) unveraendert',
      JSON.stringify(tabSoll) === JSON.stringify(alteTabellen()));
  }
  // Gemischte Zone: dominante Kachel entscheidet die Rampe (Greyglen links, Wiese rechts).
  const gemischt: BodenQuelle = {
    getGroundHeight: (x) => WATER_LEVEL + 20 + Math.tan((24 * Math.PI) / 180) * x,
    getZoneAt: () => ({
      zoneX: 0, zoneY: 0,
      cornerBiomes: [128, 1, 128, 1] as unknown as BodenZone['cornerBiomes'],
      getBiome: () => Biome.Meadows,
      getVegetationMask: () => 0,
    }),
  };
  // Zone (0,0) liegt auf [-32, 32): links dominiert die Ecke 0 (Greyglen), rechts die Ecke 1 (Wiese).
  const links = BM.kachelMischungBei(-20, 5, gemischt);
  const rechts = BM.kachelMischungBei(20, 5, gemischt);
  pruefe('gemischte Zone: links (Greyglen dominant) hat die Greyglen-Hangkachel, rechts nicht',
    links[`kachel${BK.TILE.GreyMoss}`] > 0.3 && rechts[`kachel${BK.TILE.GreyMoss}`] === 0
      && rechts[`kachel${BK.TILE.Moss}`] > 0.3 && links[`kachel${BK.TILE.Moss}`] === 0);
  // Genauer: am 24°-Hang gilt links die Greyglen-Rampe (19°→26°), rechts die globale (15°→30°).
  const c = (g: number): number => Math.cos((g * Math.PI) / 180);
  const kGrey = (c(19) - c(24)) / (c(19) - c(26));
  const kGlobal = (c(15) - c(24)) / (c(15) - c(30));
  pruefe('gemischte Zone: links gilt die Rampe der dominanten Greyglen-Kachel', Math.abs(links[`kachel${BK.TILE.GreyMoss}`] - kGrey) < 1e-9,
    `${links[`kachel${BK.TILE.GreyMoss}`].toFixed(6)} gegen ${kGrey.toFixed(6)}`);
  pruefe('gemischte Zone: rechts gilt die globale Rampe der dominanten Wiesen-Kachel', Math.abs(rechts[`kachel${BK.TILE.Moss}`] - kGlobal) < 1e-9,
    `${rechts[`kachel${BK.TILE.Moss}`].toFixed(6)} gegen ${kGlobal.toFixed(6)}`);
}

// ── 5. Shader ────────────────────────────────────────────────────────
console.log('\n[5] Shader:');
{
  const splat = readFileSync(resolve(WURZEL, 'client/src/engine/TerrainSplat.ts'), 'utf-8');
  for (const s of [
    'rampenTabelle()', "'VB_HANG_B'", "'VB_HANG_W'", "'VB_FELS_B'", "'VB_FELS_W'", "'VB_FELS_A'", "'VB_RAU_B'", "'VB_RAU_W'", "'VB_RAU_A'",
    'VB_HANG_B[i]', 'VB_FELS_B[i]', 'VB_RAU_B[i]', 'VB_FELS_A[i]', 'VB_RAU_A[i]',
    'TILE_ANZAHL',
  ]) pruefe(`Shader nutzt ${s}`, splat.includes(s));
  for (const zeile of [
    "'  hangK = clamp((VB_HANG_B[i] - ny) / VB_HANG_W[i], 0.0, 1.0);'",
    "'  felsK = clamp((VB_FELS_B[i] - ny) / VB_FELS_W[i], 0.0, 1.0) * VB_FELS_A[i];'",
    "'  rauK = clamp((VB_RAU_B[i] - ny) / VB_RAU_W[i], 0.0, 1.0) * VB_RAU_A[i];'",
    "glslTabelle('VB_HANG_B', rampenSaetze.map((r) => nyBeiGrad(r.hang.beginn)))",
    "glslTabelle('VB_HANG_W', rampenSaetze.map((r) => nyBeiGrad(r.hang.beginn) - nyBeiGrad(r.hang.voll)))",
    "glslTabelle('VB_FELS_B', rampenSaetze.map((r) => nyBeiGrad(r.fels.beginn)))",
    "glslTabelle('VB_FELS_W', rampenSaetze.map((r) => nyBeiGrad(r.fels.beginn) - nyBeiGrad(r.fels.voll)))",
    "glslTabelle('VB_FELS_A', rampenSaetze.map((r) => r.fels.anteil))",
    "glslTabelle('VB_RAU_B', rampenSaetze.map((r) => nyBeiGrad(r.rau.beginn)))",
    "glslTabelle('VB_RAU_W', rampenSaetze.map((r) => nyBeiGrad(r.rau.beginn) - nyBeiGrad(r.rau.voll)))",
    "glslTabelle('VB_RAU_A', rampenSaetze.map((r) => r.rau.anteil))",
    '`const float ${name}[${werte.length}] = float[${werte.length}](`',
    'cnst(`tile_${name}_atlasHoehe`, 1 / ATLAS_ZEILEN)',
    'const ATLAS_ZEILEN = STORE_BODEN_AKTIV ? TILE_ANZAHL : 16;',
    '(felsKAus ?? rockKRoh.output).connectTo(rockK.left)',
    'const KACHEL_MAX = (ATLAS_ZEILEN - 1).toFixed(1);',
    '`  int i = int(clamp(t, 0.0, ${KACHEL_MAX}) + 0.5);`',
  ]) pruefe(`Shader-Zeile: ${zeile.slice(0, 70)}`, splat.includes(zeile));
  pruefe('der Shader fuehrt keine Rampen-Literale 15/30/40/50 mehr in der Tabellenwahl', !/clamp\(\(\$\{HANG_BEGINN/.test(splat));
  pruefe('keine feste 16 mehr im Zeilenindex des Stapels (nur noch ATLAS_ZEILEN)', !/\) \/ 16\.0;/.test(splat));
  pruefe('SCHICHT_OBERFLAECHE hat 20 Zeilen: der Shader-Tabellen-Index klemmt auf KACHEL_MAX', splat.includes('KACHEL_MAX'));
}

if (fehler > 0) {
  console.error(`\n${fehler} FEHLER`);
  process.exit(1);
}
console.log('\nALLE GRUEN');
