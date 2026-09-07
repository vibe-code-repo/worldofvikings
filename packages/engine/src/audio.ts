/**
 * The audio engine, its listener, and playing a clip — one owner, the way
 * `lighting.ts` owns light.
 *
 * **Babylon's AudioV2, not the legacy `Audio/` engine.** Both ship in 8.56.
 * `new Sound(name, url, scene)` needs `Audio/audioSceneComponent.js` as a side
 * effect and ties every sound to a scene; AudioV2 is a standalone engine with
 * its own listener and a bus graph, created by an explicit factory call. It is
 * also the half of the API that still exists in Babylon 9.
 *
 * **Nothing is added to `side-effects.ts`, and that is a finding rather than an
 * omission.** That file's rule 1 is "only add an import that measurably changes
 * behaviour"; AudioV2 registers nothing on `Scene` and patches no prototype.
 * `CreateAudioEngineAsync` pulls in its own sub-nodes through the create path,
 * so an entry there would be bundle weight of exactly the kind the mesh-builder
 * note already argues against. These modules are imported here and nowhere else.
 *
 * **Why an engine is a page-level thing and not a scene member.** A browser has
 * one `AudioContext` worth having, its listener is one listener, and neither
 * belongs to a `Scene` — which is why this module hands back a handle instead of
 * writing into a scene the way `applyLighting` does. A caller creates it once,
 * next to the physics backend, and never awaits it in the frame loop: a clip
 * that has not arrived should delay sound, not walking.
 *
 * **What it owns:** the engine, the four buses, the listener, the per-URL clip
 * cache, and the unlocked/blocked state an app puts on screen. **What it does
 * not own:** which sounds a world has, where they stand, and when they start.
 * That is world data, and it arrives in a later step.
 */
import { CreateAudioEngineAsync } from '@babylonjs/core/AudioV2/webAudio/webAudioEngine.js';
import {
  CreateAudioBusAsync,
  CreateSoundAsync,
  CreateSoundBufferAsync,
} from '@babylonjs/core/AudioV2/abstractAudio/audioEngineV2.js';
import { SpatialAudioAttachmentType } from '@babylonjs/core/AudioV2/spatialAudioAttachmentType.js';
import type { AudioEngineV2 } from '@babylonjs/core/AudioV2/abstractAudio/audioEngineV2.js';
import type { AudioBus } from '@babylonjs/core/AudioV2/abstractAudio/audioBus.js';
import type { StaticSound } from '@babylonjs/core/AudioV2/abstractAudio/staticSound.js';
import type { StaticSoundBuffer } from '@babylonjs/core/AudioV2/abstractAudio/staticSoundBuffer.js';
import type { Node } from '@babylonjs/core/node.js';
import {
  initialAudioUnlockState,
  nextAudioUnlockState,
  summarizeAudioStatus,
} from './audio-unlock.js';
import type { AudioStatus, AudioUnlockEvent, AudioUnlockState } from './audio-unlock.js';
import { resolveAudioFalloff } from './audio-falloff.js';
import type { AudioFalloff } from './audio-falloff.js';

/**
 * The four buses, created once.
 *
 * A mixer slider is then one bus volume rather than forty sound volumes, and
 * `ui` and `music` exist empty from the start so that adding either later is a
 * `CreateSoundAsync({ outBus })` argument instead of a re-plumbing.
 */
export const AUDIO_BUS_NAMES = ['ambience', 'world', 'ui', 'music'] as const;
export type AudioBusName = (typeof AUDIO_BUS_NAMES)[number];

/** Options for {@link createAudioEngine}. Everything has a defensible default. */
export interface AudioEngineOptions {
  /** Master volume, `0…1`. */
  readonly volume?: number;
  /**
   * How often the listener's position may be recomputed, in seconds.
   *
   * A thirtieth by default rather than every frame: the update is a matrix read
   * plus six `AudioParam` writes, and nobody has ever localised a sound to
   * within one frame of head movement.
   */
  readonly listenerMinUpdateTime?: number;
  /**
   * How often the engine's own state is re-read, in milliseconds.
   *
   * Polling, and not an observable, on purpose. The state-change observable
   * lives on `_WebAudioEngine` and is marked `@internal`; reaching for it would
   * tie this module to a private surface for the sake of a property read that
   * costs nothing. Set to `0` to poll not at all and drive the state by hand.
   */
  readonly statePollMs?: number;
}

/** How one clip is placed in the world. */
export interface PlaceAudioOptions extends Partial<AudioFalloff> {
  /** Which bus it goes through. Defaults to `world`. */
  readonly bus?: AudioBusName;
  readonly volume?: number;
  readonly loop?: boolean;
  /**
   * The node the sound follows. Its **position only** — a brazier is
   * omnidirectional, and tracking rotation is a quaternion read per update for
   * nothing. Pass `position` instead for a sound with no node.
   */
  readonly node?: Node | null;
  /** Where it stands, when it follows no node. */
  readonly position?: readonly [number, number, number];
  /**
   * `equalpower` by default. `HRTF` is a convolution per source and the
   * difference is inaudible over a village bed; it is an option so that turning
   * it on is a data change, not a code change.
   */
  readonly panning?: 'equalpower' | 'HRTF';
  /** How often a followed node's position is re-read, in seconds. */
  readonly minUpdateTime?: number;
}

/** How one clip is played without a place: UI, music, and your own footsteps. */
export interface PlainAudioOptions {
  readonly bus?: AudioBusName;
  readonly volume?: number;
  readonly loop?: boolean;
  /** Playback rate, for pitch variation. `1` is unchanged. */
  readonly playbackRate?: number;
}

/** Stops listening to something. */
export type AudioUnsubscribe = () => void;

/** The one handle everything audio goes through. */
export interface AudioSystem {
  /** The Babylon engine, for the rare caller that needs it directly. */
  readonly engine: AudioEngineV2;
  /** Unlocked, blocked, or one of the four other answers. */
  readonly state: AudioUnlockState;
  /** The status line an app shows. One spelling, see `audio-unlock.ts`. */
  readonly statusLine: string;
  /** Called whenever {@link state} changes; never for a repeat of the same state. */
  onStateChanged(listener: (state: AudioUnlockState) => void): AudioUnsubscribe;
  /**
   * Asks the browser to start audio, and records that a gesture happened.
   *
   * Call it from a real user gesture. It resolves whether or not audio actually
   * started — the answer is in {@link state}, because "the promise settled" and
   * "there is sound" are different facts.
   */
  unlock(): Promise<void>;
  /** Re-reads the engine's state now, rather than waiting for the next poll. */
  refresh(): void;
  /** Whether this browser can decode a format, e.g. `'ogg'`. */
  supportsFormat(format: string): boolean;
  /** One of the four buses. */
  bus(name: AudioBusName): AudioBus;
  /**
   * Downloads and decodes a clip, once per URL.
   *
   * The cache is on the *buffer*, which is the expensive half: eleven braziers
   * playing one clip are one download, one decode and eleven panners.
   */
  loadClip(url: string): Promise<StaticSoundBuffer>;
  /** How many distinct clips are held. */
  readonly clipCount: number;
  /** A sound that has a place in the world. */
  playAt(url: string, options?: PlaceAudioOptions): Promise<StaticSound>;
  /** A sound that has no place: it is simply heard. */
  play(url: string, options?: PlainAudioOptions): Promise<StaticSound>;
  /**
   * Puts the listener on a node — normally the **camera**, not the player.
   *
   * In third person the picture is the camera's. A listener at the capsule's
   * feet puts a brazier that is on screen to your left into your right ear as
   * soon as the camera swings round, which reads as a bug in the panning rather
   * than as a decision about whose ears these are.
   */
  attachListener(node: Node | null): void;
  /** Releases the engine, the buses, every loaded clip and the poll. */
  dispose(): void;
}

/**
 * Creates the page's audio engine and its buses.
 *
 * Call once. Do not await it in the frame loop — the same rule the world file
 * and the physics WASM already follow.
 */
export async function createAudioEngine(options: AudioEngineOptions = {}): Promise<AudioSystem> {
  const listeners = new Set<(state: AudioUnlockState) => void>();
  let state = initialAudioUnlockState;
  let disposed = false;

  const emit = (event: AudioUnlockEvent): void => {
    const next = nextAudioUnlockState(state, event);
    if (next.status === state.status && next.gestured === state.gestured) {
      return;
    }
    state = next;
    for (const listener of listeners) {
      listener(state);
    }
  };

  let engine: AudioEngineV2;
  try {
    engine = await CreateAudioEngineAsync({
      // The project draws its own status line; Babylon's floating unmute button
      // would be a second, differently worded answer to the same question.
      disableDefaultUI: true,
      resumeOnInteraction: true,
      resumeOnPause: true,
      volume: options.volume ?? 1,
      listenerEnabled: true,
      listenerAutoUpdate: true,
      listenerMinUpdateTime: options.listenerMinUpdateTime ?? 1 / 30,
    });
  } catch (error) {
    // A browser with no Web Audio, or a context the page was not allowed to
    // create. Terminal, and reported as such rather than thrown: a game without
    // sound is a game, and a game that refuses to start is not.
    emit({ type: 'unavailable' });
    throw new AudioUnavailableError(error);
  }

  const buses = new Map<AudioBusName, AudioBus>();
  for (const name of AUDIO_BUS_NAMES) {
    buses.set(name, await CreateAudioBusAsync(name, {}, engine));
  }

  const clips = new Map<string, Promise<StaticSoundBuffer>>();
  const sounds = new Set<StaticSound>();

  const refresh = (): void => {
    if (disposed) {
      return;
    }
    emit({ type: 'engine', state: engineStateOf(engine) });
  };

  const pollMs = options.statePollMs ?? DEFAULT_STATE_POLL_MS;
  const poll = pollMs > 0 ? setInterval(refresh, pollMs) : undefined;
  // Never keep a Node process (or a test) alive for a status poll.
  poll?.unref?.();
  refresh();

  const busOf = (name: AudioBusName | undefined): AudioBus => {
    const bus = buses.get(name ?? 'world');
    if (bus === undefined) {
      throw new Error(`audio: no bus named "${String(name)}"`);
    }
    return bus;
  };

  const loadClip = async (url: string): Promise<StaticSoundBuffer> => {
    const cached = clips.get(url);
    if (cached !== undefined) {
      return cached;
    }
    const pending = CreateSoundBufferAsync(url, {}, engine);
    clips.set(url, pending);
    try {
      return await pending;
    } catch (error) {
      // A failed download must not poison the cache: the store may come back,
      // and a second attempt should be allowed to succeed.
      clips.delete(url);
      throw error;
    }
  };

  return {
    engine,
    get state() {
      return state;
    },
    get statusLine() {
      return summarizeAudioStatus(state);
    },
    get clipCount() {
      return clips.size;
    },
    onStateChanged(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async unlock() {
      emit({ type: 'gesture' });
      try {
        await engine.unlockAsync();
      } catch {
        // Swallowed on purpose: the question "is there sound?" is answered by
        // the engine's state below, not by whether this promise rejected.
      }
      refresh();
    },
    refresh,
    supportsFormat: (format) => engine.isFormatValid(format),
    bus: busOf,
    loadClip,

    async playAt(url, place = {}) {
      const buffer = await loadClip(url);
      const falloff = resolveAudioFalloff(place);
      const sound = await CreateSoundAsync(
        url,
        buffer,
        {
          autoplay: false,
          loop: place.loop ?? false,
          outBus: busOf(place.bus),
          volume: place.volume ?? 1,
          spatialEnabled: true,
          spatialDistanceModel: falloff.distanceModel,
          spatialMinDistance: falloff.minDistance,
          spatialMaxDistance: falloff.maxDistance,
          spatialRolloffFactor: falloff.rolloffFactor,
          spatialPanningModel: place.panning ?? 'equalpower',
          spatialMinUpdateTime: place.minUpdateTime ?? DEFAULT_SOURCE_UPDATE_SECONDS,
        },
        engine,
      );
      // Measured, not assumed (and the reason this is not five redundant
      // lines): the creation options above *do* reach the panner — the spatial
      // sub-node reads back `inverse / 1.5 / 1.6` for a brazier — but
      // `sound.spatial` is a **mirror** whose fields are initialised from
      // Babylon's own defaults and never re-read from that sub-node. So the
      // sound is right while `sound.spatial.minDistance` says `1`, and anything
      // that later asks a sound how far it carries — a distance cull, a panel,
      // a readout — would be told the wrong number. Writing the same values
      // through the mirror once makes the public answer match the audible one.
      sound.spatial.distanceModel = falloff.distanceModel;
      sound.spatial.minDistance = falloff.minDistance;
      sound.spatial.maxDistance = falloff.maxDistance;
      sound.spatial.rolloffFactor = falloff.rolloffFactor;
      sound.spatial.panningModel = place.panning ?? 'equalpower';

      if (place.node != null) {
        sound.spatial.attach(place.node, false, SpatialAudioAttachmentType.Position);
      } else if (place.position !== undefined) {
        sound.spatial.position.set(...place.position);
      }
      sounds.add(sound);
      sound.play();
      return sound;
    },

    async play(url, plain = {}) {
      const buffer = await loadClip(url);
      const sound = await CreateSoundAsync(
        url,
        buffer,
        {
          autoplay: false,
          loop: plain.loop ?? false,
          outBus: busOf(plain.bus),
          volume: plain.volume ?? 1,
          playbackRate: plain.playbackRate ?? 1,
        },
        engine,
      );
      sounds.add(sound);
      sound.play();
      return sound;
    },

    attachListener(node) {
      engine.listener.attach(node, false, SpatialAudioAttachmentType.PositionAndRotation);
    },

    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      if (poll !== undefined) {
        clearInterval(poll);
      }
      for (const sound of sounds) {
        sound.dispose();
      }
      sounds.clear();
      clips.clear();
      engine.dispose();
      emit({ type: 'disposed' });
      listeners.clear();
    },
  };
}

/** How often the engine's public `state` is re-read, in milliseconds. */
const DEFAULT_STATE_POLL_MS = 250;

/**
 * How often a followed node's position reaches the panner, in seconds.
 *
 * A twentieth. Emitters in this project do not move; the cost this avoids is a
 * per-frame matrix decompose per source for a value that never changes.
 */
const DEFAULT_SOURCE_UPDATE_SECONDS = 1 / 20;

/** Thrown when the browser has no audio to give. Carries the original cause. */
export class AudioUnavailableError extends Error {
  constructor(cause: unknown) {
    super('audio: this browser would not start an audio engine');
    this.name = 'AudioUnavailableError';
    this.cause = cause;
  }
}

/**
 * The engine's state, narrowed to what the unlock machine understands.
 *
 * Babylon's own type is the `AudioContext`'s four states. Reading it through a
 * function rather than passing it straight through means an unfamiliar fifth
 * value becomes `suspended` — "not making sound, reason unknown" — instead of a
 * status nothing can render.
 */
export function engineStateOf(engine: Pick<AudioEngineV2, 'state'>): AudioStatusSource {
  switch (engine.state) {
    case 'running':
      return 'running';
    case 'interrupted':
      return 'interrupted';
    case 'closed':
      return 'closed';
    default:
      return 'suspended';
  }
}

/** The four engine states the unlock machine is fed. */
export type AudioStatusSource = 'running' | 'suspended' | 'interrupted' | 'closed';

export type { AudioStatus, AudioUnlockState };
