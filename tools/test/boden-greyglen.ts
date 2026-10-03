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
import { WATER_LEVEL } from '../../shared/src/worldgen/Heightmap.js';
import { Biome } from '../../shared/src/types.js';
import { felsMaskeShaderBei } from '../../shared/src/worldgen/felsRauschen.js';
import * as WZ from '../store-terrain-schichten.mjs';
import * as SPLAT from '../../client/src/engine/TerrainSplat.js';
import * as GEL from '../boden-greyglen-gelaende.js';
import type { Anteile } from '../boden-greyglen-gelaende.js';

const { SCHICHTEN, ZUORDNUNG, tabelle } = WZ;
const { SCHICHT_OBERFLAECHE } = SPLAT;
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
  const splat = readFileSync(resolve(WURZEL, 'client/src/engine/TerrainSplat.ts'), 'utf-8');
  const terrain = readFileSync(resolve(WURZEL, 'client/src/engine/Terrain.ts'), 'utf-8');
  pruefe('Terrain: alle vier Eckkacheln und die Felskachel gehen durch kachelFuerStapel',
    (terrain.match(/kachelFuerStapel\(BIOME_TILE\[cb\[[0-3]\]\] \?\? TILE\.Rock, stapelOk\)/g) ?? []).length === 4
      && terrain.includes('kachelFuerStapel(FELS_TILE[kachelFuerStapel(BIOME_TILE[biome] ?? TILE.Rock, stapelOk)] ?? TILE.Rock, stapelOk)'));
  pruefe('Splat: beide Stapel werden mit ?v=Layoutversion geladen und beim Laden geprueft',
    splat.includes('`${splatDatei}?v=${STAPEL_VERSION}`') && splat.includes('?v=${STAPEL_VERSION}`, scene, false, false')
      && splat.includes("stapelPruefen(splatTex, 'Farbstapel')") && splat.includes("stapelPruefen(nTex, 'Normalenstapel')")
      && splat.includes("stapelFehler('Farbstapel')") && splat.includes("stapelFehler('Normalenstapel')"));
  pruefe('Splat: Hoehe gegen STAPEL_ZEILEN, laute Meldung, Rueckfall-Flag, Grenze der Grafikkarte',
    /if \(!stapelPasst\(gr\.width, gr\.height\)\) \{\s*stapelBrauchbarFlag = false;\s*console\.error/.test(splat) && splat.includes('gr.height > maxTex'));
  const dev = readFileSync(resolve(WURZEL, 'scripts/dev.mjs'), 'utf-8');
  pruefe('dev.mjs ruft stapelVeraltet() vor dem Neubau auf', dev.includes('!existsSync(generiert) || stapelVeraltet()'));
  // Verhalten: die Funktion aus dem Quelltext holen und mit einem erfundenen Dateisystem laufen lassen.
  const fn = /function stapelVeraltet\(\) \{[\s\S]*?\n\}\n/.exec(dev)?.[0];
  pruefe('dev.mjs: stapelVeraltet() lesbar', fn !== undefined);
  if (fn) {
    const lauf = (dateien: Record<string, string>): boolean =>
      new Function('WURZEL', 'existsSync', 'readFileSync', 'resolve', `${fn}\nreturn stapelVeraltet();`)(
        '/w', (p: string) => p in dateien, (p: string) => { if (!(p in dateien)) throw new Error('fehlt'); return dateien[p]; }, (...t: string[]) => t.join('/'),
      ) as boolean;
    const werkzeug = 'export const STAPEL_VERSION = 2;\nconst ZEILEN = 16;\n';
    const json = (v: number, z: number): string => JSON.stringify({ version: v, zeilen: z });
    const T = '/w/tools/store-terrain-schichten.mjs';
    const J = '/w/assets/generiert/terrain/store-schichten.json';
    pruefe('dev.mjs: passender Stapel (Version 2, 16 Zeilen) bleibt', lauf({ [T]: werkzeug, [J]: json(2, 16) }) === false);
    pruefe('dev.mjs: Stapel ohne store-schichten.json wird neu gebaut', lauf({ [T]: werkzeug }) === true);
    pruefe('dev.mjs: Stapel mit anderer Version wird neu gebaut (1 gegen 2)', lauf({ [T]: werkzeug, [J]: json(1, 16) }) === true);
    pruefe('dev.mjs: Stapel mit anderer Zeilenzahl wird neu gebaut (20 gegen 16)', lauf({ [T]: werkzeug, [J]: json(2, 20) }) === true);
    pruefe('dev.mjs: Stapel ohne Version im JSON (alter Stand) wird neu gebaut', lauf({ [T]: werkzeug, [J]: JSON.stringify({ zeilen: 16 }) }) === true);
    pruefe('dev.mjs: unlesbares JSON wird neu gebaut', lauf({ [T]: werkzeug, [J]: '{' }) === true);
  }
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
}

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
    'const ATLAS_ZEILEN = STAPEL_ZEILEN;',
    '`  int i = int(clamp(t, 0.0, ${KACHEL_MAX}) + 0.5);`',
    // Alle Tabellenzugriffe auf Kachel-Indizes klemmen auf KACHEL_MAX (Mutanten 11-13 des Angriffs).
    '`int vbIdx(float tile) { return int(clamp(tile, 0.0, ${KACHEL_MAX}) + 0.5); }`',
    '`  float st = VB_NST_${name}[int(clamp(layer, 0.0, ${KACHEL_MAX}) + 0.5)];`',
    '`  return VB_KACHEL_${suffix}[int(clamp(tile, 0.0, ${KACHEL_MAX}) + 0.5)];`',
    '`  return VB_ZEILE_${suffix}[int(clamp(tile, 0.0, ${KACHEL_MAX}) + 0.5)];`',
    '...glslTabelle(`VB_ZEILE_${suffix}`, TILE_ZEILE)',
    '`  float y = (vbZeile_${name}(layer) + 0.02 + f.y * 0.96) / ${ATLAS_ZEILEN}.0;`',
    'cnst(`tile_${name}_atlasHoehe`, 1 / ATLAS_ZEILEN)',
    '(felsKAus ?? rockKRoh.output).connectTo(rockK.left)',
    "glslTabelle('VB_NSTAERKE', SCHICHT_OBERFLAECHE.map((o) => o.normalStaerke))",
    "glslTabelle('VB_METALLIC', SCHICHT_OBERFLAECHE.map((o) => o.metallic))",
    "glslTabelle('VB_GLAETTE', SCHICHT_OBERFLAECHE.map((o) => o.smoothness))",
  ]) pruefe(`Shader-Zeile: ${zeile.slice(0, 80)}`, splat.includes(zeile));
  pruefe('genau zwei Stellen berechnen die Stapel-y mit vbZeile (Dreifach- und Einzelsample)', (splat.match(/\(vbZeile_\$\{name\}\(layer\) \+ 0\.02/g) ?? []).length === 2);
  pruefe('keine feste 16 / 15.0 mehr in den Tabellenzugriffen', !/0\.0, 15\.0\)/.test(splat) && !/\) \/ 16\.0;/.test(splat));
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

if (fehler > 0) {
  console.error(`\n${fehler} FEHLER`);
  process.exit(1);
}
console.log('\nALLE GRUEN');
