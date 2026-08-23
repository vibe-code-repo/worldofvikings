/**
 * Werkzeug, kein Test (G1-Durchsicht 20.08.2026): misst und druckt nur die
 * Niederschlagsverteilung je Biom, behauptet nichts und hat keinen
 * process.exit(1)-Pfad — es kann nicht fehlschlagen, egal was
 * precipitationOf()/selectWeather() liefern. Die eigentlichen
 * Zusicherungen zu Wetter/Niederschlag stehen in weather.ts (Sektion
 * "Niederschlag"), das gehört in scripts/run-tests.mjs. Diese Datei bleibt
 * ausserhalb — von Hand laufen lassen: npx tsx shared/test/rain-freq.ts
 */
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
