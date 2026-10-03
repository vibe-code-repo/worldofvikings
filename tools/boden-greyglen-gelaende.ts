/**
 * Das Testgelaende fuer die Flaechenanteile des Bioms Greyglen (K3).
 *
 * Gemeinsam fuer `tools/test/boden-greyglen.ts` (misst) und
 * `tools/boden-greyglen-eichen.ts` (sucht die Rampenzahlen). Alles ist
 * deterministisch: feste Neigungsraster, fester Zufallsstrom (LCG, Saat
 * `SAAT`), kein Datum, kein Math.random.
 *
 * Das Gelaende ist eine Menge von Streifen mit je einer festen Neigung. Jede
 * Neigung traegt das Gewicht ihres Bandes im Hang-Histogramm eines steilen
 * Hochland-Tals (0–8° 24,13 %, 8–15° 18,18 %, 15–22° 13,88 %, 22–30° 11,74 %,
 * 30–40° 11,38 %, 40–50° 7,87 %, ueber 50° 12,82 %; Mittel 24,15°). Dazu kommt
 * ein ebener Uferstreifen, der 8,75 % der Flaeche einnimmt: Sand entsteht am
 * Ufer, nicht an der Neigung, seine Flaeche ist damit durch die Breite des
 * Streifens gesetzt.
 *
 * Zwei Raster fuer dieselbe Verteilung, damit die Zahlen nicht am Raster haengen:
 *  - `fein`: 12 Neigungen je Band (Bandmitten), das letzte Band mit 12 Neigungen
 *    zwischen 50° und 85°, dichter am flachen Ende (Mittel 62°, p95 des ganzen
 *    Histogramms 64°; gemessen: Mittel 62°, p95 65°).
 *  - `grob`: 5 Neigungen je Band (10, 30, 50, 70, 90 % des Bandes), das letzte
 *    Band 52/56/60/66/76°.
 *  - `gleich`: wie `fein`, aber das letzte Band gleichverteilt zwischen 50° und 80°
 *    (Mittel 65°): die haerteste Annahme fuer die steilsten Hänge; zeigt, wie stark
 *    die Anteile an der Verteilung im letzten Band haengen.
 *
 * Why two rasters: a hand-picked raster can make the calibration look better
 * than it is; the shares must hold on both.
 */
import * as BM from '../shared/src/worldgen/bodenMischung.js';
import type { BodenQuelle, BodenZone } from '../shared/src/worldgen/bodenMischung.js';
import { WATER_LEVEL } from '../shared/src/worldgen/Heightmap.js';
import { felsMaskeShaderBei } from '../shared/src/worldgen/felsRauschen.js';
import { Biome } from '../shared/src/types.js';
import { mischeRampen, nyBeiGrad, rampenFuerKachel } from '../shared/src/worldgen/terrainRampen.js';
import { TILE } from '../shared/src/worldgen/bodenKacheln.js';

export const SAAT = 20260103;
export const STREIFEN_BREITE = 40;
export const UFER_ANTEIL = 0.0875;
/** Ufer: 1 m ueber dem Wasser. */
export const UFER_HOEHE = WATER_LEVEL + 1;

export const BAENDER = [
  { von: 0, bis: 8, anteil: 0.2413 },
  { von: 8, bis: 15, anteil: 0.1818 },
  { von: 15, bis: 22, anteil: 0.1388 },
  { von: 22, bis: 30, anteil: 0.1174 },
  { von: 30, bis: 40, anteil: 0.1138 },
  { von: 40, bis: 50, anteil: 0.0787 },
] as const;
export const LETZTES_BAND_ANTEIL = 0.1282;
/** Das Ziel in Flaechenanteilen: Gras, Moos, Fels, rauer Fels, Sand. */
export const ZIEL = { gras: 0.57, moos: 0.15, fels: 0.17, rauer: 0.07, sand: 0.035 } as const;

export interface Streifen {
  readonly grad: number;
  readonly gewicht: number;
  readonly band: number;
  readonly ufer: boolean;
}
export type Raster = 'fein' | 'grob' | 'gleich';

export function raster(art: Raster): Streifen[] {
  const je = art === 'grob' ? 5 : 12;
  const bruch = (k: number): number => (art === 'grob' ? [0.1, 0.3, 0.5, 0.7, 0.9][k]! : (k + 0.5) / je);
  const out: Streifen[] = [];
  BAENDER.forEach((b, band) => {
    for (let k = 0; k < je; k++) {
      out.push({ grad: b.von + bruch(k) * (b.bis - b.von), gewicht: ((1 - UFER_ANTEIL) * b.anteil) / je, band, ufer: false });
    }
  });
  const letzte =
    art === 'fein'
      ? Array.from({ length: 12 }, (_, k) => 50 + 35 * Math.pow((k + 0.5) / 12, 1.9))
      : art === 'gleich'
        ? Array.from({ length: 12 }, (_, k) => 50 + (30 * (k + 0.5)) / 12)
        : [52, 56, 60, 66, 76];
  for (const g of letzte) out.push({ grad: g, gewicht: ((1 - UFER_ANTEIL) * LETZTES_BAND_ANTEIL) / letzte.length, band: 6, ufer: false });
  out.push({ grad: 0, gewicht: UFER_ANTEIL, band: 0, ufer: true });
  return out;
}

/** Eine Quelle, deren Streifen `j` (x in [40 j, 40 j + 40)) die Neigung und Hoehe von `streifen[j]` hat. */
export function gelaende(biom: number, streifen: readonly Streifen[]): BodenQuelle {
  const zone: BodenZone = {
    zoneX: 0,
    zoneY: 0,
    cornerBiomes: [biom, biom, biom, biom] as unknown as BodenZone['cornerBiomes'],
    getBiome: () => biom as Biome,
    getVegetationMask: () => 0,
  };
  const s = (x: number): Streifen => streifen[Math.floor(x / STREIFEN_BREITE)]!;
  return {
    getGroundHeight: (x) =>
      (s(x).ufer ? UFER_HOEHE : WATER_LEVEL + 20) + Math.tan((s(x).grad * Math.PI) / 180) * (x - STREIFEN_BREITE * Math.floor(x / STREIFEN_BREITE)),
    getZoneAt: () => zone,
  };
}

/** Eine Probe: Neigung, Felsmaske, Hoehe und Gewicht. */
export interface Probe {
  readonly ny: number;
  readonly maske: number;
  readonly h: number;
  readonly w: number;
  readonly band: number;
  readonly x: number;
  readonly z: number;
}

/** Die Probenpunkte: je Streifen `punkteJe` Orte im Inneren des Streifens, z gleichverteilt. */
export function proben(streifen: readonly Streifen[], punkteJe: number, saat = SAAT): Probe[] {
  let s = saat;
  const zufall = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const q = gelaende(Biome.Greyglen, streifen);
  const out: Probe[] = [];
  streifen.forEach((st, j) => {
    for (let i = 0; i < punkteJe; i++) {
      const x = j * STREIFEN_BREITE + 2 + zufall() * (STREIFEN_BREITE - 4);
      const z = zufall() * 2000;
      out.push({ ny: BM.nyBei(x, z, q), maske: felsMaskeShaderBei(x, z), h: q.getGroundHeight(x, z), w: st.gewicht / punkteJe, band: st.band, x, z });
    }
  });
  return out;
}

export type Anteile = { gras: number; moos: number; fels: number; rauer: number; sand: number };

/**
 * Die Anteile aus fertigen Proben und einem Rampensatz (in Grad), ohne die
 * Bodenmischung aufzurufen: dieselbe Kette (Sand, Hang, Fels, rauer Fels) in
 * wenigen Zeilen, damit die Eichung tausende Rampen je Sekunde probieren kann.
 * `tools/test/boden-greyglen.ts` prueft, dass sie auf 1e-9 dasselbe liefert wie
 * `kachelMischungBei`.
 */
export function anteileAus(ps: readonly Probe[], r: { hang: { beginn: number; voll: number }; fels: { beginn: number; voll: number; anteil: number }; rau: { beginn: number; voll: number; anteil: number } }, nurBand = -1): Anteile & { w: number } {
  const k = (t: number): number => Math.min(1, Math.max(0, t));
  const hb = nyBeiGrad(r.hang.beginn), hv = nyBeiGrad(r.hang.voll);
  const fb = nyBeiGrad(r.fels.beginn), fv = nyBeiGrad(r.fels.voll);
  const rb = nyBeiGrad(r.rau.beginn), rv = nyBeiGrad(r.rau.voll);
  const t = { gras: 0, moos: 0, fels: 0, rauer: 0, sand: 0, w: 0 };
  for (const p of ps) {
    if (nurBand >= 0 && p.band !== nurBand) continue;
    const a: Anteile = { gras: 1, moos: 0, fels: 0, rauer: 0, sand: 0 };
    const lege = (art: keyof Anteile, v: number): void => {
      if (v <= 0) return;
      for (const n of Object.keys(a) as (keyof Anteile)[]) a[n] *= 1 - v;
      a[art] += v;
    };
    lege('sand', k((WATER_LEVEL + 2.5 - p.h) / 3) * 0.8);
    lege('moos', k((hb - p.ny) / (hb - hv)));
    lege('fels', k((fb - p.ny) / (fb - fv)) * r.fels.anteil * p.maske);
    lege('rauer', k((rb - p.ny) / (rb - rv)) * r.rau.anteil * p.maske);
    for (const n of Object.keys(a) as (keyof Anteile)[]) t[n] += a[n] * p.w;
    t.w += p.w;
  }
  return t;
}

/** Die Anteile ueber die echte Bodenmischung (`kachelMischungBei`) auf denselben Proben. */
export function messe(streifen: readonly Streifen[], proben_: readonly Probe[]): { gesamt: Anteile; jeBand: Array<Anteile & { w: number }>; rest: number; summe: number } {
  const q = gelaende(Biome.Greyglen, streifen);
  const gesamt: Anteile = { gras: 0, moos: 0, fels: 0, rauer: 0, sand: 0 };
  const jeBand = Array.from({ length: 7 }, () => ({ gras: 0, moos: 0, fels: 0, rauer: 0, sand: 0, w: 0 }));
  let rest = 0;
  let summe = 0;
  const spalten = [['gras', TILE.GreyGrass], ['moos', TILE.GreyMoss], ['fels', TILE.GreyRock], ['rauer', TILE.GreyRockMoss], ['sand', TILE.Sand]] as const;
  for (const p of proben_) {
    const a = BM.kachelMischungBei(p.x, p.z, q);
    let erfasst = 0;
    for (const [n, kachel] of spalten) {
      const v = a[`kachel${kachel}`];
      gesamt[n] += v * p.w;
      jeBand[p.band]![n] += v * p.w;
      erfasst += v;
    }
    rest += (1 - erfasst) * p.w;
    jeBand[p.band]!.w += p.w;
    summe += Object.values(a).reduce((x, y) => x + y, 0) * p.w;
  }
  return { gesamt, jeBand, rest, summe };
}

/** Hilfen fuer die Tests: die Rampe an einer Biomgrenze. */
export { mischeRampen, rampenFuerKachel };
