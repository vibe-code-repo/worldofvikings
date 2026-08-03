/** Wie oft regnet es? Anteil der Wetterperioden mit Niederschlag je Biom. */
import { selectWeather, precipitationOf, ENVIRONMENT_DURATION } from '../src/weather.js';
import { Biome } from '../src/types.js';
const N = 3000;
for (const [name, b] of [['Meadows', Biome.Meadows], ['BlackForest', Biome.BlackForest], ['Swamp', Biome.Swamp], ['Mountain', Biome.Mountain], ['Plains', Biome.Plains]] as const) {
  const c: Record<string, number> = {};
  for (let p = 0; p < N; p++) {
    const t = precipitationOf(selectWeather(b, p * ENVIRONMENT_DURATION));
    c[t] = (c[t] ?? 0) + 1;
  }
  const nass = N - (c.none ?? 0);
  const stunden = (ENVIRONMENT_DURATION / 60).toFixed(1);
  console.log(`${name.padEnd(12)} Niederschlag in ${((nass / N) * 100).toFixed(1)}% der Perioden (1 Periode = ${stunden} min) — ${Object.entries(c).map(([k, v]) => `${k} ${((v / N) * 100).toFixed(1)}%`).join(', ')}`);
}
