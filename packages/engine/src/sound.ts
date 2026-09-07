/**
 * A world's sound, put into a scene — the audio twin of `applyLighting`
 * (ADR-0052).
 *
 * `applyLighting` takes a resolved lighting profile and a scene and gives back
 * a handle that can put the scene back. This does the same for a resolved sound
 * profile: it attaches the listener, starts the bed, places the emitters,
 * schedules the one-shots, culls what is too far away to hear, and hands back a
 * `footstep()` the game calls once per step. One function, called by the game
 * and by the editor, so that what an author hears while placing a brazier is
 * what a player hears standing next to it (ADR-0033).
 *
 * **The listener follows the camera, not the player.** In third person the
 * picture is the camera's. A listener at the capsule's feet puts a brazier that
 * is on screen to your left into your right ear the moment the camera swings
 * round — which reads as a broken panner rather than as a decision about whose
 * ears these are.
 *
 * **Footsteps are not spatial.** They come from the listener's own feet.
 * Spatialising them at the capsule would put your own steps behind you whenever
 * the camera orbits, which is the same mistake in the other direction.
 *
 * **Nothing here awaits in a frame.** `applyWorldSound` is asynchronous because
 * clips have to arrive; the caller starts it and does not wait for it, so a
 * zone whose audio has not arrived yet is silent rather than stalled.
 */
import type { Node } from '@babylonjs/core/node.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { StaticSound } from '@babylonjs/core/AudioV2/abstractAudio/staticSound.js';
import type { AudioSystem } from './audio.js';
import { audibleRadius } from './audio-falloff.js';
import {
  createClipBag,
  intervalIn,
  jitteredRate,
  seededRandom,
  type ClipBag,
  type RandomSource,
} from './sound-bag.js';
import { bankForSurface, type ResolvedSoundProfile } from './sound-profile.js';
import {
  distanceBetween,
  planEmitters,
  type EmitterPlacement,
  type PlacedEntity,
} from './sound-placement.js';

/** A point in the scene, in the shape both Babylon and this module use. */
export interface ListenerPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Where a clip's bytes are, and what to load instead if they are not there. */
export interface ClipSource {
  readonly url: string;
  /** A committed stand-in; for audio that is one silent WAV (ADR-0054). */
  readonly fallbackUrl?: string | undefined;
}

/** Everything {@link applyWorldSound} needs. */
export interface WorldSoundOptions {
  /** The page's audio engine — created once, never per zone. */
  readonly audio: AudioSystem;
  /** The profile the world and the zone resolved to. */
  readonly profile: ResolvedSoundProfile;
  /** Turns an asset path from the world file into URLs to try. */
  readonly clipSource: (path: string) => ClipSource;
  /** The zone's entities, so a prefab rule has something to match. */
  readonly entities: readonly PlacedEntity[];
  /**
   * The transform node an entity was placed under, if it has one.
   *
   * A thin-instanced prefab has no node by design (ADR-0025), and neither does
   * an entity whose model failed to load. Either way the emitter falls back to
   * the entity's authored position, which is where the node would have been.
   */
  readonly nodeOf?: ((entityId: string) => Node | null) | undefined;
  /** What the listener follows. Normally `scene.activeCamera`. */
  readonly listener?: Node | null | undefined;
  /** Where the listener is, for the distance cull. */
  readonly listenerAt?: (() => ListenerPoint) | undefined;
  /** Seeded by default, so a test can watch which clip is chosen. */
  readonly random?: RandomSource | undefined;
  /** How often the distance cull runs, in milliseconds. */
  readonly cullIntervalMs?: number | undefined;
}

/** What {@link applyWorldSound} put into the scene, and how to take it out. */
export interface WorldSoundHandle {
  readonly profile: ResolvedSoundProfile;
  /** Whether a bed is playing. */
  readonly ambience: boolean;
  /** How many placed sounds are running. */
  readonly emitters: number;
  /** Emitters whose anchor is not in this zone, and rules that were capped. */
  readonly problems: readonly string[];
  /** Clip paths that could not be loaded at all, not even as a stand-in. */
  readonly failed: readonly string[];
  /** One line for a readout: what is playing, and what is not. */
  readonly report: string;
  /**
   * Plays one footstep on the given surface.
   *
   * Cheap and fire-and-forget: the clip is already decoded, so this is a
   * `BufferSource` and a gain. A surface no bank answers falls back to the
   * profile's default surface; a default no bank answers is silence.
   */
  footstep(surface: string): void;
  /** Silences everything without taking it down; the mixer's one switch. */
  setMuted(muted: boolean): void;
  /** Stops every sound this handle started and releases its timers. */
  dispose(): void;
}

/** How often the distance cull runs unless a caller says otherwise. */
const DEFAULT_CULL_INTERVAL_MS = 500;

/**
 * The seed the clip picking starts from when a caller states none.
 *
 * A constant rather than `Date.now()`: two runs of the same measurement should
 * hear the same footsteps, and nobody can tell one gravel clip from another
 * anyway — which is the whole reason there are ten of them.
 */
const DEFAULT_SOUND_SEED = 0x5011d;

/** How often the ambience fade steps, in milliseconds. */
const FADE_STEP_MS = 50;

/**
 * Puts a resolved sound profile into a scene.
 *
 * Start it, do not await it in a loop. Everything it does is additive: a scene
 * with no audio engine, no clips and no entities gets a handle that reports
 * exactly that and plays nothing.
 */
export async function applyWorldSound(
  scene: Scene,
  options: WorldSoundOptions,
): Promise<WorldSoundHandle> {
  const { audio, profile, clipSource, entities } = options;
  const random = options.random ?? seededRandom(DEFAULT_SOUND_SEED);
  const cullIntervalMs = options.cullIntervalMs ?? DEFAULT_CULL_INTERVAL_MS;

  const failed: string[] = [];
  const urls = new Map<string, string>();
  const started: StaticSound[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  let disposed = false;

  /**
   * Loads a clip, falling back to its committed stand-in.
   *
   * The stand-in for audio is one silent WAV shared by every private clip
   * (ADR-0054), so a clean clone with no asset store plays a village that is
   * quiet rather than a village that throws.
   */
  async function resolveClip(path: string): Promise<string | null> {
    const known = urls.get(path);
    if (known !== undefined) {
      return known;
    }
    const source = clipSource(path);
    for (const candidate of [source.url, source.fallbackUrl]) {
      if (candidate === undefined) {
        continue;
      }
      try {
        await audio.loadClip(candidate);
        urls.set(path, candidate);
        return candidate;
      } catch {
        // Try the stand-in; if that fails too the path is reported below.
      }
    }
    if (!failed.includes(path)) {
      failed.push(path);
    }
    return null;
  }

  // The listener first, so that anything started below is already panned from
  // where the player is looking rather than from the origin.
  const listener = options.listener ?? scene.activeCamera;
  if (listener != null) {
    audio.attachListener(listener as unknown as Node);
  }

  const muted = profile.master.muted;

  // ── The bed ────────────────────────────────────────────────────────────────
  let ambience: StaticSound | null = null;
  if (profile.ambience.enabled && profile.ambience.clip !== null) {
    const url = await resolveClip(profile.ambience.clip);
    if (url !== null && !disposed) {
      const target = profile.master.volume * profile.ambience.volume;
      ambience = await audio.play(url, {
        bus: 'ambience',
        loop: true,
        // Starts at zero and is ramped up below: a 40 s wind bed that snaps in
        // at full volume is the one moment of the whole feature a player
        // notices as a moment.
        volume: profile.ambience.fadeSeconds > 0 ? 0 : target,
      });
      applyLoopWindow(ambience, profile.ambience.loopStart, profile.ambience.loopEnd);
      started.push(ambience);
      if (profile.ambience.fadeSeconds > 0) {
        fadeTo(ambience, target, profile.ambience.fadeSeconds, timers);
      }
    }
  }

  // ── The emitters ───────────────────────────────────────────────────────────
  const plan = planEmitters(profile.emitters, entities);
  /** One running placement: the sound, where it is, and how far it carries. */
  interface RunningEmitter {
    readonly placement: EmitterPlacement;
    readonly sound: StaticSound;
    readonly radius: number;
    paused: boolean;
  }
  const running: RunningEmitter[] = [];

  for (const placement of plan.placements) {
    if (disposed) {
      break;
    }
    const { emitter } = placement;
    const bag = createClipBag(emitter.clips, random);
    if (emitter.loop) {
      const url = await resolveClip(bag.next());
      if (url === null) {
        continue;
      }
      const node = placement.entity === null ? null : (options.nodeOf?.(placement.entity) ?? null);
      const sound = await audio.playAt(url, {
        bus: 'world',
        loop: true,
        volume: profile.master.volume * emitter.volume,
        node,
        // Always stated, even when a node was found: `spatial.attach` follows a
        // node, but an emitter whose model never arrived still has to stand
        // where the world file put it rather than at the origin.
        position: [placement.position[0], placement.position[1], placement.position[2]],
        distanceModel: emitter.distanceModel,
        minDistance: emitter.minDistance,
        maxDistance: emitter.maxDistance,
        rolloffFactor: emitter.rolloffFactor,
        panning: emitter.panning,
      });
      started.push(sound);
      running.push({
        placement,
        sound,
        // The cull radius is whichever comes first: the distance at which this
        // curve has faded into the bed, or the profile's ceiling. Asking the
        // curve is what keeps a forge with a long reach audible while a candle
        // three metres away is not.
        radius: Math.min(audibleRadius(emitter), profile.cullDistance),
        paused: false,
      });
    } else if (emitter.intervalSeconds !== null) {
      scheduleOneShot(placement, bag);
    }
  }

  /**
   * A one-shot that comes back: a crow, a rooster, a distant cow.
   *
   * A chain of timeouts rather than one interval, because the gap is random per
   * play — that is what stops five crows from becoming a metronome. This is the
   * randomness agent rule 17 allows: it decides *when* an authored clip is
   * heard, never what is in the world file.
   */
  function scheduleOneShot(placement: EmitterPlacement, bag: ClipBag): void {
    const { emitter } = placement;
    const range = emitter.intervalSeconds;
    if (range === null) {
      return;
    }
    const wait = intervalIn(range, random);
    const timer = setTimeout(
      () => {
        if (disposed) {
          return;
        }
        void (async () => {
          const url = await resolveClip(bag.next());
          if (url === null || disposed) {
            return;
          }
          const node =
            placement.entity === null ? null : (options.nodeOf?.(placement.entity) ?? null);
          const sound = await audio.playAt(url, {
            bus: 'world',
            loop: false,
            volume: profile.master.volume * emitter.volume,
            node,
            position: [placement.position[0], placement.position[1], placement.position[2]],
            distanceModel: emitter.distanceModel,
            minDistance: emitter.minDistance,
            maxDistance: emitter.maxDistance,
            rolloffFactor: emitter.rolloffFactor,
            panning: emitter.panning,
          });
          started.push(sound);
        })();
        scheduleOneShot(placement, bag);
      },
      Math.max(wait, 0) * 1000,
    );
    timer.unref?.();
    timers.push(timer);
  }

  // ── Footsteps ──────────────────────────────────────────────────────────────
  // Every bank is loaded up front. A footstep that has to download its clip is
  // a footstep that arrives after the foot did.
  const bags = new Map<string, ClipBag>();
  if (profile.footsteps.enabled) {
    for (const bank of profile.footsteps.banks) {
      const paths: string[] = [];
      for (const clip of bank.clips) {
        const url = await resolveClip(clip);
        if (url !== null) {
          paths.push(clip);
        }
      }
      if (paths.length > 0) {
        bags.set(bank.surface, createClipBag(paths, random));
      }
    }
  }

  // ── The distance cull ──────────────────────────────────────────────────────
  // Every half second, not every frame: seventeen emitters do not need this,
  // and the zone that declares two hundred should not need a code change to
  // survive. `pause`/`resume` and not `stop`/`play`, so a fire the player walks
  // back to is the same fire.
  const listenerAt = options.listenerAt;
  const cull =
    listenerAt === undefined || running.length === 0
      ? undefined
      : setInterval(() => {
          if (disposed) {
            return;
          }
          const at = listenerAt();
          for (const emitter of running) {
            const far = distanceBetween(emitter.placement.position, at) > emitter.radius;
            if (far && !emitter.paused) {
              emitter.sound.pause();
              emitter.paused = true;
            } else if (!far && emitter.paused) {
              emitter.sound.resume();
              emitter.paused = false;
            }
          }
        }, cullIntervalMs);
  cull?.unref?.();

  const problems = [
    ...plan.unmatched.map((id) => `emitter "${id}" matched nothing in this zone`),
    ...plan.capped.map((id) => `emitter "${id}" matched more placements than its maxCount`),
  ];

  const handle: WorldSoundHandle = {
    profile,
    ambience: ambience !== null,
    emitters: running.length,
    problems,
    failed,
    report:
      `sound: ${ambience === null ? 'no bed' : '1 bed'}, ` +
      `${String(running.length)} emitter(s), ${String(bags.size)} footstep bank(s)` +
      (failed.length > 0 ? `, ${String(failed.length)} clip(s) unavailable` : '') +
      (problems.length > 0 ? `, ${String(problems.length)} problem(s)` : ''),

    footstep(surface) {
      if (disposed || muted || !profile.footsteps.enabled) {
        return;
      }
      const bank = bankForSurface(profile.footsteps, surface);
      if (bank === undefined) {
        return;
      }
      const bag = bags.get(bank.surface);
      if (bag === undefined) {
        return;
      }
      const url = urls.get(bag.next());
      if (url === undefined) {
        return;
      }
      void audio
        .play(url, {
          bus: 'world',
          volume: profile.master.volume * profile.footsteps.volume * bank.volume,
          playbackRate: jitteredRate(profile.footsteps.pitchJitter, random),
        })
        .then((sound) => {
          started.push(sound);
        })
        .catch(() => {
          // A footstep that would not play is not worth a line in the console
          // sixty times a minute; the clip's absence is already in `failed`.
        });
    },

    setMuted(next) {
      for (const name of ['ambience', 'world'] as const) {
        audio.bus(name).volume = next ? 0 : 1;
      }
    },

    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      if (cull !== undefined) {
        clearInterval(cull);
      }
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers.length = 0;
      for (const sound of started) {
        sound.stop();
        sound.dispose();
      }
      started.length = 0;
    },
  };

  if (muted) {
    handle.setMuted(true);
  }
  return handle;
}

/**
 * Loops a clip on part of itself, when the profile asked for that.
 *
 * A bed whose last second ends on a gust loops audibly; the same bed looped on
 * its clean middle does not. `0`/`0` — the default — means the whole file, and
 * the window is ignored if it is not a real one, because a loop that ends
 * before it starts is silence and silence is hard to diagnose.
 */
function applyLoopWindow(sound: StaticSound, start: number, end: number): void {
  if (end <= start) {
    return;
  }
  const loopable = sound as unknown as { loopStart?: number; loopEnd?: number };
  loopable.loopStart = start;
  loopable.loopEnd = end;
}

/** Ramps a sound's volume to a target over `seconds`, in small steps. */
function fadeTo(
  sound: StaticSound,
  target: number,
  seconds: number,
  timers: ReturnType<typeof setTimeout>[],
): void {
  const steps = Math.max(Math.round((seconds * 1000) / FADE_STEP_MS), 1);
  for (let step = 1; step <= steps; step += 1) {
    const timer = setTimeout(() => {
      sound.volume = (target * step) / steps;
    }, step * FADE_STEP_MS);
    timer.unref?.();
    timers.push(timer);
  }
}
