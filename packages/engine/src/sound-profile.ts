/**
 * The sound profile as plain data: defaults, merging and validation
 * (ADR-0052).
 *
 * Free of Babylon.js and of Zod, exactly like `lighting-profile.ts` and for the
 * same two reasons: `@wov/world-schema` describes data files and must stay free
 * of a renderer, this package is the renderer and must stay free of Zod, and
 * every decision worth watching in a test happens before a single WebAudio node
 * exists. The shapes are structurally identical to the schema's, so
 * `resolveSoundProfile(world.sound, zone.sound)` on a parsed world file needs no
 * conversion.
 *
 * **What merges and what replaces.** Groups merge field by field, zone over
 * world, the way lighting does. The two *lists* — `emitters` and the footstep
 * `banks` — replace rather than merge, because there is no honest way to merge
 * two lists: matching them by id would make a zone that states one emitter
 * inherit sixteen it never mentioned, and appending would make a zone unable to
 * take one away. A zone that states emitters states all of them.
 */
import {
  resolveAudioFalloff,
  type AudioDistanceModel,
  type AudioFalloff,
} from './audio-falloff.js';

/** How loud a whole world or zone is. */
export interface SoundMasterOptions {
  readonly volume: number;
  /** Authored silence. Not the same as `?mute=1`, which is a diagnostic. */
  readonly muted: boolean;
}

/** The bed: one looping clip with no place in the world. */
export interface AmbienceOptions {
  readonly enabled: boolean;
  /** `null` means this zone has no bed — silence, not a missing file. */
  readonly clip: string | null;
  readonly volume: number;
  readonly fadeSeconds: number;
  /** Seconds; `0`/`0` means the whole file. */
  readonly loopStart: number;
  readonly loopEnd: number;
}

/** The clips one surface is walked on with. */
export interface FootstepBankOptions {
  readonly surface: string;
  readonly clips: readonly string[];
  readonly volume: number;
}

/** How often footsteps happen, how loud, and which ground answers which bank. */
export interface FootstepOptions {
  readonly enabled: boolean;
  readonly volume: number;
  readonly strideWalk: number;
  readonly strideSprint: number;
  readonly minInterval: number;
  readonly pitchJitter: number;
  /** One surface id per terrain layer, in the terrain's layer order. */
  readonly layerSurfaces: readonly string[];
  readonly defaultSurface: string;
  readonly banks: readonly FootstepBankOptions[];
}

/** One thing that makes a noise, with every number filled in. */
export interface SoundEmitterOptions extends AudioFalloff {
  readonly id: string;
  /** Exactly one of these three is set; see `SoundEmitterSchema`. */
  readonly prefab?: string | undefined;
  readonly entity?: string | undefined;
  readonly position?: readonly [number, number, number] | undefined;
  /** Every clip this emitter may play — `clip` first, then its variants. */
  readonly clips: readonly string[];
  readonly loop: boolean;
  readonly volume: number;
  readonly panning: 'equalpower' | 'HRTF';
  /**
   * Seconds of silence between plays of a one-shot, `[min, max]`.
   *
   * `null` for a loop, and for a one-shot that should be played by hand.
   */
  readonly intervalSeconds: readonly [number, number] | null;
  /** The most placements a `prefab` rule may sound at once. */
  readonly maxCount: number;
}

/** A complete description of how a zone sounds. */
export interface ResolvedSoundProfile {
  readonly master: SoundMasterOptions;
  readonly ambience: AmbienceOptions;
  readonly footsteps: FootstepOptions;
  readonly emitters: readonly SoundEmitterOptions[];
  /** Metres past which an emitter is paused rather than kept running. */
  readonly cullDistance: number;
}

/** One emitter exactly as a world file states it. */
export interface SoundEmitterInput {
  readonly id: string;
  readonly prefab?: string | undefined;
  readonly entity?: string | undefined;
  readonly position?: readonly [number, number, number] | undefined;
  readonly clip: string;
  readonly variants?: readonly string[] | undefined;
  readonly loop?: boolean | undefined;
  readonly volume?: number | undefined;
  readonly intervalSeconds?: readonly [number, number] | undefined;
  readonly minDistance?: number | undefined;
  readonly maxDistance?: number | undefined;
  readonly rolloff?: number | undefined;
  readonly distanceModel?: AudioDistanceModel | undefined;
  readonly panning?: 'equalpower' | 'HRTF' | undefined;
  readonly maxCount?: number | undefined;
}

/**
 * One group of a profile, with every field optional.
 *
 * `Partialise` and not `Partial`: under `exactOptionalPropertyTypes` the second
 * refuses a field that is *present and undefined*, and that is exactly what a
 * parsed world file hands over for a key it does not have.
 */
type Partialise<T> = { readonly [K in keyof T]?: T[K] | undefined };

/** A sound profile exactly as a world file states it: everything optional. */
export interface SoundProfileOptions {
  readonly master?: Partialise<SoundMasterOptions> | undefined;
  readonly ambience?: Partialise<AmbienceOptions> | undefined;
  readonly footsteps?:
    | (Partialise<Omit<FootstepOptions, 'banks'>> & {
        readonly banks?: readonly SoundBankInput[] | undefined;
      })
    | undefined;
  readonly emitters?: readonly SoundEmitterInput[] | undefined;
  readonly cullDistance?: number | undefined;
}

/** One footstep bank as a world file states it. */
export interface SoundBankInput {
  readonly surface: string;
  readonly clips: readonly string[];
  readonly volume?: number | undefined;
}

/**
 * What a world with no sound block sounds like: nothing.
 *
 * Deliberately *not* a stand-in bed the way `defaultLightingProfile` is a
 * stand-in light. A scene has to be lit by something or it is a black frame; a
 * scene does not have to sound like anything, and inventing a wind loop for
 * every world that never asked for one would be the renderer deciding what the
 * game sounds like. So the numbers here are all pacing and falloff — how a
 * footstep behaves once an author has named a clip — and every path is empty.
 */
export const defaultSoundProfile: ResolvedSoundProfile = {
  master: { volume: 1, muted: false },
  ambience: { enabled: true, clip: null, volume: 0.35, fadeSeconds: 2, loopStart: 0, loopEnd: 0 },
  footsteps: {
    enabled: true,
    volume: 0.5,
    // Metres, not seconds, so that standing still is silent and a slope does
    // not change the rhythm. The numbers are set against the movement tuning
    // this game actually has (`DEFAULT_MOVEMENT_TUNING`: 4.5 m/s, ×1.6 to
    // sprint): 1.1 m at a jog is about four steps a second, 1.5 m at a sprint
    // is about five — a longer stride arriving faster, which is what running
    // is. `minInterval` sits below both, so it is a floor against the collision
    // solver pushing the capsule along a wall (ADR-0038) rather than a second
    // rhythm competing with the stride.
    strideWalk: 1.1,
    strideSprint: 1.5,
    minInterval: 0.18,
    pitchJitter: 0.06,
    layerSurfaces: [],
    defaultSurface: 'gravel',
    banks: [],
  },
  emitters: [],
  // Sixty metres. The village square is about forty across, so a brazier on the
  // far side of it is still running and a brazier behind the palisade is not.
  cullDistance: 60,
};

/**
 * Fills a chain of partial profiles into one complete description.
 *
 * Later arguments win — `resolveSoundProfile(world.sound, zone.sound)` — group
 * by group and field by field, with the two lists replacing rather than
 * merging (see the module note). Passing nothing at all resolves to
 * {@link defaultSoundProfile}, which is silence.
 *
 * @throws {Error} on a non-finite number, a negative volume, a stride of zero
 * or an emitter with no clip. This is world data arriving from a file, so it is
 * checked at the edge rather than played as a click (agent rule 10).
 */
export function resolveSoundProfile(
  ...profiles: (SoundProfileOptions | undefined)[]
): ResolvedSoundProfile {
  const base = defaultSoundProfile;
  const master = merge(base.master, ...profiles.map((profile) => profile?.master));
  const ambience = merge(base.ambience, ...profiles.map((profile) => profile?.ambience));

  const footstepOverrides = profiles.map((profile) => profile?.footsteps);
  // The banks are taken out of the merge rather than merged and then
  // overwritten: a list has no field-by-field answer, so it is chosen whole.
  const { banks: _ignored, ...footstepBase } = base.footsteps;
  const footsteps = merge(
    footstepBase,
    ...footstepOverrides.map((override) => {
      if (override === undefined) {
        return undefined;
      }
      const { banks: _dropped, ...scalars } = override;
      return scalars;
    }),
  );
  const banks = lastStated(footstepOverrides.map((override) => override?.banks)) ?? [];

  const emitters = lastStated(profiles.map((profile) => profile?.emitters)) ?? [];
  const cullDistance = lastStated(profiles.map((profile) => profile?.cullDistance));

  return {
    master: {
      volume: requireGain(master.volume, 'master.volume'),
      muted: master.muted,
    },
    ambience: {
      enabled: ambience.enabled,
      clip: ambience.clip === null || ambience.clip === '' ? null : ambience.clip,
      volume: requireGain(ambience.volume, 'ambience.volume'),
      fadeSeconds: requireGain(ambience.fadeSeconds, 'ambience.fadeSeconds'),
      loopStart: requireGain(ambience.loopStart, 'ambience.loopStart'),
      loopEnd: requireGain(ambience.loopEnd, 'ambience.loopEnd'),
    },
    footsteps: {
      enabled: footsteps.enabled,
      volume: requireGain(footsteps.volume, 'footsteps.volume'),
      strideWalk: requirePositive(footsteps.strideWalk, 'footsteps.strideWalk'),
      strideSprint: requirePositive(footsteps.strideSprint, 'footsteps.strideSprint'),
      minInterval: requireGain(footsteps.minInterval, 'footsteps.minInterval'),
      pitchJitter: requireFraction(footsteps.pitchJitter, 'footsteps.pitchJitter'),
      layerSurfaces: [...footsteps.layerSurfaces],
      defaultSurface: footsteps.defaultSurface,
      banks: banks.map((bank, index) => resolveBank(bank, index)),
    },
    emitters: emitters.map((emitter) => resolveEmitter(emitter)),
    cullDistance: requirePositive(cullDistance ?? base.cullDistance, 'cullDistance'),
  };
}

/** The bank that answers a surface, or the one the default surface names. */
export function bankForSurface(
  footsteps: FootstepOptions,
  surface: string,
): FootstepBankOptions | undefined {
  return (
    footsteps.banks.find((bank) => bank.surface === surface) ??
    footsteps.banks.find((bank) => bank.surface === footsteps.defaultSurface)
  );
}

/**
 * The surface a terrain layer sounds like, by its index in the layer list.
 *
 * Out of range — a `layerSurfaces` shorter than the terrain has layers, or a
 * probe that could not answer — is the default surface rather than a throw: a
 * plain footstep is better than none, and `pnpm validate:content` is where the
 * length mismatch is meant to be caught.
 */
export function surfaceOfLayer(footsteps: FootstepOptions, layer: number): string {
  return footsteps.layerSurfaces[layer] ?? footsteps.defaultSurface;
}

/** Every clip path a profile will ever ask for, deduplicated, in order. */
export function soundProfileClips(profile: ResolvedSoundProfile): readonly string[] {
  const paths = new Set<string>();
  if (profile.ambience.clip !== null) {
    paths.add(profile.ambience.clip);
  }
  for (const emitter of profile.emitters) {
    for (const clip of emitter.clips) {
      paths.add(clip);
    }
  }
  for (const bank of profile.footsteps.banks) {
    for (const clip of bank.clips) {
      paths.add(clip);
    }
  }
  return [...paths];
}

function resolveBank(bank: SoundBankInput, index: number): FootstepBankOptions {
  if (bank.clips.length === 0) {
    throw new Error(`sound: footsteps.banks[${String(index)}] "${bank.surface}" has no clips`);
  }
  return {
    surface: bank.surface,
    clips: [...bank.clips],
    volume: requireGain(bank.volume ?? 1, `footsteps.banks[${String(index)}].volume`),
  };
}

function resolveEmitter(emitter: SoundEmitterInput): SoundEmitterOptions {
  const where = `emitters."${emitter.id}"`;
  if (emitter.clip === '') {
    throw new Error(`sound: ${where} has no clip`);
  }
  // Built by assignment rather than by object literal: `exactOptionalPropertyTypes`
  // distinguishes "absent" from "present and undefined", and a world file that
  // omits a field means the first.
  const stated: { -readonly [K in keyof AudioFalloff]?: AudioFalloff[K] } = {};
  if (emitter.distanceModel !== undefined) {
    stated.distanceModel = emitter.distanceModel;
  }
  if (emitter.minDistance !== undefined) {
    stated.minDistance = emitter.minDistance;
  }
  if (emitter.maxDistance !== undefined) {
    stated.maxDistance = emitter.maxDistance;
  }
  if (emitter.rolloff !== undefined) {
    stated.rolloffFactor = emitter.rolloff;
  }
  const falloff = resolveAudioFalloff(stated);
  const interval = emitter.intervalSeconds;
  return {
    id: emitter.id,
    prefab: emitter.prefab,
    entity: emitter.entity,
    position: emitter.position,
    clips: [emitter.clip, ...(emitter.variants ?? [])],
    // A placed sound loops unless it is told not to: a fire, a forge and a
    // waterfall are the normal case, and a one-shot announces itself by having
    // an interval.
    loop: emitter.loop ?? interval === undefined,
    volume: requireGain(emitter.volume ?? 1, `${where}.volume`),
    panning: emitter.panning ?? 'equalpower',
    intervalSeconds: interval === undefined ? null : [interval[0], interval[1]],
    maxCount: emitter.maxCount ?? DEFAULT_EMITTER_MAX_COUNT,
    ...falloff,
  };
}

/**
 * How many placements one prefab rule sounds at once unless it says otherwise.
 *
 * Sixty-four. Above that a rule has almost certainly matched something it did
 * not mean to — a tuft of grass, a fence post — and the readout saying "capped"
 * is how an author finds that out, rather than a browser dropping panners.
 */
export const DEFAULT_EMITTER_MAX_COUNT = 64;

/** The last argument that stated a value at all, or `undefined`. */
function lastStated<T>(values: readonly (T | undefined)[]): T | undefined {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

/** Merges a group of overrides over a resolved group, field by field. */
function merge<T extends object>(base: T, ...overrides: (Partialise<T> | undefined)[]): T {
  let result = base;
  for (const override of overrides) {
    if (override === undefined) {
      continue;
    }
    const defined: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(override)) {
      if (value !== undefined && key in base) {
        defined[key] = value;
      }
    }
    result = { ...result, ...defined };
  }
  return result;
}

function requireGain(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`sound: ${field} must be a number ≥ 0, got ${String(value)}`);
  }
  return value;
}

function requirePositive(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`sound: ${field} must be a number > 0, got ${String(value)}`);
  }
  return value;
}

function requireFraction(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`sound: ${field} must be between 0 and 1, got ${String(value)}`);
  }
  return value;
}
