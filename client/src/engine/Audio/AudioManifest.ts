/**
 * Reads assets/manifest.json's `toene` section (B1, branch
 * agent/claude/ton-manifest — B1 owns the manifest format and is not
 * changed here). Each entry is `{datei, bytes, hash, dauer, kanaele,
 * abtastrate}`; `datei` is a path relative to assets/store/audio/, e.g.
 * `ambience/forest-birds.ogg`. B1 carries no bus/group — both are
 * derived from the path (FOLDER_BUS below, and the path with its
 * trailing "-NN" stripped).
 *
 * The background music track is not part of `toene` (it lives under
 * assets/audio/, not assets/store/audio/) and is added as a fixed
 * entry (BACKGROUND_MUSIC_NAME), independent of whether `toene` is
 * present at all.
 */

export type AudioBusName = 'ambience' | 'world' | 'ui' | 'music';

export interface AudioManifestEntry {
  /** Fully resolved, fetchable URL. */
  url: string;
  bus: AudioBusName;
  /** Clips sharing a group shuffle together (ShuffleBag). */
  group?: string;
}

export type AudioManifest = Readonly<Record<string, AudioManifestEntry>>;

const STORE_BASE_URL = '/assets/store/audio/';
const AUDIO_BASE_URL = '/assets/audio/';

export const BACKGROUND_MUSIC_NAME = 'backgroundMusic';
export const BACKGROUND_MUSIC_ENTRY: AudioManifestEntry = {
  url: `${AUDIO_BASE_URL}hintergrundmusik.mp3`,
  bus: 'music',
  group: BACKGROUND_MUSIC_NAME,
};

/**
 * Folder (first path segment under assets/store/audio/) -> bus. Covers
 * every folder B1's `toene` section has today (checked by
 * audio-manifest.ts against a fixture of all eight); a folder missing
 * from this table defaults to 'world' with one console warning instead
 * of being silently dropped.
 */
export const FOLDER_BUS: Readonly<Record<string, AudioBusName>> = {
  ambience: 'ambience',
  music: 'music',
  ui: 'ui',
  animals: 'world',
  combat: 'world',
  creatures: 'world',
  emitters: 'world',
  footsteps: 'world',
};

interface ToeneEntry {
  datei: string;
}

function isToeneEntry(value: unknown): value is ToeneEntry {
  if (!value || typeof value !== 'object') return false;
  const datei = (value as Record<string, unknown>).datei;
  return typeof datei === 'string' && datei.length > 0;
}

/** Folder -> bus, warning at most once per unknown folder per readAudioManifest() call. */
function busForFolder(folder: string, warned: Set<string>): AudioBusName {
  const bus = FOLDER_BUS[folder];
  if (bus) return bus;
  if (!warned.has(folder)) {
    warned.add(folder);
    console.warn(
      `[audio] assets/store/audio/${folder}/ has no bus in AudioManifest.FOLDER_BUS — defaulting to 'world'.`,
    );
  }
  return 'world';
}

/** "footsteps/wood-01" -> "footsteps/wood"; a path without a trailing "-NN" is its own group. */
function groupFromPath(pathWithoutExtension: string): string {
  return pathWithoutExtension.replace(/-\d+$/, '');
}

export function readAudioManifest(manifest: unknown): AudioManifest {
  const result: Record<string, AudioManifestEntry> = {
    [BACKGROUND_MUSIC_NAME]: BACKGROUND_MUSIC_ENTRY,
  };
  const toene = manifest && typeof manifest === 'object' ? (manifest as Record<string, unknown>).toene : undefined;
  if (toene && typeof toene === 'object') {
    const warned = new Set<string>();
    for (const [key, raw] of Object.entries(toene as Record<string, unknown>)) {
      if (!isToeneEntry(raw)) continue;
      const datei = raw.datei;
      const folder = datei.split('/')[0] ?? '';
      const withoutExtension = datei.replace(/\.[^./]+$/, '');
      result[key] = {
        url: `${STORE_BASE_URL}${datei}`,
        bus: busForFolder(folder, warned),
        group: groupFromPath(withoutExtension),
      };
    }
  }
  return result;
}

/** Groups manifest entries by (bus, group ?? key) — one ShuffleBag pool per group. */
export function groupByBus(manifest: AudioManifest): Record<AudioBusName, Map<string, string[]>> {
  const groups: Record<AudioBusName, Map<string, string[]>> = {
    ambience: new Map(),
    world: new Map(),
    ui: new Map(),
    music: new Map(),
  };
  for (const [name, entry] of Object.entries(manifest)) {
    const key = entry.group ?? name;
    const map = groups[entry.bus];
    const list = map.get(key);
    if (list) list.push(name);
    else map.set(key, [name]);
  }
  return groups;
}
