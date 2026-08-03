/**
 * Environment model — port of Valheim's `EnvSetup` / `EnvMan` lighting data.
 *
 * Valheim does NOT drive lighting from a generic "sun angle over 24 h"
 * formula. Every weather is an `EnvSetup` ScriptableObject holding
 * KEYFRAMES for four times of day, and `EnvMan` interpolates between them
 * using the day fraction. Faithfully reproducing the look therefore means
 * reproducing that data model, not inventing a curve.
 *
 * ── Verified field set ────────────────────────────────────────────────
 * The field list below is 1:1 the EnvSetup surface exposed by
 * Expand World Data (JereKuusela), which writes vanilla EnvSetup objects
 * to YAML — see docs/environments.md in that repo:
 *
 *   fogColor{Morning,Day,Evening,Night}       base fog color
 *   fogColorSun{Morning,Day,Evening,Night}    fog color TOWARDS the sun
 *   fogDensity{Morning,Day,Evening,Night}     default 0.01
 *   sunColor{Morning,Day,Evening,Night}       directional light color
 *   ambColorDay / ambColorNight               ambient (only two keys!)
 *   lightIntensityDay   default 1.2
 *   lightIntensityNight default 0
 *   sunAngle            default 60  (max elevation in degrees)
 *   alwaysDark          default false (caves/crypts)
 *
 * Two consequences matter for the renderer:
 *  1. Fog has TWO colors per keyframe. The rendered fog color depends on
 *     the VIEW DIRECTION relative to the sun (`fogColorSun*` towards it,
 *     `fogColor*` away from it). This directional, sun-tinted fog is the
 *     single most characteristic part of Valheim's look, and it is why a
 *     plain single-color `scene.fogColor` never reads as "Valheim".
 *     Babylon's built-in fog is single-color → see ValheimFogPlugin.
 *  2. Ambient has only day/night keys while fog/sun have four, so the
 *     two are interpolated on DIFFERENT curves.
 *
 * ── Verified timing ──────────────────────────────────────────────────
 * The phase anchors come from constants.ts, which was ported 1:1 from the
 * C++ server (Valhalla2.0, ValhallaServer.h) and matches vanilla:
 *
 *   WORLD_TIME_LENGTH = 1800 s   full cycle (30 min)  → EnvMan.m_dayLengthSec
 *   TIME_MORNING      =  240 s   → fraction 0.1333    sunrise
 *   TIME_DAY          =  270 s   → fraction 0.15      full daylight
 *   TIME_AFTERNOON    =  900 s   → fraction 0.5       midday
 *   TIME_NIGHT        = 1530 s   → fraction 0.85      sunset / night start
 *
 * Night therefore spans 0.85 → 1.1333, i.e. 0.283 of the cycle ≈ 510 s,
 * day ≈ 1290 s. That is the well-documented vanilla "21 min day / 9 min
 * night" split and independently confirms the 0.3 night fraction that
 * day-length mods (e.g. GammaOfNightLights) expose.
 *
 * ── Colour values ────────────────────────────────────────────────────
 * The STRUCTURE and TIMING above are verified. The concrete per-weather
 * colour numbers in ENVIRONMENTS are hand-tuned approximations of the
 * vanilla look, NOT extracted values — they are the one part of this file
 * that is not ground truth. Replace them with real data via
 *
 *   node tools/dump-envsetup.mjs <AssetRipper-export-dir>
 *
 * which writes shared/src/envData.json from the local Valheim export
 * (same approach that produced the verified clutter table).
 */

import { Biome } from './types.js';
import {
  WORLD_TIME_LENGTH,
  TIME_MORNING,
  TIME_AFTERNOON,
  TIME_NIGHT,
} from './constants.js';
import envData from './envData.json';

/** RGB in linear-ish 0..1 space, matching Unity `Color` without alpha. */
export interface EnvColor {
  r: number;
  g: number;
  b: number;
}

/** One EnvSetup keyframe set — see the field notes in the file header. */
export interface EnvSetup {
  name: string;
  /** Fog colour looking AWAY from the sun, per time of day. */
  fogColorMorning: EnvColor;
  fogColorDay: EnvColor;
  fogColorEvening: EnvColor;
  fogColorNight: EnvColor;
  /** Fog colour looking TOWARDS the sun, per time of day. */
  fogColorSunMorning: EnvColor;
  fogColorSunDay: EnvColor;
  fogColorSunEvening: EnvColor;
  fogColorSunNight: EnvColor;
  fogDensityMorning: number;
  fogDensityDay: number;
  fogDensityEvening: number;
  fogDensityNight: number;
  sunColorMorning: EnvColor;
  sunColorDay: EnvColor;
  sunColorEvening: EnvColor;
  sunColorNight: EnvColor;
  /** Ambient has only two keys in Valheim, not four. */
  ambColorDay: EnvColor;
  ambColorNight: EnvColor;
  lightIntensityDay: number;
  lightIntensityNight: number;
  /** Max sun elevation in degrees (vanilla default 60). */
  sunAngle: number;
  /** Caves/crypts: no sun, permanent night lighting. */
  alwaysDark: boolean;
  /** Cloud coverage of the sky dome, 0..1 (vanilla default 0). */
  rainCloudAlpha: number;
  /**
   * Wind strength range of this weather, 0..1. EnvMan.UpdateWind rolls a
   * noise value in 0..1 and lerps between these two, so the weather is what
   * decides breeze vs. gale — see WindManager.
   */
  windMin: number;
  windMax: number;
  /** Precipitation is falling (rain/snow) — drives the wet look. */
  isWet: boolean;
  /** Temperature flags; the freezing debuff builds on these later. */
  isCold: boolean;
  isColdAtNight: boolean;
  isFreezing: boolean;
  isFreezingAtNight: boolean;
}

/**
 * Fields the hand-tuned table below does not spell out, so its entries stay
 * readable. envData.json overwrites every one of them for the weathers the
 * extraction knows — which, with a full EnvMan dump, is all of them.
 */
const ENV_EXTRAS = {
  windMin: 0.1,
  windMax: 0.6,
  isWet: false,
  isCold: false,
  isColdAtNight: false,
  isFreezing: false,
  isFreezingAtNight: false,
} as const;

/** The subset of EnvSetup that BASE_ENVIRONMENTS spells out by hand. */
type EnvBase = Omit<EnvSetup, keyof typeof ENV_EXTRAS>;

/** Fully interpolated lighting state for one frame. */
export interface EnvState {
  fogColor: EnvColor;
  fogColorSun: EnvColor;
  fogDensity: number;
  sunColor: EnvColor;
  ambColor: EnvColor;
  lightIntensity: number;
  /** Cloud coverage for the sky dome, 0..1. */
  cloudAlpha: number;
  /** Normalised direction the light TRAVELS (i.e. sun→scene). */
  lightDir: { x: number; y: number; z: number };
  /**
   * TRUE sun direction as seen from the ground (unit vector towards the
   * sun, y<0 once it has set). Drives the sky dome — unlike `lightDir`
   * this must be allowed below the horizon so the sky actually darkens.
   */
  sunDir: { x: number; y: number; z: number };
  /** True while the moon, not the sun, is the light source. */
  isNight: boolean;
  /** Sun/moon elevation, -1 (nadir) .. 1 (zenith). */
  elevation: number;
}

// ── Phase anchors as day fractions (verified, see header) ───────────

/** Sunrise — night→morning crossover. */
export const FRACTION_SUNRISE = TIME_MORNING / WORLD_TIME_LENGTH; // 0.1333
/** Midday — the "day" keyframe peak. */
export const FRACTION_MIDDAY = TIME_AFTERNOON / WORLD_TIME_LENGTH; // 0.5
/** Sunset — evening→night crossover. */
export const FRACTION_SUNSET = TIME_NIGHT / WORLD_TIME_LENGTH; // 0.85

const c = (r: number, g: number, b: number): EnvColor => ({ r, g, b });

/**
 * Vanilla weather names (verified against the `env` console command list).
 * Only the ones the client can currently end up in are modelled; boss and
 * dungeon environments are listed for completeness of the biome mapping.
 */
export const ENV_CLEAR = 'Clear';
export const ENV_MISTY = 'Misty';
export const ENV_DEEP_FOREST = 'DeepForest Mist';
export const ENV_HEATH_CLEAR = 'Heath clear';
export const ENV_SWAMP_RAIN = 'SwampRain';
export const ENV_SNOW = 'Snow';
export const ENV_DARKLANDS = 'Darklands_dark';
export const ENV_ASH_RAIN = 'Ashrain';
export const ENV_MISTLANDS = 'Mistlands_dark';

/**
 * Weather table. Structure + timing verified; colours approximate the
 * vanilla mood pending `tools/dump-envsetup.mjs` (see header).
 */
const BASE_ENVIRONMENTS: readonly EnvBase[] = [
  {
    // Meadows / default: bright blue day, warm low sun, soft blue night.
    name: ENV_CLEAR,
    fogColorMorning: c(0.32, 0.36, 0.44),
    fogColorDay: c(0.63, 0.72, 0.83),
    fogColorEvening: c(0.34, 0.33, 0.38),
    fogColorNight: c(0.03, 0.04, 0.07),
    fogColorSunMorning: c(0.86, 0.62, 0.42),
    fogColorSunDay: c(0.85, 0.9, 0.96),
    fogColorSunEvening: c(0.92, 0.55, 0.32),
    fogColorSunNight: c(0.08, 0.1, 0.16),
    fogDensityMorning: 0.006,
    fogDensityDay: 0.0035,
    fogDensityEvening: 0.006,
    fogDensityNight: 0.008,
    sunColorMorning: c(1.0, 0.72, 0.48),
    sunColorDay: c(1.0, 0.97, 0.9),
    sunColorEvening: c(1.0, 0.63, 0.38),
    sunColorNight: c(0.4, 0.5, 0.72),
    ambColorDay: c(0.55, 0.62, 0.72),
    ambColorNight: c(0.1, 0.13, 0.2),
    lightIntensityDay: 1.2,
    lightIntensityNight: 0.15,
    sunAngle: 60,
    alwaysDark: false,
    rainCloudAlpha: 0.1,
  },
  {
    // Black Forest: desaturated, denser, colder — the signature gloom.
    name: ENV_DEEP_FOREST,
    fogColorMorning: c(0.24, 0.28, 0.29),
    fogColorDay: c(0.42, 0.5, 0.5),
    fogColorEvening: c(0.24, 0.26, 0.27),
    fogColorNight: c(0.02, 0.035, 0.04),
    fogColorSunMorning: c(0.55, 0.5, 0.4),
    fogColorSunDay: c(0.6, 0.67, 0.66),
    fogColorSunEvening: c(0.6, 0.45, 0.32),
    fogColorSunNight: c(0.05, 0.08, 0.1),
    fogDensityMorning: 0.014,
    fogDensityDay: 0.01,
    fogDensityEvening: 0.014,
    fogDensityNight: 0.018,
    sunColorMorning: c(0.85, 0.72, 0.58),
    sunColorDay: c(0.86, 0.9, 0.85),
    sunColorEvening: c(0.85, 0.62, 0.45),
    sunColorNight: c(0.28, 0.36, 0.55),
    ambColorDay: c(0.36, 0.42, 0.44),
    ambColorNight: c(0.06, 0.09, 0.12),
    lightIntensityDay: 1.0,
    lightIntensityNight: 0.1,
    sunAngle: 60,
    alwaysDark: false,
    rainCloudAlpha: 0.35,
  },
  {
    // Swamp: permanently overcast, sickly green, very dense.
    name: ENV_SWAMP_RAIN,
    fogColorMorning: c(0.2, 0.22, 0.19),
    fogColorDay: c(0.3, 0.33, 0.28),
    fogColorEvening: c(0.19, 0.21, 0.18),
    fogColorNight: c(0.03, 0.04, 0.035),
    fogColorSunMorning: c(0.28, 0.3, 0.25),
    fogColorSunDay: c(0.38, 0.42, 0.35),
    fogColorSunEvening: c(0.28, 0.28, 0.23),
    fogColorSunNight: c(0.05, 0.06, 0.05),
    fogDensityMorning: 0.03,
    fogDensityDay: 0.025,
    fogDensityEvening: 0.03,
    fogDensityNight: 0.035,
    sunColorMorning: c(0.55, 0.58, 0.5),
    sunColorDay: c(0.6, 0.64, 0.55),
    sunColorEvening: c(0.55, 0.55, 0.47),
    sunColorNight: c(0.2, 0.26, 0.28),
    ambColorDay: c(0.28, 0.32, 0.27),
    ambColorNight: c(0.05, 0.07, 0.06),
    lightIntensityDay: 0.6,
    lightIntensityNight: 0.08,
    sunAngle: 60,
    alwaysDark: false,
    rainCloudAlpha: 0.9,
  },
  {
    // Mountain: bright, cold, blue-white, high contrast.
    name: ENV_SNOW,
    fogColorMorning: c(0.42, 0.47, 0.55),
    fogColorDay: c(0.66, 0.73, 0.82),
    fogColorEvening: c(0.4, 0.42, 0.5),
    fogColorNight: c(0.05, 0.07, 0.12),
    fogColorSunMorning: c(0.8, 0.74, 0.72),
    fogColorSunDay: c(0.88, 0.93, 0.98),
    fogColorSunEvening: c(0.8, 0.62, 0.55),
    fogColorSunNight: c(0.12, 0.16, 0.26),
    fogDensityMorning: 0.016,
    fogDensityDay: 0.012,
    fogDensityEvening: 0.016,
    fogDensityNight: 0.02,
    sunColorMorning: c(0.95, 0.88, 0.85),
    sunColorDay: c(0.98, 0.99, 1.0),
    sunColorEvening: c(0.95, 0.8, 0.72),
    sunColorNight: c(0.45, 0.55, 0.78),
    ambColorDay: c(0.6, 0.66, 0.76),
    ambColorNight: c(0.12, 0.16, 0.26),
    lightIntensityDay: 1.3,
    lightIntensityNight: 0.2,
    sunAngle: 60,
    alwaysDark: false,
    rainCloudAlpha: 0.55,
  },
  {
    // Plains: dry, warm, golden, open sky.
    name: ENV_HEATH_CLEAR,
    fogColorMorning: c(0.38, 0.36, 0.36),
    fogColorDay: c(0.66, 0.68, 0.72),
    fogColorEvening: c(0.4, 0.34, 0.32),
    fogColorNight: c(0.04, 0.045, 0.07),
    fogColorSunMorning: c(0.92, 0.7, 0.48),
    fogColorSunDay: c(0.9, 0.9, 0.85),
    fogColorSunEvening: c(0.96, 0.6, 0.34),
    fogColorSunNight: c(0.09, 0.1, 0.15),
    fogDensityMorning: 0.005,
    fogDensityDay: 0.003,
    fogDensityEvening: 0.005,
    fogDensityNight: 0.007,
    sunColorMorning: c(1.0, 0.78, 0.55),
    sunColorDay: c(1.0, 0.98, 0.88),
    sunColorEvening: c(1.0, 0.68, 0.42),
    sunColorNight: c(0.4, 0.48, 0.68),
    ambColorDay: c(0.58, 0.6, 0.66),
    ambColorNight: c(0.1, 0.12, 0.18),
    lightIntensityDay: 1.25,
    lightIntensityNight: 0.15,
    sunAngle: 60,
    alwaysDark: false,
    rainCloudAlpha: 0.1,
  },
  {
    // Mistlands: near-black, extremely dense — sunlight barely arrives.
    name: ENV_MISTLANDS,
    fogColorMorning: c(0.1, 0.1, 0.12),
    fogColorDay: c(0.16, 0.17, 0.19),
    fogColorEvening: c(0.1, 0.1, 0.11),
    fogColorNight: c(0.02, 0.02, 0.03),
    fogColorSunMorning: c(0.14, 0.13, 0.14),
    fogColorSunDay: c(0.2, 0.21, 0.22),
    fogColorSunEvening: c(0.14, 0.12, 0.12),
    fogColorSunNight: c(0.03, 0.03, 0.04),
    fogDensityMorning: 0.06,
    fogDensityDay: 0.05,
    fogDensityEvening: 0.06,
    fogDensityNight: 0.07,
    sunColorMorning: c(0.35, 0.35, 0.38),
    sunColorDay: c(0.42, 0.43, 0.45),
    sunColorEvening: c(0.35, 0.33, 0.34),
    sunColorNight: c(0.14, 0.16, 0.2),
    ambColorDay: c(0.16, 0.17, 0.19),
    ambColorNight: c(0.04, 0.045, 0.055),
    lightIntensityDay: 0.45,
    lightIntensityNight: 0.05,
    sunAngle: 60,
    alwaysDark: false,
    rainCloudAlpha: 0.8,
  },
  {
    // Ashlands: red, hot, ash-laden.
    name: ENV_ASH_RAIN,
    fogColorMorning: c(0.3, 0.16, 0.13),
    fogColorDay: c(0.42, 0.2, 0.15),
    fogColorEvening: c(0.3, 0.15, 0.12),
    fogColorNight: c(0.1, 0.045, 0.035),
    fogColorSunMorning: c(0.7, 0.3, 0.18),
    fogColorSunDay: c(0.85, 0.38, 0.2),
    fogColorSunEvening: c(0.7, 0.28, 0.16),
    fogColorSunNight: c(0.3, 0.1, 0.06),
    fogDensityMorning: 0.028,
    fogDensityDay: 0.024,
    fogDensityEvening: 0.028,
    fogDensityNight: 0.03,
    sunColorMorning: c(1.0, 0.55, 0.35),
    sunColorDay: c(1.0, 0.62, 0.4),
    sunColorEvening: c(1.0, 0.5, 0.3),
    sunColorNight: c(0.6, 0.25, 0.15),
    ambColorDay: c(0.42, 0.24, 0.2),
    ambColorNight: c(0.16, 0.08, 0.07),
    lightIntensityDay: 1.1,
    lightIntensityNight: 0.25,
    sunAngle: 60,
    alwaysDark: false,
    rainCloudAlpha: 0.85,
  },
  {
    // Deep North: pale, bleak, dim sun.
    name: ENV_DARKLANDS,
    fogColorMorning: c(0.34, 0.4, 0.48),
    fogColorDay: c(0.52, 0.6, 0.7),
    fogColorEvening: c(0.32, 0.36, 0.44),
    fogColorNight: c(0.04, 0.06, 0.1),
    fogColorSunMorning: c(0.6, 0.62, 0.68),
    fogColorSunDay: c(0.7, 0.78, 0.88),
    fogColorSunEvening: c(0.58, 0.55, 0.6),
    fogColorSunNight: c(0.1, 0.14, 0.22),
    fogDensityMorning: 0.022,
    fogDensityDay: 0.018,
    fogDensityEvening: 0.022,
    fogDensityNight: 0.026,
    sunColorMorning: c(0.8, 0.85, 0.95),
    sunColorDay: c(0.88, 0.92, 1.0),
    sunColorEvening: c(0.8, 0.82, 0.92),
    sunColorNight: c(0.35, 0.45, 0.7),
    ambColorDay: c(0.5, 0.56, 0.66),
    ambColorNight: c(0.1, 0.14, 0.22),
    lightIntensityDay: 1.0,
    lightIntensityNight: 0.18,
    sunAngle: 60,
    alwaysDark: false,
    rainCloudAlpha: 0.6,
  },
  {
    // Ocean uses Misty in vanilla — hazier than Meadows, same warmth.
    name: ENV_MISTY,
    fogColorMorning: c(0.36, 0.4, 0.46),
    fogColorDay: c(0.62, 0.68, 0.76),
    fogColorEvening: c(0.36, 0.36, 0.42),
    fogColorNight: c(0.03, 0.045, 0.075),
    fogColorSunMorning: c(0.8, 0.66, 0.52),
    fogColorSunDay: c(0.82, 0.87, 0.92),
    fogColorSunEvening: c(0.86, 0.58, 0.38),
    fogColorSunNight: c(0.08, 0.1, 0.17),
    fogDensityMorning: 0.02,
    fogDensityDay: 0.015,
    fogDensityEvening: 0.02,
    fogDensityNight: 0.024,
    sunColorMorning: c(0.95, 0.78, 0.6),
    sunColorDay: c(0.96, 0.96, 0.94),
    sunColorEvening: c(0.96, 0.68, 0.46),
    sunColorNight: c(0.36, 0.46, 0.7),
    ambColorDay: c(0.54, 0.6, 0.7),
    ambColorNight: c(0.09, 0.12, 0.19),
    lightIntensityDay: 1.15,
    lightIntensityNight: 0.15,
    sunAngle: 60,
    alwaysDark: false,
    rainCloudAlpha: 0.4,
  },
];

/**
 * Overlay extracted ground truth (envData.json) onto the hand-tuned table.
 *
 * envData.json ships EMPTY and is filled by tools/dump-envsetup.mjs from a
 * local Valheim export, so this is a no-op until that has been run — the
 * same arrangement as prefabData.json in prefabs.ts. Merging happens FIELD
 * BY FIELD so a partial extraction (a cave env with only a handful of keys
 * set, for instance) sharpens what it knows without punching holes into the
 * rest. Names with no hand-tuned counterpart are added on top of Clear.
 */
function buildEnvironments(): readonly EnvSetup[] {
  // Fill in the fields the hand-tuned table leaves out, so `key in base`
  // below sees them and the extraction can actually override them.
  const withExtras = (b: EnvBase): EnvSetup => ({ ...ENV_EXTRAS, ...b });
  const extracted = (envData.environments ?? []) as ReadonlyArray<Record<string, unknown>>;
  if (extracted.length === 0) return BASE_ENVIRONMENTS.map(withExtras);

  const byName = new Map<string, Record<string, unknown>>();
  for (const e of extracted) {
    if (typeof e.name === 'string') byName.set(e.name, e);
  }

  const overlay = (base: EnvSetup, data: Record<string, unknown>): EnvSetup => {
    const out: EnvSetup = { ...base, name: base.name };
    for (const [key, value] of Object.entries(data)) {
      if (key === 'name' || !(key in base)) continue;
      const current = (base as unknown as Record<string, unknown>)[key];
      const ok =
        typeof current === typeof value &&
        (typeof value !== 'object' ||
          (value !== null &&
            typeof (value as EnvColor).r === 'number' &&
            typeof (value as EnvColor).g === 'number' &&
            typeof (value as EnvColor).b === 'number'));
      if (ok) (out as unknown as Record<string, unknown>)[key] = value;
    }
    return out;
  };

  const result: EnvSetup[] = BASE_ENVIRONMENTS.map((b) => {
    const base = withExtras(b);
    const data = byName.get(base.name);
    if (data) byName.delete(base.name);
    return data ? overlay(base, data) : base;
  });

  // Environments the hand-tuned table doesn't know (Crypt, boss arenas, …)
  const fallbackBase = withExtras(BASE_ENVIRONMENTS.find((e) => e.name === ENV_CLEAR)!);
  for (const [name, data] of byName) {
    result.push(overlay({ ...fallbackBase, name }, data));
  }
  return result;
}

/** All known weathers — hand-tuned defaults with envData.json merged in. */
export const ENVIRONMENTS: readonly EnvSetup[] = buildEnvironments();

const ENV_BY_NAME: ReadonlyMap<string, EnvSetup> = new Map(
  ENVIRONMENTS.map((e) => [e.name, e])
);

export function findEnvironment(name: string): EnvSetup | undefined {
  return ENV_BY_NAME.get(name);
}

/** Vanilla default weather per biome (EnvMan.m_biomeEnvironments). */
const BIOME_ENV: ReadonlyArray<readonly [Biome, string]> = [
  [Biome.Meadows, ENV_CLEAR],
  [Biome.BlackForest, ENV_DEEP_FOREST],
  [Biome.Swamp, ENV_SWAMP_RAIN],
  [Biome.Mountain, ENV_SNOW],
  [Biome.Plains, ENV_HEATH_CLEAR],
  [Biome.Mistlands, ENV_MISTLANDS],
  [Biome.AshLands, ENV_ASH_RAIN],
  [Biome.DeepNorth, ENV_DARKLANDS],
  [Biome.Ocean, ENV_MISTY],
];

/**
 * Default environment for a biome bitmask. Biome is a bitmask and blend
 * zones can carry several bits — the first match in the table above wins,
 * which keeps the choice stable while crossing a border.
 */
export function environmentForBiome(biome: Biome): EnvSetup {
  for (const [bit, name] of BIOME_ENV) {
    if ((biome & bit) !== 0) {
      const env = ENV_BY_NAME.get(name);
      if (env) return env;
    }
  }
  return ENV_BY_NAME.get(ENV_CLEAR)!;
}

// ── Interpolation ───────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(a: EnvColor, b: EnvColor, t: number): EnvColor {
  return { r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) };
}

/**
 * Where we sit between the four keyframes. Valheim's keys are anchored at
 * night (midnight), morning (sunrise), day (midday) and evening (sunset),
 * so the segments are NOT equally long — using four equal quarters is the
 * usual mistake and makes dawn/dusk land at the wrong clock time.
 */
interface KeyBlend {
  from: 'night' | 'morning' | 'day' | 'evening';
  to: 'night' | 'morning' | 'day' | 'evening';
  t: number;
}

function keyBlend(dayFraction: number): KeyBlend {
  const f = ((dayFraction % 1) + 1) % 1;
  if (f < FRACTION_SUNRISE) {
    // midnight → sunrise
    return { from: 'night', to: 'morning', t: f / FRACTION_SUNRISE };
  }
  if (f < FRACTION_MIDDAY) {
    return {
      from: 'morning',
      to: 'day',
      t: (f - FRACTION_SUNRISE) / (FRACTION_MIDDAY - FRACTION_SUNRISE),
    };
  }
  if (f < FRACTION_SUNSET) {
    return {
      from: 'day',
      to: 'evening',
      t: (f - FRACTION_MIDDAY) / (FRACTION_SUNSET - FRACTION_MIDDAY),
    };
  }
  // sunset → next midnight
  return {
    from: 'evening',
    to: 'night',
    t: (f - FRACTION_SUNSET) / (1 - FRACTION_SUNSET),
  };
}

const KEY_SUFFIX = {
  night: 'Night',
  morning: 'Morning',
  day: 'Day',
  evening: 'Evening',
} as const;

function blendKeyColor(
  env: EnvSetup,
  prefix: 'fogColor' | 'fogColorSun' | 'sunColor',
  b: KeyBlend
): EnvColor {
  const from = env[`${prefix}${KEY_SUFFIX[b.from]}` as keyof EnvSetup] as EnvColor;
  const to = env[`${prefix}${KEY_SUFFIX[b.to]}` as keyof EnvSetup] as EnvColor;
  return lerpColor(from, to, b.t);
}

function blendKeyFloat(env: EnvSetup, prefix: 'fogDensity', b: KeyBlend): number {
  const from = env[`${prefix}${KEY_SUFFIX[b.from]}` as keyof EnvSetup] as number;
  const to = env[`${prefix}${KEY_SUFFIX[b.to]}` as keyof EnvSetup] as number;
  return lerp(from, to, b.t);
}

/**
 * Sun/moon elevation as a -1..1 factor. 0 at sunrise/sunset, 1 at midday,
 * -1 at midnight — derived from the verified anchors rather than a plain
 * sine, so dawn and dusk hit 0.1333 / 0.85 exactly.
 */
function elevationFactor(dayFraction: number): number {
  const f = ((dayFraction % 1) + 1) % 1;
  if (f >= FRACTION_SUNRISE && f <= FRACTION_SUNSET) {
    // daylight arc: 0 → 1 → 0
    const t = (f - FRACTION_SUNRISE) / (FRACTION_SUNSET - FRACTION_SUNRISE);
    return Math.sin(t * Math.PI);
  }
  // night arc: 0 → -1 → 0 across the wrap at midnight
  const nightSpan = 1 - (FRACTION_SUNSET - FRACTION_SUNRISE);
  const t = (f > FRACTION_SUNSET ? f - FRACTION_SUNSET : f + (1 - FRACTION_SUNSET)) / nightSpan;
  return -Math.sin(t * Math.PI);
}

/**
 * Die vier Phasengewichte aus EnvMan.cs:272-275 — Nacht, Tag, Morgen,
 * Abend.
 *
 * Das ist KEIN Blend zwischen zwei benachbarten Keyframes, auch wenn es
 * danach aussieht. Die vier Gewichte entstehen unabhängig voneinander und
 * werden anschliessend AUFSUMMIERT, und ihre Summe ist ausdrücklich nicht
 * 1: um 19.7 h liefert die Formel nur `nacht = 0.53`, alles andere 0.
 * Genau daraus entsteht Valheims Dämmerung — die Farben werden nicht zur
 * nächsten Tageszeit hin verschoben, sondern gegen Schwarz gedämpft.
 *
 * Ein normalisierter Zwei-Key-Blend (der Vorgänger dieser Funktion) kann
 * das nicht abbilden: Er liefert immer volle Helligkeit und landet um
 * 19.7 h beim Abend-Keyframe. Bei "Misty" ist `fogColorSunEvening`
 * rötlich (0.51, 0.32, 0.32) — daher die rosa Szene im Screenshot vom
 * 2026-07-29. Mit den echten Gewichten ist zu dieser Uhrzeit
 * ausschliesslich das Nacht-Keyframe aktiv, und das ist grau.
 *
 * m_sunHorizonTransitionH = 0.08, m_sunHorizonTransitionL = 0.02
 * (EnvMan.cs:46/48). Die Asymmetrie ist gewollt: Der Morgen steigt
 * schnell an und klingt langsam aus, der Abend umgekehrt.
 */
const SUN_HORIZON_TRANSITION_H = 0.08;
const SUN_HORIZON_TRANSITION_L = 0.02;

export interface PhaseWeights {
  night: number;
  day: number;
  morning: number;
  evening: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export function phaseWeights(dayFraction: number): PhaseWeights {
  const f = ((dayFraction % 1) + 1) % 1;
  return {
    night: Math.sqrt(Math.max(1 - clamp01(f / 0.25), clamp01((f - 0.75) / 0.25))),
    day: Math.sqrt(clamp01(1 - Math.abs(f - 0.5) / 0.25)),
    morning: Math.min(
      clamp01(1 - (f - 0.26) / -SUN_HORIZON_TRANSITION_L),
      clamp01(1 - (f - 0.26) / SUN_HORIZON_TRANSITION_H)
    ),
    evening: Math.min(
      clamp01(1 - (f - 0.74) / -SUN_HORIZON_TRANSITION_H),
      clamp01(1 - (f - 0.74) / SUN_HORIZON_TRANSITION_L)
    ),
  };
}

/** Gewichtete Summe von vier Keyframe-Farben (EnvMan.SetEnv). */
function weighByPhase(
  env: EnvSetup,
  prefix: 'fogColor' | 'fogColorSun' | 'sunColor',
  w: PhaseWeights,
  /** Morgen/Abend/Tag zählen im Original nur mit, wenn dayInt > 0 ist —
   *  siehe `if (dayInt > 0f)` in EnvMan.cs:686 und 699. */
  dayGated: boolean
): EnvColor {
  const k = (suffix: string): EnvColor =>
    env[`${prefix}${suffix}` as keyof EnvSetup] as EnvColor;
  let r = k('Night').r * w.night;
  let g = k('Night').g * w.night;
  let b = k('Night').b * w.night;
  if (!dayGated || w.day > 0) {
    for (const [suffix, weight] of [
      ['Day', w.day],
      ['Morning', w.morning],
      ['Evening', w.evening],
    ] as const) {
      const c = k(suffix);
      r += c.r * weight;
      g += c.g * weight;
      b += c.b * weight;
    }
  }
  return { r, g, b };
}

/**
 * Interpolate an EnvSetup at a given day fraction (0 = midnight,
 * 0.5 = midday). This is the Babylon-side equivalent of EnvMan.SetEnv.
 */
export function evaluateEnv(env: EnvSetup, dayFraction: number): EnvState {
  // alwaysDark (caves/crypts): the whole cycle is pinned to the night
  // keyframe — not just the light level, the fog too, otherwise a crypt
  // would visibly brighten and shift colour at "midday".
  const w: PhaseWeights = env.alwaysDark
    ? { night: 1, day: 0, morning: 0, evening: 0 }
    : phaseWeights(dayFraction);
  const elevation = env.alwaysDark ? -1 : elevationFactor(dayFraction);

  // Sun rises in the east, sets in the west; azimuth sweeps with the day so
  // shadows rotate through the cycle instead of only shortening.
  const f = ((dayFraction % 1) + 1) % 1;
  const azimuth = (f - 0.25) * Math.PI * 2;
  const maxElevRad = (env.sunAngle * Math.PI) / 180;
  const height = Math.sin(elevation * maxElevRad);
  const horiz = Math.cos(elevation * maxElevRad);

  const fogColor = weighByPhase(env, 'fogColor', w, false);
  // EnvMan.cs:705 — der Sonnennebel wird gegen den normalen Nebel
  // zurückgemischt, sobald weder Tag noch Nacht klar dominieren.
  const sunFogRaw = weighByPhase(env, 'fogColorSun', w, true);
  const sunMix = clamp01(Math.max(w.night, w.day) * 3);

  return {
    fogColor,
    fogColorSun: {
      r: fogColor.r + (sunFogRaw.r - fogColor.r) * sunMix,
      g: fogColor.g + (sunFogRaw.g - fogColor.g) * sunMix,
      b: fogColor.b + (sunFogRaw.b - fogColor.b) * sunMix,
    },
    fogDensity:
      env.fogDensityNight * w.night +
      env.fogDensityDay * w.day +
      env.fogDensityMorning * w.morning +
      env.fogDensityEvening * w.evening,
    sunColor: weighByPhase(env, 'sunColor', w, true),
    // EnvMan.cs:711 — RenderSettings.ambientLight = Lerp(night, day, dayInt).
    ambColor: lerpColor(env.ambColorNight, env.ambColorDay, w.day),
    lightIntensity: env.lightIntensityDay * w.day + env.lightIntensityNight * w.night,
    cloudAlpha: env.rainCloudAlpha,
    // Light travels from the sky towards the ground → negate. |height|
    // keeps the MOON overhead at night (Valheim has one main light that
    // becomes moonlight, it never shines up from below the terrain).
    lightDir: {
      x: -Math.cos(azimuth) * horiz,
      y: -Math.abs(height) - 0.05,
      z: -Math.sin(azimuth) * horiz,
    },
    // Sky dome needs the real sun, below the horizon included.
    sunDir: {
      x: Math.cos(azimuth) * horiz,
      y: height,
      z: Math.sin(azimuth) * horiz,
    },
    // EnvMan flips das Sonnenlicht um 180°, sobald nightInt > 0 ist
    // (EnvMan.cs:679). Als Ja/Nein-Auskunft fürs HUD: Nacht dominiert.
    isNight: w.night > w.day,
    elevation,
  };
}

/** Seconds within the current day → 0..1 fraction (EnvMan.GetDayFraction). */
export function dayFractionFromSeconds(timeOfDaySeconds: number): number {
  const f = (timeOfDaySeconds / WORLD_TIME_LENGTH) % 1;
  return (f + 1) % 1;
}
