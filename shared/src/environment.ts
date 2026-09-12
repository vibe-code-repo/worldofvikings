/**
 * Environment model — keyframe-based lighting data.
 *
 * Lighting is NOT driven by a generic "sun angle over 24 h" formula. Every
 * weather is a data record holding KEYFRAMES for four times of day, and the
 * environment manager interpolates between them using the day fraction.
 * Faithfully reproducing the look therefore means reproducing that data
 * model, not inventing a curve.
 *
 * ── Verified field set ────────────────────────────────────────────────
 * The field list below is 1:1 the surface of the reference environment
 * record, as exposed by a third-party YAML exporter for that format:
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
 *     single most characteristic part of the look we are after, and it is
 *     why a plain single-color `scene.fogColor` never gets there.
 *     Babylon's built-in fog is single-color → see ValheimFogPlugin.
 *  2. Ambient has only day/night keys while fog/sun have four, so the
 *     two are interpolated on DIFFERENT curves.
 *
 * ── Verified timing ──────────────────────────────────────────────────
 * The phase anchors come from constants.ts, which was ported 1:1 from the
 * C++ reference server:
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
 * which writes shared/src/envData.json from a local asset export
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
  /** Ambient has only two keys in the reference data, not four. */
  ambColorDay: EnvColor;
  ambColorNight: EnvColor;
  lightIntensityDay: number;
  lightIntensityNight: number;
  /*
    ── Die zwei optionalen Abend-Schlüssel (09.09.2026) ───────────────

    Das Referenzmodell kennt für Grundlicht und Sonnenstärke nur einen
    TAG- und einen NACHT-Wert und blendet beide mit dem TAGGEWICHT
    ineinander. Für ein Wetter, das ein ABEND ist, ist das eine
    Zwangsjacke: Bei Tagesbruchteil 0,7083 (17 h) liegt das Taggewicht
    bei 0,408, das Grundlicht besteht dort also zu 59 % aus dem
    NACHT-Keyframe. Ein helles Abend-Grundlicht ist so nur zu haben,
    indem man die Nacht mit aufhellt. Am Modul nachgerechnet
    (09.09.2026): Selbst `ambColorDay` auf reines Weiss gedreht bringt
    bei 17 h nur ×1,10 — nötig waren ×2,23.

    Das Schwesterprojekt hat diesen Zwang nicht, weil sein Lichtaufbau
    STATISCH ist: `content/worlds/village1.json` schreibt
    `sun.intensity` 3,0 und `ambient.intensity` 1,1 hin, ohne
    Tageszeit. Was hier fehlte, war also keine Farbe, sondern der
    zweite Stützpunkt.

    Beide Felder sind OPTIONAL, und ohne sie rechnen `mischeAmbient()`
    und `mischeStaerke()` Zeile für Zeile weiter wie bisher — die
    anderen Wetter dieser Tabelle und alles aus envData.json bleiben
    unberührt. Gesetzt sind sie allein bei `Klar-Comic`.

    Ein MORGEN-Schlüssel fehlt bewusst: Der Look beschreibt einen
    Abend, für den Morgen gibt es kein Zielbild, und eine erfundene
    Zahl wäre eine dritte Wahrheit — dieselbe Regel, nach der Morgen-
    und Nacht-Keyframes von `Klar-Comic` aus `Clear` übernommen sind.

    Two optional EVENING keys. The reference model interpolates ambient
    and light intensity between a day and a night key only; at 17 h the
    day weight is 0.408, so an evening cannot get brighter than the
    night key allows. Absent, `evaluateEnv` behaves exactly as before.
  */
  ambColorEvening?: EnvColor;
  lightIntensityEvening?: number;
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
 * Das Look-Wetter der Stufe 2 — handgestimmt, kein Vanilla-Name.
 *
 * Der Bindestrich ist Absicht: Er trennt es sichtbar von den 39 Namen,
 * die `tools/dump-envsetup.mjs` aus einem Asset-Export schreibt. Wer in
 * envData.json nach ihm sucht, findet ihn nicht, und das ist richtig so
 * — die Herleitung steht am Datensatz unten.
 * The stage-2 look weather — hand-tuned, deliberately not a vanilla name.
 */
export const ENV_KLAR_COMIC = 'Klar-Comic';

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
  {
    // ── Klar-Comic ────────────────────────────────────────────────────
    // Das am Bild kalibrierte Look-Wetter der Stufe 2. Kein Vanilla-Wetter
    // und ausdrücklich keins: Es steht hier, weil es HANDGESTIMMT ist, und
    // die handgestimmte Tabelle ist genau dieser Ort. In envData.json
    // gehört es NICHT — die Datei schreibt `tools/dump-envsetup.mjs` aus
    // einem Asset-Export neu, ein Eintrag dort wäre beim nächsten Lauf weg.
    //
    // Das Profil ist ein ABEND (Sonnenrichtung [0.58,−0.45,0.68] des
    // Schwesterprojekts, Elevation 27°), nicht ein Tagesmittel. Getroffen
    // wird es bei Tagesbruchteil 0,7083 (= 17 h): `phaseWeights` liefert
    // dort Tag 0,408 und Abend 0,604, und `elevationFactor` × sunAngle 46
    // ergibt 26,8° — die 27° des Vorbilds auf eine Zehntelstunde genau.
    //
    // Stand 12.09.2026: Bei Tagesbruchteil 0,75 waren Tag- UND Nachtgewicht
    // früher exakt null (der Tagbogen endete bei 0,75, der Nachtbogen begann
    // dort), und `lightIntensity` zog ausschliesslich aus diesen beiden —
    // gemessen sunColor (0,0,0), Intensität 0,000. Bauer „Tageslauf" hat das
    // behoben: `tagseitenAnteil`/`elevationFactor` liefern bei 0,75 jetzt
    // eine durchgehende Kurve statt eines Sprungs. Am Modul gemessen:
    // `evaluateEnv(klar, 0.75)` liefert Intensität 0,97 und sunColor
    // (0,98 / 0,772 / 0,538) — 18 h ist damit kein Sonderfall mehr.
    //
    // Herleitung der Abend-Werte aus dem `lighting`-Block von
    // village1.json (Stand main a81cee3). Gesucht ist nicht der
    // KEYFRAME-Wert, sondern die gewichtete Summe bei 17 h:
    //
    //   Sonne   0,408·Tag + 0,604·Abend = (1.012, 0.899, 0.766)
    //           Ziel #ffe4c6            = (1.000, 0.894, 0.776)
    //   Nebel   0,408·Tag + 0,604·Abend = (0.640, 0.690, 0.751)
    //           Ziel #a3afbd            = (0.639, 0.686, 0.741)
    //   Dichte  0,408·0,0009 + 0,604·0,0012 = 0,00109  (Ziel exp 0,0011)
    //
    // Die Farben stehen als SRGB, wie jede EnvColor in dieser Datei —
    // `Lighting.inLinear()` wandelt sie. Wer die Hex-Werte aus
    // village1.json vorlinearisiert einträgt, linearisiert doppelt: zu
    // dunkel und zu satt (Analyse §4, „Gamma-Fallen").
    //
    // NEBELDICHTEN sind neu gerechnet und nicht aus `Clear` übernommen:
    // Dieses Wetter läuft auf der exp-Kurve, `Clear` auf exp2. Bei 0,0011
    // liegt die halbe Sichtbarkeit auf 630 m (`sichtweite()` in
    // shared/src/lookProfil.ts) — dieselbe Sicht wie exp 0,0005 mit der
    // 2,2-Potenz, die der Boden des Schwesterprojekts anwendet und dieser
    // Client nirgends.
    //
    // fogColorSun* == fogColor* IN DEN DATEN. Der neue Look hat EINE kühle
    // Dunstfarbe und holt die Wärme aus Himmelsglühen und Strahlen. Das
    // Plugin für den gerichteten Nebel bleibt verdrahtet und wirkt hier
    // neutral; wer die alte Handschrift will, dreht `look.nebelWaerme`
    // hoch — das mischt zur Sonnenfarbe hin, ohne diese Daten anzufassen.
    //
    // Morgen und Nacht sind aus `Clear` übernommen (Analyse §4): Der Look
    // beschreibt einen Abend, und eine erfundene Nacht wäre eine dritte
    // Wahrheit ohne Zielbild.
    //
    // Klar-Comic: the image-calibrated look weather of stage 2. Hand-tuned,
    // therefore in this table and not in envData.json (which the dump tool
    // rewrites). The profile is an EVENING, met at day fraction 0.7083
    // (17 h). As of 2026-09-12, day fraction 0.75 (18 h) is no longer a
    // dead zone — builder "Tageslauf" fixed the day/night weight jump;
    // `evaluateEnv(klar, 0.75)` now returns intensity 0.97 and sunColor
    // (0.98 / 0.772 / 0.538).
    name: ENV_KLAR_COMIC,
    /*
      ── Klar-Comic trägt seit dem 10.09.2026 die Zahlen des VORBILDS ───

      Bis hierher war dieses Wetter aus dem `lighting`-Block von
      `village1.json` des Schwesterprojekts abgeleitet und am Bild
      nachjustiert. Jetzt stehen hier die Werte, die der Vermesser aus
      den Spieldateien von Tale of Dark Lands gelesen hat
      (`design/original-boden.md` §D, Szene Level1 — die Szene, aus der
      ALLE DREI Referenzbilder stammen):

        Sonne       #FFC98C, Intensität 2,3, Elevation 50°, Azimut 150°
        Grundlicht  AmbientMode = Skybox, Cubemap `Sky1 L1`,
                    Tint #B2D1FE, Exposure 0,8
        Nebel       LINEAR 15 → 200 m, #73A7FF

      ── Das Vorbild hat EINE Sonne, keinen Tageslauf ──────────────────
      Level1 ist eine Szene mit einem festen Directional Light. Unser
      Modell interpoliert zwischen Keyframes. Übersetzt ist das so: Die
      Zahlen des Vorbilds stehen im TAG-Keyframe, und der ABEND wird so
      nachgeführt, dass die gewichtete Summe bei 17 h dieselbe Farbe
      ergibt — über den Tag ändert sich damit nur der SONNENSTAND, nicht
      die Stimmung. Morgen und Nacht bleiben Altbestand (aus `Clear`);
      für sie gibt das Vorbild nichts her, und eine erfundene Nacht wäre
      wieder das, was diese Runde gerade aufgeräumt hat.

      Die zwei Gewichtungen sind VERSCHIEDEN, und das ist der Grund für
      die zwei verschiedenen Abend-Rechnungen unten:

        Farben (Sonne, Nebel)  `lerpEnvColor` summiert UNGEWICHTET:
          0,408 · Tag + 0,604 · Abend. Die Summe ist 1,012, nicht 1 —
          Abend = Tag würde also 1,2 % zu hell landen. Deshalb
          Abend = Tag · (1 − 0,408) / 0,604 = Tag · 0,98013.

        Grundlicht und Stärke   `mischeAmbient`/`mischeStaerke` normieren
          die Tagseite (Tag 0,4032 / Abend 0,5968). Dort ist
          Abend = Tag exakt richtig.

      ── Was NICHT übertragbar war, und was statt dessen dasteht ───────

      1. AZIMUT 150°. Unser Sonnenlauf hat keinen Azimut-Parameter (die
         Sonne geht im Osten auf und im Westen unter, `sunAngle` ist
         allein die Maximalhöhe). Übernommen ist deshalb nur die
         Elevation; sie ist die Grösse, die Lambert und damit die
         Bodenhelligkeit bestimmt.

      2. AMBIENT AUS EINER CUBEMAP. Das Vorbild beleuchtet mit
         `Sky1 L1` × Tint #B2D1FE × Exposure 0,8. Wir haben diese Cubemap
         nicht und können ihre absolute Helligkeit aus den Daten auch
         nicht ableiten — der Tint sagt nur, WIE die Umgebung gefärbt
         ist, nicht wie hell sie leuchtet (das steht in den Texeln).
         Übernommen ist deshalb der TINT als Farbe des Grundlichts; die
         HÖHE des Grundlichts ist am Bild kalibriert (`look.belichtung`,
         s. server.yml). Ausdrücklich NICHT übernommen sind
         `m_AmbientSkyColor`/`EquatorColor`/`GroundColor`: Sie stehen im
         Vorbild auf Unitys Vorgabe und sind bei `AmbientMode = Skybox`
         wirkungslos (§D, F12) — wer sie abschreibt, schreibt eine
         Vorgabe ab.

      3. INTENSITÄT 2,3. Eine URP-Lux-Zahl gegen Babylons
         `DirectionalLight.intensity` zu stellen ist keine Umrechnung,
         sondern eine Verwechslung zweier Skalen. Belastbar ist am
         Vorbild allein das VERHÄLTNIS Sonne zu Grundlicht, und das hängt
         an der Cubemap, die uns fehlt (s. 2.). `lightIntensityDay`
         bleibt deshalb bei der am Bild kalibrierten 1,55 und wird über
         die Regionsmessung nachgezogen, nicht über die 2,3.

      Klar-Comic now carries the measured numbers of the original's
      Level1 scene (design/original-boden.md §D): sun #FFC98C at 50°,
      ambient from the skybox tint #B2D1FE, fog LINEAR 15 → 200 m in
      #73A7FF. The original has one fixed sun, so the evening keyframes
      are derived to keep 17 h on the same colour — only the sun's
      elevation moves across the day.
    */
    fogColorMorning: c(0.3, 0.31, 0.34),
    /*
      #73A7FF = (0,450 / 0,654 / 1,000), `m_FogColor` der Szene Level1.

      Das ist ein KRÄFTIGES Blau und nicht der helle Dunst, der hier bis
      gestern stand (0,83 / 0,87 / 0,92). Zusammen mit `linear 15 → 200 m`
      ist der Nebel die stärkste Einzelgrösse im Bild des Vorbilds: Bei
      200 m Endweite und 1200 m Kameraweite sind seine Bergmeshes voll
      eingefärbt — das blaue Panorama in Bild 3 ist zu grossen Teilen
      diese Farbe und nicht die des Gesteins (§D).

      ⚠ DER HIMMEL HÄNGT NICHT MEHR DARAN. `look.himmel.horizont` stand
      auf `nebel`, der Horizont der Kuppel WAR also diese Farbe. Im
      Vorbild sind Nebel und Himmel zwei verschiedene Dinge — der Himmel
      ist eine Cubemap, der Nebel eine Farbe —, und die Referenz misst
      sie auch verschieden: Himmel S 0,133 (heller Dunst) gegen Nebel
      S 0,549 (sattes Blau). Mit gekoppeltem Horizont wäre die eine Zahl
      nur um den Preis der anderen zu treffen. `server.yml` trägt deshalb
      jetzt eine eigene Horizontfarbe; die Begründung steht dort.
    */
    fogColorDay: c(0.45, 0.654, 1.0),
    // Tag · 0,98013 — s. die Rechnung im Kopf dieses Blocks.
    fogColorEvening: c(0.441, 0.641, 0.98),
    fogColorNight: c(0.145, 0.15, 0.169),
    fogColorSunMorning: c(0.3, 0.31, 0.34),
    fogColorSunDay: c(0.45, 0.654, 1.0),
    fogColorSunEvening: c(0.441, 0.641, 0.98),
    fogColorSunNight: c(0.145, 0.15, 0.169),
    /*
      Die vier Dichten sind ab jetzt WIRKUNGSLOS und bleiben trotzdem
      stehen: Das Look-Profil fährt `nebelmodus: linear`, und im
      Linear-Modus liest weder Babylon noch die Nebelkette des Bodens
      `fogDensity` (genau wie im Vorbild, wo `m_FogDensity` 0,01 neben
      `m_FogMode = 1` steht und nichts tut). Wer das Profil auf `exp`
      zurückdreht, bekommt die alte, am Bild kalibrierte Kurve zurück —
      deshalb werden die Zahlen nicht gelöscht.
    */
    fogDensityMorning: 0.0016,
    fogDensityDay: 0.0009,
    fogDensityEvening: 0.0012,
    fogDensityNight: 0.0025,
    sunColorMorning: c(1.0, 0.75, 0.55),
    // #FFC98C — `Light.m_Color` der Sonne von Level1, sRGB wie jede
    // EnvColor dieser Datei (`Lighting.inLinear()` wandelt sie).
    sunColorDay: c(1.0, 0.788, 0.549),
    // Tag · 0,98013 — s. die Rechnung im Kopf dieses Blocks.
    sunColorEvening: c(0.98, 0.772, 0.538),
    sunColorNight: c(0.364, 0.384, 0.486),
    /*
      Der Tint der Skybox `Sky1 L1`: #B2D1FE = (0,697 / 0,821 / 0,996).

      Er ersetzt die alte (0,86 / 0,95 / 1,00) — kühler und um rund ein
      Fünftel dunkler. Was er NICHT mitbringt, ist die Helligkeit der
      Cubemap selbst; die Begründung steht im Kopf dieses Blocks unter
      Punkt 2.
    */
    ambColorDay: c(0.564, 0.665, 0.811),
    ambColorNight: c(0.357, 0.368, 0.485),
    /*
      Gleich dem Tag: `mischeAmbient` normiert die Tagseite (Tag 0,4032 /
      Abend 0,5968), damit liefert Abend = Tag bei 17 h exakt den
      Tageswert. Das ist die Übersetzung von „das Vorbild hat EIN
      Grundlicht" in ein Keyframe-Modell.

      Hier stand (0,775 / 0,82 / 1,00), zurückgerechnet aus dem
      Grundlichtanteil 0,395 von `village1.json`. Diese Vorlage ist nicht
      mehr das Ziel.
    */
    ambColorEvening: c(0.564, 0.665, 0.811),
    /*
      1,55 bleibt stehen, und zwar als KALIBRIERTE und nicht als
      übertragene Zahl — die 2,3 des Vorbilds ist eine URP-Grösse ohne
      Entsprechung hier (Punkt 3 im Kopf dieses Blocks). Was am Bild
      nachgezogen wird, ist `look.belichtung`.

      `lightIntensityNight: 1.0` ist aus `Clear` übernommen und sieht nur
      hell aus: In diesem Datenmodell steckt die Dunkelheit der Nacht in
      der FARBE (`sunColorNight` ist ein dunkles Blau), nicht in der
      Stärke.
    */
    lightIntensityDay: 0.97,
    lightIntensityNight: 1.0,
    /*
      Gleich dem Tag, aus demselben Grund wie `ambColorEvening`:
      `mischeStaerke` normiert die Tagseite, und das Vorbild hat EINE
      Sonnenstärke. Hier stand 2,67 — der Wert, mit dem der Abend gegen
      `village1.json` (#ffe4c6 × 3,0) aufgeholt hat. Diese Vorlage gilt
      nicht mehr; was den Abend jetzt dunkler macht als den Mittag, ist
      allein der Sonnenstand (26,8° gegen 50°), und genau so ist es im
      Vorbild auch: eine Sonne, ein Licht, ein Winkel.
    */
    lightIntensityEvening: 0.97,
    /*
      50° — die gemessene Elevation der Sonne von Level1 (§D). `sunAngle`
      ist die MAXIMALHÖHE, also der Stand bei Tagesbruchteil 0,5; die
      Referenzmessung gegen Bild 3 läuft genau dort und trifft damit den
      Sonnenstand des Vorbilds auf die Zehntel.

      Vorher 46 — eine Zahl, die den 27°-Abendstand von `village1.json`
      bei 17 h treffen sollte. Mit 50 liegen um 17 h 29,1° an; der
      Unterschied ist eine Folge des neuen Ziels und keine Ungenauigkeit.
      Den AZIMUT (150°) kennt unser Sonnenlauf nicht — s. Punkt 1 oben.
    */
    sunAngle: 50,
    alwaysDark: false,
    /*
      ── A5 (11.09.2026): 0,06 war keine geringe Deckung, sondern keine ─

      Die Kuppel rechnet ihre Wolkendichte gegen die Schwelle
      `1,25 − deckung · 1,15` (`ValheimSky.ts`). Bei 0,06 steht die
      Schwelle auf 1,181, während das FBM der Lagen im Mittel rund 0,8
      erreicht und nur in Spitzen darüber kommt — es gab also nicht
      wenige Wolken, sondern in keinem Bild eine. Genau das steht in der
      Bestandsaufnahme der Roadmap als „Himmel oben ohne Wolken".

      0,34 ist am Vorbild GEMESSEN. Bild 3 der Referenz, Himmelsfenster
      1170–1350 / 0–150 (reiner Himmel, ohne Berg und ohne Sonnenhof):

        Spanne p95 − p5 = 28 Luma     Anteil über 1,03 × Median = 32 %

      Das sind dünne, weiche Schleier und keine Schäfchenherde. Der
      Zeuge ist `~/wov-lab-mess/himmel-mess.mjs`: Er misst dieselben zwei
      Zahlen INNERHALB eines Elevationsbandes — sonst zählte der
      Himmelsverlauf als Streuung mit und jede Wolkenaussage wäre eine
      Aussage über den Verlauf.

      Die übrigen Wetter bleiben unberührt: Ihre Deckungen stehen in
      `envData.json` und beschreiben Regen, nicht diesen Look.

      A5: 0.06 produced literally zero clouds (the dome's threshold sits
      above the noise); 0.34 is measured against reference image 3.
    */
    rainCloudAlpha: 0.4,
  },
];

/**
 * Overlay extracted ground truth (envData.json) onto the hand-tuned table.
 *
 * envData.json ships EMPTY and is filled by tools/dump-envsetup.mjs from a
 * local asset export, so this is a no-op until that has been run — the
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
 * Where we sit between the four keyframes. The keys are anchored at
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
 * Genau daraus entsteht die Dämmerung — die Farben werden nicht zur
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
 *
 * ── SEIT DEM 12.09.2026 SIND DIESE VIER ZAHLEN NUR NOCH DIE MISCHUNG ──
 *
 * Wieviel Tagseite überhaupt zählt, sagt jetzt allein der Sonnenstand
 * (`tagseitenAnteil`). Die Gewichte hier entscheiden nur noch, WELCHER
 * der drei tagseitigen Keyframes die Farbe stellt — Tag, Morgen oder
 * Abend. Die Summe der vier ist damit keine Helligkeit mehr, und der
 * Absatz oben über die „gegen Schwarz gedämpfte" Dämmerung beschreibt
 * die alte Rechnung; die Dämpfung steckt jetzt im Nachtanteil
 * `night · (1 − tagseitenAnteil)`.
 *
 * These four are only the MIX now; how much day side counts at all comes
 * from the sun's elevation (`tagseitenAnteil`).
 */
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const SUN_HORIZON_TRANSITION_H = 0.08;
/*
  ── 0,02 war die halbe Ursache des schwarzen Abends ──────────────────

  Mit 0,02 fällt das Abendgewicht bei f = 0,76 (18:14) auf exakt null,
  während die Sonne erst bei f = 0,85 (20:24) untergeht: auf 19,6 % des
  Zyklus stand die Sonne bis zu 19° hoch und es gab trotzdem KEINEN
  tagseitigen Keyframe mehr, aus dem sich eine Farbe hätte mischen
  lassen. Morgens dasselbe Loch ab f = 0,24 rückwärts bis zum
  Sonnenaufgang bei f = 0,1333.

  Die Rampe muss deshalb mindestens so weit reichen, wie der Tagesanteil
  überhaupt zählt — und das ist bis `ELEV_DAEMMERUNG` unter dem Horizont,
  also bis f = 0,1243 (morgens) bzw. f = 0,8590 (abends). Vom jeweiligen
  Gipfel (0,26 / 0,74) aus sind das 0,1357 bzw. 0,1190; 0,14 deckt beide
  Seiten mit Rand ab und bleibt EINE Zahl.

  Was sich dadurch NICHT ändert: die Gewichte oberhalb des Gipfels — dort
  führt `SUN_HORIZON_TRANSITION_H`. Um 17 h (f = 0,70833) stehen deshalb
  unverändert Tag 0,408 und Abend 0,604 an; die Wache in
  `server/test/stufe2-licht.ts` misst genau diese beiden Zahlen.

  0.02 let the evening weight die at f = 0.76 while the sun sets at 0.85.
  The ramp now reaches past the horizon on both sides; the high side (and
  with it the 17 h weights) is untouched.
*/
const SUN_HORIZON_TRANSITION_L = 0.14;

/**
 * Ab diesem Sonnenstand zählt die Tagseite voll (Elevationsfaktor, also
 * `sunAngle`-Anteile: 0,40 sind bei Klar-Comic 20,0°).
 *
 * Warum die Tagseite oben NICHT weiter ansteigt: Der Keyframe beschreibt
 * die STIMMUNG des Himmels, nicht den Einfallswinkel. Wie schräg das
 * Licht auftrifft, steht schon in `lightDir` und rechnet Babylon in jedem
 * Pixel mit; wer es hier ein zweites Mal hineinrechnet, dunkelt den
 * Nachmittag doppelt ab. Zwischen Mittag und 18:04 ist der Himmel voll
 * „Tag", und das Bild wird trotzdem flacher, weil die Sonne sinkt.
 *
 * ── Warum ausgerechnet 0,40 und keine rundere Zahl ───────────────────
 *
 * An den beiden Vierteln des Tages (f = 0,25 und f = 0,75) hat der
 * NACHTBOGEN seinen Wurzelknick: `sqrt` startet dort mit senkrechter
 * Tangente. Bekommt der Nachtanteil an dieser Stelle einen Beiwert über
 * null, schlägt diese senkrechte Tangente durch, und die Sonne wird für
 * einen Augenblick wieder HELLER, obwohl sie sinkt (gemessen: genau ein
 * Anstieg, bei f = 0,7507, mit `ELEV_TAG_VOLL = 0,55`).
 *
 * Der Beiwert ist `1 − tagseitenAnteil`. Er ist null, solange die
 * Tagseite voll zählt — und der Sonnenstand an den beiden Vierteln ist
 * 0,4894 (morgens) und 0,4253 (abends). Jede Schwelle unterhalb von
 * 0,4253 legt den Knick damit in einen Bereich, in dem er nichts wiegt.
 * 0,40 tut das mit Rand.
 *
 * 0.40 sits below the sun's elevation at both quarter points (0.489 /
 * 0.425), where the night arc's sqrt has a vertical tangent — that is
 * what makes the evening fall monotone.
 */
const ELEV_TAG_VOLL = 0.4;
/**
 * So tief unter dem Horizont endet die Tagseite (Dämmerband).
 *
 * Bei Sonnenuntergang (Elevation 0) bleiben dadurch 0,10 / 0,50 = 20 %
 * Tagseite stehen — die Dämmerung — und erst 0,0090 Zyklusanteile später
 * (rund 16 Sekunden Bildschirmzeit) ist die Tagseite sauber null. Ab da
 * ist jede Zahl dieser Datei Zeichen für Zeichen die alte: die NACHT
 * bleibt unangetastet.
 */
const ELEV_DAEMMERUNG = 0.1;

/**
 * Der tagseitige Anteil — die EINE Uhr.
 *
 * ── Warum es diese Funktion gibt ─────────────────────────────────────
 * Bis zum 11.09.2026 liefen im Tageslauf zwei Uhren gegeneinander: Die
 * Phasengewichte endeten bei f = 0,75 bzw. 0,25, der Sonnenbogen erst bei
 * 0,85 bzw. 0,1333. Auf 19,6 % des Zyklus stand die Sonne also am Himmel,
 * während Licht, Nebel und Grundlicht bereits ausschliesslich aus dem
 * Nacht-Keyframe kamen — gemessen fiel die Sonnenleuchtdichte zwischen
 * 17:42 und 18:18 um den Faktor 176 und lag danach bei 0,73 % des
 * Mittagswerts, dem 27. Teil der Mitternachtshelligkeit. Umgekehrt
 * addierten sich Tag- und Abendgewicht kurz vor dem Knick auf 1,199 und
 * schoben die Sonnenfarbe mit (1,180 / 0,930 / 0,648) über Weiss.
 *
 * Beides verschwindet, wenn die Menge Tag nicht mehr aus den Gewichten,
 * sondern aus dem Sonnenstand kommt. Die Funktion ist monoton im
 * Sonnenstand, liegt in 0..1 und ist am Mittag exakt 1 — der Mittag
 * bleibt dadurch Zeichen für Zeichen, wie er war.
 *
 * The single clock: how much the day side counts, straight from the sun's
 * elevation. Monotone, 0..1, exactly 1 at midday.
 */
export function tagseitenAnteil(elevation: number): number {
  return clamp01((elevation + ELEV_DAEMMERUNG) / (ELEV_TAG_VOLL + ELEV_DAEMMERUNG));
}

/**
 * Der Nachtanteil der Himmelskuppel — dieselbe Grösse, andere Rampe.
 *
 * Die Kuppel hing schon immer am Sonnenstand (`ValheimSky.update`), aber
 * mit zwei nirgends benannten Zahlen mitten im Code. Sie stehen jetzt
 * hier, neben der Uhr, die das Licht fährt: Damit kann keine der beiden
 * Rampen still von der anderen wegwandern, und der Widerspruch, der das
 * schwarze Band am Horizont erzeugt hat („Himmel auf Tagfarbe, Licht auf
 * Nacht"), ist als Eigenschaft prüfbar — wo die Kuppel Tag zeigt
 * (`kuppelNacht` klein), ist `tagseitenAnteil` nachweislich > 0.
 *
 * DIE ZAHLEN SIND UNVERÄNDERT (0,25 / 0,45). Sterne, Mond und
 * Sonnenscheibe verblassen deshalb zur selben Sekunde wie bisher; ihre
 * Helligkeit hängt im Fragment-Shader an genau diesem Wert.
 *
 * The dome's night term, unchanged in value (0.25 / 0.45) — moved here so
 * dome and light demonstrably read the same clock.
 */
export function kuppelNacht(elevation: number): number {
  return 1 - clamp01((elevation + 0.25) / 0.45);
}

export interface PhaseWeights {
  night: number;
  day: number;
  morning: number;
  evening: number;
}


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

/**
 * Die tagseitige Mischung: WELCHER der drei Keyframes die Farbe stellt.
 *
 * Normiert, im Unterschied zur alten Summe — die Menge Tag steht seit dem
 * 12.09.2026 in `tagseitenAnteil` und nicht mehr in diesen Gewichten.
 * Genau daran lag der Überlauf: Tag- und Abendgewicht summierten sich auf
 * 7,2 % des Zyklus auf bis zu 1,199 und hoben die Sonne über Weiss, und
 * unmittelbar danach fielen beide auf null und rissen sie um den Faktor
 * 176 nach unten. Eine Mischung kann weder das eine noch das andere.
 *
 * Fällt die Summe auf null (kein tagseitiger Keyframe in Reichweite), gilt
 * der Tag-Keyframe. Das ist eine Wache, kein Arbeitspfad: Die Rampen
 * reichen seit derselben Änderung über den ganzen Bereich, in dem
 * `tagseitenAnteil` überhaupt grösser als null ist.
 *
 * Which of the three day-side keyframes supplies the colour — normalised.
 */
function tagseitenMischung(w: PhaseWeights): { tag: number; morgen: number; abend: number } {
  const summe = w.day + w.morning + w.evening;
  if (!(summe > 0)) return { tag: 1, morgen: 0, abend: 0 };
  return { tag: w.day / summe, morgen: w.morning / summe, abend: w.evening / summe };
}

/**
 * Eine Keyframe-Farbe für einen Augenblick: Nachtanteil plus Tagseite.
 *
 * ── Die Form, und warum sie die Gewichtssumme nicht mehr sprengen kann ─
 *
 *   Farbe = nacht · (1 − t) · Nacht-Keyframe  +  t · Tagseiten-Mischung
 *
 * mit `t = tagseitenAnteil(elevation)` und `nacht = w.night`. Die Summe
 * der Anteile ist `nacht · (1 − t) + t ≤ 1` für jedes `nacht ≤ 1` — die
 * Schranke ist also keine geprüfte Zusage, sondern eine Eigenschaft der
 * Form. An beiden Enden bleibt alles, wie es war: bei `t = 0` steht dort
 * `nacht · Nacht-Keyframe` (Zeichen für Zeichen die alte Nacht), bei
 * `t = 1` ist der Nachtanteil null und es zählt allein die Tagseite (der
 * Mittag also unverändert).
 *
 * Das alte Tor `dayGated` ist damit weg. Es fragte die Gewichte, ob es
 * noch Tag sei — und die Gewichte waren die falsche Uhr.
 *
 * Night share plus day side; the weights can no longer sum past 1.
 */
function mischeKeyframes(
  env: EnvSetup,
  prefix: 'fogColor' | 'fogColorSun' | 'sunColor',
  w: PhaseWeights,
  tagAnteil: number
): EnvColor {
  const k = (suffix: string): EnvColor =>
    env[`${prefix}${suffix}` as keyof EnvSetup] as EnvColor;
  const m = tagseitenMischung(w);
  const nachtAnteil = w.night * (1 - tagAnteil);
  const n = k('Night');
  const d = k('Day');
  const mo = k('Morning');
  const ab = k('Evening');
  return {
    r: n.r * nachtAnteil + (d.r * m.tag + mo.r * m.morgen + ab.r * m.abend) * tagAnteil,
    g: n.g * nachtAnteil + (d.g * m.tag + mo.g * m.morgen + ab.g * m.abend) * tagAnteil,
    b: n.b * nachtAnteil + (d.b * m.tag + mo.b * m.morgen + ab.b * m.abend) * tagAnteil,
  };
}

/** Dieselbe Form für die vier Nebeldichten. */
function mischeDichte(env: EnvSetup, w: PhaseWeights, tagAnteil: number): number {
  const m = tagseitenMischung(w);
  return (
    env.fogDensityNight * w.night * (1 - tagAnteil) +
    (env.fogDensityDay * m.tag +
      env.fogDensityMorning * m.morgen +
      env.fogDensityEvening * m.abend) *
      tagAnteil
  );
}

/**
 * Das TAGSEITIGE Gewicht für die beiden optionalen Abend-Schlüssel.
 *
 * Grundlicht und Sonnenstärke werden im Referenzmodell nicht wie die
 * Farben ADDIERT, sondern zwischen Nacht und Tag INTERPOLIERT
 * (EnvMan.cs:711 für das Ambient; für die Stärke siehe die Begründung
 * bei `lightIntensity` unten). Ein Abend-Stützpunkt muss diese Form
 * behalten, sonst wäre er ein zweites Rechenmodell im selben Objekt.
 *
 * Deshalb wird der Abend nicht als dritter Summand angehängt, sondern
 * die TAGSEITE bekommt zwei Keyframes: Tag und Abend werden nach ihren
 * Gewichten zu EINER Farbe gemittelt, und diese eine Farbe geht gegen die
 * Nacht.
 *
 * ── Was sich am 12.09.2026 geändert hat ──────────────────────────────
 * Der MISCHUNGSANTEIL kommt weiter aus den Phasengewichten (bei 17 h also
 * unverändert Tag 0,4032 / Abend 0,5968, s. der Block bei
 * `ambColorEvening`), die MENGE dagegen aus `tagseitenAnteil`. Vorher
 * stand hier `s = w.day + w.evening`, und dieses `s` fiel zwischen 18:14
 * und 20:24 auf null, während die Sonne noch bis zu 19° hoch stand: Das
 * Grundlicht sprang mitten am Abend auf den Nacht-Keyframe. Der Morgen
 * blieb bei der alten Rechnung ganz aussen vor — deshalb dasselbe Loch
 * zwischen Sonnenaufgang und f = 0,24, nur ohne eigenen Namen.
 *
 * Fällt der Abend weg, ist die Tagseite der Tagwert und die Zeile ist
 * Zeichen für Zeichen die alte.
 *
 * Mix from the phase weights, AMOUNT from the sun's elevation.
 */
function tagseite(w: PhaseWeights, hatAbend: boolean): { wTag: number; wAbend: number } {
  const s = w.day + (hatAbend ? w.evening : 0);
  if (!(s > 0)) return { wTag: 1, wAbend: 0 };
  return { wTag: w.day / s, wAbend: (hatAbend ? w.evening : 0) / s };
}

/** Grundlicht: Nacht → (Tag, Abend), Menge aus `tagseitenAnteil`. */
function mischeAmbient(env: EnvSetup, w: PhaseWeights, tagAnteil: number): EnvColor {
  const abend = env.ambColorEvening;
  if (tagAnteil <= 0) return env.ambColorNight;
  const { wTag, wAbend } = tagseite(w, abend !== undefined);
  const d = env.ambColorDay;
  const tag: EnvColor =
    abend === undefined
      ? d
      : {
          r: d.r * wTag + abend.r * wAbend,
          g: d.g * wTag + abend.g * wAbend,
          b: d.b * wTag + abend.b * wAbend,
        };
  return lerpColor(env.ambColorNight, tag, tagAnteil);
}

/** Sonnenstärke: Nacht → (Tag, Abend), Menge aus `tagseitenAnteil`. */
function mischeStaerke(env: EnvSetup, w: PhaseWeights, tagAnteil: number): number {
  const abend = env.lightIntensityEvening;
  if (tagAnteil <= 0) return env.lightIntensityNight;
  const { wTag, wAbend } = tagseite(w, abend !== undefined);
  const tag =
    abend === undefined ? env.lightIntensityDay : env.lightIntensityDay * wTag + abend * wAbend;
  return lerp(env.lightIntensityNight, tag, tagAnteil);
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
  /*
    ── EINE Uhr: die Menge Tag kommt aus dem Sonnenstand ──────────────

    Alles, was unten tagseitig ist — Nebelfarbe, Sonnenfarbe, Grundlicht,
    Sonnenstärke, Nebeldichte —, hängt ab hier an derselben Zahl. Bei
    `alwaysDark` ist die Elevation −1, `tagseitenAnteil` also 0, und die
    Höhle bleibt genau so dunkel, wie sie war.
  */
  const tagAnteil = tagseitenAnteil(elevation);

  // Sun rises in the east, sets in the west; azimuth sweeps with the day so
  // shadows rotate through the cycle instead of only shortening.
  const f = ((dayFraction % 1) + 1) % 1;
  const azimuth = (f - 0.25) * Math.PI * 2;
  const maxElevRad = (env.sunAngle * Math.PI) / 180;
  const height = Math.sin(elevation * maxElevRad);
  const horiz = Math.cos(elevation * maxElevRad);

  const fogColor = mischeKeyframes(env, 'fogColor', w, tagAnteil);
  /*
    EnvMan.cs:705 — der Sonnennebel wird gegen den normalen Nebel
    zurückgemischt, sobald weder Tag noch Nacht klar dominieren.

    Gefragt wird jetzt die EINE Uhr statt zweier Phasengewichte: `w.day`
    war bei Tagesbruchteil 0,75 exakt null, und dort fiel der gerichtete
    Nebel schlagartig auf die ungerichtete Farbe zurück, obwohl die Sonne
    noch 21° hoch stand. Für `Klar-Comic` ändert das nichts (beide
    Nebelfarben sind dort absichtlich gleich), für jedes andere Wetter
    schon.
  */
  const nachtAnteil = w.night * (1 - tagAnteil);
  const sunFogRaw = mischeKeyframes(env, 'fogColorSun', w, tagAnteil);
  const sunMix = clamp01(Math.max(nachtAnteil, tagAnteil) * 3);

  return {
    fogColor,
    fogColorSun: {
      r: fogColor.r + (sunFogRaw.r - fogColor.r) * sunMix,
      g: fogColor.g + (sunFogRaw.g - fogColor.g) * sunMix,
      b: fogColor.b + (sunFogRaw.b - fogColor.b) * sunMix,
    },
    fogDensity: mischeDichte(env, w, tagAnteil),
    sunColor: mischeKeyframes(env, 'sunColor', w, tagAnteil),
    // EnvMan.cs:711 — RenderSettings.ambientLight = Lerp(night, day, dayInt).
    // Seit dem 09.09.2026 durch `mischeAmbient()`, das GENAU diese Zeile
    // rechnet, solange kein `ambColorEvening` gesetzt ist.
    ambColor: mischeAmbient(env, w, tagAnteil),
    /*
      ── Die Sonnenstärke wird INTERPOLIERT, nicht aufsummiert ─────────

      Hier stand `Id · w.day + In · w.night`. An den beiden Vierteln des
      Tages (Bruchteil 0,25 und 0,75 = 6 und 18 Uhr) sind BEIDE Gewichte
      exakt null — der Tagbogen endet dort, der Nachtbogen beginnt dort —
      und die Summe war damit zweimal je Zyklus 0,000. Die Szene wurde
      nachtschwarz, obwohl der Morgen- bzw. Abend-Keyframe mit 0,5
      danebenstand (gemessen über 24 h in Viertelstunden, Bauer „Gras",
      09.09.2026; die Reihe steht im Test `stufe2-licht.ts`).

      Die Zeile darunter — das Umgebungslicht — machte es die ganze Zeit
      richtig: `Lerp(night, day, dayInt)`, mit EnvMan.cs:711 als Beleg.
      Diese hier war die einzige Stelle, an der zwei Phasengewichte
      ADDIERT wurden, und zwei Gewichte zu addieren, die gleichzeitig
      durch null gehen, ergibt null.

      An den Enden ändert sich dadurch NICHTS: Um Mitternacht ist
      `w.day = 0` und die Interpolation liefert `In`, mittags ist
      `w.day = 1` und sie liefert `Id` — beides genau wie vorher. Anders
      wird es nur in den Übergängen, und zwar so, wie das Datenmodell es
      meint: Die Dunkelheit der Nacht steckt in der FARBE
      (`sunColorNight` ist dunkelblau), nicht in der Stärke. Die alte
      Summe hat den Übergang deshalb doppelt gedämpft — einmal über die
      Farbe, einmal über die Stärke — und an den zwei Nullpunkten mit
      null multipliziert.

      Interpolated, not summed: at day fractions 0.25 and 0.75 both
      weights are exactly zero and the sum went black twice per cycle.
      The ambient line below always did it this way (EnvMan Lerp).

      Seit dem 09.09.2026 steht die Interpolation in `mischeStaerke()` —
      dieselbe Zeile, solange kein `lightIntensityEvening` gesetzt ist.
    */
    lightIntensity: mischeStaerke(env, w, tagAnteil),
    cloudAlpha: env.rainCloudAlpha,
    // Light travels from the sky towards the ground → negate. |height|
    // keeps the MOON overhead at night (there is one main light that
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
    /*
      Als Ja/Nein-Auskunft fürs HUD (`main.ts` schreibt „tag"/„nacht").

      Hier stand `w.night > w.day`, und das war dieselbe zweite Uhr wie
      überall sonst: Bei Tagesbruchteil 0,80 (19:12) meldete es Nacht,
      während die Sonne noch 11° über dem Horizont stand. Gefragt wird
      jetzt der Sonnenstand selbst — das ist die Entscheidung E2 der
      Analyse, wörtlich: Tag gilt, solange die Sonne oben ist. Höhlen
      (`alwaysDark`) tragen Elevation −1 und bleiben Nacht.

      Was das NICHT ist: ein Lichtschalter. Der Übergang liegt in
      `tagseitenAnteil` und ist stetig; diese Zeile beschriftet nur.
    */
    isNight: elevation <= 0,
    elevation,
  };
}

/** Seconds within the current day → 0..1 fraction (EnvMan.GetDayFraction). */
export function dayFractionFromSeconds(timeOfDaySeconds: number): number {
  const f = (timeOfDaySeconds / WORLD_TIME_LENGTH) % 1;
  return (f + 1) % 1;
}
