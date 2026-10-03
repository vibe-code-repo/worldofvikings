/**
 * "Glen clear": the clear-weather state of the greyglen biome (bit 128), its night base and the fade-in
 * above the horizon. Split out of environment.ts (size limit); behaviour unchanged.
 * Der Klarwetter-Zustand des Bioms greyglen samt Nachtbasis und Einblendung (aus environment.ts ausgelagert).
 *
 * Only TYPES are imported from environment.ts, so there is no import cycle at run time.
 */
import type { EnvColor, EnvSetup, EnvState } from '../environment.js';

/** Name of the state (hand-tuned, not a vanilla name, so it is not a record of envData.json). */
export const ENV_GLEN_CLEAR = 'Glen clear';
/** The weather it is exactly while the sun is below the horizon (same string as `ENV_CLEAR`). */
const BASIS_NAME = 'Clear';

/*
  ── „Glen clear“: Licht und Nebel des Bioms greyglen (K5) ───────────────

  Nur die TAG-Schlüssel sind eigen, Morgen, Abend und Nacht bleiben die von
  `Clear`: Die Nacht ist damit bitgleich zum Grasland, und der Übergang
  vom Grasland in dieses Biom ändert tagsüber Sonne, Grundlicht und Nebel,
  nachts nichts.

    Sonne      #FFE1BF = (1 / 0,883333 / 0,75), Stärke 2,0 → 0,8435 (wie bei
               `Village`: Stärke 2,0 im Verhältnis 2,0 / 2,3 gegen die
               kalibrierte 0,97)
    Winkel     50° (Maximalhöhe des Tages)
    Nebel      Tagesfarbe #5F8FBF = (0,3745098 / 0,56013644 / 0,7490196)
    Grundlicht Leuchtdichte so, dass Sonne : Grundlicht = 3,5 : 1 gilt,
               gerechnet linear als Stärke · Leuchtdichte(Sonnenfarbe) gegen
               Leuchtdichte(Grundlicht). Das ist ein DATENVERHÄLTNIS: Im Bild
               mindert die Himmelskuppel das Hemisphärenlicht um bis zu
               0,5 (Stärke 1 − 0,5 · q, q = Kuppelanteil am Grundlicht,
               0..1; `AMBIENT_ANTEIL_HIMMEL` in `client/src/engine/
               Lighting.ts`, 0,5 ist der Höchstanteil). q ist für Glen
               clear nicht gemessen; gerendert (`bodenSonne` /
               `bodenAmbient`) 6,95 gegen 6,84 im Grasland. Die Farbe ist der Ton von `Clear`
               (0,463 / 0,574 / 0,706), linear skaliert

  Die Nebeldichte ist 0,009 und nicht die 0,015 aus dem Beschluss: Bei
  exp2 liegt die 90-%-Sichtweite bei 0,015 in 101 m, bei 0,009 in 169 m
  (Nebelanteil 50 m: 18 %, 100 m: 55 %, 200 m: 97,5 %). Unsere Kamera
  sieht 4000 m weit, hinter 100 m wäre bei 0,015 alles einfarbig blau.
  Gemessen (gleiche Pose, Mittag, Regionen Himmel/Ferne/Mitte/Nah): Nah-
  und Mittelgrund ändern sich in keinem Wert um mehr als 3 %, der Boden
  knapp unter dem Horizont bekommt bei 0,009 rund 29 % der Verfärbung des
  vollen Nebels (bei 0,015 46 %). Die Messung deckt nur diese Zone ab
  (rechnerisch etwa 65 m), nicht 100–200 m. Die Reihe steht im Bericht
  (`Berichte/Nachweise/Grauklamm-K5/`).

  Nacht: `sunAngle` 50 gilt nur am Tag. Unter dem Horizont (und bis zum
  Sonnenaufgang) liefert `evaluateEnv` den Zustand von `Clear` bitgleich,
  darüber wird auf den eigenen Zustand übergeblendet (`NACHT_BASIS`).
*/

const c = (r: number, g: number, b: number): EnvColor => ({ r, g, b });
const GLEN_NEBEL_FARBE = c(0.3745098, 0.56013644, 0.7490196);

/** The state, built on `Clear`: only the day keys and the sun height are its own. */
export function baueGlenClear(clearBase: EnvSetup): EnvSetup {
  return {
    ...clearBase,
    name: ENV_GLEN_CLEAR,
    fogColorDay: GLEN_NEBEL_FARBE,
    fogColorSunDay: GLEN_NEBEL_FARBE,
    fogDensityDay: 0.009,
    sunColorDay: c(1, 0.883333, 0.75),
    lightIntensityDay: (0.97 * 2) / 2.3,
    ambColorDay: c(0.3871, 0.4821, 0.5949),
    sunAngle: 50,
  };
}

/**
 * Zustände, die unter dem Horizont genau ein anderer Zustand sind (Name → Name).
 * Der eigene Zustand beginnt erst mit der Sonne über dem Horizont und wird über
 * `ELEV_UEBERBLENDUNG` Elevationseinheiten eingeblendet — stetig, ohne Sprung.
 * States that are exactly another state below the horizon.
 */
export const NACHT_BASIS: ReadonlyMap<string, string> = new Map([[ENV_GLEN_CLEAR, BASIS_NAME]]);
export const ELEV_UEBERBLENDUNG = 0.25;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpColor = (a: EnvColor, b: EnvColor, t: number): EnvColor => ({ r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) });

function mischeRichtung(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  t: number
): { x: number; y: number; z: number } {
  const x = lerp(a.x, b.x, t);
  const y = lerp(a.y, b.y, t);
  const z = lerp(a.z, b.z, t);
  const len = Math.hypot(x, y, z);
  return len > 1e-6 ? { x: x / len, y: y / len, z: z / len } : b;
}

/**
 * The state of a night-based weather: the base state below the horizon, the own state from
 * `ELEV_UEBERBLENDUNG` up, a smoothstep blend between. `eigen` is only asked for above the horizon.
 */
export function mitNachtBasis(unten: EnvState, eigen: () => EnvState): EnvState {
  if (unten.elevation <= 0) return unten;
  const e = eigen();
  const t = unten.elevation / ELEV_UEBERBLENDUNG;
  if (t >= 1) return e;
  const w = t * t * (3 - 2 * t);
  return {
    fogColor: lerpColor(unten.fogColor, e.fogColor, w),
    fogColorSun: lerpColor(unten.fogColorSun, e.fogColorSun, w),
    fogDensity: lerp(unten.fogDensity, e.fogDensity, w),
    sunColor: lerpColor(unten.sunColor, e.sunColor, w),
    ambColor: lerpColor(unten.ambColor, e.ambColor, w),
    lightIntensity: lerp(unten.lightIntensity, e.lightIntensity, w),
    cloudAlpha: lerp(unten.cloudAlpha, e.cloudAlpha, w),
    lightDir: mischeRichtung(unten.lightDir, e.lightDir, w),
    sunDir: mischeRichtung(unten.sunDir, e.sunDir, w),
    isNight: unten.isNight,
    elevation: unten.elevation,
  };
}
