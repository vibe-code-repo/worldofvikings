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
const s90Beschluss = sichtweite('exp2', 0.015, 0.1);
check('exp2 curve: 90 % fog distance of the number of the decision is 101 m', nah(s90Beschluss, 101.16, 0.01), s90Beschluss.toFixed(2));
check('the density is lower than the number of the decision (it would be a wall)', dichte < 0.015, String(dichte));
check('but thicker than grassland, so the haze is the biome\'s own (90 % fog: 150–250 m)', s90 >= 150 && s90 <= 250, `${s90.toFixed(1)} m`);
check('measured value 0.009 (extracted from the sweep in the report)', nah(dichte, 0.009, 1e-9), String(dichte));

// ── Night: bit-identical to grassland, whole state (colours, density, strength, directions, sky) ──
const gleichState = (t: number): boolean => JSON.stringify(evaluateEnv(glen, t)) === JSON.stringify(evaluateEnv(klar, t));
let nachtN = 0;
let nachtGleich = true;
for (let i = 0; i < 2880; i++) {
  const t = i / 2880;
  if (evaluateEnv(klar, t).elevation > 0) continue;
  nachtN++;
  if (!gleichState(t)) nachtGleich = false;
}
check('the whole night (sun below the horizon, 2880 steps of the day) is bit-identical to grassland, every field', nachtGleich && nachtN > 500, `${nachtN} steps`);
check('the twilight times 0.125, 0.130 and 0.854 (night flag, ground light and strength used to differ) are identical',
  [0.125, 0.130, 0.854].every((t) => evaluateEnv(klar, t).elevation <= 0 && gleichState(t)));
check('moon and sky direction at midnight: identical to grassland', JSON.stringify(evaluateEnv(glen, 0).sunDir) === JSON.stringify(evaluateEnv(klar, 0).sunDir)
  && JSON.stringify(evaluateEnv(glen, 0).lightDir) === JSON.stringify(evaluateEnv(klar, 0).lightDir));
check('by day the own state applies (noon differs from grassland)', !gleichState(0.5));
// continuity at sunrise and sunset: no step bigger than the change one step of the clock can bring
const winkel = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number =>
  Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z))) * 180 / Math.PI;
const einheit = (v: { x: number; y: number; z: number }): { x: number; y: number; z: number } => {
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};
const groesterSchritt = (env: typeof glen): number => {
  let m = 0;
  let vor = evaluateEnv(env, 0);
  for (let i = 1; i <= 20000; i++) {
    const e = evaluateEnv(env, i / 20000);
    m = Math.max(m, Math.abs(e.fogDensity - vor.fogDensity) * 10, Math.abs(e.lightIntensity - vor.lightIntensity),
      Math.abs(e.ambColor.g - vor.ambColor.g), Math.abs(e.sunColor.g - vor.sunColor.g), winkel(e.sunDir, vor.sunDir) / 10, winkel(einheit(e.lightDir), einheit(vor.lightDir)) / 10);
    vor = e;
  }
  return m;
};
const sprungGlen = groesterSchritt(glen);
const sprungKlar = groesterSchritt(klar);
const dichteSchritt = (env: typeof glen): number => {
  let m = 0;
  let vor = evaluateEnv(env, 0).fogDensity;
  for (let i = 1; i <= 20000; i++) {
    const d = evaluateEnv(env, i / 20000).fogDensity;
    m = Math.max(m, Math.abs(d - vor));
    vor = d;
  }
  return m;
};
check('fog density alone: no step bigger than twice grassland\'s biggest', dichteSchritt(glen) <= dichteSchritt(klar) * 2 + 1e-12, `${dichteSchritt(glen)} vs ${dichteSchritt(klar)}`);
check('over a whole day no step of 1/20000 is bigger than grassland\'s own biggest step (x1.5)', sprungGlen <= sprungKlar * 1.5 + 1e-9, `${sprungGlen.toFixed(5)} vs ${sprungKlar.toFixed(5)}`);
// in the fade-in band the blended directions stay unit vectors
const band: number[] = [];
for (let i = 0; i < 2000; i++) {
  const e = evaluateEnv(klar, i / 2000).elevation;
  if (e > 0.01 && e < 0.24) band.push(i / 2000);
}
check('sun direction stays a unit vector in the fade-in band after sunrise and before sunset', band.length > 100 && band.every((t) => {
  const e = evaluateEnv(glen, t);
  return nah(Math.hypot(e.sunDir.x, e.sunDir.y, e.sunDir.z), 1, 1e-9);
}), String(band.length));
const mittag2 = evaluateEnv(glen, 0.5);
check('noon is the own state untouched by the blend', mittag2.fogDensity === 0.009);
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
