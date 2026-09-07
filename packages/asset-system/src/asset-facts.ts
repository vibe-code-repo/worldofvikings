/**
 * The two closed vocabularies the manifest and the client both need, with no
 * Zod anywhere near them.
 *
 * They cannot live in `manifest.ts`: the game must be able to say
 * `visibility === 'private'` without being able to *reach* the schema, which is
 * what `game-must-not-pull-in-the-manifest-schema` enforces (ADR-0012). They
 * cannot be duplicated either — two spellings of `'private'` drift the first
 * time a third kind is added. So the lists live here, `manifest.ts` builds its
 * Zod enums from them, and the client imports the types.
 */

/**
 * What an asset *is*, which decides how it is checked and normalised.
 *
 * `mesh` is one exported model, `prefab` an authored hierarchy of several,
 * `terrain` a height field, `texture` an image, `audio` a sound file. The first
 * three occupy space in the world and therefore have bounds in metres; a
 * texture and a sound do not.
 *
 * `audio` is a kind of its own rather than "a texture with a different
 * extension" for the reason every other split in this list exists: what can be
 * checked about it differs. A sound has a duration, a channel count and a
 * sample rate where an image has pixels; and it must be recognisable as *not*
 * geometry without also becoming something a prefab could place.
 */
export const ASSET_KINDS = ['mesh', 'prefab', 'terrain', 'texture', 'audio'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/**
 * File extensions this project serves as audio, lower case and with the dot.
 *
 * One list, because four places need the same answer and each of them fails
 * differently when it disagrees: the manifest's version 1 migration, the
 * development asset server's content types, the importer, and anything that
 * wants to know whether a path names a sound. A `.wav` served as
 * `application/octet-stream` still decodes in a browser, so a fifth place
 * spelling this list its own way would go wrong quietly.
 */
export const AUDIO_EXTENSIONS = ['.ogg', '.opus', '.mp3', '.m4a', '.wav'] as const;

/** Whether an asset path names a sound file. Extension only, never contents. */
export function isAudioAssetPath(assetPath: string): boolean {
  const lower = assetPath.toLowerCase();
  return AUDIO_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * Where the bytes are: in this repository, or in the private asset store.
 *
 * A *distribution* statement, not a security one — the store is where files sit
 * whose redistribution rights are not settled yet (ADR-0015).
 */
export const ASSET_VISIBILITIES = ['private', 'public'] as const;
export type AssetVisibility = (typeof ASSET_VISIBILITIES)[number];

/**
 * Kinds that occupy space in the world and therefore carry bounds in metres.
 *
 * Deliberately *not* widened when `audio` arrived: a sound has a falloff radius
 * in metres, but that radius is world data on the emitter that plays it, not a
 * property of the file. An audio row carrying `bounds` is a mistake and the
 * manifest still says so.
 */
export const GEOMETRY_KINDS: readonly AssetKind[] = ['mesh', 'prefab', 'terrain'];

/** Whether this kind has an extent in metres. */
export function isGeometryKind(kind: AssetKind): boolean {
  return GEOMETRY_KINDS.includes(kind);
}
