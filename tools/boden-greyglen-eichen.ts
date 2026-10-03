/**
 * Eichung der Greyglen-Rampe (K3): so sind die Zahlen in `RAMPEN_JE_KACHEL`
 * entstanden und so lassen sie sich nachrechnen.
 *
 *   npx tsx tools/boden-greyglen-eichen.ts            # misst die eingetragene Rampe auf beiden Rastern
 *   npx tsx tools/boden-greyglen-eichen.ts --suche    # sucht eine Rampe (Zufallssuche, feste Saat)
 *
 * Verfahren der Suche: Gesucht sind acht Zahlen (Beginn/Voll von Hang, Fels und
 * rauem Fels in Grad, dazu zwei Deckel). Zielfunktion ist die Summe der
 * quadrierten Abweichungen der fuenf Flaechenanteile (Gras, Moos, Fels, rauer
 * Fels, Sand) gegen `ZIEL`, auf dem feinen UND dem groben Raster zugleich.
 * Nebenbedingungen: jede Stufe laeuft aufwaerts und ist mindestens 6° breit, die
 * Stufen stapeln sich (Ende ≤ naechster Beginn), Deckel in (0,05; 1]. Die Suche
 * verschiebt die Zahlen zufaellig (LCG, Saat `SAAT`) und behaelt jede
 * Verbesserung; danach wird von Hand auf runde Zahlen gesetzt und nachgemessen.
 *
 * Warum zwei Raster: Ein einzelnes Raster misst auch, wie die Stuetzpunkte
 * fallen. Die Zahlen gelten, wenn sie auf beiden stimmen.
 *
 * Calibration of the greyglen ramp: deterministic random search on two slope
 * rasters (fixed seed); the committed numbers are rounded from its result.
 */
import { RAMPEN_JE_KACHEL } from '../shared/src/worldgen/terrainRampen.js';
import { TILE } from '../shared/src/worldgen/bodenKacheln.js';
import { SAAT, ZIEL, anteileAus, proben, raster, type Anteile } from './boden-greyglen-gelaende.js';

const R = RAMPEN_JE_KACHEL[TILE.GreyGrass]!;
const fein = proben(raster('fein'), 150);
const grob = proben(raster('grob'), 300);

function verlust(p: number[]): number {
  const r = { hang: { beginn: p[0]!, voll: p[1]! }, fels: { beginn: p[2]!, voll: p[3]!, anteil: p[4]! }, rau: { beginn: p[5]!, voll: p[6]!, anteil: p[7]! } };
  let v = 0;
  for (const ps of [fein, grob]) {
    const a = anteileAus(ps, r);
    for (const k of Object.keys(ZIEL) as (keyof Anteile)[]) v += (a[k] - ZIEL[k]) ** 2;
  }
  return v;
}
const zulaessig = (p: number[]): boolean =>
  p[1]! - p[0]! >= 6 && p[3]! - p[2]! >= 6 && p[6]! - p[5]! >= 6 && p[1]! <= p[2]! && p[3]! <= p[5]! && p[0]! >= 5 && p[6]! <= 89 &&
  p[4]! > 0.05 && p[4]! <= 1 && p[7]! > 0.05 && p[7]! <= 1;

function ausgeben(titel: string, p: number[]): void {
  const r = { hang: { beginn: p[0]!, voll: p[1]! }, fels: { beginn: p[2]!, voll: p[3]!, anteil: p[4]! }, rau: { beginn: p[5]!, voll: p[6]!, anteil: p[7]! } };
  console.log(titel, JSON.stringify(p.map((v) => +v.toFixed(3))));
  for (const [n, ps] of [['fein', fein], ['grob', grob]] as const) {
    const a = anteileAus(ps, r);
    console.log(`  ${n}: ${(Object.keys(ZIEL) as (keyof Anteile)[]).map((k) => `${k} ${(a[k] * 100).toFixed(2)} (Ziel ${(ZIEL[k] * 100).toFixed(1)})`).join(' · ')}`);
  }
}

const eingetragen = [R.hang.beginn, R.hang.voll, R.fels.beginn, R.fels.voll, R.fels.anteil, R.rau.beginn, R.rau.voll, R.rau.anteil];
ausgeben('eingetragen', eingetragen);

if (process.argv.includes('--suche')) {
  let s = SAAT;
  const zufall = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  let best = [15, 30, 30, 40, 0.4, 40, 50, 0.1];
  let bv = verlust(best);
  const schritt = [4, 4, 4, 4, 0.1, 4, 4, 0.1];
  for (let i = 0; i < 6000; i++) {
    const c = best.map((v, k) => v + (zufall() - 0.5) * 2 * schritt[k]! * (i > 3000 ? 0.3 : 1));
    if (!zulaessig(c)) continue;
    const v = verlust(c);
    if (v < bv) {
      bv = v;
      best = c;
    }
  }
  ausgeben('gefunden', best);
}
