/**
 * Sanity checks for the weather/wind port (shared/src/weather.ts).
 *
 * Run: npx tsx shared/test/weather.ts
 *
 * These assert the properties the port has to hold — determinism, the
 * clamp range, the draw weights — rather than exact numbers, which would
 * only re-state the implementation.
 */
import {
  selectWeather,
  windFor,
  windNoise,
  WeatherManager,
  ENVIRONMENT_DURATION,
  WIND_PERIOD_DURATION,
  WIND_TRANSITION_DURATION,
  WEATHER_TRANSITION_DURATION,
  precipitationOf,
} from '../src/weather.js';
import { findEnvironment, ENVIRONMENTS } from '../src/environment.js';
import { Biome } from '../src/types.js';

let failed = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failed++;
}

console.log(`timing: envDuration=${ENVIRONMENT_DURATION}s windPeriod=${WIND_PERIOD_DURATION}s\n`);

// Timing must come from the extraction, not the C# field defaults (20/10).
check('Wetterdauer aus den Assets', ENVIRONMENT_DURATION === 666, `${ENVIRONMENT_DURATION}s`);
check('Windperiode aus den Assets', WIND_PERIOD_DURATION === 1000, `${WIND_PERIOD_DURATION}s`);

// Determinism — the whole point of seeding off the world clock.
const a = selectWeather(Biome.Meadows, 5000);
const b = selectWeather(Biome.Meadows, 5000);
check('Wetter ist deterministisch', a.name === b.name, a.name);
const w1 = windFor(a, 5000);
const w2 = windFor(a, 5000);
check('Wind ist deterministisch', w1.dirX === w2.dirX && w1.intensity === w2.intensity);

// Weather is constant within a period and may change across one.
const p0 = selectWeather(Biome.Meadows, 0).name;
const pMid = selectWeather(Biome.Meadows, ENVIRONMENT_DURATION - 1).name;
check('Wetter konstant innerhalb einer Periode', p0 === pMid, `${p0} / ${pMid}`);

// Draw weights: Meadows is Clear 5.0 against four entries at 0.2, so Clear
// should win roughly 5/5.8 ≈ 86% of the periods.
const counts = new Map<string, number>();
const PERIODS = 4000;
for (let p = 0; p < PERIODS; p++) {
  const n = selectWeather(Biome.Meadows, p * ENVIRONMENT_DURATION).name;
  counts.set(n, (counts.get(n) ?? 0) + 1);
}
const clearShare = (counts.get('Clear') ?? 0) / PERIODS;
check('Meadows ist überwiegend klar', clearShare > 0.8 && clearShare < 0.92, `${(clearShare * 100).toFixed(1)}%`);
check('Meadows hat mehrere Wetter', counts.size >= 4, `${counts.size} verschiedene`);
console.log(
  '      Verteilung: ' +
    [...counts]
      .sort((x, y) => y[1] - x[1])
      .map(([n, c]) => `${n} ${((c / PERIODS) * 100).toFixed(1)}%`)
      .join(', ')
);

// Wind: unit direction, intensity clamped to 0.05..1 (SetTargetWind).
let minI = Infinity;
let maxI = -Infinity;
let badDir = 0;
for (let t = 0; t < 200_000; t += 37) {
  const env = selectWeather(Biome.Meadows, t);
  const w = windFor(env, t);
  minI = Math.min(minI, w.intensity);
  maxI = Math.max(maxI, w.intensity);
  if (Math.abs(Math.hypot(w.dirX, w.dirZ) - 1) > 1e-6) badDir++;
}
check('Windrichtung ist normiert', badDir === 0, `${badDir} Ausreißer`);
check('Windstärke im Clamp 0.05..1', minI >= 0.05 && maxI <= 1, `${minI.toFixed(3)}..${maxI.toFixed(3)}`);
check('Windstärke variiert', maxI - minI > 0.1, `Spanne ${(maxI - minI).toFixed(3)}`);

// The raw noise starts at 0.5 and each octave adds -0.5/o + rand/o, i.e.
// ±0.5/o. Four octaves therefore span 0.5 ± (0.5+0.25+0.125+0.0625) =
// -0.4375..1.4375. It is deliberately NOT pre-clamped — windFor() maps it
// through lerp(windMin, windMax) and clamps after, so the tails simply
// saturate at the weather's limits.
const NOISE_SPAN = 0.5 + 0.25 + 0.125 + 0.0625;
let nMin = Infinity;
let nMax = -Infinity;
for (let t = 0; t < 200_000; t += 13) {
  const n = windNoise(t);
  nMin = Math.min(nMin, n.intensity);
  nMax = Math.max(nMax, n.intensity);
}
check(
  'Noise im Oktavbereich 0.5 ± 0.9375',
  nMin >= 0.5 - NOISE_SPAN && nMax <= 0.5 + NOISE_SPAN,
  `${nMin.toFixed(3)}..${nMax.toFixed(3)}`
);
check('Noise nutzt beide Hälften', nMin < 0.5 && nMax > 0.5);

// Storms must actually blow harder than clear skies, or coupling the wind
// to the weather buys nothing.
const clear = selectWeather(Biome.Meadows, 0);
const storm = findEnvironment('ThunderStorm');
check(
  'Sturm windiger als klarer Himmel',
  storm !== undefined && storm.windMax > clear.windMax && storm.windMin > clear.windMin,
  storm
    ? `Clear ${clear.windMin.toFixed(2)}..${clear.windMax.toFixed(2)} vs. ThunderStorm ${storm.windMin.toFixed(2)}..${storm.windMax.toFixed(2)}`
    : 'ThunderStorm fehlt'
);

// The stateful layer: transitions run and settle, wetness stays in range.
const mgr = new WeatherManager(Biome.Meadows, 0);
let state = mgr.update(0, 0);
const first = state.to.name;
let changedAt = -1;
let blendOutOfRange = 0;
let wetOutOfRange = 0;
for (let t = 1; t < 4000; t++) {
  state = mgr.update(t, 1);
  if (state.to.name !== first && changedAt < 0) changedAt = t;
  if (state.blend < 0 || state.blend > 1) blendOutOfRange++;
  if (state.wetness < 0 || state.wetness > 1) wetOutOfRange++;
}
check('Blend bleibt in 0..1', blendOutOfRange === 0);
check('Nässe bleibt in 0..1', wetOutOfRange === 0);
// Run past the cross-fade before asserting it settles — the loop above may
// well have stopped mid-transition (a change at t=3996 is only 4s in).
for (let t = 4000; t < 4000 + Math.ceil(WEATHER_TRANSITION_DURATION) + 2; t++) {
  state = mgr.update(t, 1);
}
check('Blend rastet ein', state.blend === 1, `blend=${state.blend}`);
check(
  'Wetter wechselt an einer Periodengrenze',
  changedAt < 0 || changedAt % ENVIRONMENT_DURATION <= 1,
  changedAt < 0 ? 'kein Wechsel in 4000s' : `t=${changedAt}s`
);

// Wind must ramp rather than jump — sailing would be unusable otherwise.
const mgr2 = new WeatherManager(Biome.Meadows, 0);
let prev = mgr2.update(0, 0).wind;
let maxStep = 0;
for (let t = 1; t < 3000; t++) {
  const w = mgr2.update(t, 1).wind;
  maxStep = Math.max(maxStep, Math.abs(w.intensity - prev.intensity));
  prev = w;
}
check(
  'Wind rampt statt zu springen',
  maxStep <= 1 / WIND_TRANSITION_DURATION + 1e-6,
  `max. Schritt ${maxStep.toFixed(4)}/s bei dt=1s`
);

// ── windData: die Semantik, die EnvMan an die Shader gibt ──────────
// Der Sinn der beiden Vektoren: Verbraucher mischen ihre WIRKUNG, nicht
// den Vektor (WaterVolume.CalcWave). Dafür muss wind1 während der Rampe
// stehenbleiben und alpha sauber von 0 nach 1 laufen.
const mgr3 = new WeatherManager(Biome.Meadows, 0);
mgr3.update(0, 0);
const ruhe = mgr3.windData;
check('ohne Rampe ist alpha 0', ruhe.alpha === 0, `alpha=${ruhe.alpha}`);
check(
  'ohne Rampe ist wind1 der aktuelle Wind',
  Math.abs(ruhe.wind1.dirX - mgr3.windDir.x) < 1e-9 &&
    Math.abs(ruhe.wind1.intensity - mgr3.windIntensity) < 1e-9
);

// Über mehrere Rampen laufen. Jede wird EINZELN geprüft — zwischen zwei
// Rampen fällt alpha zurück auf 0 und wind1 wechselt auf den neuen Wert,
// das ist korrekt und darf nicht als Sprung gewertet werden.
let rampen = 0;
let alphaMonoton = true;
let wind1Stabil = true;
let alphaAusserhalb = 0;
let inRampe = false;
let letzteAlpha = 0;
let rampenWind1 = '';
for (let t = 1; t < 4000; t++) {
  mgr3.update(t, 1);
  const d = mgr3.windData;
  if (d.alpha < 0 || d.alpha > 1) alphaAusserhalb++;
  const key = `${d.wind1.dirX.toFixed(6)}/${d.wind1.intensity.toFixed(6)}`;
  if (d.alpha > 0) {
    if (!inRampe) {
      // Rampenstart
      inRampe = true;
      rampen++;
      rampenWind1 = key;
      letzteAlpha = d.alpha;
    } else {
      if (d.alpha < letzteAlpha - 1e-9) alphaMonoton = false;
      letzteAlpha = d.alpha;
      if (key !== rampenWind1) wind1Stabil = false;
    }
  } else {
    inRampe = false;
  }
}
const sahRampe = rampen > 0;
check('Windrampen traten auf', sahRampe, `${rampen} Rampen in 4000 s`);
check('alpha bleibt in 0..1', alphaAusserhalb === 0, `${alphaAusserhalb} Ausreißer`);
check('alpha wächst monoton', alphaMonoton);
check('wind1 steht während der Rampe still', wind1Stabil);

// ── Niederschlag ───────────────────────────────────────────────────
// Die Zuordnung ist aus den Flags abgeleitet, weil EnvSetup.m_psystems
// (die Partikel-Prefabs) nicht im Export liegt. Geprüft wird deshalb, dass
// sie zu den Flags passt, die das Original tatsächlich mitliefert.
const nachTyp = new Map<string, string[]>();
for (const e of ENVIRONMENTS) {
  const t = precipitationOf(e);
  if (!nachTyp.has(t)) nachTyp.set(t, []);
  nachTyp.get(t)!.push(e.name);
}
const regen = nachTyp.get('rain') ?? [];
const schnee = nachTyp.get('snow') ?? [];
check(
  'jedes isWet-Wetter bringt Regen',
  ENVIRONMENTS.filter((e) => e.isWet).every((e) => precipitationOf(e) === 'rain'),
  `${regen.length} Regenwetter`
);
check('Regen ist ausschließlich isWet', regen.every((n) => findEnvironment(n)!.isWet));
check(
  'Schnee trifft die Schneewetter',
  schnee.includes('Snow') && schnee.includes('SnowStorm'),
  schnee.join(', ')
);
check(
  'Schnee macht nicht nass',
  schnee.every((n) => !findEnvironment(n)!.isWet),
  'wie in vanilla: Snow/SnowStorm sind nicht isWet'
);
check('Klarer Himmel bleibt trocken', precipitationOf(findEnvironment('Clear')!) === 'none');
check(
  'Ashlands-"clear"/"misty" tragen keinen Niederschlag',
  precipitationOf(findEnvironment('Ashlands_ashrain_clear')!) === 'none' &&
    precipitationOf(findEnvironment('Ashlands_misty')!) === 'none'
);

console.log(failed === 0 ? '\nalle Prüfungen bestanden' : `\n${failed} Prüfung(en) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
