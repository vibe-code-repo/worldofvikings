/**
 * The sound of a world or a zone, as data (ADR-0052).
 *
 * Sound is world data for the same reason light is (ADR-0024): which bed a
 * valley lies under, how loud its forge is, and what its paths sound like
 * underfoot are authored decisions, not renderer constants. A village at dusk
 * and a cellar under it differ by two blocks in one file, not by an `if` in
 * TypeScript (agent rule 9).
 *
 * Every field is optional and every group is optional. A world file that says
 * nothing about sound still opens and still validates, and is silent — which is
 * exactly what it was before this schema existed, and what makes the format
 * change purely additive (see `migrations.ts`, v4 → v5).
 *
 * Zone beats world, group by group, the way lighting already does. Merging is
 * the engine's job (`resolveSoundProfile` in `@wov/engine`); this module only
 * says what may be written down.
 */
import { z } from 'zod';
import { IdentifierSchema, Vector3Schema, assetPathOf } from './common.js';

/** A gain: real, never negative, no upper opinion. */
const Gain = z.number().min(0).finite();
/** A fraction of one. */
const Fraction = z.number().min(0).max(1);
/** A distance in metres that is real and forward. */
const PositiveMetres = z.number().positive().finite();
/** Seconds that are real and not negative. */
const NonNegativeSeconds = z.number().min(0).finite();

/**
 * A ground surface a footstep bank answers for: `gravel`, `grass`, `wood`.
 *
 * A free identifier rather than an enum, because the vocabulary is authored:
 * the day a zone paints sand, a bank named `sand` and a `layerSurfaces` entry
 * saying `sand` are the whole change. An id that no bank answers falls back to
 * {@link FootstepsSchema.defaultSurface}, which is reported rather than silent.
 */
export const SurfaceIdSchema = IdentifierSchema;

/** How loud everything in this world or zone is. */
export const SoundMasterSchema = z
  .strictObject({
    volume: Gain,
    /** Authored silence — a zone that is deliberately quiet, not a bug. */
    muted: z.boolean(),
  })
  .partial();

/**
 * The bed: one looping clip that is simply *there*, with no place in the world.
 *
 * Not spatial on purpose. A wind bed has no position — it is the air the zone
 * is in — and panning it would put the whole outdoors in one ear.
 */
export const AmbienceSchema = z
  .strictObject({
    enabled: z.boolean(),
    clip: assetPathOf('audio'),
    volume: Gain,
    /** Crossfade when the zone changes, in seconds. */
    fadeSeconds: NonNegativeSeconds,
    /**
     * The part of the clip that loops, in seconds.
     *
     * `0` and `0` mean the whole file. They exist because a bed with a dirty
     * tail — a gust that ends abruptly — loops cleanly on its middle and
     * audibly on its ends, and cutting the file instead would throw away the
     * part an author may want back.
     */
    loopStart: NonNegativeSeconds,
    loopEnd: NonNegativeSeconds,
  })
  .partial();

/** The clips one surface is walked on with. */
export const FootstepBankSchema = z.strictObject({
  surface: SurfaceIdSchema,
  /** Every clip of this bank; one is chosen per step, never twice in a row. */
  clips: z.array(assetPathOf('audio')).min(1),
  volume: Gain.optional(),
});

/**
 * Footsteps: how often they happen, how loud, and which clips answer which
 * ground.
 *
 * They are **not** spatial. They come from the listener's own feet, and
 * spatialising them at the capsule puts your own steps behind you the moment
 * the camera orbits (ADR-0052).
 */
export const FootstepsSchema = z
  .strictObject({
    enabled: z.boolean(),
    volume: Gain,
    /** Metres of ground covered between two steps at a walk. */
    strideWalk: PositiveMetres,
    /** …and at a sprint. Shorter, because a run is a shorter, faster stride. */
    strideSprint: PositiveMetres,
    /** Never two steps closer together than this, in seconds. */
    minInterval: NonNegativeSeconds,
    /** How far playback rate is jittered per step, `0…1`; 0.06 is ±6 %. */
    pitchJitter: Fraction,
    /**
     * One surface id per terrain layer, in the terrain's own layer order.
     *
     * A parallel array rather than a `surface` field on the layer itself, and
     * that is a decision with a date on it: the natural home *is* the terrain
     * layer, and ADR-0052 records moving it there as a follow-up. It is
     * defensible on its own terms — which sound a painted rock makes is a sound
     * decision, not a ground-material one — and `pnpm validate:content` checks
     * the length against `terrain.layers` so the two cannot silently drift.
     */
    layerSurfaces: z.array(SurfaceIdSchema),
    /** What is walked on where the ground does not say, or cannot be asked. */
    defaultSurface: SurfaceIdSchema,
    banks: z.array(FootstepBankSchema),
  })
  .partial();

/** The distance curves a `PannerNode` offers; see `audio-falloff.ts`. */
export const AUDIO_DISTANCE_MODELS = ['linear', 'inverse', 'exponential'] as const;
export const AudioDistanceModelSchema = z.enum(AUDIO_DISTANCE_MODELS);

/** How a placed sound is panned. */
export const AUDIO_PANNING_MODELS = ['equalpower', 'HRTF'] as const;
export const AudioPanningModelSchema = z.enum(AUDIO_PANNING_MODELS);

/**
 * One thing in the zone that makes a noise.
 *
 * **Exactly one of `prefab`, `entity` or `position` says where it is**, and the
 * three are three different questions:
 *
 * - `prefab` is a *rule*: every entity of the zone placed from that prefab gets
 *   this sound. Eleven braziers are one line, and a twelfth brazier dropped in
 *   the editor is audible without anybody editing the sound block. This is what
 *   the village uses.
 * - `entity` is one named placement — the one well, this particular door.
 * - `position` is a sound with no object at all: crows over the hill.
 *
 * Emitters are a list on the sound block and not a field on the entity. Partly
 * because 5273 entities of which seventeen make a noise would be 5273 places to
 * look, and partly because an emitter has fields — an interval, a radius, a bus
 * — that have nothing to do with a transform.
 */
export const SoundEmitterSchema = z
  .strictObject({
    /** Names it in a readout and in the editor; unique within the zone. */
    id: IdentifierSchema,
    /** Every entity of this prefab sounds. */
    prefab: IdentifierSchema.optional(),
    /** This one entity sounds. */
    entity: IdentifierSchema.optional(),
    /** Nothing sounds; this point does. */
    position: Vector3Schema.optional(),
    clip: assetPathOf('audio'),
    /**
     * Further clips one of which is picked instead of {@link clip}, per start.
     *
     * What keeps five crows from being one crow five times.
     */
    variants: z.array(assetPathOf('audio')).optional(),
    /** A fire loops. A crow does not. */
    loop: z.boolean().optional(),
    volume: Gain.optional(),
    /**
     * A one-shot's silence between plays, `[min, max]` in seconds.
     *
     * Only meaningful when `loop` is false. Randomised in the interval, which
     * is editor-convenience randomisation of the allowed kind (agent rule 17):
     * it decides *when* a clip is heard, never what is in the world file.
     */
    intervalSeconds: z.tuple([NonNegativeSeconds, NonNegativeSeconds]).optional(),
    /** Metres inside which it does not get louder. See `audio-falloff.ts`. */
    minDistance: PositiveMetres.optional(),
    /** Metres past which it stops getting quieter — `linear` only. */
    maxDistance: PositiveMetres.optional(),
    /** How steep the fade is. 0 never fades. */
    rolloff: Gain.optional(),
    distanceModel: AudioDistanceModelSchema.optional(),
    panning: AudioPanningModelSchema.optional(),
    /**
     * The most placements a `prefab` rule may sound at once.
     *
     * A guard rather than a preference: a rule that matches four hundred tufts
     * of grass is four hundred panners, and the ceiling should be in the file
     * before the first stutter rather than after it.
     */
    maxCount: z.number().int().positive().optional(),
  })
  .superRefine((emitter, ctx) => {
    const anchors = [emitter.prefab, emitter.entity, emitter.position].filter(
      (anchor) => anchor !== undefined,
    );
    if (anchors.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'an emitter needs exactly one of "prefab", "entity" or "position"',
      });
    }
    if (emitter.intervalSeconds !== undefined) {
      const [low, high] = emitter.intervalSeconds;
      if (high < low) {
        ctx.addIssue({
          code: 'custom',
          path: ['intervalSeconds'],
          message: 'the second value must not be smaller than the first',
        });
      }
    }
  });

/**
 * How far a placed sound may be from the listener before it is paused.
 *
 * Not a saving on seventeen emitters, and not meant as one. It is the ceiling a
 * zone with two hundred needs, and it belongs in the format from the start so
 * that the first zone that needs it does not need a code change too.
 */
const CullDistanceSchema = PositiveMetres;

/** Everything a world or a zone may say about how it sounds. */
export const SoundProfileSchema = z
  .strictObject({
    master: SoundMasterSchema,
    ambience: AmbienceSchema,
    footsteps: FootstepsSchema,
    emitters: z.array(SoundEmitterSchema),
    /** Metres past which an emitter is paused rather than kept running. */
    cullDistance: CullDistanceSchema,
  })
  .partial()
  .superRefine((profile, ctx) => {
    const emitters = profile.emitters ?? [];
    const seen = new Set<string>();
    for (const [index, emitter] of emitters.entries()) {
      if (seen.has(emitter.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['emitters', index, 'id'],
          message: `duplicate emitter id "${emitter.id}"`,
        });
      }
      seen.add(emitter.id);
    }
  });

export type SoundMaster = z.infer<typeof SoundMasterSchema>;
export type Ambience = z.infer<typeof AmbienceSchema>;
export type FootstepBank = z.infer<typeof FootstepBankSchema>;
export type Footsteps = z.infer<typeof FootstepsSchema>;
export type AudioDistanceModelName = z.infer<typeof AudioDistanceModelSchema>;
export type AudioPanningModelName = z.infer<typeof AudioPanningModelSchema>;
export type SoundEmitter = z.infer<typeof SoundEmitterSchema>;
export type SoundProfile = z.infer<typeof SoundProfileSchema>;
