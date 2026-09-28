/**
 * The (future) `audio` section of assets/manifest.json — B1 (Karte
 * "Tonaufnahmen ins Manifest", branch agent/claude/ton-manifest) fills
 * it in. Until it lands, the section is absent, so readAudioManifest
 * returns an empty map plus one bridging entry (see MUSIC_FALLBACK)
 * that reproduces today's single hardcoded background track — the only
 * clip that already existed before this manifest section did. Nothing
 * else is invented here: no world/ui/ambience entries exist today, so
 * none are hardcoded.
 */

export type AudioBusName = 'ambience' | 'world' | 'ui' | 'music';

export interface AudioManifestEntry {
  /** File name under assets/audio/, relative to that folder. */
  file: string;
  bus: AudioBusName;
  /** Clips sharing a group shuffle together (ShuffleBag). Defaults to the entry's own key. */
  group?: string;
}

export type AudioManifest = Readonly<Record<string, AudioManifestEntry>>;

const BUS_NAMES: readonly AudioBusName[] = ['ambience', 'world', 'ui', 'music'];

function isAudioManifestEntry(value: unknown): value is AudioManifestEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.file === 'string' && v.file.length > 0 && BUS_NAMES.includes(v.bus as AudioBusName);
}

export const MUSIC_FALLBACK_NAME = 'backgroundMusic';
export const MUSIC_FALLBACK_ENTRY: AudioManifestEntry = { file: 'hintergrundmusik.mp3', bus: 'music' };

/** Reads and validates manifest.audio; see module doc for the fallback bridge. */
export function readAudioManifest(manifest: unknown): AudioManifest {
  const raw =
    manifest && typeof manifest === 'object' ? (manifest as Record<string, unknown>).audio : undefined;
  const result: Record<string, AudioManifestEntry> = {};
  if (raw && typeof raw === 'object') {
    for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
      if (isAudioManifestEntry(entry)) result[name] = entry;
    }
  }
  if (!Object.values(result).some((entry) => entry.bus === 'music')) {
    result[MUSIC_FALLBACK_NAME] = MUSIC_FALLBACK_ENTRY;
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
