/**
 * What each source material name means for the surface, as a checked table.
 *
 * **Why a table and not a rule in the loader.** The modelling export carries no
 * material settings at all: every one of the 58 material names in it arrives as
 * `alphaMode: "OPAQUE"`, `doubleSided: false`, with no factors — the exporter
 * dropped them. So the settings have to be restored from somewhere, and the
 * only honest somewhere is a list a person has read. A regular expression over
 * material names ("contains `leaves`") would be a guess that silently spreads
 * to every future name; a table is a decision that fails loudly by omission —
 * an unlisted material is reported by the importer and rendered opaque, which
 * is wrong in a visible, fixable way rather than in a plausible one.
 *
 * **The three surfaces.**
 *
 * | Surface    | Applies to                                     | glTF                                            |
 * | ---------- | ---------------------------------------------- | ----------------------------------------------- |
 * | `opaque`   | everything not named below                     | `OPAQUE`, single-sided                          |
 * | `cutout`   | leaves, grass, glass, and `DoubleSide_*`       | `MASK` + `alphaCutoff` 0.5, `doubleSided: true` |
 * | `emissive` | `*_Emmisive` and the crystal                   | opaque plus `emissiveFactor` and an emissive map |
 *
 * Foliage is `MASK` rather than `BLEND` on purpose: these atlases are hard
 * cutouts, and `BLEND` would cost sorting per frame and still draw leaves
 * through each other. `doubleSided` comes with it because a leaf card has no
 * back face of its own — without it half of every tree disappears.
 *
 * **Metalness.** Every bound material is written with `metallicFactor: 0` and
 * `roughnessFactor: 1`. The glTF default is metallic 1 / rough 1, so a material
 * that says nothing renders as rough metal in a physically-based renderer:
 * the textures go black except where the environment reflects. That default is
 * the single most visible thing this table exists to override.
 */

/** How one material behaves. */
export interface MaterialSurface {
  readonly alphaMode: 'OPAQUE' | 'MASK';
  readonly doubleSided: boolean;
  readonly emissive: boolean;
}

/** Alpha-tested foliage, grass and glass: cut out, lit from both sides. */
export const CUTOUT: MaterialSurface = { alphaMode: 'MASK', doubleSided: true, emissive: false };

/** The ordinary case: a solid, single-sided surface. */
export const OPAQUE: MaterialSurface = { alphaMode: 'OPAQUE', doubleSided: false, emissive: false };

/** Opaque, and lit by its own base colour as well as by the scene. */
export const EMISSIVE: MaterialSurface = {
  alphaMode: 'OPAQUE',
  doubleSided: false,
  emissive: true,
};

/** The cutoff written with every `MASK` material. */
export const ALPHA_CUTOFF = 0.5;

/** See the note on metalness above. */
export const METALLIC_FACTOR = 0;
export const ROUGHNESS_FACTOR = 1;

/** How strongly an emissive material lights itself, per channel. */
export const EMISSIVE_FACTOR: readonly [number, number, number] = [1, 1, 1];

/**
 * Every material name the export uses, and the surface it gets.
 *
 * The list is the union of the material names found in the scene bundles and
 * those already carried by the models in the store — 58 of them. Names with a
 * trailing number (`… 2`, `… 3 1`) are separate material instances of the same
 * authored material and are listed separately rather than folded together by a
 * pattern, so that a future instance with different settings has somewhere to
 * go.
 */
export const MATERIAL_SURFACES: Readonly<Record<string, MaterialSurface>> = {
  // --- leaves ------------------------------------------------------------
  'Leaves 1': CUTOUT,
  'Leaves 2': CUTOUT,
  'Leaves 3': CUTOUT,
  'Leaves Birch 1': CUTOUT,
  'Leaves Birch 2': CUTOUT,
  'Leaves Birch 3 Dark': CUTOUT,
  'Leaves Birch 3 Dark Snow': CUTOUT,
  'Maple Leaves': CUTOUT,
  'Maple Leaves 1': CUTOUT,
  'Pine 1': CUTOUT,
  'Pine 2': CUTOUT,
  // --- grass and small plants -------------------------------------------
  'Grass_Short_Mat_01 1': CUTOUT,
  'Grass_Short_Mat_01 Low Wild': CUTOUT,
  Grass_Short_Plant_Leaves_1A1: CUTOUT,
  'Grass_Short_Plant_Leaves_1A1 2': CUTOUT,
  Grass_Short_Plant_Leaves_1A1_RedBlue: CUTOUT,
  Grass_Short_Plant_Leaves_1A1_Snow: CUTOUT,
  Grass_Short_Plant_Leaves_1A1_Yellow: CUTOUT,
  // --- glass, and the material the authors marked double-sided ----------
  'Glass_atlas-e_01 1': CUTOUT,
  'DoubleSide_atlas-b_Material_01 1': CUTOUT,
  // Cloud cards: alpha planes like foliage, and invisible from behind unless
  // they are double-sided.
  atlas-c_Clouds: CUTOUT,
  // --- self-lit ----------------------------------------------------------
  // The misspelling is the authors'; it is the name in the file.
  atlas-a_Mat_01_A_Emmisive: EMISSIVE,
  SM_Item_Crystal_04: EMISSIVE,
  // --- bark and trunks ---------------------------------------------------
  Birch_Bark_A: OPAQUE,
  Oak_Bark_A: OPAQUE,
  'Oak_Bark_A 2 Dark': OPAQUE,
  Trunks: OPAQUE,
  // --- the flat-shaded atlases ------------------------------------------
  atlas-a_Mat_01_A: OPAQUE,
  'atlas-a_Mat_01_A 2': OPAQUE,
  'atlas-a_Mat_01_A 2 1': OPAQUE,
  'atlas-a_Mat_01_A 3': OPAQUE,
  'atlas-a_Mat_01_A 3 1': OPAQUE,
  'Dark 85 atlas-a_Mat_01_A 2': OPAQUE,
  'Metal_atlas-a_Mat_01_A 2': OPAQUE,
  'Metal_atlas-a_Mat_01_A 5': OPAQUE,
  'atlas-a_Mat_Castle_Wall_01 1': OPAQUE,
  atlas-d_01_A: OPAQUE,
  atlas-c_01: OPAQUE,
  atlas-b_Material_01: OPAQUE,
  atlas-b_Material_01_Dark: OPAQUE,
  'Dark 60 atlas-b_Material_01 1': OPAQUE,
  'Dark 85 atlas-b_Material_01 2': OPAQUE,
  'Dark_atlas-b_Material_01 1': OPAQUE,
  atlas-e_01: OPAQUE,
  atlas-e_02: OPAQUE,
  atlas-e_TextureWalls: OPAQUE,
  Dungeons_Material_Characters_01: OPAQUE,
  Destroyed_House: OPAQUE,
  Ice: OPAQUE,
  // --- one-off materials -------------------------------------------------
  Boss: OPAQUE,
  'Cube Wood': OPAQUE,
  'Default-Material': OPAQUE,
  DefaultMaterial: OPAQUE,
  Lit: OPAQUE,
  // A mesh-effect material. Left opaque deliberately: nothing in the export
  // says how it blended, and a guessed blend mode on a solid mesh is worse
  // than a solid mesh.
  'Mesh_MeshEffect 2': OPAQUE,
  // The rune sets read as engraved stone in the atlas; nothing marks them
  // self-lit in the export, so they stay opaque until someone looks.
  RunesA: OPAQUE,
  RunesD: OPAQUE,
  RunesP: OPAQUE,
  SM_Item_Potion_01: OPAQUE,
  SM_Prop_Log_Spike_09: OPAQUE,
};

/** What an unlisted material gets, and what the importer reports it as. */
export const UNLISTED_SURFACE = OPAQUE;

/** Whether this material name is one the table has an answer for. */
export function isListedMaterial(name: string): boolean {
  return Object.hasOwn(MATERIAL_SURFACES, name);
}

/** The surface for one material name; {@link UNLISTED_SURFACE} when unlisted. */
export function surfaceFor(name: string): MaterialSurface {
  return MATERIAL_SURFACES[name] ?? UNLISTED_SURFACE;
}
