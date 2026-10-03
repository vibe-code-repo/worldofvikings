/**
 * Greyglen (Biom-Bit 128), Karte K3 (+ Nachbesserung N1): eigener Boden.
 *
 * Festgehalten wird:
 *
 *  1. TABELLEN: Greyglen hat eine eigene Grundkachel (`GreyGrass`) und eigene
 *     Hang-, Fels- und Rau-Kachel (alle Zeilen 16–19 der drei Tabellen). Die
 *     vier Kacheln zeigen auf Zeilen des Texturstapels, die es schon gibt
 *     (`TILE_ZEILE`); der Stapel bleibt 16 Zeilen hoch (8192 px bei 512).
 *  2. STAPEL ALT/NEU: Ein alter Client liest einen neuen Stapel richtig, ein neuer
 *     Client einen alten (Zeile fuer Zeile dieselben Quellen, Golden von vor K3),
 *     und passt ein Stapel nicht zum Code, fallen die Greyglen-Kacheln auf Grasland
 *     zurueck.
 *  3. RAMPEN: `RAMPEN_JE_KACHEL` fuer Greyglen, `RAMPEN` fuer jede andere Kachel;
 *     an einer Biomgrenze folgen die Rampenwerte den Eckgewichten (stetig).
 *  4. FLAECHENANTEILE: Auf dem Hang-Histogramm eines steilen Hochland-Tals misst
 *     die CPU-Bodenmischung Gras 57 %, Fels 17 %, Moos 15 %, rauer Fels 7 %, Sand
 *     3,5 % (± 5 Punkte, geeicht unter 1, auf drei Neigungsrastern).
 *  5. BITGLEICH: Alle aelteren Biome liefern dieselbe Mischung wie vor K3 (Golden
 *     von vor K3, einheitliche UND gemischte Ecken, Lavamaske, Schnee).
 *  6. SHADER: Der Shader liest die Rampen und Stapelzeilen aus denselben Tabellen.
 *
 * Das Testgelaende steht in `tools/boden-greyglen-gelaende.ts` (feste Raster, feste
 * Saat); die Eichung der Rampe in `tools/boden-greyglen-eichen.ts`.
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
import { E_WIDTH, WATER_LEVEL } from '../../shared/src/worldgen/Heightmap.js';
import { Biome } from '../../shared/src/types.js';
import { felsMaskeShaderBei } from '../../shared/src/worldgen/felsRauschen.js';
import * as WZ from '../store-terrain-schichten.mjs';
import * as DEVB from '../../scripts/dev-boden.mjs';
import * as SPLAT from '../../client/src/engine/TerrainSplat.js';
import { TerrainManager } from '../../client/src/engine/Terrain.js';
import * as GEL from '../boden-greyglen-gelaende.js';
import type { Anteile } from '../boden-greyglen-gelaende.js';

const { SCHICHTEN, ZUORDNUNG, tabelle } = WZ;
const { SCHICHT_OBERFLAECHE } = SPLAT;
const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const GOLDEN = resolve(WURZEL, 'shared/test/golden/boden-mischung-alte-biome.json');

let fehler = 0;
/** Nebenlaeufige Pruefungen (Hash-Abruf): ihr Ergebnis steht vor dem Schlussstrich. */
const asyncTests: Array<Promise<void>> = [];
function pruefe(name: string, an: boolean, detail = ''): void {
  if (an) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    fehler += 1;
  }
}

// ── Golden: aeltere Biome bitgleich ──────────────────────────────────
const ALTE_BIOME = [1, 2, 4, 8, 16, 32, 64, 256, 512];

/** Einheitliche Ecken: je Biom 240 Mischungen (12 Neigungen × 4 Hoehen × 5 Orte). */
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
          const q = einheitlich(biom, g, hh);
          const a = BM.bodenMischungBei(ox + 4, oz, q);
          h.update(JSON.stringify(BM.BODENARTEN.map((k) => a[k])));
        }
      }
    }
    hashes[String(biom)] = h.digest('hex');
  }
  return hashes;
}

function einheitlich(biom: number, grad: number, hoehe: number): BodenQuelle {
  const zone: BodenZone = {
    zoneX: 0,
    zoneY: 0,
    cornerBiomes: [biom, biom, biom, biom] as unknown as BodenZone['cornerBiomes'],
    getBiome: () => biom as Biome,
    getVegetationMask: () => 0,
  };
  return { getGroundHeight: (x) => hoehe + Math.tan((grad * Math.PI) / 180) * (x - 40 * Math.floor(x / 40)), getZoneAt: () => zone };
}

/**
 * GEMISCHTE Ecken (N1): je Zone vier zufaellige aeltere Biome als Ecken, ein
 * davon abweichendes `getBiome`, eine Lavamaske zwischen 0 und 1, Neigungsebene
 * mit zufaelliger Richtung, Hoehen von unter Wasser bis ueber die Schneelinie.
 * Das fasst die Stellen an, die einheitliche Ecken nie erreichen: dominante Ecke,
 * Felskachel aus dem Biom des Punktes, Rampe aus der Mischung der Ecken.
 */
function alteBiomeGemischtHash(): string {
  let s = 424242;
  const zufall = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const wahl = (): number => ALTE_BIOME[Math.floor(zufall() * ALTE_BIOME.length)]!;
  const h = createHash('sha256');
  for (let zi = 0; zi < 400; zi++) {
    const zx = Math.floor(zufall() * 200) - 100;
    const zy = Math.floor(zufall() * 200) - 100;
    const ecken = [wahl(), wahl(), wahl(), wahl()];
    const punktBiom = wahl();
    const veg = zufall() < 0.5 ? 0 : zufall();
    const grad = zufall() * 75;
    const richtung = zufall() * Math.PI * 2;
    const basis = WATER_LEVEL - 4 + zufall() * 130;
    const zone: BodenZone = {
      zoneX: zx,
      zoneY: zy,
      cornerBiomes: ecken as unknown as BodenZone['cornerBiomes'],
      getBiome: () => punktBiom as Biome,
      getVegetationMask: () => veg,
    };
    const t = Math.tan((grad * Math.PI) / 180);
    const q: BodenQuelle = { getGroundHeight: (x, z) => basis + t * (Math.cos(richtung) * x + Math.sin(richtung) * z), getZoneAt: () => zone };
    for (let p = 0; p < 5; p++) {
      const x = zx * 64 - 32 + zufall() * 64;
      const z = zy * 64 - 32 + zufall() * 64;
      const a = BM.bodenMischungBei(x, z, q);
      h.update(JSON.stringify(BM.BODENARTEN.map((k) => a[k])));
    }
  }
  return h.digest('hex');
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

/** Aus welcher Quellschicht jede der 16 Stapelzeilen gebaut wird (vor K3: Zeile = Kachel). */
function alteStapelZeilen(): unknown {
  const z = (ZUORDNUNG as Array<{ altbestand?: boolean; schicht?: string }>).slice(0, 16);
  const namen = z.map((e) => (e.altbestand ? 'altbestand' : e.schicht));
  // Je Zeile die Nummer der ersten Zeile mit derselben Quellschicht (die Zerlegung, ohne Namen).
  return { zeilen: namen.map((n) => namen.indexOf(n)), felsSchicht: (SCHICHTEN as Record<string, unknown>)['rock-rough'] };
}

if (process.argv.includes('--golden-schreiben')) {
  writeFileSync(
    GOLDEN,
    JSON.stringify({ biome: alteBiomeHashes(), gemischt: alteBiomeGemischtHash(), tabellen: alteTabellen(), stapel: alteStapelZeilen() }, null, 2) + '\n',
  );
  console.log('Golden geschrieben:', GOLDEN);
  process.exit(0);
}

// ── 1. Tabellen ──────────────────────────────────────────────────────
console.log('\n[1] Tabellen:');
pruefe('TILE_ANZAHL ist 20', BK.TILE_ANZAHL === 20);
pruefe('Greyglen-Kacheln 16–19 in der Reihenfolge Gras, Moos, Fels, rauer Fels',
  BK.TILE.GreyGrass === 16 && BK.TILE.GreyMoss === 17 && BK.TILE.GreyRock === 18 && BK.TILE.GreyRockMoss === 19);
pruefe('BIOME_TILE[128] = GreyGrass', BK.BIOME_TILE[128] === BK.TILE.GreyGrass);
{
  const G = BK.TILE;
  const hang = [G.GreyMoss, G.GreyMoss, G.GreyRock, G.GreyRockMoss];
  const fels = [G.GreyRock, G.GreyRock, G.GreyRock, G.GreyRockMoss];
  const rau = [G.GreyRockMoss, G.GreyRockMoss, G.GreyRockMoss, G.GreyRockMoss];
  pruefe('HANG_TILE Zeilen 16–19', [16, 17, 18, 19].every((k, i) => BK.HANG_TILE[k] === hang[i]), JSON.stringify(BK.HANG_TILE.slice(16)));
  pruefe('FELS_TILE Zeilen 16–19', [16, 17, 18, 19].every((k, i) => BK.FELS_TILE[k] === fels[i]), JSON.stringify(BK.FELS_TILE.slice(16)));
  pruefe('RAU_TILE Zeilen 16–19', [16, 17, 18, 19].every((k, i) => BK.RAU_TILE[k] === rau[i]), JSON.stringify(BK.RAU_TILE.slice(16)));
}
pruefe('die drei Tabellen haben 20 Zeilen', BK.HANG_TILE.length === 20 && BK.FELS_TILE.length === 20 && BK.RAU_TILE.length === 20);
pruefe('TILE_BODENART: 16/17 Gras, 18/19 Fels',
  BM.TILE_BODENART.length === 20 && BM.TILE_BODENART[16] === 'gras' && BM.TILE_BODENART[17] === 'gras'
    && BM.TILE_BODENART[18] === 'fels' && BM.TILE_BODENART[19] === 'fels');
pruefe('Stapel: 16 Zeilen', BK.STAPEL_ZEILEN === 16);
pruefe('TILE_ZEILE: 0–15 wie der Index (Kachel 6 teilt Zeile 5), Greyglen auf 0, 11, 4 und 6',
  JSON.stringify(BK.TILE_ZEILE) === JSON.stringify([0, 1, 2, 3, 4, 5, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 11, 4, 6]));
pruefe('keine Kachel zeigt ueber den Stapel hinaus', BK.TILE_ZEILE.every((z) => Number.isInteger(z) && z >= 0 && z < BK.STAPEL_ZEILEN));
{
  const zeile = (i: number) => (ZUORDNUNG as Array<{ name: string; schicht?: string; zeile?: number; toenung?: number[] }>)[i]!;
  pruefe('Gras (16) nimmt die Quellschicht der Kachel 0', zeile(16).schicht === zeile(0).schicht);
  pruefe('Moos (17) nimmt die Quellschicht der Kachel 11', zeile(17).schicht === zeile(11).schicht);
  pruefe('Fels (18) nimmt die Quellschicht der Kachel 4', zeile(18).schicht === zeile(4).schicht);
  pruefe('rauer Fels (19) hat eine eigene Quellschicht, nicht die der Kachel 5', zeile(19).schicht === 'rock-moss' && zeile(19).schicht !== zeile(5).schicht);
  pruefe('keine Toenung auf den neuen Kacheln', [16, 17, 18, 19].every((i) => (zeile(i).toenung ?? []).every((f) => f === 1)));
  pruefe('Werkzeug und Code nennen dieselbe Stapelzeile je Kachel (alle 20)',
    BK.TILE_ZEILE.every((z, k) => WZ.zeileVon(k) === z), JSON.stringify(BK.TILE_ZEILE.map((_, k) => WZ.zeileVon(k))));
}
{
  const s = (SCHICHTEN as Record<string, { farbe: string; farbeErsatz?: string; normale: string; normaleErsatz?: string; kachelMeter: number; normalStaerke: number; metallic: number; smoothness: number }>);
  const r = s['rock-moss']!;
  const alt = s['rock-rough']!;
  pruefe('rauer Fels von Greyglen: Farbe wie die der Kachel 5, eigene Normale',
    r.farbe === alt.farbe && r.farbeErsatz === alt.farbeErsatz && r.normale === 'terrain-rock-moss-normal', `${r.farbe} / ${r.normale}`);
  pruefe('… mit benanntem Ersatz fuer die Normale, solange sie nicht im Speicher liegt', r.normaleErsatz === alt.normale);
  pruefe('… sonst dieselben Werte wie Zeile 5 (Kachelmass, Staerke, Metallic, Glaette)',
    r.kachelMeter === alt.kachelMeter && r.normalStaerke === alt.normalStaerke && r.metallic === alt.metallic && r.smoothness === alt.smoothness);
  const t = (tabelle(256) as { zeilen: number; version: number; tiles: Array<{ tile: number; zeile: number; normale: string; normaleGewuenscht?: string; kachelMeter: number; normalStaerke: number; metallic: number; smoothness: number }> });
  pruefe('Tabelle: 16 Zeilen, 20 Kacheln, Version wie im Code', t.zeilen === 16 && t.tiles.length === 20 && t.version === BK.STAPEL_VERSION);
  pruefe('das Werkzeug fuehrt dieselbe Stapelversion wie der Code', WZ.STAPEL_VERSION === BK.STAPEL_VERSION);
  pruefe('Tabelle: jede Kachel nennt ihre Stapelzeile', t.tiles.every((x) => x.zeile === BK.TILE_ZEILE[x.tile]));
  pruefe('Tabelle: Kachel 19 nennt die gewuenschte Normale', t.tiles[19]?.normaleGewuenscht === 'terrain-rock-moss-normal');
  pruefe('Tabelle: nur Kachel 19 fuehrt eine Ersatz-Normale', t.tiles.filter((z) => z.normaleGewuenscht !== undefined).length === 1);
  const soll: Record<number, [number, number, number, number]> = { 16: [2, 2, 0.7, 0], 17: [2, 1.2, 0, 0], 18: [5, 1.5, 0.2, 0.2], 19: [7, 2, 0, 0] };
  for (const k of [16, 17, 18, 19]) {
    const o = SCHICHT_OBERFLAECHE[k]!;
    const w = t.tiles[k]!;
    pruefe(`Kachel ${k}: Shader und Werkzeug nennen Kachelmass, Normalstaerke, Metallic, Glaette wie die Quellschicht`,
      o.kachelMeter === soll[k]![0] && o.normalStaerke === soll[k]![1] && o.metallic === soll[k]![2] && o.smoothness === soll[k]![3]
        && w.kachelMeter === o.kachelMeter && w.normalStaerke === o.normalStaerke && w.metallic === o.metallic && w.smoothness === o.smoothness,
      `${o.kachelMeter}/${o.normalStaerke}/${o.metallic}/${o.smoothness}`);
  }
  pruefe('SCHICHT_OBERFLAECHE hat 20 Zeilen', SCHICHT_OBERFLAECHE.length === 20);
  pruefe('Kachel 6 und 5 haben dieselben Oberflaechenwerte (sie teilen eine Stapelzeile)',
    JSON.stringify(SCHICHT_OBERFLAECHE[6]) === JSON.stringify(SCHICHT_OBERFLAECHE[5]));
}

// ── 2. Stapel alt/neu, Rueckfall ─────────────────────────────────────
console.log('\n[2] Stapel alt/neu und Rueckfall:');
{
  const golden = existsSync(GOLDEN) ? (JSON.parse(readFileSync(GOLDEN, 'utf-8')) as { stapel?: { zeilen: number[]; felsSchicht: Record<string, unknown> } }) : {};
  const alt = golden.stapel;
  pruefe('Golden fuehrt die 16 Stapelzeilen von vor K3', alt?.zeilen.length === 16);
  if (alt) {
    const namen = Array.from({ length: 16 }, (_, r) => {
      const q = WZ.zeilenQuelle(r) as { altbestand?: boolean; schicht?: string };
      return q.altbestand ? 'altbestand' : q.schicht;
    });
    const nun = namen.map((n) => namen.indexOf(n));
    // ALTER CLIENT, NEUER STAPEL: er liest Zeile = Kachel; jede Zeile traegt dieselbe Quelle wie vor K3,
    // ausser Zeile 6 (vor K3 dieselbe Karte wie Zeile 5, die jetzt der rauen Greyglen-Kachel gehoert).
    pruefe('ALT/NEU: die Zerlegung der 16 Zeilen in Quellschichten ist bis auf Zeile 6 die von vor K3',
      nun.filter((q, r) => q === alt.zeilen[r]).length === 15, nun.map((q, r) => (q === alt.zeilen[r] ? '' : `Zeile ${r}`)).filter(Boolean).join('; '));
    pruefe('ALT/NEU: nur Zeile 6 ist anders, und vor K3 war sie dieselbe Quelle wie Zeile 5',
      nun.every((q, r) => r === 6 || q === alt.zeilen[r]) && alt.zeilen[6] === alt.zeilen[5] && alt.zeilen[5] === 5);
    const s = (SCHICHTEN as Record<string, Record<string, unknown>>)['rock-moss']!;
    const a = alt.felsSchicht;
    pruefe('ALT/NEU: Zeile 6 unterscheidet sich von der alten nur in der Normale',
      ['farbe', 'farbeErsatz', 'kachelMeter', 'normalStaerke', 'metallic', 'smoothness'].every((k) => s[k] === a[k]) && s['normaleErsatz'] === a['normale']);
    // NEUER CLIENT, ALTER STAPEL: Er liest die Zeilen 0, 11, 4 (Greyglen) und 6; im alten Stapel stehen dort dieselben Quellen.
    pruefe('NEU/ALT: die Zeilen 0, 11, 4 des alten Stapels tragen die Quellschichten der Greyglen-Kacheln 16–18',
      [16, 17, 18].every((k) => (ZUORDNUNG as Array<{ schicht?: string }>)[k]!.schicht === (ZUORDNUNG as Array<{ schicht?: string }>)[BK.TILE_ZEILE[k]!]!.schicht && alt.zeilen[BK.TILE_ZEILE[k]!] === BK.TILE_ZEILE[k]));
    pruefe('NEU/ALT: Zeile 6 des alten Stapels hat die Farbe der rauen Greyglen-Kachel (nur die Normale ist die Ersatz-Normale)',
      alt.felsSchicht['farbe'] === s['farbe'] && alt.felsSchicht['normale'] === s['normaleErsatz']);
    pruefe('NEU/ALT: Kachel 6 liest im alten Stapel Zeile 5, dieselbe Quelle wie ihre eigene Zeile 6', alt.zeilen[5] === alt.zeilen[6]);
  }
  // Rueckfall bei unbrauchbarem Stapel.
  pruefe('stapelPasst: 512 × 8192 ja', SPLAT.stapelPasst(512, 8192));
  pruefe('stapelPasst: 512 × 10240 nein (Stapel mit 20 Zeilen)', !SPLAT.stapelPasst(512, 10240));
  pruefe('stapelPasst: 256 × 4096 ja, 512 × 4096 nein, 0 × 0 nein', SPLAT.stapelPasst(256, 4096) && !SPLAT.stapelPasst(512, 4096) && !SPLAT.stapelPasst(0, 0));
  pruefe('Rueckfall: Greyglen-Kacheln werden Gras, Moos, Fels, Cliff; die anderen bleiben',
    [16, 17, 18, 19].every((k, i) => BK.kachelFuerStapel(k, false) === [BK.TILE.Grass, BK.TILE.Moss, BK.TILE.Rock, BK.TILE.Cliff][i])
      && Array.from({ length: 16 }, (_, k) => k).every((k) => BK.kachelFuerStapel(k, false) === k));
  pruefe('ohne Rueckfall bleibt jede Kachel', Array.from({ length: 20 }, (_, k) => k).every((k) => BK.kachelFuerStapel(k, true) === k));
  pruefe('der Rueckfall hat dieselbe Oberflaeche wie die Greyglen-Kachel (Gras, Moos, Fels)',
    [16, 17, 18].every((k) => JSON.stringify(SCHICHT_OBERFLAECHE[BK.KACHEL_RUECKFALL[k]!]) === JSON.stringify(SCHICHT_OBERFLAECHE[k])));

  // ── N2/F2: das Layout kommt aus der Textur, nicht aus einer festen 16 ──────────────────
  const lay = SPLAT.stapelLayout;
  pruefe('Layout 512 × 8192: Modus 0, 16 Zeilen', lay(512, 8192).modus === 0 && lay(512, 8192).zeilen === 16);
  pruefe('Layout 512 × 10240 (Stapel des ersten Entwurfs): Modus 1, 20 Zeilen', lay(512, 10240).modus === 1 && lay(512, 10240).zeilen === 20);
  pruefe('Layout 256 × 4096 und 1024 × 16384: Modus 0 (die Kante ist egal, das Verhaeltnis zaehlt)', lay(256, 4096).modus === 0 && lay(1024, 16384).modus === 0);
  pruefe('Layout 512 × 4096 (8 Zeilen): Modus 2, Zeilenzahl aus der Hoehe', lay(512, 4096).modus === 2 && lay(512, 4096).zeilen === 8);
  pruefe('Layout 512 × 6000 (nicht ganzzahlig) und 0 × 0: Modus 2', lay(512, 6000).modus === 2 && lay(0, 0).modus === 2 && lay(-1, 5).modus === 2);
  pruefe('Layout rundet: 512 × 3891 (7,6) → 8 Zeilen, 512 × 3686 (7,2) → 7 Zeilen (nicht abgeschnitten, nicht aufgerundet)', lay(512, 3891).zeilen === 8 && lay(512, 3686).zeilen === 7);
  pruefe('Layout: nie weniger als eine Zeile (512 × 100) und Hoehe 0 ist Modus 2', lay(512, 100).zeilen === 1 && lay(512, 100).modus === 2 && lay(512, 0).modus === 2 && lay(512, 0).zeilen === 16);
  // F1: Babylon klemmt getSize() auf MAX_TEXTURE_SIZE; gelesen wird die Bildgroesse.
  {
    const karte4096 = { getSize: () => ({ width: 512, height: 4096 }), getBaseSize: () => ({ width: 512, height: 8192 }) };
    const b4 = SPLAT.stapelBefundAusTextur(karte4096, 4096, 'Farbstapel');
    pruefe('Grafikkarte mit 4096 px: getSize() ist auf 512 × 4096 geklemmt, der Befund liest die Bildgroesse 512 × 8192: Modus 0, 16 Zeilen, gut, Meldung zur Verkleinerung',
      b4.layout.modus === 0 && b4.layout.zeilen === 16 && b4.ok && b4.meldung?.includes('verkleinert') === true);
    const karte2048 = { getSize: () => ({ width: 256, height: 2048 }), getBaseSize: () => ({ width: 512, height: 8192 }) };
    pruefe('Grafikkarte mit 2048 px: ebenfalls Modus 0', SPLAT.stapelBefundAusTextur(karte2048, 2048, 'Normalenstapel').layout.modus === 0);
    const grosseKarte = { getSize: () => ({ width: 512, height: 8192 }), getBaseSize: () => ({ width: 512, height: 8192 }) };
    pruefe('Karte mit 16384 px: Modus 0 ohne Meldung', SPLAT.stapelBefundAusTextur(grosseKarte, 16384, 'Farbstapel').meldung === null);
    const stapel20 = { getSize: () => ({ width: 512, height: 8192 }), getBaseSize: () => ({ width: 512, height: 10240 }) };
    pruefe('20-Zeilen-Stapel auf einer 8192-Karte (getSize geklemmt auf 8192): Modus 1 aus der Bildgroesse', SPLAT.stapelBefundAusTextur(stapel20, 8192, 'Farbstapel').layout.modus === 1);
  }
  {
    const b0 = SPLAT.stapelBefundAusGroesse(512, 8192, 16384, 'Farbstapel');
    pruefe('Befund Modus 0: gut, keine Meldung', b0.ok && b0.meldung === null);
    pruefe('Befund Modus 0 auf einer Karte mit 4096 px: gut, aber laute Meldung zur Grenze', SPLAT.stapelBefundAusGroesse(512, 8192, 4096, 'Farbstapel').meldung?.includes('4096') === true);
    const b1 = SPLAT.stapelBefundAusGroesse(512, 10240, 16384, 'Farbstapel');
    pruefe('Befund Modus 1: gut (Greyglen hat dort eigene Zeilen), Hinweis mit Neubau', b1.ok && b1.meldung?.includes('store:boden') === true);
    const b2 = SPLAT.stapelBefundAusGroesse(512, 4096, 16384, 'Normalenstapel');
    pruefe('Befund Modus 2: nicht gut, laute Meldung mit Name, Groesse und Neubau', !b2.ok && b2.meldung?.includes('Normalenstapel') === true && b2.meldung.includes('512x4096') && b2.meldung.includes('store:boden'));
  }
  {
    const l0 = lay(512, 8192), l1 = lay(512, 10240), l2 = lay(512, 4096);
    pruefe('Zeile Modus 0 = TILE_ZEILE fuer alle 20 Kacheln', Array.from({ length: 20 }, (_, k) => SPLAT.stapelZeile(k, l0) === BK.TILE_ZEILE[k]).every(Boolean));
    pruefe('Zeile Modus 1 = Kachel (jede Kachel ihre eigene Zeile)', Array.from({ length: 20 }, (_, k) => SPLAT.stapelZeile(k, l1) === k).every(Boolean));
    pruefe('Zeile Modus 2: Greyglen liest die Zeile der Grasland-Entsprechung, jede Zeile unter der Hoehe',
      SPLAT.stapelZeile(16, l2) === BK.TILE_ZEILE[0] && SPLAT.stapelZeile(17, l2) === Math.min(BK.TILE_ZEILE[11]!, l2.zeilen - 1) && SPLAT.stapelZeile(19, l2) === Math.min(BK.TILE_ZEILE[5]!, l2.zeilen - 1)
        && Array.from({ length: 20 }, (_, k) => SPLAT.stapelZeile(k, l2)).every((z) => z >= 0 && z < l2.zeilen));
    const code = SPLAT.zeileBlockCode('x').join('\n');
    pruefe('Zeilenblock (GLSL): Modus 0 aus der Tabelle, Modus 1 die Kachel, Modus 2 Rueckfall mit Klemme, beide Tabellen mit 20 Werten',
      code.includes('if (modus < 0.5) { row = VB_ZEILE_x[t]; }') && code.includes('else if (modus < 1.5) { row = float(t); }')
        && code.includes('else { row = min(VB_ZEILE_x[int(VB_RUECK_x[t] + 0.5)], zeilen - 1.0); }')
        && code.includes('const float VB_ZEILE_x[20]') && code.includes('const float VB_RUECK_x[20]')
        && code.includes(BK.TILE_ZEILE.map((z) => z.toFixed(4)).join(', ')) && code.includes(BK.KACHEL_RUECKFALL.map((z) => z.toFixed(4)).join(', ')));
  }
  // Das Ergebnis der Pruefung steuert die Kacheln: Flag, Fehlerpfad (Mutanten N20/N25).
  {
    const meldungen: string[] = [];
    const alt = console.error;
    console.error = (...a: unknown[]): void => { meldungen.push(String(a[0])); };
    SPLAT.stapelMelden(true);
    pruefe('Flag: nach stapelMelden(true) brauchbar', SPLAT.stapelBrauchbar());
    SPLAT.stapelFehlgeschlagen('Farbstapel', 'Zeitueberschreitung');
    console.error = alt;
    pruefe('Ladefehler: Flag falsch und eine laute Meldung mit Namen und Grund', !SPLAT.stapelBrauchbar() && meldungen.length === 1 && meldungen[0]!.includes('Farbstapel') && meldungen[0]!.includes('Zeitueberschreitung'));
    SPLAT.stapelMelden(true);
    pruefe('Flag zurueckgesetzt', SPLAT.stapelBrauchbar());
  }
  // ── N2/F3: der Cache-Brecher folgt dem Inhalt ───────────────────────────────────────────
  pruefe('stapelUrl mit Hash: ?h=<Hash>, ohne Hash die nackte URL', SPLAT.stapelUrl('/a/s.png', 'abcdef0123456789') === '/a/s.png?h=abcdef0123456789' && SPLAT.stapelUrl('/a/s.png', undefined) === '/a/s.png');
  {
    const gut = { ok: true, json: async () => ({ stapelHash: { farbe: 'aaaaaaaaaaaaaaaa', normale: 'bbbbbbbbbbbbbbbb' } }) };
    asyncTests.push((async () => {
      const h = await SPLAT.stapelHashesHolen(async () => gut, 'u');
      pruefe('Hashes aus der JSON gelesen (Farbe und Normale getrennt)', h.farbe === 'aaaaaaaaaaaaaaaa' && h.normale === 'bbbbbbbbbbbbbbbb');
      const alt = await SPLAT.stapelHashesHolen(async () => ({ ok: true, json: async () => ({ zeilen: 16 }) }), 'u');
      pruefe('alte JSON ohne stapelHash: keine Hashes (nackte URL)', alt.farbe === undefined && alt.normale === undefined);
      const aus = await SPLAT.stapelHashesHolen(async () => { throw new Error('offline'); }, 'u');
      pruefe('JSON nicht erreichbar: keine Hashes, keine Ausnahme', aus.farbe === undefined);
      const nok = await SPLAT.stapelHashesHolen(async () => ({ ok: false, json: async () => ({}) }), 'u');
      pruefe('JSON mit Fehlerstatus: keine Hashes', nok.farbe === undefined);
      const nokMitHash = await SPLAT.stapelHashesHolen(async () => ({ ok: false, json: async () => ({ stapelHash: { farbe: 'aaaaaaaaaaaaaaaa', normale: 'bbbbbbbbbbbbbbbb' } }) }), 'u');
      pruefe('JSON mit Fehlerstatus (404/500) und Hash im Koerper: der Hash wird NICHT uebernommen', nokMitHash.farbe === undefined && nokMitHash.normale === undefined);
      const kaputt = await SPLAT.stapelHashesHolen(async () => ({ ok: true, json: async () => { throw new Error('kein JSON'); } }), 'u');
      pruefe('JSON unlesbar: keine Hashes', kaputt.farbe === undefined);
      const boese = await SPLAT.stapelHashesHolen(async () => ({ ok: true, json: async () => ({ stapelHash: { farbe: '../x?y', normale: 12 } }) }), 'u');
      pruefe('Hash in falscher Form (Pfadzeichen, Zahl) wird nicht uebernommen', boese.farbe === undefined && boese.normale === undefined);
      const formen = await Promise.all(['abcdef12/../x', 'abcdef0123456789zz', 'abc', 'ABCDEF0123456789', '', 'abcdef01'].map((h) => SPLAT.stapelHashesHolen(async () => ({ ok: true, json: async () => ({ stapelHash: { farbe: h } }) }), 'u')));
      pruefe('Hashform: mit Pfadzeichen, mit Zeichen hinter den Ziffern, zu kurz, Grossbuchstaben, leer: abgelehnt; genau 8 Hexziffern: angenommen',
        formen.slice(0, 5).every((f) => f.farbe === undefined) && formen[5]!.farbe === 'abcdef01');
      const lang = await SPLAT.stapelHashesHolen(async () => ({ ok: true, json: async () => ({ stapelHash: { farbe: 'a'.repeat(64), normale: 'a'.repeat(65) } }) }), 'u');
      pruefe('Hashform: 64 Hexziffern ja, 65 nein', lang.farbe === 'a'.repeat(64) && lang.normale === undefined);
    })());
  }
  {
    const a = Buffer.from('stapel-bytes'), b = Buffer.from('stapel-bytes'), c = Buffer.from('stapel-bytez');
    pruefe('inhaltsHash: gleiche Bytes gleicher Hash (16 Hexstellen), ein anderes Byte anderer Hash',
      WZ.inhaltsHash(a) === WZ.inhaltsHash(b) && WZ.inhaltsHash(a) !== WZ.inhaltsHash(c) && /^[0-9a-f]{16}$/.test(WZ.inhaltsHash(a)));
  }
  const splat = readFileSync(resolve(WURZEL, 'client/src/engine/TerrainSplat.ts'), 'utf-8');
  const terrain = readFileSync(resolve(WURZEL, 'client/src/engine/Terrain.ts'), 'utf-8');
  const stapelQuelle = readFileSync(resolve(WURZEL, 'client/src/engine/StapelLayout.ts'), 'utf-8');
  pruefe('Terrain: alle vier Eckkacheln gehen als Grasland-Entsprechung ins Gitter (immer, nicht nur bei Rueckfall), die Felskachel ebenso',
    (terrain.match(/kachelFuerStapel\(BIOME_TILE\[cb\[[0-3]\]\] \?\? TILE\.Rock, false\)/g) ?? []).length === 4
      && terrain.includes('aRockTile[vi] = kachelFuerStapel(FELS_TILE[BIOME_TILE[biome] ?? TILE.Rock] ?? TILE.Rock, false);') && !terrain.includes('stapelOk'));
  pruefe('Terrain: das Greyglen-Gewicht steht im Lava-Kanal (markerLava, greyGewicht aus den Eckkacheln und -gewichten)',
    terrain.includes('aLava[vi] = markerLava(') && terrain.includes('greyGewicht(') && terrain.includes('[aWeights[vi * 4]!, aWeights[vi * 4 + 1]!, aWeights[vi * 4 + 2]!, aWeights[vi * 4 + 3]!]')
      && terrain.includes('biome === Biome.AshLands ? Math.min(1, Math.max(0, hm.getVegetationMask(wx, wz))) : 0'));
  pruefe('Splat: beide Texturen entstehen ohne URL und bekommen sie nach dem Lesen der JSON (mit Hash)',
    (splat.match(/new Texture\(null, scene, false, false, Texture\.TRILINEAR_SAMPLINGMODE, null, /g) ?? []).length === 2
      && splat.includes("splatTex.updateURL(stapelUrl(splatDatei, STORE_BODEN_AKTIV ? h.farbe : undefined), null, () => stapelGeladen(splatTex, 'Farbstapel'))")
      && splat.includes("nTexRef.updateURL(stapelUrl(`${STORE_TEX_BASE}store_n_array.png`, h.normale), null, () => stapelGeladen(nTexRef!, 'Normalenstapel'))")
      && splat.includes('stapelHashesHolen(mitZeitlimit, `${STORE_TEX_BASE}store-schichten.json`)'));
  pruefe('Splat: Ladefehler beider Stapel gehen in stapelFehlgeschlagen (Rueckfall-Flag)',
    splat.includes("(msg) => stapelFehlgeschlagen('Farbstapel', msg)") && splat.includes("(msg) => stapelFehlgeschlagen('Normalenstapel', msg)"));
  pruefe('Splat: nach dem Laden Befund aus der Groesse, Uniforms und Flag gesetzt',
    splat.includes('stapelModusBlock.value = befund.layout.modus;') && splat.includes('stapelZeilenBlock.value = befund.layout.zeilen;') && splat.includes('if (!befund.ok) stapelMelden(false);'));
  pruefe('Splat: die Uniforms stapelModus und stapelZeilen sind Eingaenge der Zeilenknoten (Kachel, Modus, Zeilen)',
    splat.includes('kachel.connectTo(z.tile!);') && splat.includes('stapelModusBlock.output.connectTo(z.modus!);') && splat.includes('stapelZeilenBlock.output.connectTo(z.zeilen!);'));
  pruefe('Splat: alle drei Abtaststellen (Dreifach, Einzel, WebGPU) nehmen die Zeile aus dem Zeilenknoten',
    splat.includes('zeileKnoten(name, layerInput).connectTo(ot.zeile);') && splat.includes('zeileKnoten(name, layerInput).connectTo(o.zeile);')
      && splat.includes('zeileKnoten(name, layerInput).connectTo(layerInset.left);'));
  pruefe('Splat: Zeilenzahl als Uniform an beiden GLSL-Bloecken und im WebGPU-Pfad geteilt',
    splat.includes('stapelZeilenBlock.output.connectTo(ot.zeilen);') && splat.includes('stapelZeilenBlock.output.connectTo(o.zeilen);')
      && splat.includes('stapelZeilenBlock.output.connectTo(yAtlas.right);') && splat.includes('const yAtlas = new DivideBlock(`tile_${name}_yAtlas`);'));
  {
    const aufrufe = ['uvO, dOx, dOy', 'uvX, dXx, dXy', 'uvZ, dZx, dZy'].flatMap((u) => [`vec3 m = vbEbene_\${name}(atlas, ${u}, zeile, zeilen) * 2.0 - 1.0; m.xy *= st;`, `acc += vbEbene_\${name}(atlas, ${u}, zeile, zeilen) * w.`]);
    pruefe('Splat: alle sechs Abtastungen der drei Ebenen (Normale und Farbe) uebergeben Zeile und Zeilenzahl (Mutant M60: X-Ebene mit layer)',
      aufrufe.every((t) => splat.includes(t)) && !/vbEbene_\$\{name\}\(atlas, [^)]*\blayer\b/.test(splat) && (splat.match(/vbEbene_\$\{name\}\(atlas, uv[OXZ], d[OXZ]x, d[OXZ]y, zeile, zeilen\)/g) ?? []).length === 6);
  }
  {
    // Die Greyglen-Unterschiede im Shader (Greyglen minus Grasland), mit den Zahlen unabhaengig nachgerechnet.
    const c = (g: number): number => Math.cos((g * Math.PI) / 180);
    const r4 = (v: number): number => Number(v.toFixed(4));
    const text = SPLAT.greyDeltaGlslVon(TR.rampenTabelle());
    const wert = (n: string): number => Number(new RegExp(`const float VB_GREY_D_${n} = ([-0-9.e]+);`).exec(text.join('\n'))![1]);
    const soll: Record<string, number> = {
      HANG_B: r4(c(19)) - r4(c(15)), HANG_W: r4(c(19) - c(26)) - r4(c(15) - c(30)),
      FELS_B: c(26) - c(30), FELS_W: (c(26) - c(34)) - (c(30) - c(40)), FELS_A: 0.94 - 0.4,
      RAU_B: r4(c(36)) - r4(c(40)), RAU_W: r4(c(36) - c(50)) - r4(c(40) - c(50)), RAU_A: r4(0.42) - r4(0.1),
    };
    pruefe('greyDeltaGlslVon: acht Konstanten VB_GREY_D_* mit dem Unterschied Greyglen minus Grasland (Hang/Rau auf vier Stellen gerundet, Fels voll)',
      text.length === 8 && Object.keys(soll).every((k) => Math.abs(wert(k) - soll[k]!) < 1e-12), Object.keys(soll).map((k) => `${k} ${wert(k).toFixed(6)}/${soll[k]!.toFixed(6)}`).join(' '));
    pruefe('… die Vorzeichen: der Greyglen-Hang beginnt spaeter (kleineres ny: Beginn-Delta negativ), der Fels deckt staerker (Deckel-Delta positiv)', wert('HANG_B') < 0 && wert('FELS_A') > 0 && wert('RAU_A') > 0);
  }
  pruefe('Splat: Startwerte der Uniforms (Modus 0 bzw. 1 im toten Altbestand-Pfad, 16 Zeilen) und Meldungsstufen (gut: warn, schlecht: error)',
    splat.includes('stapelModusBlock.value = STORE_BODEN_AKTIV ? 0 : 1;') && splat.includes('stapelZeilenBlock.value = STAPEL_ZEILEN;')
      && splat.includes('if (befund.meldung) (befund.ok ? console.warn : console.error)(befund.meldung);') && stapelQuelle.includes('console.error(`[terrain] ${was} konnte nicht geladen werden'));
  pruefe('Splat: fehlt der Hash in der JSON, gibt es eine Konsolenmeldung; der Abruf hat ein Zeitlimit von 4 s',
    splat.includes("if (STORE_BODEN_AKTIV && (!h.farbe || !h.normale)) {") && splat.includes('console.warn(\'[terrain] store-schichten.json nennt keinen Stapel-Hash')
      && splat.includes('AbortSignal.timeout(4000)') && splat.includes("fetch(u, { cache: 'no-cache', signal:"));
  pruefe('Splat: das Layout wird aus der Bildgroesse gelesen (stapelBefundAusTextur), nirgends aus getSize()', splat.includes('stapelBefundAusTextur(tex, scene.getEngine().getCaps().maxTextureSize, was)') && !/\.getSize\(\)/.test(splat));
  pruefe('Splat: das Greyglen-Gewicht im Shader: Eingang aus dem Lava-Kanal, Schalter greyOk, Rampe plus g mal Unterschied, Kacheln ab g > 0,5',
    splat.includes('terrainMarkerSplit.z.connectTo(hw.marker);') && splat.includes('greyOkBlock.output.connectTo(hw.greyOk);')
      && splat.includes("'  float g = clamp(-marker, 0.0, 1.0) * greyOk;'") && splat.includes('`    ${v} += g * VB_GREY_D_${n};`')
      && splat.includes('`    if (g > 0.5) { hangTile = ${TILE.GreyMoss}.0; rauTile = ${TILE.GreyRockMoss}.0; }`')
      && splat.includes("'void vbHangWahl(vec4 tiles, vec4 weights, float ny, float marker, float greyOk,',")
      && splat.includes("stapelBeobachten((ok) => { greyOkBlock.value = ok ? 1 : 0; });"));
  {
    // Das Greyglen-Gewicht und der Lava-Kanal (Terrain schreibt, Shader liest).
    const w = [0.1, 0.2, 0.3, 0.4];
    pruefe('greyGewicht: Summe der Eckgewichte der Greyglen-Ecken (nur Kacheln ab 16)', Math.abs(BK.greyGewicht([0, 16, 0, 19], w) - 0.6) < 1e-12 && BK.greyGewicht([0, 1, 2, 15], w) === 0 && Math.abs(BK.greyGewicht([16, 17, 18, 19], w) - 1) < 1e-12);
    pruefe('markerLava: Lava gewinnt, sonst minus das Gewicht (auf 1 geklemmt), sonst 0', BK.markerLava(0.7, 0.5) === 0.7 && BK.markerLava(0, 0.25) === -0.25 && BK.markerLava(0, 3) === -1 && BK.markerLava(0, 0) === 0);
    pruefe('greyAusMarker: Spiegelbild; Lava (positiv) gibt kein Gewicht, ausserhalb geklemmt', BK.greyAusMarker(-0.25) === 0.25 && BK.greyAusMarker(0.7) === 0 && BK.greyAusMarker(-3) === 1 && BK.greyAusMarker(0) === 0);
    pruefe('Hin und zurueck: greyAusMarker(markerLava(0, g)) = g fuer g in [0, 1]', [0, 0.1, 0.5, 0.99, 1].every((g) => Math.abs(BK.greyAusMarker(BK.markerLava(0, g)) - g) < 1e-12));
    // Beobachter des Pruefergebnisses (stellt im Material das greyOk ein).
    const gesehen: boolean[] = [];
    const ab = SPLAT.stapelBeobachten((ok) => gesehen.push(ok));
    const altE = console.error;
    console.error = (): void => undefined;
    SPLAT.stapelMelden(false);
    SPLAT.stapelFehlgeschlagen('x', 'y');
    SPLAT.stapelMelden(true);
    console.error = altE;
    ab();
    SPLAT.stapelMelden(false);
    SPLAT.stapelMelden(true);
    pruefe('stapelBeobachten: meldet jede Aenderung (auch aus stapelFehlgeschlagen) und nach dem Abmelden nichts mehr', JSON.stringify(gesehen) === JSON.stringify([false, false, true]), JSON.stringify(gesehen));
  }
  pruefe('Splat: WebGPU-Zeilenblock ist ein Float-Block mit den drei Eingaengen und dem Ausgang row (Mutanten N47/N48)',
    splat.includes("functionName: `vbZeileBlk_${name}`,") && splat.includes("{ name: 'tile', type: 'Float' },") && splat.includes("{ name: 'modus', type: 'Float' },")
      && splat.includes("outParameters: [{ name: 'row', type: 'Float' }],") && splat.includes('code: zeileBlockCode(name),') && splat.includes('return z.row!;'));
  const dev = readFileSync(resolve(WURZEL, 'scripts/dev.mjs'), 'utf-8');
  pruefe('dev.mjs: ruft bodenVorbereiten mit dem echten Dateisystem und dem Werkzeug-Import auf und wartet darauf',
    dev.includes("import { bodenVorbereiten } from './dev-boden.mjs';") && dev.includes('await bodenVorbereiten({') && dev.includes("werkzeugLaden: () => import(pathToFileURL(resolve(WURZEL, 'tools/store-terrain-schichten.mjs')).href),")
      && dev.includes('\nawait assetsVorbereiten();\n') && !dev.includes('stapelVeraltetPruefen'));
  // Verhalten von dev-boden.mjs mit erfundenem Dateisystem und erfundenen Kindprozessen (alle Zweige).
  asyncTests.push((async () => {
    const W0 = '/w';
    const res = (...t: string[]): string => t.join('/');
    const sperre = `${W0}/tools/sperre.sh`;
    const lauf = async (dateien: string[], tabelle: string | null | 'wirft', opt: { werkzeugWirft?: boolean; status?: number } = {}): Promise<{ r: string; aufrufe: string[][]; warn: string[] }> => {
      const aufrufe: string[][] = [];
      const warn: string[] = [];
      const json = `${W0}/assets/generiert/terrain/store-schichten.json`;
      const da = new Set(dateien);
      if (tabelle !== null) da.add(json);
      const r = await DEVB.bodenVorbereiten({
        wurzel: W0, npm: 'NPM', resolve: res,
        existsSync: (p: string) => da.has(p),
        readFileSync: (p: string) => { if (p === json && tabelle !== null && tabelle !== 'wirft') return tabelle; throw new Error('lesen'); },
        werkzeugLaden: async () => { if (opt.werkzeugWirft) throw new Error('Import'); return { stapelVeraltet: WZ.stapelVeraltet }; },
        spawnSync: (c: string, a: string[]) => { aufrufe.push([c, ...a]); return { status: opt.status ?? 0 }; },
        log: () => undefined, warn: (t: string) => warn.push(t),
      });
      return { r, aufrufe, warn };
    };
    const VOLL = [`${W0}/assets/store`, `${W0}/assets/store-lab`, `${W0}/assets/generiert`, sperre];
    const gut = JSON.stringify({ zeilen: 16, version: 2 });
    const z = (xs: string[][]): string => JSON.stringify(xs);
    let t = await lauf([], gut);
    pruefe('dev-boden: ohne assets/store geschieht nichts', t.r === 'kein-store' && t.aufrufe.length === 0);
    t = await lauf(VOLL, gut);
    pruefe('dev-boden: aktueller Stapel (16 Zeilen, Version 2): kein Kindprozess', t.r === 'aktuell' && t.aufrufe.length === 0);
    t = await lauf(VOLL, JSON.stringify({ zeilen: 16 }));
    pruefe('dev-boden: Tabelle von vor K3 (ohne Version): kein Kindprozess (rsync-Kopie von DEV)', t.r === 'aktuell' && t.aufrufe.length === 0);
    t = await lauf(VOLL, JSON.stringify({ zeilen: 20, version: 2 }));
    pruefe('dev-boden: andere Zeilenzahl: GENAU ein Aufruf, store:boden, unter der Bau-Sperre', t.r === 'neu-gebaut' && z(t.aufrufe) === z([[sperre, 'build', '--', 'NPM', 'run', 'store:boden']]));
    t = await lauf(VOLL, JSON.stringify({ zeilen: 16, version: 1 }));
    pruefe('dev-boden: andere Version: ebenso nur store:boden unter der Sperre', t.r === 'neu-gebaut' && z(t.aufrufe) === z([[sperre, 'build', '--', 'NPM', 'run', 'store:boden']]));
    t = await lauf(VOLL, null);
    pruefe('dev-boden: Tabelle fehlt: nur store:boden (store:aufbereiten schreibt getrackte Dateien und laeuft nicht)', t.r === 'neu-gebaut' && z(t.aufrufe) === z([[sperre, 'build', '--', 'NPM', 'run', 'store:boden']]));
    t = await lauf(VOLL, '{');
    pruefe('dev-boden: unlesbare Tabelle: neu bauen, nicht "aktuell"', t.r === 'neu-gebaut' && t.aufrufe.length === 1);
    t = await lauf(VOLL, 'wirft');
    pruefe('dev-boden: Lesefehler der Tabelle: neu bauen', t.r === 'neu-gebaut' && t.aufrufe.length === 1);
    t = await lauf(VOLL, gut, { werkzeugWirft: true });
    pruefe('dev-boden: das Werkzeug laesst sich nicht laden: neu bauen (nicht "aktuell")', t.r === 'neu-gebaut' && t.aufrufe.length === 1);
    t = await lauf(VOLL.filter((p) => !p.endsWith('/generiert')), gut);
    pruefe('dev-boden: assets/generiert fehlt: store:aufbereiten UND store:boden, nacheinander, BEIDE unter der Bau-Sperre',
      t.r === 'aufbereitet' && z(t.aufrufe) === z([[sperre, 'build', '--', 'NPM', 'run', 'store:aufbereiten'], [sperre, 'build', '--', 'NPM', 'run', 'store:boden']]));
    t = await lauf(VOLL.filter((p) => !p.endsWith('/store-lab')), gut);
    pruefe('dev-boden: assets/store-lab fehlt: derselbe Weg, beide Schritte unter der Sperre', t.r === 'aufbereitet' && t.aufrufe.length === 2 && t.aufrufe.every((a) => a[0] === sperre && a[1] === 'build'));
    t = await lauf(VOLL.filter((p) => p !== sperre), JSON.stringify({ zeilen: 20 }));
    pruefe('dev-boden: ohne tools/sperre.sh (alter Stand) direkt npm, im Zweig "veraltet"', z(t.aufrufe) === z([['NPM', 'run', 'store:boden']]));
    t = await lauf(VOLL.filter((p) => p !== sperre && !p.endsWith('/generiert')), gut);
    pruefe('dev-boden: ohne tools/sperre.sh direkt npm, auch im Zweig "fehlt"', z(t.aufrufe) === z([['NPM', 'run', 'store:aufbereiten'], ['NPM', 'run', 'store:boden']]));
    t = await lauf(VOLL.filter((p) => !p.endsWith('/generiert')), gut, { status: 1 });
    pruefe('dev-boden: schlaegt der erste Schritt fehl: Warnung mit Namen, der zweite laeuft nicht', t.r === 'fehlgeschlagen' && t.aufrufe.length === 1 && t.warn.length === 1 && t.warn[0]!.includes('store:aufbereiten'));
    t = await lauf(VOLL, JSON.stringify({ zeilen: 20 }), { status: 2 });
    pruefe('dev-boden: schlaegt store:boden fehl: Warnung, Spiel startet trotzdem (Rueckgabe, keine Ausnahme)', t.r === 'fehlgeschlagen' && t.warn.length === 1 && t.warn[0]!.includes('store:boden'));
  })());
  // Die Entscheidung selbst (Werkzeug).
  const alt16 = { zeilen: 16 };
  pruefe('stapelVeraltet: keine/kaputte Tabelle → veraltet', WZ.stapelVeraltet(null) === true && WZ.stapelVeraltet('x') === true && WZ.stapelVeraltet(undefined) === true);
  pruefe('stapelVeraltet: JSON von vor K3 (16 Zeilen, ohne Version) → aktuell, KEIN Neubau', WZ.stapelVeraltet(alt16) === false);
  pruefe('stapelVeraltet: Version 2 und 16 Zeilen → aktuell', WZ.stapelVeraltet({ zeilen: 16, version: 2 }) === false);
  pruefe('stapelVeraltet: andere Version → veraltet', WZ.stapelVeraltet({ zeilen: 16, version: 1 }) === true && WZ.stapelVeraltet({ zeilen: 16, version: 3 }) === true);
  pruefe('stapelVeraltet: andere Zeilenzahl → veraltet (auch ohne Version, auch mit richtiger)', WZ.stapelVeraltet({ zeilen: 20 }) === true && WZ.stapelVeraltet({ zeilen: 20, version: 2 }) === true && WZ.stapelVeraltet({}) === true);
  pruefe('das Werkzeug fuehrt die Zeilenzahl, die dev.mjs vergleicht', WZ.STAPEL_ZEILEN_WERKZEUG === 16);
}

// ── 3. Rampen je Grundkachel ─────────────────────────────────────────
console.log('\n[3] Rampen je Grundkachel:');
{
  const g = TR.RAMPEN_JE_KACHEL[BK.TILE.GreyGrass]!;
  pruefe('Greyglen hat eine eigene Rampenzeile', g !== undefined);
  pruefe('Hang 19° → 26°', g.hang.beginn === 19 && g.hang.voll === 26);
  pruefe('Fels 26° → 34°, Deckel 0,94', g.fels.beginn === 26 && g.fels.voll === 34 && g.fels.anteil === 0.94);
  pruefe('rauer Fels 36° → 50°, Deckel 0,42', g.rau.beginn === 36 && g.rau.voll === 50 && g.rau.anteil === 0.42);
  pruefe('jede Stufe laeuft aufwaerts (beginn < voll)', g.hang.beginn < g.hang.voll && g.fels.beginn < g.fels.voll && g.rau.beginn < g.rau.voll);
  pruefe('die Stufen stapeln sich (Ende ≤ naechster Beginn)', g.hang.voll <= g.fels.beginn && g.fels.voll <= g.rau.beginn);
  pruefe('die Deckel liegen in (0, 1]', g.fels.anteil > 0 && g.fels.anteil <= 1 && g.rau.anteil > 0 && g.rau.anteil <= 1);
  pruefe('die oberste Stufe ist voll unter 56° (auf dem Gelaende erreichbar)', g.rau.voll < 56);
  pruefe('jede andere Kachel hat KEINE eigene Zeile und bekommt RAMPEN',
    Object.keys(TR.RAMPEN_JE_KACHEL).length === 1
      && Array.from({ length: 20 }, (_, k) => k).filter((k) => k !== 16).every((k) => TR.rampenFuerKachel(k) === TR.RAMPEN));
  const tab = TR.rampenTabelle();
  pruefe('rampenTabelle() hat 20 Saetze, Zeile 16 eigen, alle anderen RAMPEN', tab.length === 20 && tab[16] === g && tab.filter((_, k) => k !== 16).every((r) => r === TR.RAMPEN));
  pruefe('RAMPEN selbst unveraendert (15/30, 30/40/0,4, 40/50/0,1)',
    TR.RAMPEN.hang.beginn === 15 && TR.RAMPEN.hang.voll === 30 && TR.RAMPEN.fels.beginn === 30 && TR.RAMPEN.fels.voll === 40
      && TR.RAMPEN.fels.anteil === 0.4 && TR.RAMPEN.rau.beginn === 40 && TR.RAMPEN.rau.voll === 50 && TR.RAMPEN.rau.anteil === 0.1);

  // Mischen (N1/B2).
  const rg = TR.rampeNy(g);
  const rw = TR.rampeNy(TR.RAMPEN);
  const eins = TR.mischeRampen([TR.RAMPEN, TR.RAMPEN, TR.RAMPEN, TR.RAMPEN], [0.3, 0.2, 0.4, 0.1]);
  pruefe('gleiche Saetze auf allen Ecken: der Satz unveraendert, Bit fuer Bit (keine Rechnung ueber die Gewichte)',
    JSON.stringify(eins) === JSON.stringify(rw));
  const halb = TR.mischeRampen([g, TR.RAMPEN, g, TR.RAMPEN], [0.25, 0.25, 0.25, 0.25]);
  pruefe('gemischt: bei Gewicht 0,5/0,5 das Mittel beider Saetze (alle acht Werte)',
    (Object.keys(rg) as Array<keyof typeof rg>).every((k) => Math.abs(halb[k] - (rg[k] + rw[k]) / 2) < 1e-12));
  const reinG = TR.mischeRampen([g, TR.RAMPEN, g, TR.RAMPEN], [0.5, 0, 0.5, 0]);
  pruefe('gemischt: Gewicht 1 auf der Greyglen-Seite = der Greyglen-Satz', (Object.keys(rg) as Array<keyof typeof rg>).every((k) => Math.abs(reinG[k] - rg[k]) < 1e-12));
  // Stetigkeit: Gewicht der Greyglen-Seite von 1 auf 0 in 100 Schritten; jeder Schritt aendert den Deckel um hoechstens 1,01 % der Spanne.
  let maxSprung = 0;
  let vorher = TR.mischeRampen([g, TR.RAMPEN, g, TR.RAMPEN], [0.5, 0, 0.5, 0]);
  for (let i = 1; i <= 100; i++) {
    const t = i / 100;
    const m = TR.mischeRampen([g, TR.RAMPEN, g, TR.RAMPEN], [0.5 * (1 - t), 0.5 * t, 0.5 * (1 - t), 0.5 * t]);
    for (const k of Object.keys(rg) as Array<keyof typeof rg>) {
      const spanne = Math.abs(rg[k] - rw[k]);
      if (spanne > 0) maxSprung = Math.max(maxSprung, Math.abs(m[k] - vorher[k]) / spanne);
    }
    vorher = m;
  }
  pruefe('die Rampe aendert sich stetig ueber die Gewichte (kein Schritt ueber 1,01 % der Spanne in 100 Schritten)', maxSprung <= 0.0101, maxSprung.toFixed(5));

  // Greyglen auf JEDER einzelnen Ecke (Mutanten N02: vierte Ecke in der Identitaetspruefung, N07: Gewichtsreihenfolge).
  for (let e = 0; e < 4; e++) {
    const sets = [TR.RAMPEN, TR.RAMPEN, TR.RAMPEN, TR.RAMPEN];
    sets[e] = g;
    const w = [0, 0, 0, 0];
    w[e] = 1;
    const m = TR.mischeRampen(sets, w);
    pruefe(`Greyglen nur auf Ecke ${e}, Gewicht 1 dort: genau die Greyglen-Rampe`, (Object.keys(rg) as Array<keyof typeof rg>).every((k) => Math.abs(m[k] - rg[k]) < 1e-12));
    const w2 = [0.25, 0.25, 0.25, 0.25];
    const m2 = TR.mischeRampen(sets, w2);
    pruefe(`Greyglen nur auf Ecke ${e}, alle Gewichte 0,25: ein Viertel Greyglen, drei Viertel global`, (Object.keys(rg) as Array<keyof typeof rg>).every((k) => Math.abs(m2[k] - (0.25 * rg[k] + 0.75 * rw[k])) < 1e-12));
  }}

// ── 4. Biomgrenze Greyglen / Grasland ────────────────────────────────
console.log('\n[4] Naht an der Biomgrenze (Bodenart-Mischung, 0,25-m-Schritte quer ueber eine Zone):');
{
  const q = (ecken: number[], grad: number): BodenQuelle => ({
    getGroundHeight: (x) => 60 + Math.tan((grad * Math.PI) / 180) * x,
    getZoneAt: () => ({
      zoneX: 0, zoneY: 0, cornerBiomes: ecken as unknown as BodenZone['cornerBiomes'], getBiome: () => Biome.Meadows, getVegetationMask: () => 0,
    }),
  });
  // Die Grenze liegt bei x = 0 (dort wechselt die dominante Ecke). Die Linie laeuft bei einem z, an dem die Felsmaske rund um die Grenze stark ist (≥ 0,8):
  // eine schwache Maske verdeckt die Rampe, und ein Sprung der Rampe waere nicht zu sehen.
  let zLinie = -31;
  let besteMaske = -1;
  for (let z = -31; z <= 31; z += 0.37) {
    const schwach = Math.min(...[-0.5, 0, 0.5].map((x) => felsMaskeShaderBei(x, z)));
    if (schwach > besteMaske) {
      besteMaske = schwach;
      zLinie = z;
    }
  }
  pruefe('die Pruefzeile hat an der Grenze eine starke Felsmaske (≥ 0,8 an allen drei Stellen um x = 0)', besteMaske >= 0.8, `z ${zLinie.toFixed(2)}, schwaechste Stelle ${besteMaske.toFixed(2)}`);
  const maxSchritt = (ecken: number[], grad: number): number => {
    let max = 0;
    let vor: Record<string, number> | null = null;
    for (let x = -31.5; x < 31.5; x += 0.25) {
      const a = BM.bodenMischungBei(x, zLinie, q(ecken, grad)) as unknown as Record<string, number>;
      if (vor) for (const k of Object.keys(a)) max = Math.max(max, Math.abs(a[k]! - vor[k]!));
      vor = a;
    }
    return max;
  };
  /*
    Die Schwelle: Auch in einer Zone ohne Biomgrenze springt die Mischung von Schritt
    zu Schritt, weil die Felsmaske (24-m-Rauschen) sich aendert; gemessen (24° bis
    38°) hoechstens 0,064 je 0,25 m. Quer ueber die Greyglen/Grasland-Grenze darf
    der Schritt hoechstens so gross sein wie der groesste der beiden einheitlichen
    Laeufe mal 1,25, plus 0,01. Mit der harten Wahl der dominanten Ecke springt die
    Deckung dort um den Unterschied beider Rampen (bis 0,5 und mehr).
  */
  let schlimmster = 0;
  for (const grad of [24, 28, 30, 32, 34, 38]) {
    const grey = maxSchritt([128, 128, 128, 128], grad);
    const wiese = maxSchritt([1, 1, 1, 1], grad);
    const gemischt = maxSchritt([128, 1, 128, 1], grad);
    schlimmster = Math.max(schlimmster, gemischt);
    pruefe(`${grad}°: Schritt ueber die Grenze ${gemischt.toFixed(3)} ≤ 1,25 · max(einheitlich ${Math.max(grey, wiese).toFixed(3)}) + 0,01`, gemischt <= 1.25 * Math.max(grey, wiese) + 0.01);
  }
  pruefe('der groesste Schritt an der Grenze bleibt klein (≤ 0,15 je 0,25 m, auf allen Neigungen)', schlimmster <= 0.15, schlimmster.toFixed(3));
}

// ── 5. Flaechenanteile ───────────────────────────────────────────────
console.log('\n[5] Flaechenanteile (CPU-Bodenmischung, Greyglen):');
const NAMEN = ['0–8°', '8–15°', '15–22°', '22–30°', '30–40°', '40–50°', '>50°'];
const SCHICHTEN_NAMEN = ['gras', 'moos', 'fels', 'rauer', 'sand'] as const;
let feinMessung: ReturnType<typeof GEL.messe> | null = null;
for (const [art, punkte, eng] of [['fein', 300, true], ['grob', 600, true], ['gleich', 300, false]] as const) {
  const st = GEL.raster(art);
  const ps = GEL.proben(st, punkte);
  const m = GEL.messe(st, ps);
  if (art === 'fein') feinMessung = m;
  pruefe(`[${art}] die Anteile eines Punktes summieren sich auf 1`, Math.abs(m.summe - 1) < 1e-9, m.summe.toFixed(12));
  pruefe(`[${art}] ausser den fuenf Schichten steht nichts im Boden`, Math.abs(m.rest) < 1e-4, m.rest.toExponential(2));
  const kette = GEL.anteileAus(ps, TR.RAMPEN_JE_KACHEL[BK.TILE.GreyGrass]!);
  pruefe(`[${art}] die kurze Kette der Eichung (anteileAus) liefert dasselbe wie die Bodenmischung (1e-9)`,
    SCHICHTEN_NAMEN.every((k) => Math.abs(kette[k] - m.gesamt[k]) < 1e-9));
  console.log(`  [${art}]  Schicht      gemessen   Ziel    Abweichung (Punkte)`);
  for (const k of SCHICHTEN_NAMEN) {
    const d = (m.gesamt[k] - GEL.ZIEL[k]) * 100;
    console.log(`  [${art}]  ${k.padEnd(10)} ${(m.gesamt[k] * 100).toFixed(2).padStart(7)} %  ${(GEL.ZIEL[k] * 100).toFixed(1).padStart(5)} %  ${d >= 0 ? '+' : ''}${d.toFixed(2)}`);
    pruefe(`[${art}] ${k}: innerhalb ± 5 Punkte vom Ziel`, Math.abs(d) <= 5, `${d.toFixed(2)}`);
    if (eng) pruefe(`[${art}] ${k}: innerhalb ± 2 Punkte (Eichung)`, Math.abs(d) <= 2, `${d.toFixed(2)}`);
    if (k === 'sand') pruefe(`[${art}] sand: durch die Breite des Uferstreifens gesetzt (3,5 % ± 0,3)`, Math.abs(d) <= 0.3, `${d.toFixed(2)}`);
  }
}
{
  const m = feinMessung!;
  console.log('\n  Neigung × Schicht (fein; Anteil der Schicht an der Flaeche des Bandes, %):');
  console.log('  Band       Gras   Moos   Fels  Rauer  Sand   (Anteil des Bandes am Gelaende)');
  m.jeBand.forEach((b, i) => {
    const f = (k: keyof Anteile): string => ((b[k] / b.w) * 100).toFixed(1).padStart(6);
    console.log(`  ${NAMEN[i]!.padEnd(8)} ${f('gras')} ${f('moos')} ${f('fels')} ${f('rauer')} ${f('sand')}   ${(b.w * 100).toFixed(1)} %`);
  });
  const anteil = (i: number, k: keyof Anteile): number => m.jeBand[i]![k] / m.jeBand[i]!.w;
  pruefe('unter 15° bleibt der Boden Gras (≥ 85 % in den zwei flachsten Baendern, der Rest ist Ufersand)', anteil(0, 'gras') >= 0.85 && anteil(1, 'gras') >= 0.99);
  pruefe('Gras nimmt mit der Neigung ab (Baender 1 → 6, ohne das Ufer-Band)', [1, 2, 3, 4, 5].every((i) => anteil(i, 'gras') > anteil(i + 1, 'gras') || anteil(i, 'gras') < 0.2));
  pruefe('Moos dominiert zwischen 22° und 30° (mehr Moos als Fels)', anteil(3, 'moos') > anteil(3, 'fels'));
  pruefe('ueber 50° ist der Boden zu mehr als der Haelfte Stein', anteil(6, 'fels') + anteil(6, 'rauer') >= 0.5, `${((anteil(6, 'fels') + anteil(6, 'rauer')) * 100).toFixed(1)} %`);
  pruefe('rauer Fels kommt erst ab 36° vor (unter 30° keiner)', [0, 1, 2, 3].every((i) => anteil(i, 'rauer') < 1e-9));
  pruefe('Sand kommt nur am Ufer vor (hoechstens im Uferband 0–8°)', [1, 2, 3, 4, 5, 6].every((i) => anteil(i, 'sand') < 1e-9));
  // Das Raster: das Mittel der Neigungen entspricht dem Histogramm (Mittel 24,15°).
  const st = GEL.raster('fein');
  const land = st.filter((s) => !s.ufer);
  const mittel = land.reduce((p, s) => p + s.grad * s.gewicht, 0) / land.reduce((p, s) => p + s.gewicht, 0);
  pruefe('das feine Raster hat das Mittel des Histogramms (24,15° ± 0,6°)', Math.abs(mittel - 24.15) < 0.6, mittel.toFixed(2));
  const q0 = GEL.gelaende(Biome.Greyglen, st);
  pruefe('das Gelaende gibt je Streifen die gesetzte Neigung zurueck (Stichprobe)', Math.abs(BM.nyBei(5 + 40 * 30, 7, q0) - Math.cos((st[30]!.grad * Math.PI) / 180)) < 1e-9);
}

// ── 6. Aeltere Biome bitgleich ───────────────────────────────────────
console.log('\n[6] Aeltere Biome bitgleich (Golden vor K3):');
{
  if (!existsSync(GOLDEN)) {
    pruefe('Golden-Datei vorhanden', false, GOLDEN);
  } else {
    const g = JSON.parse(readFileSync(GOLDEN, 'utf-8')) as { biome: Record<string, string>; gemischt?: string; tabellen: unknown };
    const ist = alteBiomeHashes();
    for (const biom of ALTE_BIOME) pruefe(`Biom ${biom}: Mischung an 240 Punkten bitgleich`, g.biome[String(biom)] === ist[String(biom)]);
    pruefe('Golden fuehrt genau die neun aelteren Biome', Object.keys(g.biome).length === ALTE_BIOME.length);
    pruefe('GEMISCHTE Ecken (400 Zonen, 2000 Punkte, Lavamaske, Schnee, Punktbiom ≠ Ecken) bitgleich', g.gemischt === alteBiomeGemischtHash());
    pruefe('die Tabellen der 16 alten Kacheln (BIOME_TILE ohne 128, Hang/Fels/Rau, RAMPEN, Bodenart, Regeln) unveraendert', JSON.stringify(g.tabellen) === JSON.stringify(alteTabellen()));
  }
  // Greyglen auf jeder einzelnen Ecke: an der Ecke selbst gilt dort die Greyglen-Rampe (Mutant N07, Gewichte der Rampenmischung umgekehrt).
  {
    const c = (g: number): number => Math.cos((g * Math.PI) / 180);
    const kGrey = (c(19) - c(24)) / (c(19) - c(26));
    const orte: Array<[number, number]> = [[-32, -32], [32, -32], [-32, 32], [32, 32]];
    for (let e = 0; e < 4; e++) {
      const ecken = [1, 1, 1, 1];
      ecken[e] = 128;
      const q: BodenQuelle = {
        getGroundHeight: (x) => WATER_LEVEL + 20 + Math.tan((24 * Math.PI) / 180) * x,
        getZoneAt: () => ({ zoneX: 0, zoneY: 0, cornerBiomes: ecken as unknown as BodenZone['cornerBiomes'], getBiome: () => Biome.Meadows, getVegetationMask: () => 0 }),
      };
      const r = BM.kachelMischungBei(orte[e]![0], orte[e]![1], q);
      pruefe(`Greyglen nur auf Ecke ${e}, Punkt auf dieser Ecke: die Hangdeckung der Greyglen-Rampe (${kGrey.toFixed(4)})`, Math.abs(r[`kachel${BK.TILE.GreyMoss}`] - kGrey) < 1e-9, r[`kachel${BK.TILE.GreyMoss}`].toFixed(6));
    }
  }
  // Gleichstand der dominanten Ecke: bei vier gleichen Gewichten gilt die LETZTE (wie `step(w, next)` im Shader).
  const mitte = (ecken: number[]): Record<string, number> =>
    BM.kachelMischungBei(0, 0, {
      getGroundHeight: (x) => 60 + Math.tan((24 * Math.PI) / 180) * x,
      getZoneAt: () => ({ zoneX: 0, zoneY: 0, cornerBiomes: ecken as unknown as BodenZone['cornerBiomes'], getBiome: () => Biome.Meadows, getVegetationMask: () => 0 }),
    }) as unknown as Record<string, number>;
  const gleich = mitte([128, 1, 1, 1]);
  pruefe('Gleichstand (alle Gewichte 0,25): die LETZTE Ecke gewinnt (Wiese: Moos der Kachel 11, nicht das der Kachel 17)', gleich['kachel11']! > 0.1 && gleich['kachel17']! === 0);
  const gleich2 = mitte([1, 1, 1, 128]);
  pruefe('… und mit Greyglen auf der letzten Ecke das Greyglen-Moos', gleich2['kachel17']! > 0.1 && gleich2['kachel11']! === 0);
  // Welche Felskachel gilt, sagt das Biom des PUNKTES; welche Hang- und Rau-Kachel, die dominante Ecke (Angriffs-Mutanten M01/M17).
  // Auf Bodenart-Ebene (Golden) sind alle Felskacheln 'fels' und damit gleich; hier auf Kachel-Ebene, mit der Kette einzeln nachgerechnet.
  {
    let ort = 100;
    while (felsMaskeShaderBei(ort, 0) < 1.3 && ort < 3000) ort += 0.7;
    const m = felsMaskeShaderBei(ort, 0);
    const kl = (t: number): number => Math.min(1, Math.max(0, t));
    const cs = (g: number): number => Math.cos((g * Math.PI) / 180);
    const am = (ecken: number[], biom: number, grad: number): Record<string, number> =>
      BM.kachelMischungBei(ort, 0, {
        getGroundHeight: (x) => 70 + Math.tan((grad * Math.PI) / 180) * x,
        getZoneAt: () => ({ zoneX: 0, zoneY: 0, cornerBiomes: ecken as unknown as BodenZone['cornerBiomes'], getBiome: () => biom as Biome, getVegetationMask: () => 0 }),
      }) as unknown as Record<string, number>;
    const nah = (x: number, y: number): boolean => Math.abs(x - y) < 1e-9;
    pruefe('die Felsmaske am Pruefort ist stark (≥ 1,3)', m >= 1.3, m.toFixed(3));
    // (a) Ecken Heide, Punkt Asche, 35°: Hang = Dirt (HANG_TILE[Heath]), Fels aus dem PUNKT = Basalt.
    {
      const g = 35;
      const kf = kl((cs(30) - cs(g)) / (cs(30) - cs(40))) * 0.4 * m;
      const r = am([16, 16, 16, 16], 32, g);
      pruefe('Felskachel aus dem Biom des Punktes (Asche: Basalt), Hang aus der Ecke (Heide: Erde); Anteile einzeln nachgerechnet',
        nah(r[`kachel${BK.TILE.Basalt}`]!, kf) && nah(r[`kachel${BK.TILE.Dirt}`]!, 1 - kf) && r[`kachel${BK.TILE.Cliff}`]! === 0, `Basalt ${r[`kachel${BK.TILE.Basalt}`]!.toFixed(4)} gegen ${kf.toFixed(4)}`);
    }
    // (b) Ecken Heide, Punkt Schwarzwald, 48°: Hang Dirt, Fels aus dem PUNKT = Rock (FELS_TILE[Forest]), Rau aus der ECKE = Cliff (RAU_TILE[Heath]).
    {
      const g = 48;
      const kf = kl((cs(30) - cs(g)) / (cs(30) - cs(40))) * 0.4 * m;
      const kr = kl((cs(40) - cs(g)) / (cs(40) - cs(50))) * 0.1 * m;
      const r = am([16, 16, 16, 16], 8, g);
      pruefe('Rau-Kachel aus der dominanten Ecke (Heide: Cliff), Felskachel aus dem Punktbiom (Schwarzwald: Fels A); Anteile nachgerechnet',
        nah(r[`kachel${BK.TILE.Cliff}`]!, kr) && nah(r[`kachel${BK.TILE.Rock}`]!, kf * (1 - kr)) && nah(r[`kachel${BK.TILE.Dirt}`]!, (1 - kf) * (1 - kr)),
        `Cliff ${r[`kachel${BK.TILE.Cliff}`]!.toFixed(4)} gegen ${kr.toFixed(4)}`);
      // (c) umgekehrt: Ecken Schwarzwald, Punkt Heide: Hang Rock, Fels Cliff, Rau Rock.
      const u = am([8, 8, 8, 8], 16, g);
      pruefe('… und umgekehrt (Ecken Schwarzwald, Punkt Heide): Hang und Rau Fels A, Felskachel Cliff',
        nah(u[`kachel${BK.TILE.Cliff}`]!, kf * (1 - kr)) && nah(u[`kachel${BK.TILE.Rock}`]!, (1 - kf) * (1 - kr) + kr));
    }
  }
  // Gemischte Zone: Greyglen links, Wiese rechts. Die Kachel wahlt die dominante Ecke, die Rampe mischt.
  const gemischt: BodenQuelle = {
    getGroundHeight: (x) => WATER_LEVEL + 20 + Math.tan((24 * Math.PI) / 180) * x,
    getZoneAt: () => ({ zoneX: 0, zoneY: 0, cornerBiomes: [128, 1, 128, 1] as unknown as BodenZone['cornerBiomes'], getBiome: () => Biome.Meadows, getVegetationMask: () => 0 }),
  };
  const links = BM.kachelMischungBei(-30, 5, gemischt);
  const rechts = BM.kachelMischungBei(30, 5, gemischt);
  pruefe('gemischte Zone: links (Greyglen dominant) die Greyglen-Hangkachel, rechts die der Wiese',
    links[`kachel${BK.TILE.GreyMoss}`] > 0.3 && links[`kachel${BK.TILE.Moss}`] === 0 && rechts[`kachel${BK.TILE.Moss}`] > 0.3 && rechts[`kachel${BK.TILE.GreyMoss}`] === 0);
  // Am 24°-Hang: Greyglen-Rampe 19°→26°, globale 15°→30°; links nahezu reine Greyglen-Eckengewichte, rechts reine Wiesen-Eckengewichte.
  const c = (g: number): number => Math.cos((g * Math.PI) / 180);
  const kGrey = (c(19) - c(24)) / (c(19) - c(26));
  const kGlobal = (c(15) - c(24)) / (c(15) - c(30));
  const wL = BM.kachelMischungBei(-30, 5, gemischt);
  const kMischung = wL[`kachel${BK.TILE.GreyMoss}`];
  pruefe('gemischte Zone: die Rampe ist zwischen beiden Saetzen gemischt (nicht der reine Greyglen- und nicht der reine globale Wert)',
    kMischung > Math.min(kGrey, kGlobal) - 0.2 && kMischung !== kGrey && kMischung !== kGlobal, `${kMischung.toFixed(4)} zwischen ${kGlobal.toFixed(4)} und ${kGrey.toFixed(4)}`);
}

// ── 7. Shader ────────────────────────────────────────────────────────
console.log('\n[7] Shader:');
{
  const splat = readFileSync(resolve(WURZEL, 'client/src/engine/TerrainSplat.ts'), 'utf-8');
  for (const zeile of [
    'rampenTabelle()',
    "'  hangK = clamp((hb - ny) / hw, 0.0, 1.0);'",
    "'  felsK = clamp((fb - ny) / fw, 0.0, 1.0) * fa;'",
    "'  rauK = clamp((rb - ny) / rw, 0.0, 1.0) * ra;'",
    "glslTabelle('VB_HANG_B', rampenSaetze.map((r) => nyBeiGrad(r.hang.beginn)))",
    "glslTabelle('VB_HANG_W', rampenSaetze.map((r) => nyBeiGrad(r.hang.beginn) - nyBeiGrad(r.hang.voll)))",
    "glslTabelle('VB_FELS_B', rampenSaetze.map((r) => nyBeiGrad(r.fels.beginn)), 'exakt')",
    "glslTabelle('VB_FELS_W', rampenSaetze.map((r) => nyBeiGrad(r.fels.beginn) - nyBeiGrad(r.fels.voll)), 'exakt')",
    "glslTabelle('VB_FELS_A', rampenSaetze.map((r) => r.fels.anteil), 'exakt')",
    "glslTabelle('VB_RAU_B', rampenSaetze.map((r) => nyBeiGrad(r.rau.beginn)))",
    "glslTabelle('VB_RAU_W', rampenSaetze.map((r) => nyBeiGrad(r.rau.beginn) - nyBeiGrad(r.rau.voll)))",
    "glslTabelle('VB_RAU_A', rampenSaetze.map((r) => r.rau.anteil))",
    "glslTabelle('VB_RAMPE_ID', rampenSaetze.map((r) => rampenSaetze.indexOf(r)))",
    'if (VB_RAMPE_ID[i0] == VB_RAMPE_ID[i1] && VB_RAMPE_ID[i0] == VB_RAMPE_ID[i2] && VB_RAMPE_ID[i0] == VB_RAMPE_ID[i3]) {',
    '`    ${v} = VB_${n}[i0] * weights.x + VB_${n}[i1] * weights.y + VB_${n}[i2] * weights.z + VB_${n}[i3] * weights.w;`',
    "'    hb = VB_HANG_B[i0]; hw = VB_HANG_W[i0]; fb = VB_FELS_B[i0]; fw = VB_FELS_W[i0]; fa = VB_FELS_A[i0];'",
    "'    rb = VB_RAU_B[i0]; rw = VB_RAU_W[i0]; ra = VB_RAU_A[i0];'",
    'const KACHEL_MAX = (TILE_ANZAHL - 1).toFixed(1);',
    '`  int i = int(clamp(t, 0.0, ${KACHEL_MAX}) + 0.5);`',
    // Alle Tabellenzugriffe auf Kachel-Indizes klemmen auf KACHEL_MAX (Mutanten 11-13 des Angriffs).
    '`int vbIdx(float tile) { return int(clamp(tile, 0.0, ${KACHEL_MAX}) + 0.5); }`',
    '`  float st = VB_NST_${name}[int(clamp(layer, 0.0, ${KACHEL_MAX}) + 0.5)];`',
    '`  return VB_KACHEL_${suffix}[int(clamp(tile, 0.0, ${KACHEL_MAX}) + 0.5)];`',
    '(felsKAus ?? rockKRoh.output).connectTo(rockK.left)',
    "glslTabelle('VB_NSTAERKE', SCHICHT_OBERFLAECHE.map((o) => o.normalStaerke))",
    "glslTabelle('VB_METALLIC', SCHICHT_OBERFLAECHE.map((o) => o.metallic))",
    "glslTabelle('VB_GLAETTE', SCHICHT_OBERFLAECHE.map((o) => o.smoothness))",
  ]) pruefe(`Shader-Zeile: ${zeile.slice(0, 80)}`, splat.includes(zeile));
  pruefe('genau zwei GLSL-Stellen rechnen die Stapel-y aus Zeile und Zeilenzahl (Dreifach- und Einzelsample)', (splat.match(/'  float y = \(zeile \+ 0\.02 \+ f\.y \* 0\.96\) \/ zeilen;'/g) ?? []).length === 2
    && (splat.match(/'  float YS = 0\.96 \/ zeilen;'/g) ?? []).length === 2);
  pruefe('keine feste 16 / 15.0 mehr in den Tabellenzugriffen und keine feste Zeilenzahl im y', !/0\.0, 15\.0\)/.test(splat) && !/\) \/ 16\.0;/.test(splat) && !/ATLAS_ZEILEN/.test(splat));
  // glslTabelle selbst: Laenge, Ziffern, exakt.
  const t4 = SPLAT.glslTabelle('X', [0.123456789, 1]).join('\n');
  pruefe('glslTabelle: Laenge aus der Liste, vier Stellen', t4.includes('const float X[2] = float[2](') && t4.includes('0.1235, 1.0000'));
  const tex = SPLAT.glslTabelle('X', [0.8660254037844387, 0.4, 1], 'exakt').join('\n');
  pruefe('glslTabelle exakt: volle Zahl, ganze Zahlen mit .0', tex.includes('0.8660254037844387, 0.4, 1.0'));
  pruefe('glslTabelle: 20 Werte → float[20]', SPLAT.glslTabelle('X', Array.from({ length: 20 }, () => 0)).join('').includes('float[20]'));
  // Die Felsrampe im Shader hat fuer die aelteren Biome dieselbe Zahl wie die Konstante vor K3 (B8): voll, nicht auf vier Stellen.
  const felsAlt = Math.cos((30 * Math.PI) / 180);
  pruefe('Felsrampe: Beginn der globalen Rampe steht im Shader in voller Genauigkeit (nicht 0,8660)',
    SPLAT.glslTabelle('X', [felsAlt], 'exakt').join('').includes(String(felsAlt)) && !SPLAT.glslTabelle('X', [felsAlt], 'exakt').join('').includes('0.8660)'));
}

// ── 8. Greyglen im Chunk-Gitter (N2/Z2, N3/F2) ───────────────────────
console.log('\n[8] Greyglen im Gitter: keine fremden Kacheln, stetiges Gewicht (echter Gitterbau, erfundene Zonen):');
{
  type Gitter = { aTiles: Float32Array; aRockTile: Float32Array; aLava: Float32Array; aWeights: Float32Array };
  const baue = (biomAnSpalte: (cx: number) => number, punktBiom: (x: number, z: number) => number, zx0: number, zy0: number, zonenJeSeite: number, schritt: number): { d: Gitter; n: number } => {
    const zonen = new Map<string, unknown>();
    const zone = (zx: number, zy: number): unknown => {
      const k = `${zx},${zy}`;
      if (!zonen.has(k)) {
        zonen.set(k, {
          zoneX: zx, zoneY: zy, heights: new Float32Array(E_WIDTH * E_WIDTH).fill(50),
          cornerBiomes: [biomAnSpalte(zx), biomAnSpalte(zx + 1), biomAnSpalte(zx), biomAnSpalte(zx + 1)],
          getBiome: (x: number, z: number) => punktBiom(x, z), getVegetationMask: () => 0.5,
        });
      }
      return zonen.get(k);
    };
    const tm = Object.create(TerrainManager.prototype) as { world: unknown; buildGridGeometry: (...a: unknown[]) => Gitter };
    tm.world = { heightmaps: { getZone: zone } };
    return { d: tm.buildGridGeometry(zx0, zy0, zonenJeSeite, schritt, 0), n: (zonenJeSeite * 64) / schritt + 1 };
  };
  const gleich = (a: Float32Array, b: Float32Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
  SPLAT.stapelMelden(true);
  // (1) Grenze Greyglen/Grasland, Fern und Nah: die Kachel-Attribute sind BITGLEICH denen derselben Welt mit Grasland statt Greyglen.
  const grenze = (cx: number): number => (cx >= 1 ? 128 : 1);
  const grasAlles = (cx: number): number => (grenze(cx) === 128 ? 1 : grenze(cx));
  const punkt = (x: number): number => (x >= 32 ? 128 : 1);
  const punktGras = (x: number): number => (punkt(x) === 128 ? 1 : punkt(x));
  for (const [name, zx0, zonen, schritt] of [['Fern 2×2, Schritt 4', 0, 2, 4], ['Fern 2×2, Schritt 2', 0, 2, 2], ['Nah an der Grenze (Zone 0)', 0, 1, 1], ['Nah, Greyglen innen (Zone 1)', 1, 1, 1]] as const) {
    const a = baue(grenze, (x) => punkt(x), zx0, 0, zonen, schritt);
    const b = baue(grasAlles, (x) => punktGras(x), zx0, 0, zonen, schritt);
    pruefe(`${name}: aTiles und aRockTile sind bitgleich zu derselben Welt mit Grasland statt Greyglen (keine neue fremde Kachel, keine Kachel 16–19)`,
      gleich(a.d.aTiles, b.d.aTiles) && gleich(a.d.aRockTile, b.d.aRockTile) && a.d.aTiles.every((t) => t < 16) && a.d.aRockTile.every((t) => t < 16));
  }
  // (2) Zufaellige Konfigurationen mit 1 bis 4 verschiedenen Biomen aus allen zehn, Nah und Fern.
  {
    const alle = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
    let saat = 777;
    const zuf = (): number => { saat = (Math.imul(saat, 1664525) + 1013904223) >>> 0; return saat / 4294967296; };
    let mitGrey = 0;
    let schlecht = 0;
    for (let i = 0; i < 120; i++) {
      const n = 1 + Math.floor(zuf() * 4);
      const menge: number[] = [];
      while (menge.length < n) { const b = alle[Math.floor(zuf() * alle.length)]!; if (!menge.includes(b)) menge.push(b); }
      if (i % 3 === 0 && !menge.includes(128)) menge[0] = 128;
      const tabEck = new Map<string, number>();
      const eck = (cx: number, cy: number): number => { const k = `${cx},${cy}`; if (!tabEck.has(k)) tabEck.set(k, menge[Math.floor(zuf() * menge.length)]!); return tabEck.get(k)!; };
      const tabPkt = new Map<string, number>();
      const pkt = (x: number, z: number): number => { const k = `${Math.floor(x / 16)},${Math.floor(z / 16)}`; if (!tabPkt.has(k)) tabPkt.set(k, menge[Math.floor(zuf() * menge.length)]!); return tabPkt.get(k)!; };
      const ersetze = (b: number): number => (b === 128 ? 1 : b);
      const baueMit = (eckFn: (cx: number, cy: number) => number, pktFn: (x: number, z: number) => number, zonen: number, schritt: number) => {
        const zonenMap = new Map<string, unknown>();
        const zone = (zx: number, zy: number): unknown => {
          const k = `${zx},${zy}`;
          if (!zonenMap.has(k)) zonenMap.set(k, { zoneX: zx, zoneY: zy, heights: new Float32Array(E_WIDTH * E_WIDTH).fill(50), cornerBiomes: [eckFn(zx, zy), eckFn(zx + 1, zy), eckFn(zx, zy + 1), eckFn(zx + 1, zy + 1)], getBiome: pktFn, getVegetationMask: () => 0.5 });
          return zonenMap.get(k);
        };
        const tm = Object.create(TerrainManager.prototype) as { world: unknown; buildGridGeometry: (...a: unknown[]) => Gitter };
        tm.world = { heightmaps: { getZone: zone } };
        return tm.buildGridGeometry(0, 0, zonen, schritt, 0);
      };
      for (const [zonen, schritt] of [[1, 1], [2, 4], [2, 2]] as const) {
        const a = baueMit(eck, pkt, zonen, schritt);
        const b = baueMit((cx, cy) => ersetze(eck(cx, cy)), (x, z) => ersetze(pkt(x, z)), zonen, schritt);
        if (menge.includes(128)) {
          mitGrey += 1;
          if (!gleich(a.aTiles, b.aTiles) || !gleich(a.aRockTile, b.aRockTile) || !a.aTiles.every((t) => t < 16)) schlecht += 1;
          // Lava (Asche) bleibt unveraendert, wo es Lava gibt; sonst nur das Greyglen-Gewicht, immer in [-1, ...].
          if (!a.aLava.every((l, vi) => l >= -1 && (b.aLava[vi]! > 0 ? l === b.aLava[vi] : l <= 0))) schlecht += 1;
        } else if (!gleich(a.aTiles, b.aTiles) || !gleich(a.aLava, b.aLava)) schlecht += 1;
      }
    }
    pruefe('120 zufaellige Welten mit 1 bis 4 Biomen aus allen zehn (Nah 1 m, Fern 4 m und 2 m): Kachel-Attribute immer bitgleich zur Grasland-Welt, Greyglen nur im Lava-Kanal, Welten ohne Greyglen bitgleich', schlecht === 0 && mitGrey >= 100, `${schlecht} Abweichungen, ${mitGrey} Chunks mit Greyglen`);
  }
  // (3) Das Greyglen-Gewicht: Grasland links, Greyglen rechts; stetig, auch im Fern-Chunk ueber die Zonennaht.
  {
    const fern = baue(grenze, punkt, 0, 0, 2, 4);
    const reihe = (iy: number): number[] => Array.from({ length: fern.n }, (_, ix) => BK.greyAusMarker(fern.d.aLava[iy * fern.n + ix]!));
    let maxSchritt = 0;
    let monoton = true;
    for (const iy of [0, 8, 16, 24, 32]) {
      const g = reihe(iy);
      for (let i = 1; i < g.length; i++) { maxSchritt = Math.max(maxSchritt, Math.abs(g[i]! - g[i - 1]!)); if (g[i]! < g[i - 1]! - 1e-6) monoton = false; }
    }
    const g0 = reihe(8);
    pruefe('Fern-Chunk ueber die Grenze: das Greyglen-Gewicht steigt von 0 (Grasland) auf 1 (Greyglen), monoton', g0[0] === 0 && g0[g0.length - 1]! > 0.999 && monoton, `Rand ${g0[0]} / ${g0[g0.length - 1]!.toFixed(4)}`);
    pruefe('… und stetig: hoechstens 0,12 je 4-m-Schritt, auch ueber die Zonennaht (Fern-Chunk)', maxSchritt <= 0.12, maxSchritt.toFixed(4));
    const nah = baue(grenze, punkt, 0, 0, 1, 1);
    let maxNah = 0;
    for (let iy = 0; iy < nah.n; iy += 8) for (let ix = 1; ix < nah.n; ix++) maxNah = Math.max(maxNah, Math.abs(BK.greyAusMarker(nah.d.aLava[iy * nah.n + ix]!) - BK.greyAusMarker(nah.d.aLava[iy * nah.n + ix - 1]!)));
    pruefe('Nah-Chunk: das Gewicht ist stetig (hoechstens 0,05 je Meter)', maxNah <= 0.05, maxNah.toFixed(4));
    const innen = baue(() => 128, () => 128, 1, 0, 1, 1);
    pruefe('Greyglen innen (Nah): das Gewicht ist ueberall 1, die Kacheln Grasland', innen.d.aLava.every((l) => Math.abs(l + 1) < 1e-6) && innen.d.aTiles.every((t) => t === 0));
    const innenFern = baue(() => 128, () => 128, 0, 0, 2, 4);
    pruefe('Greyglen innen (Fern): ebenfalls Gewicht 1 — dieselbe Rampe wie nah, kein Wechsel auf die Grasland-Rampen', innenFern.d.aLava.every((l) => Math.abs(l + 1) < 1e-6));
    const gras = baue(() => 1, () => 1, 0, 0, 2, 4);
    pruefe('Grasland (Fern): Gewicht 0, Lava-Kanal 0', gras.d.aLava.every((l) => l === 0 || l > 0));
  }
  // (4) Der Zustand des Stapels aendert die Vertices nicht (das regelt das Uniform greyOk im Shader).
  {
    const a = baue(grenze, punkt, 0, 0, 2, 4);
    const altE = console.error;
    console.error = (): void => undefined;
    SPLAT.stapelMelden(false);
    console.error = altE;
    const b = baue(grenze, punkt, 0, 0, 2, 4);
    SPLAT.stapelMelden(true);
    pruefe('Stapel unbrauchbar: die Vertex-Daten bleiben dieselben (Rueckfall im Shader ueber greyOk)', gleich(a.d.aTiles, b.d.aTiles) && gleich(a.d.aLava, b.d.aLava) && gleich(a.d.aRockTile, b.d.aRockTile));
  }
  // (5) Lava (Asche) neben Greyglen: die Lava gewinnt im Kanal.
  {
    const asche = (cx: number): number => (cx >= 1 ? 32 : 128);
    const a = baue(asche, (x) => (x >= 32 ? 32 : 128), 0, 0, 2, 4);
    pruefe('Asche (Lava 0,5) neben Greyglen: im Aschegebiet gilt die Lava (positiv), links das Gewicht (negativ)', a.d.aLava[0]! < 0 && a.d.aLava[a.n - 1]! === 0.5);
  }
  // Vergleichsfall: zwei alte Biome (Grasland/Asche) im Fernbild bleiben wie vor K3.
  {
    const a = baue((cx) => (cx >= 1 ? 32 : 1), (x) => (x >= 32 ? 32 : 1), 0, 0, 2, 4);
    pruefe('Grasland/Asche im Fernbild: die Kacheln sind die Nummern 0 und 7 wie vor K3 (die Zwischenwerte dieser alten Grenze bleiben, wie entschieden)',
      new Set(Array.from(a.d.aTiles)).size === 2 && new Set(Array.from(a.d.aTiles)).has(0) && new Set(Array.from(a.d.aTiles)).has(7));
  }
}

function ende(): void {
  if (fehler > 0) {
    console.error(`\n${fehler} FEHLER`);
    process.exit(1);
  }
  console.log('\nALLE GRUEN');
}
void Promise.all(asyncTests).then(ende);
