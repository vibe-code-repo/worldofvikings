/**
 * K5 — light and fog of the greyglen biome (bit 128): its own clear-weather state 'Glen clear',
 * entered for biome 128 only. Every other biome, the whole weather table and the night stay as they were.
 * Eigener Licht- und Nebelzustand fuer greyglen; andere Biome und die Nacht bitgleich.
 *
 *   npx tsx shared/test/biom-greyglen-licht.ts   (from the repo root)
 */
import { createHash } from 'node:crypto';
import { Biome } from '../src/types.js';
import {
  ENV_CLEAR,
  ENV_GLEN_CLEAR,
  ENVIRONMENTS,
  environmentForBiome,
  evaluateEnv,
  findEnvironment,
  type EnvColor,
} from '../src/environment.js';
import { STANDARD_WETTER_DEFINITIONEN, WetterWuerfel } from '../src/wetterDefinition.js';
import { selectWeather } from '../src/weather.js';
import { LOOK_VORGABE, sichtweite } from '../src/lookProfil.js';
import { inhaltText } from '../src/texte.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}
const nah = (a: number, b: number, eps: number): boolean => Math.abs(a - b) <= eps;
const lin = (c: number): number => (c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92);
const leucht = (c: EnvColor): number => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
const gleichFarbe = (a: EnvColor, b: EnvColor): boolean => a.r === b.r && a.g === b.g && a.b === b.b;

const glen = findEnvironment(ENV_GLEN_CLEAR)!;
const klar = findEnvironment(ENV_CLEAR)!;

// ── The state exists and belongs to biome 128 only ────────────────────
check('Glen clear exists, named neutrally', glen !== undefined && ENV_GLEN_CLEAR === 'Glen clear');
check('biome 128 → Glen clear', environmentForBiome(Biome.Greyglen).name === ENV_GLEN_CLEAR);
const erwartet: [Biome, string][] = [
  [Biome.Meadows, 'Clear'], [Biome.BlackForest, 'DeepForest Mist'], [Biome.Swamp, 'SwampRain'], [Biome.Mountain, 'Snow'],
  [Biome.Plains, 'Heath clear'], [Biome.Mistlands, 'Mistlands_dark'], [Biome.AshLands, 'Ashrain'], [Biome.DeepNorth, 'DeepNorth_dark'],
  [Biome.Ocean, 'Misty'],
];
check('every other biome keeps its default environment', erwartet.every(([b, n]) => environmentForBiome(b).name === n));
check('weather draw: grassland never gets Glen clear (100 windows)', (() => {
  for (let i = 0; i < 100; i++) if (selectWeather(Biome.Meadows, i * 1800).name === ENV_GLEN_CLEAR) return false;
  return true;
})());
check('biome 128 + 1 (blend zone) resolves to grassland, not to the new state', environmentForBiome((Biome.Meadows | Biome.Greyglen) as Biome).name === 'Clear');

// ── Day values: the numbers of the decision ───────────────────────────
const mittag = evaluateEnv(glen, 0.5);
check('sun colour at noon = #FFE1BF', nah(mittag.sunColor.r, 1, 1e-6) && nah(mittag.sunColor.g, 0.883333, 1e-6) && nah(mittag.sunColor.b, 0.75, 1e-6));
check('sun strength at noon = 2.0 in the calibrated scale (0.97 · 2 / 2.3)', nah(mittag.lightIntensity, (0.97 * 2) / 2.3, 1e-9), String(mittag.lightIntensity));
check('maximum sun height 50°', glen.sunAngle === 50 && nah(Math.asin(mittag.sunDir.y) * 180 / Math.PI, 50, 0.1), String(glen.sunAngle));
check('fog colour at noon = #5F8FBF', nah(mittag.fogColor.r, 0.3745098, 1e-6) && nah(mittag.fogColor.g, 0.56013644, 1e-6) && nah(mittag.fogColor.b, 0.7490196, 1e-6));
check('directed fog colour at noon = the same blue (one haze colour)', gleichFarbe(mittag.fogColorSun, mittag.fogColor));
const verhaeltnis = (mittag.lightIntensity * leucht(mittag.sunColor)) / leucht(mittag.ambColor);
check('sun : ground light = 3.5 : 1 (linear luminance, ±2 %)', nah(verhaeltnis, 3.5, 0.07), verhaeltnis.toFixed(3));
check('ground light keeps the grassland tint (blue/red ratio of Clear)', nah(mittag.ambColor.b / mittag.ambColor.r, evaluateEnv(klar, 0.5).ambColor.b / evaluateEnv(klar, 0.5).ambColor.r, 0.05));

// ── Fog: exp2, and NOT a wall at our 4000 m camera ────────────────────
// The curve is the global look profile's (the density is only read in exp/exp2, linear ignores it): the new state
// is only worth anything while that is exp2, and it is calibrated for exp2.
check('look profile fog mode is exp2 (the density of the state is read)', LOOK_VORGABE.nebelmodus === 'exp2');
const dichte = mittag.fogDensity;
check('fog density at noon is the own value, not the grassland one', dichte !== evaluateEnv(klar, 0.5).fogDensity && dichte > 0);
const s90 = sichtweite('exp2', dichte, 0.1);
const s90Vorbild = sichtweite('exp2', 0.015, 0.1);
check('exp2 curve: 90 % fog distance of the number of the decision is 101 m', nah(s90Vorbild, 101.16, 0.01), s90Vorbild.toFixed(2));
check('the density is lower than the number of the decision (it would be a wall)', dichte < 0.015, String(dichte));
check('but thicker than grassland, so the haze is the biome\'s own (90 % fog: 200–400 m)', s90 >= 200 && s90 <= 400, `${s90.toFixed(1)} m`);

// ── Night and the other keyframes: unchanged against grassland ─────────
const FELDER = ['fogColor', 'fogColorSun', 'sunColor', 'ambColor'] as const;
let nachtGleich = true;
for (const t of [0, 0.02, 0.05, 0.93, 0.97, 0.999]) {
  const a = evaluateEnv(glen, t);
  const b = evaluateEnv(klar, t);
  if (a.isNight !== b.isNight || a.fogDensity !== b.fogDensity || a.lightIntensity !== b.lightIntensity) nachtGleich = false;
  for (const f of FELDER) if (!gleichFarbe(a[f], b[f])) nachtGleich = false;
}
check('night (colours, density, strength): bit-identical to grassland at 6 times', nachtGleich);
const nachtSchluessel = ['fogColorNight', 'fogColorSunNight', 'fogDensityNight', 'sunColorNight', 'ambColorNight', 'lightIntensityNight', 'fogColorMorning', 'fogColorEvening', 'fogDensityMorning', 'fogDensityEvening', 'sunColorMorning', 'sunColorEvening'] as const;
check('night, morning and evening keyframes are the Clear ones', nachtSchluessel.every((k) => JSON.stringify(glen[k]) === JSON.stringify(klar[k])));
check('only the day keys differ from Clear', (Object.keys(glen) as (keyof typeof glen)[]).filter((k) => JSON.stringify(glen[k]) !== JSON.stringify(klar[k])).sort().join(',')
  === ['ambColorDay', 'fogColorDay', 'fogColorSunDay', 'fogDensityDay', 'lightIntensityDay', 'name', 'sunAngle', 'sunColorDay'].join(','));

// ── Every other environment: bit-identical to the state before this change ──
const rest = ENVIRONMENTS.filter((e) => e.name !== ENV_GLEN_CLEAR);
const hash = createHash('sha256').update(JSON.stringify(rest)).digest('hex');
check('all other environments unchanged (sha256 of the table without Glen clear)', hash === '694af54b9dafb36453f9b59b5b54644724f66d08a49ee223b448a18886cd483c', hash);

// ── Weather table: only the clear entry of biome 128 changed ───────────
const tab = STANDARD_WETTER_DEFINITIONEN;
const g = tab.biome.find((b) => b.biom === 'Greyglen')!;
check('Greyglen: first entry is Glen clear with the grassland weight', g.zustaende[0].zustand === ENV_GLEN_CLEAR && g.zustaende[0].gewicht === 5);
check('Greyglen: no entry still names plain Clear', !g.zustaende.some((z) => z.zustand === 'Clear'));
check('no other biome names Glen clear', tab.biome.filter((b) => b.biom !== 'Greyglen').every((b) => !b.zustaende.some((z) => z.zustand === ENV_GLEN_CLEAR)));
check('state list carries Glen clear once, with a key', tab.zustaende.filter((z) => z.id === ENV_GLEN_CLEAR).length === 1);
const w = new WetterWuerfel();
check('the dice draws Glen clear for greyglen in at least one of 200 windows', (() => {
  for (let i = 0; i < 200; i++) if (w.wetterFuer(Biome.Greyglen, i * 1800).umgebung === ENV_GLEN_CLEAR) return true;
  return false;
})());
check('display name through the key, de and en', inhaltText('inhalt.wetter.glen_clear', 'de') === 'Klar (Grauklamm)' && inhaltText('inhalt.wetter.glen_clear', 'en') === 'Clear (glen)');

if (fehler > 0) {
  console.error(`\n${fehler} FAIL`);
  process.exit(1);
}
console.log('\nbiom-greyglen-licht: alle Pruefungen gruen');
