/**
 * Weather selection and wind — port of the EnvMan parts that decide WHICH
 * weather is active and HOW HARD the wind blows.
 *
 * C# reference: EnvMan.UpdateEnvironment / SelectWeightedEnvironment and
 * EnvMan.UpdateWind / AddWindOctave. environment.ts already holds the
 * per-weather lighting keyframes; this file is the layer above it.
 *
 * ── Everything here is a pure function of the world time ─────────────
 * Valheim derives both the weather and the wind from the world clock plus
 * Unity's seeded PRNG — no state is synchronised between machines. Two
 * clients showing the same second show the same storm from the same angle.
 * Reproducing that means reproducing the PRNG, which XorShiftRandom does
 * (it is Unity's generator, reverse-engineered by the Valhalla project).
 *
 * So: no randomness that is not seeded, and integer division where C# had
 * `long`s — `timeSec / (m_windPeriodDuration / octave)` truncates twice,
 * and getting that wrong desynchronises the wind from vanilla.
 *
 * The transitions (weather cross-fade, wind ramp) are the one part that IS
 * stateful, because they depend on when the change was noticed. They live
 * in WeatherManager at the bottom of this file.
 */

import envData from './envData.json';
import { ENVIRONMENTS, findEnvironment, environmentForBiome, type EnvSetup } from './environment.js';
import { Biome } from './types.js';
import { XorShiftRandom } from './worldgen/Random.js';

// ── Timing (EnvMan prefab values, not the C# field defaults) ─────────
//
// The C# source shows m_environmentDuration = 20 and m_windPeriodDuration
// = 10, but both are serialised fields that the EnvMan prefab overrides —
// the real values are 666 and 1000. Taking the source defaults would cycle
// the weather 30x too fast, so these come from the extraction.

interface EnvTiming {
  environmentDuration?: number;
  windPeriodDuration?: number;
  windTransitionDuration?: number;
  transitionDuration?: number;
  wetTransitionDuration?: number;
  dayLengthSec?: number;
}

const TIMING: EnvTiming = (envData as { timing?: EnvTiming }).timing ?? {};

/** Seconds one weather lasts before a new roll. */
export const ENVIRONMENT_DURATION = TIMING.environmentDuration ?? 666;
/** Base period of the slowest wind octave, in seconds. */
export const WIND_PERIOD_DURATION = TIMING.windPeriodDuration ?? 1000;
/** Seconds the wind takes to ramp from the old vector to the new one. */
export const WIND_TRANSITION_DURATION = TIMING.windTransitionDuration ?? 10;
/** Seconds the lighting cross-fades when the weather changes. */
export const WEATHER_TRANSITION_DURATION = TIMING.transitionDuration ?? 10;
/** Seconds the wet look fades in/out — slower than the lighting blend. */
export const WET_TRANSITION_DURATION = TIMING.wetTransitionDuration ?? 15;

// ── Biome weather tables (EnvMan.m_biomes) ──────────────────────────

/** One candidate weather with its draw weight. */
export interface WeatherEntry {
  environment: string;
  weight: number;
  ashlandsOverride: boolean;
  deepnorthOverride: boolean;
}

interface RawBiomeWeather {
  biome: number;
  name?: string;
  environments: WeatherEntry[];
}

/**
 * Candidate weathers per biome bit. Falls back to the single default
 * weather of environment.ts when envData.json carries no tables — the
 * result is then a constant weather per biome, which is what the project
 * did before this file existed.
 */
function buildBiomeWeather(): ReadonlyMap<number, readonly WeatherEntry[]> {
  const raw = (envData as { biomes?: RawBiomeWeather[] }).biomes ?? [];
  const out = new Map<number, readonly WeatherEntry[]>();
  for (const b of raw) {
    // Drop entries naming a weather we have no EnvSetup for, rather than
    // letting selectWeather() hand back a null environment later.
    const entries = b.environments.filter((e) => findEnvironment(e.environment));
    if (entries.length > 0) out.set(b.biome, entries);
  }
  return out;
}

const BIOME_WEATHER = buildBiomeWeather();

/** Biome bits in the order EnvMan lists them — first match wins. */
const BIOME_ORDER: readonly Biome[] = [
  Biome.Meadows,
  Biome.BlackForest,
  Biome.Swamp,
  Biome.Mountain,
  Biome.Plains,
  Biome.Mistlands,
  Biome.AshLands,
  Biome.DeepNorth,
  Biome.Ocean,
];

/**
 * Biome is a bitmask and blend zones carry several bits. Resolve to a
 * single bit the same way environmentForBiome does, so weather and
 * lighting never disagree about which biome the player is in.
 */
function resolveBiomeBit(biome: Biome): Biome | null {
  for (const bit of BIOME_ORDER) {
    if ((biome & bit) !== 0) return bit;
  }
  return null;
}

// ── Weather selection ───────────────────────────────────────────────

/** Which weather period a world time falls into. C#: `sec / m_environmentDuration`. */
export function weatherPeriod(timeSec: number): number {
  return Math.floor(timeSec / ENVIRONMENT_DURATION);
}

/**
 * C# SelectWeightedEnvironment. Entries flagged as an Ashlands/DeepNorth
 * override are excluded from the draw — they replace the result afterwards
 * when the player is actually there.
 */
function selectWeighted(entries: readonly WeatherEntry[], rng: XorShiftRandom): string | null {
  let total = 0;
  for (const e of entries) {
    if (!e.ashlandsOverride && !e.deepnorthOverride) total += e.weight;
  }
  if (total <= 0) return null;
  const roll = rng.rangeFloat(0, total);
  let acc = 0;
  for (const e of entries) {
    if (e.ashlandsOverride || e.deepnorthOverride) continue;
    acc += e.weight;
    if (acc >= roll) return e.environment;
  }
  const last = entries[entries.length - 1];
  return last.ashlandsOverride || last.deepnorthOverride ? null : last.environment;
}

export interface WeatherOptions {
  /** True inside the Ashlands — activates entries flagged as its override. */
  ashlands?: boolean;
  /** True inside the Deep North. */
  deepnorth?: boolean;
}

/**
 * The weather for a biome at a world time. Deterministic: same seconds and
 * same biome always give the same answer, on every machine.
 *
 * C# seeds with `Random.InitState((int)period)` — note the cast to int, so
 * the period index is what drives the draw, not the raw time.
 */
export function selectWeather(biome: Biome, timeSec: number, opts: WeatherOptions = {}): EnvSetup {
  const bit = resolveBiomeBit(biome);
  const entries = bit === null ? undefined : BIOME_WEATHER.get(bit);
  if (!entries || entries.length === 0) return environmentForBiome(biome);

  const rng = new XorShiftRandom(weatherPeriod(timeSec) | 0);
  let name = selectWeighted(entries, rng);
  // Overrides win over the draw, exactly as in UpdateEnvironment.
  for (const e of entries) {
    if (e.ashlandsOverride && opts.ashlands) name = e.environment;
    if (e.deepnorthOverride && opts.deepnorth) name = e.environment;
  }
  return (name ? findEnvironment(name) : undefined) ?? environmentForBiome(biome);
}

// ── Wind ────────────────────────────────────────────────────────────

/** Raw wind noise, before the weather scales it. */
export interface WindNoise {
  /** Radians, 0 = +Z (north), growing towards +X — matches sin/cos below. */
  angle: number;
  /** 0..1 before the windMin/windMax lerp. */
  intensity: number;
}

/**
 * C# AddWindOctave. Both divisions are integer divisions on `long`s:
 * `m_windPeriodDuration / octave` first, then `timeSec / that`. Doing them
 * in floating point would make the octaves drift against vanilla.
 */
function addWindOctave(timeSec: number, octave: number, acc: WindNoise): void {
  const period = Math.floor(WIND_PERIOD_DURATION / octave);
  const seed = Math.floor(timeSec / period) | 0;
  const rng = new XorShiftRandom(seed);
  acc.angle += rng.nextFloat() * ((Math.PI * 2) / octave);
  acc.intensity += -0.5 / octave + rng.nextFloat() / octave;
}

/**
 * The four wind octaves at a world time. Slow octaves set the prevailing
 * direction, fast ones add the gusts.
 *
 * Each octave re-seeds the PRNG rather than drawing twice from one stream —
 * that is what makes the wind a function of time alone, so a client that
 * joins late sees the same weather as everyone else.
 */
export function windNoise(timeSec: number): WindNoise {
  const acc: WindNoise = { angle: 0, intensity: 0.5 };
  addWindOctave(timeSec, 1, acc);
  addWindOctave(timeSec, 2, acc);
  addWindOctave(timeSec, 4, acc);
  addWindOctave(timeSec, 8, acc);
  return acc;
}

/** A wind vector: unit direction in XZ plus its strength. */
export interface Wind {
  dirX: number;
  dirZ: number;
  /** 0.05..1 — clamped exactly as SetTargetWind does. */
  intensity: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Target wind for a weather at a world time. The noise is weather-agnostic;
 * the weather only decides how far up the windMin..windMax range it maps,
 * which is why a storm and a clear sky share a direction but not a force.
 */
export function windFor(env: EnvSetup, timeSec: number): Wind {
  const noise = windNoise(timeSec);
  const intensity = clamp(lerp(env.windMin, env.windMax, noise.intensity), 0.05, 1);
  return { dirX: Math.sin(noise.angle), dirZ: Math.cos(noise.angle), intensity };
}

// ── Precipitation ───────────────────────────────────────────────────
//
// The original hangs the actual particles off EnvSetup.m_psystems — an
// array of prefab references that EnvMan simply enables and disables
// (SetParticleArrayEnabled). Those prefabs are NOT in our asset export, so
// which system belongs to which weather cannot be read out; it is derived
// from the flags instead, which the extraction does have:
//
//   isWet                  → rain   (8 weathers; Rain, ThunderStorm, …)
//   isFreezing / isCold    → snow   (Snow, SnowStorm — note these are NOT
//                                    flagged wet, snow does not wet you)
//   Ashlands weathers      → ash    (ashrain/CinderRain are neither)
//
// The look of each is our own; the WHEN is ground truth.

export type Precipitation = 'none' | 'rain' | 'snow' | 'ash';

/** Which precipitation a weather produces. */
export function precipitationOf(env: EnvSetup): Precipitation {
  if (env.isWet) return 'rain';
  if (env.isFreezing || env.isColdAtNight || env.isCold) {
    // Only the ones that actually carry a particle system in vanilla —
    // a merely cold clear sky has none.
    return /snow|storm/i.test(env.name) ? 'snow' : 'none';
  }
  // Nur die Ashlands-Wetter, deren Name den Niederschlag ausweist —
  // "…_clear" und "…_misty" tragen in vanilla keinen.
  if (/ashrain|cinder|meteorshower/i.test(env.name) && !/_clear$/i.test(env.name)) return 'ash';
  return 'none';
}

// ── Stateful layer: transitions ─────────────────────────────────────

/** What the renderer needs to know about the current weather and wind. */
export interface WeatherState {
  /** Weather being faded out (equals `to` when no fade is running). */
  from: EnvSetup;
  /** Weather being faded in. */
  to: EnvSetup;
  /** 0..1 blend between `from` and `to`. */
  blend: number;
  /** Current wind, already interpolated — for gameplay (sailing, particles). */
  wind: Wind;
  /**
   * The two wind vectors and their blend, as EnvMan hands them to the
   * shaders (_GlobalWind1/_GlobalWind2/_GlobalWindAlpha).
   *
   * Consumers must interpolate their RESULT, not these vectors — see
   * WaterVolume.CalcWave, which evaluates the wave twice and lerps the two
   * heights. Interpolating the vector instead sends it through zero on a
   * ~180° shift, so the wind briefly dies out instead of one wave field
   * crossfading into the other.
   */
  windData: { wind1: Wind; wind2: Wind; alpha: number };
  /** 0..1 wetness, ramped on WET_TRANSITION_DURATION. */
  wetness: number;
  /** Precipitation of the weather being faded in. */
  precipitation: Precipitation;
  /**
   * 0..1 precipitation strength. Ramps on the same timer as the wetness so
   * rain fades in rather than snapping on, and drops to 0 for dry weather.
   */
  precipitationAmount: number;
}

/**
 * Tracks the weather over time and smooths the jumps.
 *
 * The selection itself is stateless (see selectWeather), so this only holds
 * what a cross-fade needs: which weather we came from and how far along the
 * blend is. Feed it the world time each frame.
 */
export class WeatherManager {
  private from: EnvSetup;
  private to: EnvSetup;
  private blend = 1;
  private currentWetness: number;
  /** Wind at the start of the current ramp. */
  private windFrom: Wind;
  private windTo: Wind;
  /** C# m_windTransitionTimer: -1 = keine Rampe, sonst Sekunden seit Start. */
  private windTimer = -1;
  private wind: Wind;
  /** Set by setDebugWind — overrides the simulated wind while present. */
  private debug: Wind | null = null;
  /** Set by setEnvironmentOverride — wins over the biome draw. */
  private override: EnvSetup | null = null;

  constructor(
    private biome: Biome,
    timeSec: number,
    private opts: WeatherOptions = {}
  ) {
    const env = selectWeather(biome, timeSec, opts);
    this.from = env;
    this.to = env;
    this.currentWetness = env.isWet ? 1 : 0;
    const w = windFor(env, timeSec);
    this.windFrom = w;
    this.windTo = w;
    this.wind = w;
  }

  /**
   * Force a fixed wind, as EnvMan.SetDebugWind does. Angle in degrees
   * (0 = north), intensity 0..1. Bypasses the octaves and the transition
   * so a test can hold a known vector steady.
   */
  setDebugWind(angleDeg: number, intensity: number): void {
    const rad = (angleDeg * Math.PI) / 180;
    this.debug = {
      dirX: Math.sin(rad),
      dirZ: Math.cos(rad),
      intensity: clamp(intensity, 0.05, 1),
    };
  }

  /** C# EnvMan.ResetDebugWind. */
  clearDebugWind(): void {
    this.debug = null;
  }

  /**
   * Force a specific weather, as EnvMan's `environmentOverride` does —
   * it short-circuits UpdateEnvironment before the weighted draw. Null
   * hands control back to the biome table.
   */
  setEnvironmentOverride(name: string | null): boolean {
    if (name === null) {
      this.override = null;
      return true;
    }
    const env = findEnvironment(name);
    if (!env) return false;
    this.override = env;
    return true;
  }

  /** Switch biome — takes effect on the next update, like walking a border. */
  setBiome(biome: Biome, opts: WeatherOptions = this.opts): void {
    this.biome = biome;
    this.opts = opts;
  }

  /** @param dt real seconds since the last call. */
  update(timeSec: number, dt: number): WeatherState {
    const target = this.override ?? selectWeather(this.biome, timeSec, this.opts);
    if (target !== this.to) {
      // Start the fade from whatever is on screen right now, not from
      // `this.to` — a weather change during a running fade would otherwise
      // snap to the half-finished state.
      this.from = this.blend >= 1 ? this.to : this.from;
      this.to = target;
      this.blend = 0;
    }
    if (this.blend < 1 && WEATHER_TRANSITION_DURATION > 0) {
      this.blend = Math.min(1, this.blend + dt / WEATHER_TRANSITION_DURATION);
    } else {
      this.blend = 1;
    }

    // Wetness follows the target weather on its own, slower ramp.
    const wetTarget = this.to.isWet ? 1 : 0;
    if (WET_TRANSITION_DURATION > 0) {
      const step = dt / WET_TRANSITION_DURATION;
      this.currentWetness =
        this.currentWetness < wetTarget
          ? Math.min(wetTarget, this.currentWetness + step)
          : Math.max(wetTarget, this.currentWetness - step);
    } else {
      this.currentWetness = wetTarget;
    }

    this.updateWind(timeSec, dt);

    const precipitation = precipitationOf(this.to);
    return {
      from: this.from,
      to: this.to,
      blend: this.blend,
      wind: this.wind,
      windData: this.windData,
      wetness: this.currentWetness,
      precipitation,
      // Dry weather has no particles at all; for wet ones the wetness ramp
      // doubles as the fade, and snow/ash use the weather cross-fade since
      // they never set isWet.
      precipitationAmount:
        precipitation === 'none' ? 0 : this.to.isWet ? this.currentWetness : this.blend,
    };
  }

  /**
   * C# UpdateWindTransition: a new target starts a ramp, and while one is
   * running further targets are ignored — SetTargetWind returns early on
   * `m_windTransitionTimer >= 0`. Without that guard the wind would chase
   * every gust octave and never settle.
   */
  private updateWind(timeSec: number, dt: number): void {
    if (this.debug) {
      this.wind = this.debug;
      // Beide Seiten festnageln, sonst blendet der Shader den Debug-Wind
      // gegen den zuletzt simulierten Vektor.
      this.windFrom = this.debug;
      this.windTo = this.debug;
      this.windTimer = -1;
      return;
    }

    // C# SetTargetWind: ein neues Ziel wird nur angenommen, wenn gerade
    // keine Rampe läuft (`m_windTransitionTimer >= 0` kehrt früh zurück).
    // Ohne diese Sperre jagt der Wind jeder Gust-Oktave hinterher und
    // kommt nie zur Ruhe.
    if (this.windTimer < 0) {
      const target = windFor(this.to, timeSec);
      const changed =
        Math.abs(target.dirX - this.windTo.dirX) > 1e-6 ||
        Math.abs(target.dirZ - this.windTo.dirZ) > 1e-6 ||
        Math.abs(target.intensity - this.windTo.intensity) > 1e-6;
      if (changed) {
        this.windFrom = this.windTo;
        this.windTo = target;
        this.windTimer = 0;
      }
    }

    // C# UpdateWindTransition.
    if (this.windTimer >= 0) {
      this.windTimer += dt;
      const a = clamp(this.windTimer / WIND_TRANSITION_DURATION, 0, 1);
      this.wind = {
        dirX: lerp(this.windFrom.dirX, this.windTo.dirX, a),
        dirZ: lerp(this.windFrom.dirZ, this.windTo.dirZ, a),
        intensity: lerp(this.windFrom.intensity, this.windTo.intensity, a),
      };
      if (a >= 1) {
        this.windFrom = this.windTo;
        this.windTimer = -1;
      }
    } else {
      this.wind = this.windFrom;
    }
  }


  /** C# EnvMan.GetWindForce — direction scaled by strength. Basis for sailing. */
  get windForce(): { x: number; z: number } {
    return { x: this.wind.dirX * this.wind.intensity, z: this.wind.dirZ * this.wind.intensity };
  }

  /**
   * C# EnvMan.GetWindData. While no transition runs, wind1 IS the current
   * wind and alpha is 0 — the same convention the original uses.
   */
  get windData(): { wind1: Wind; wind2: Wind; alpha: number } {
    const alpha = this.windTimer >= 0 ? clamp(this.windTimer / WIND_TRANSITION_DURATION, 0, 1) : 0;
    return { wind1: this.windFrom, wind2: this.windTo, alpha };
  }

  /** C# EnvMan.GetWindDir — unit vector in XZ. */
  get windDir(): { x: number; z: number } {
    return { x: this.wind.dirX, z: this.wind.dirZ };
  }

  /** C# EnvMan.GetWindIntensity — 0.05..1. */
  get windIntensity(): number {
    return this.wind.intensity;
  }

  /** Compass bearing of the wind in degrees, 0 = north (+Z), 90 = east (+X). */
  get windAngleDeg(): number {
    const deg = (Math.atan2(this.wind.dirX, this.wind.dirZ) * 180) / Math.PI;
    return (deg + 360) % 360;
  }

  /** 0..1 precipitation ramp. */
  get wetness(): number {
    return this.currentWetness;
  }

  /** The weather being faded in — what the lighting should show. */
  get environment(): EnvSetup {
    return this.to;
  }
}

/** Every weather the extraction knows, for debug UI. */
export const WEATHER_NAMES: readonly string[] = ENVIRONMENTS.map((e) => e.name);
