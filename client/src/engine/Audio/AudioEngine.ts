import type { Scene } from '@babylonjs/core/scene';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateAudioEngineAsync, type AudioEngineV2, type AudioBus, type StaticSound } from '@babylonjs/core/AudioV2';
import { ShuffleBag } from './ShuffleBag';
import { AutoplayAutomaton, type AutoplayState } from './AutoplayAutomaton';
import {
  readAudioManifest,
  groupByBus,
  BACKGROUND_MUSIC_NAME,
  type AudioBusName,
  type AudioManifest,
  type AudioManifestEntry,
} from './AudioManifest';
import { audibleRadius } from './AudibleRadius';
import { syncListenerPosition, type CameraPositionLike } from './ListenerSync';
import { isPlaybackAllowed } from './PlaybackGate';
import { loadWithWarnOnce } from './ClipLoader';

const MANIFEST_URL = '/assets/manifest.json';

/** Default bus volumes for as long as no player setting exists (none do today, see karte B2). */
const DEFAULT_BUS_VOLUME: Record<AudioBusName, number> = {
  ambience: 0.5,
  world: 0.6,
  ui: 0.8,
  // Matches the old GameAudio's combined loudness: 0.7 (master) x 0.16 (track) = 0.112.
  music: 0.112,
};

/** World-bus spatial constants; AudioEngine.worldAudibleRadius is their analytic consequence (AudibleRadius.ts). */
const WORLD_MIN_DISTANCE = 2;
const WORLD_ROLLOFF_FACTOR = 1;

/** Random pitch variance applied to every clip play, +/-6 % (karte B2). */
const PITCH_JITTER = 0.06;

export interface AudioEngineOptions {
  muted?: boolean;
  /** Element the first-unlock gesture is armed on. Defaults to `window`. */
  gestureTarget?: EventTarget;
}

export interface PlayOptions {
  /** Required for the 'world' bus; ignored otherwise. */
  position?: Vector3;
  loop?: boolean;
}

/**
 * Audio subsystem: four independent buses (ambience/world/ui/music), a
 * clip cache, a shuffle bag per clip group, spatial sound for 'world',
 * and the browser-autoplay unlock automaton. Replaces GameAudio.ts.
 *
 * client/src/main.ts has exactly one call site: `AudioEngine.create(...)`.
 */
export class AudioEngine {
  private readonly automaton: AutoplayAutomaton;
  private readonly engine: AudioEngineV2;
  private readonly buses: Record<AudioBusName, AudioBus>;
  private readonly manifest: Record<string, AudioManifestEntry>;
  private readonly groups: Record<AudioBusName, Map<string, string[]>>;
  private readonly clipCache = new Map<string, Promise<StaticSound | null>>();
  private readonly failedClipsWarned = new Set<string>();
  private readonly shuffleBags = new Map<string, ShuffleBag<string>>();
  private readonly camera: CameraPositionLike;
  private muted: boolean;
  private musicStarted = false;
  private disposed = false;

  private constructor(
    automaton: AutoplayAutomaton,
    engine: AudioEngineV2,
    buses: Record<AudioBusName, AudioBus>,
    manifest: AudioManifest,
    scene: Scene,
    camera: CameraPositionLike,
    muted: boolean,
  ) {
    this.automaton = automaton;
    this.engine = engine;
    this.buses = buses;
    this.manifest = { ...manifest };
    this.groups = groupByBus(manifest);
    this.camera = camera;
    this.muted = muted;
    this.engine.volume = muted ? 0 : 1;
    scene.onBeforeRenderObservable.add(() => {
      if (!this.disposed) syncListenerPosition(this.camera, this.engine.listener);
    });
  }

  /** The distance at which a 'world'-bus spatial sound has faded to 2 % — see AudibleRadius.ts. */
  static get worldAudibleRadius(): number {
    return audibleRadius(WORLD_MIN_DISTANCE, WORLD_ROLLOFF_FACTOR);
  }

  get state(): AutoplayState {
    return this.automaton.current;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /**
   * Builds the engine and arms the first-gesture unlock. The caller
   * (client/src/main.ts) must attach a `.catch` — a rejection here
   * (no audio device, too many AudioContexts, …) leaves the game
   * running without sound rather than crashing it.
   */
  static async create(
    scene: Scene,
    camera: CameraPositionLike,
    options: AudioEngineOptions = {},
  ): Promise<AudioEngine> {
    const gestureTarget = options.gestureTarget ?? window;
    const automaton = new AutoplayAutomaton();
    automaton.beginBuildup();

    let engine: AudioEngineV2;
    try {
      // listenerEnabled only decides eager vs. lazy creation of the
      // listener (webAudioEngine.js: `_HasSpatialAudioListenerOptions`
      // gates an eager create+setOptions in _initAsync; otherwise the
      // `get listener()` getter creates it lazily on first access, with
      // the same auto-update default). AudioEngine touches
      // engine.listener every frame regardless (syncListenerPosition
      // below), so the lazy path would work too — this is set
      // explicitly for clarity, not because it changes behaviour.
      engine = await CreateAudioEngineAsync({ resumeOnInteraction: false, listenerEnabled: true });
    } catch (err) {
      automaton.buildupFailed();
      throw err;
    }
    automaton.contextReady(engine.state === 'running' ? 'running' : 'suspended');

    const buses: Record<AudioBusName, AudioBus> = {
      ambience: await engine.createBusAsync('ambience', { volume: DEFAULT_BUS_VOLUME.ambience }),
      world: await engine.createBusAsync('world', { volume: DEFAULT_BUS_VOLUME.world }),
      ui: await engine.createBusAsync('ui', { volume: DEFAULT_BUS_VOLUME.ui }),
      music: await engine.createBusAsync('music', { volume: DEFAULT_BUS_VOLUME.music }),
    };

    let manifest: AudioManifest;
    try {
      const response = await fetch(MANIFEST_URL, { cache: 'no-store' });
      manifest = readAudioManifest(await response.json());
    } catch {
      manifest = readAudioManifest(undefined);
    }

    const wov = new AudioEngine(automaton, engine, buses, manifest, scene, camera, options.muted ?? false);
    if (automaton.current === 'unlocked') {
      wov.startMusicIfNeeded();
    } else {
      wov.armUnlockGesture(gestureTarget);
    }
    return wov;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.engine.volume = muted ? 0 : 1;
  }

  /**
   * Plays the next clip from the (bus, group) shuffle bag. No-op before
   * 'unlocked' and while muted — nothing is queued for later, per karte B2.
   * A clip that fails to load (404, decode error) warns once (see
   * loadClip) and is otherwise silently skipped — never an unhandled
   * rejection and never a thrown error out of this method.
   */
  async playAsync(bus: AudioBusName, group: string, options: PlayOptions = {}): Promise<void> {
    if (this.disposed || !isPlaybackAllowed(this.automaton.current, this.muted)) return;
    const names = this.groups[bus].get(group);
    if (!names || names.length === 0) return;
    const bagKey = `${bus}:${group}`;
    let bag = this.shuffleBags.get(bagKey);
    if (!bag) {
      bag = new ShuffleBag(names);
      this.shuffleBags.set(bagKey, bag);
    }
    const clipName = bag.next();
    const sound = await this.loadClip(clipName, bus);
    if (this.disposed || !sound) return;
    // Shared across a clip's instances (StaticSound stores playbackRate, not
    // per-instance) — acceptable for the one-shots this drives; concurrent
    // overlapping plays of the very same clip will share the newest jitter.
    sound.playbackRate = 1 + (Math.random() * 2 - 1) * PITCH_JITTER;
    if (options.position) {
      // Assigned on every play. loadClip() passes no spatial options to
      // createSoundAsync(), so the spatial sub node does not exist yet:
      // the first `sound.spatial` access creates it asynchronously.
      // Babylon's callOnSubNode() (abstractAudioSubGraph.js) defers a
      // property assignment until the sub node exists and then applies
      // it, so values set before that are not lost. Until such an
      // assignment lands, a lazily created sub node keeps the native
      // PannerNode defaults (distanceModel 'inverse', refDistance 1).
      // Re-assigning per play is harmless; once would do. Checked
      // against node_modules/@babylonjs/core/AudioV2 (9.28.0).
      sound.spatial.distanceModel = 'inverse';
      sound.spatial.minDistance = WORLD_MIN_DISTANCE;
      sound.spatial.rolloffFactor = WORLD_ROLLOFF_FACTOR;
      sound.spatial.position.copyFrom(options.position);
    }
    sound.play({ loop: options.loop ?? false });
  }

  /**
   * Registers a manifest entry at runtime. `assets/manifest.json`'s
   * `toene` section (B1) is the normal source; this is also how the
   * Hörprobe measurement harness can add a clip on the fly, and how
   * B3/B4 could add procedural clips later.
   */
  registerClip(name: string, entry: AudioManifestEntry): void {
    this.manifest[name] = entry;
    const key = entry.group ?? name;
    const list = this.groups[entry.bus].get(key);
    if (list) list.push(name);
    else this.groups[entry.bus].set(key, [name]);
  }

  /** RMS of the given bus's current output, 0..1, via its analyzer (Hörprobe measurement). */
  async measureBusLevelAsync(bus: AudioBusName): Promise<number> {
    const node = this.buses[bus];
    if (!node.analyzer.isEnabled) await node.analyzer.enableAsync();
    const data = node.analyzer.getByteTimeDomainData();
    if (data.length === 0) return 0;
    let sumSquares = 0;
    for (const sample of data) {
      const centered = (sample - 128) / 128;
      sumSquares += centered * centered;
    }
    return Math.sqrt(sumSquares / data.length);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.engine.dispose();
  }

  private armUnlockGesture(target: EventTarget): void {
    const unlock = (): void => {
      target.removeEventListener('pointerdown', unlock);
      target.removeEventListener('keydown', unlock);
      void this.unlock();
    };
    target.addEventListener('pointerdown', unlock, { once: true });
    target.addEventListener('keydown', unlock, { once: true });
  }

  private async unlock(): Promise<void> {
    this.automaton.gesture();
    try {
      await this.engine.resumeAsync();
      this.automaton.resumeSucceeded();
      this.startMusicIfNeeded();
    } catch {
      this.automaton.resumeFailed();
    }
  }

  private startMusicIfNeeded(): void {
    if (this.musicStarted) return;
    if (!this.groups.music.has(BACKGROUND_MUSIC_NAME)) return;
    this.musicStarted = true;
    void this.playAsync('music', BACKGROUND_MUSIC_NAME, { loop: true });
  }

  /**
   * Resolves to `null` (after warning once per clip name) instead of
   * rejecting when the network fetch or decode fails — a missing/broken
   * clip must not crash playAsync() or produce an unhandled rejection
   * (karte B2 N1, Befund B2). An unknown clip *name* (a bag entry with
   * no matching manifest entry) is a programming error, not a runtime
   * asset failure, and still throws.
   */
  private async loadClip(name: string, bus: AudioBusName): Promise<StaticSound | null> {
    let pending = this.clipCache.get(name);
    if (!pending) {
      const entry = this.manifest[name];
      if (!entry) throw new Error(`Unknown audio clip '${name}'`);
      pending = loadWithWarnOnce(
        name,
        () => this.engine.createSoundAsync(name, entry.url, { outBus: this.buses[bus] }),
        this.failedClipsWarned,
        (clipName, err) => console.warn(`[audio] failed to load clip '${clipName}' (${entry.url}):`, err),
      );
      this.clipCache.set(name, pending);
    }
    return pending;
  }
}
