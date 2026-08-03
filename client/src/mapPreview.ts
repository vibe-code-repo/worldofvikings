/**
 * Einstieg für karte.html — die Weltkarte allein, ohne Spiel.
 *
 * Dient als Prüfstand: hier lässt sich das Kartenbild schnell gegen das
 * Offline-Referenzbild aus `shared/test/geo-map.ts` halten, ohne den ganzen
 * Client hochzufahren. Der Spieler wird als fester Punkt vorgetäuscht.
 */
import { createWorld, DEFAULT_OFFLINE_SEED } from './world/World';
import { WorldMap } from './ui/WorldMap';

const params = new URLSearchParams(location.search);
const seed = params.get('seed') ?? DEFAULT_OFFLINE_SEED;
const px = Number(params.get('x') ?? 0);
const pz = Number(params.get('z') ?? 0);

const world = createWorld(seed);
const karte = new WorldMap({
  seed,
  settings: {},
  world,
  spieler: () => ({ x: px, z: pz, yaw: 0 }),
});
karte.vorberechnen();
karte.show();

// Prüf-Handle für Playwright-Sonden.
(window as unknown as Record<string, unknown>).__karte = karte;
