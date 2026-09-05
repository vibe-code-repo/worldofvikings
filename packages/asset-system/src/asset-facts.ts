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
 * `terrain` a height field, `texture` an image. The first three occupy space in
 * the world and therefore have bounds in metres; a texture does not.
 */
export const ASSET_KINDS = ['mesh', 'prefab', 'terrain', 'texture'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/**
 * Where the bytes are: in this repository, or in the private asset store.
 *
 * A *distribution* statement, not a security one — the store is where files sit
 * whose redistribution rights are not settled yet (ADR-0015).
 */
export const ASSET_VISIBILITIES = ['private', 'public'] as const;
export type AssetVisibility = (typeof ASSET_VISIBILITIES)[number];

/** Kinds that occupy space in the world and therefore carry bounds in metres. */
export const GEOMETRY_KINDS: readonly AssetKind[] = ['mesh', 'prefab', 'terrain'];

/** Whether this kind has an extent in metres. */
export function isGeometryKind(kind: AssetKind): boolean {
  return GEOMETRY_KINDS.includes(kind);
}
