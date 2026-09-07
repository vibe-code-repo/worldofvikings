/**
 * The editor's half of sound: hearing the zone you are editing (ADR-0052,
 * ADR-0033).
 *
 * The twin of `apps/game/src/zone-sound.ts` — same `applyWorldSound`, same
 * resolved profile out of the same world file, different answers to the two
 * questions only this side of the boundary can answer: where a clip's bytes are
 * and which camera the ears sit on. It is a separate module and not an addition
 * to `EditorViewport` for the reason `zone-terrain.ts` is: the viewport owns a
 * canvas, and everything else it does should be one call.
 *
 * **Three decisions worth stating.**
 *
 * *The engine is a page singleton, not a scene member.* An audio context is a
 * per-page resource and the browser gives out a small number of them; React
 * StrictMode mounts the viewport twice on every dev reload, and the viewport is
 * rebuilt whenever the renderer restarts. So the engine is created once behind
 * a module-level promise and outlives every scene — which is also what makes
 * the Listen toggle survive a viewport rebuild.
 *
 * *Off by default.* An editor that starts a forge loop the moment a scene loads
 * is an editor nobody keeps open, and the browser would refuse to start it
 * before a gesture anyway. Nothing is created until an author asks for it; the
 * toggle's own click is the gesture the audio context is unlocked with.
 *
 * *Rebuilt on the profile, not on the document.* The document is replaced on
 * every gizmo drag. Tearing down eleven panners and re-downloading a bed each
 * time a barrel moves would make the viewport unusable, so the sound is keyed
 * on the world id, the zone id and the two `sound` blocks, exactly as the
 * relight is keyed on the two `lighting` blocks.
 */
import type { Scene } from '@babylonjs/core/scene.js';
import { assetStoreUrl, assetUrl, type AssetSourceConfig } from '@wov/asset-system';
import {
  applyWorldSound,
  createAudioEngine,
  resolveSoundProfile,
  type AudioSystem,
  type ClipSource,
  type WorldSoundHandle,
} from '@wov/engine';
import type { EditorDocument } from '@wov/editor-core';

/**
 * The one stand-in every private audio clip falls back to (ADR-0054).
 *
 * The same quarter second of silence the game falls back to. It matters more
 * here than there: an author on a clean clone with no private store still gets
 * a panel that behaves, an emitter count that is right, and silence — rather
 * than 44 failed requests and a readout full of red.
 */
const AUDIO_PLACEHOLDER = 'placeholders/audio/silence.wav';

/** Where one clip's bytes are, and what to play instead if they are not there. */
export function clipSource(source: AssetSourceConfig, path: string): ClipSource {
  return { url: assetStoreUrl(source, path), fallbackUrl: assetUrl(source, AUDIO_PLACEHOLDER) };
}

/**
 * The page's audio engine, created at most once.
 *
 * A promise rather than a value, and kept even when it rejects: a browser that
 * cannot give this page an audio context will not give it one on the second ask
 * either, and retrying per toggle would be a stream of failed constructions
 * behind a switch that looks broken.
 */
let engine: Promise<AudioSystem> | null = null;

export function editorAudio(): Promise<AudioSystem> {
  engine ??= createAudioEngine();
  return engine;
}

/** What the viewport hands the sound each time the document changes. */
export interface ZoneSoundOptions {
  readonly scene: Scene;
  readonly source: AssetSourceConfig;
  /** Called whenever the readout changes, so the panel can show it. */
  readonly onStatus?: (status: string) => void;
}

/** The viewport's handle on the sound of the zone it is drawing. */
export interface ZoneSound {
  /**
   * Makes the sound match the document, or takes it away.
   *
   * Safe to call on every render: it returns immediately unless the world id,
   * the zone id, one of the two `sound` blocks or `listening` actually changed.
   */
  update(document: EditorDocument, listening: boolean): void;
  /** One line an author can read: what is playing, and what did not load. */
  status(): string;
  dispose(): void;
}

/** Nothing is playing and nothing failed — the line before the first Listen. */
const SILENT = 'sound: off';

export function createZoneSound(options: ZoneSoundOptions): ZoneSound {
  const { scene, source } = options;

  let key = '';
  let handle: WorldSoundHandle | null = null;
  /** Guards against a rebuild finishing after this zone sound was disposed. */
  let generation = 0;
  let disposed = false;
  let status = SILENT;

  const report = (line: string): void => {
    if (line === status) {
      return;
    }
    status = line;
    options.onStatus?.(line);
  };

  const stop = (): void => {
    handle?.dispose();
    handle = null;
  };

  function rebuild(document: EditorDocument, listening: boolean): void {
    generation += 1;
    const mine = generation;
    stop();

    if (!listening) {
      report(SILENT);
      return;
    }

    const zone = document.world.zones.find((each) => each.id === document.activeZoneId);
    if (zone === undefined) {
      report('sound: no zone');
      return;
    }

    report('sound: starting…');
    void editorAudio().then(
      async (audio) => {
        if (disposed || mine !== generation) {
          return;
        }
        // The gesture that opened the panel is what unlocks the context; asking
        // again here costs nothing and covers a viewport rebuilt after one.
        await audio.unlock();
        const applied = await applyWorldSound(scene, {
          audio,
          profile: resolveSoundProfile(document.world.sound, zone.sound),
          clipSource: (path) => clipSource(source, path),
          entities: zone.entities.map((entity) => ({
            id: entity.id,
            prefab: entity.prefab,
            position: entity.position,
          })),
          // The node `scene-sync` built for the entity, so an emitter follows
          // the brazier while its gizmo is dragged.
          nodeOf: (entityId) => scene.getTransformNodeByName(`entity:${entityId}`),
          // The orbit camera: an author hears the scene from where they are
          // looking, which is the same rule the game applies to its own camera.
          listener: scene.activeCamera,
          listenerAt: () => {
            const at = scene.activeCamera?.globalPosition;
            return at === undefined ? { x: 0, y: 0, z: 0 } : { x: at.x, y: at.y, z: at.z };
          },
        });
        if (disposed || mine !== generation) {
          applied.dispose();
          return;
        }
        handle = applied;
        for (const problem of applied.problems) {
          console.warn(`[editor] zone "${zone.id}" sound — ${problem}`);
        }
        // One spelling, and one prefix. `statusLine` already begins with
        // "sound: " (`audio-unlock.ts`) and so does the handle's report, so
        // exactly one of them keeps it — the same line the game's HUD shows,
        // for the same reason: "sound: sound: click to enable" reads as a bug
        // in the very line whose job is to say whether there is one.
        report(`${audio.statusLine} — ${applied.report.replace(/^sound: /, '')}`);
      },
      (error: unknown) => {
        if (disposed || mine !== generation) {
          return;
        }
        report(`sound: unavailable — ${error instanceof Error ? error.message : String(error)}`);
      },
    );
  }

  return {
    update(document, listening) {
      const zone = document.world.zones.find((each) => each.id === document.activeZoneId);
      const next = JSON.stringify([
        listening,
        document.world.id,
        document.activeZoneId,
        document.world.sound ?? null,
        zone?.sound ?? null,
      ]);
      if (next === key) {
        return;
      }
      key = next;
      rebuild(document, listening);
    },
    status: () => status,
    dispose() {
      disposed = true;
      generation += 1;
      stop();
    },
  };
}
