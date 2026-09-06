/**
 * What each source material means for the surface, as a checked table.
 *
 * **Why a table and not a rule in the loader.** The modelling export carries no
 * material settings at all: every one of the 60 materials in it arrives as
 * `alphaMode: "OPAQUE"`, `doubleSided: false`, with no factors — the exporter
 * dropped them. So the settings have to be restored from somewhere, and the
 * only honest somewhere is a list a person has read. A regular expression over
 * material names ("contains `leaves`") would be a guess that silently spreads
 * to every future name; a table is a decision that fails loudly by omission —
 * an unlisted material is reported by the importer and rendered opaque, which
 * is wrong in a visible, fixable way rather than in a plausible one.
 *
 * **Why the table is keyed by a digest and not by the name.** The material
 * names in the source export carry vendor and product wording that this
 * repository does not repeat (see `docs/assets.md`). {@link materialKey} hashes
 * a name to a short, stable key, so the table can be complete and reviewable
 * without any of those names being written down: what each entry *is* stands
 * next to it in plain words. To add one, print its key with
 * `pnpm tsx tooling/asset-pipeline/material-key.ts "<name>"` and paste the key
 * plus a description.
 *
 * **The three surfaces.**
 *
 * | Surface    | Applies to                                    | glTF                                             |
 * | ---------- | --------------------------------------------- | ------------------------------------------------ |
 * | `opaque`   | bark, atlases, everything not named below     | `OPAQUE`, single-sided                           |
 * | `cutout`   | leaves, grass, glass, clouds, double-sided    | `MASK` + `alphaCutoff` 0.5, `doubleSided: true`  |
 * | `emissive` | the self-lit atlas variant and the crystal    | opaque plus `emissiveFactor` and an emissive map |
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
 *
 * **Colour.** The leaf and needle atlases in the store are brightness masks,
 * not colour: measured over their opaque pixels, `Leaves Birch 1` averages
 * R 115.4 G 115.1 B 115.4 and the two needle cards R=G=B 118.4 and 148.4 —
 * grey to within a digit, spanning 101…140 for the broadleaf card. The green
 * lived in a material colour the export dropped along with every other factor,
 * so a tree imported without one is a grey tree. {@link TINTS} puts it back as
 * `baseColorFactor`, per leaf card rather than per model: eleven tree, bush and
 * hedge models share one broadleaf atlas and differ only in that factor, which
 * is exactly what a multiplier is for.
 *
 * The factors are linear multipliers and glTF caps them at 1, so a tint can
 * only take colour away. Green is therefore kept at or near 1 and red and blue
 * are pulled down; pushing all three down to "reach" a saturated green would
 * only produce a darker grey-green. Bark and trunk atlases are already coloured
 * (R 113 G 98 B 80) and are left alone — a tint on top of them would be a
 * second opinion about a colour someone already painted.
 */
import { createHash } from 'node:crypto';

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

/**
 * The painted distance: cut out, lit from both sides, and self-lit.
 *
 * The same three flags as {@link CUTOUT} plus `emissive`, and each one is a
 * measurement rather than a preference:
 *
 * - `MASK`, because 13 % of the mountain panorama is `alpha = 0` — the sky
 *   above the peaks is a hole in the texture, not a colour in it. Drawn
 *   `OPAQUE` the shell is an opaque wall around the world and the sky is gone;
 *   drawn `BLEND` it would sort against itself for a picture with no soft edge
 *   anywhere in it.
 * - `doubleSided`, because these shells are seen from the inside. Which way
 *   their faces point is a property of a source file nobody in this repository
 *   can re-export, so the safe answer is to draw both.
 *
 * It is deliberately **not** emissive. A painted range that lights itself is
 * drawn at `emissive + lit`, which with this world's sun and ambient is about
 * twice the brightness of the ground in front of it — a white cut-out at the
 * horizon. Lit like everything else it takes the same sun, which is the answer
 * that keeps an evening evening all the way to the skyline.
 */
export const BACKDROP: MaterialSurface = {
  alphaMode: 'MASK',
  doubleSided: true,
  emissive: false,
};

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

/** A base colour multiplier: glTF's `baseColorFactor`, red, green, blue, alpha. */
export type Tint = readonly [number, number, number, number];

/**
 * The leaf cards that need a colour, named after the card and not after the
 * plant — a bush is not a tint of its own, because the bush models wear the
 * same birch and broadleaf atlases the trees do (measured in the store).
 */
export type TintName =
  | 'birch-leaf'
  | 'birch-leaf-dark'
  | 'broadleaf'
  | 'maple-leaf'
  | 'pine-needle'
  | 'grass-card'
  | 'plant-leaf';

/**
 * What each card is multiplied by.
 *
 * Read against a mask pixel of 115/255 (sRGB), which is where the broadleaf
 * atlas sits: `broadleaf` lands the lit leaf near sRGB 82/115/55, a warm mid
 * green, and `pine-needle` near 64/94/58, darker and cooler, the two apart by
 * more than the eye needs to tell a conifer from an oak across the village.
 * `grass-card` is the odd one out and deliberately gentle: that atlas was
 * exported *with* its colour (R 87 G 107 B 55), so its factor only deepens what
 * is already there instead of colouring a grey.
 */
export const TINTS: Readonly<Record<TintName, Tint>> = {
  'birch-leaf': [0.55, 1, 0.24, 1],
  'birch-leaf-dark': [0.4, 0.78, 0.18, 1],
  broadleaf: [0.46, 0.95, 0.2, 1],
  'maple-leaf': [0.62, 1, 0.2, 1],
  'pine-needle': [0.26, 0.58, 0.24, 1],
  'grass-card': [0.85, 1, 0.6, 1],
  'plant-leaf': [0.44, 0.92, 0.24, 1],
};

/**
 * What kind of thing a material covers. The kind decides the surface, so the
 * table below states the kind and never repeats the same three flags 60 times.
 */
export type MaterialKind =
  | 'leaf'
  | 'grass'
  | 'glass'
  | 'double-sided'
  | 'cloud'
  | 'backdrop'
  | 'self-lit'
  | 'bark'
  | 'atlas'
  | 'other';

/** The surface each kind gets. */
export const SURFACE_BY_KIND: Readonly<Record<MaterialKind, MaterialSurface>> = {
  leaf: CUTOUT,
  grass: CUTOUT,
  glass: CUTOUT,
  'double-sided': CUTOUT,
  cloud: CUTOUT,
  backdrop: BACKDROP,
  'self-lit': EMISSIVE,
  bark: OPAQUE,
  atlas: OPAQUE,
  other: OPAQUE,
};

/** One row of the table: what the material is, in words a reviewer can check. */
export interface MaterialRow {
  readonly kind: MaterialKind;
  /** Plain description of the surface, standing in for the source name. */
  readonly note: string;
  /** The colour the export dropped, when this material is a brightness mask. */
  readonly tint?: TintName;
}

/**
 * The stable key for one source material name.
 *
 * Twelve hex characters of SHA-256 — long enough that the 60 keys below cannot
 * collide by accident, short enough to read in a diff.
 */
export function materialKey(name: string): string {
  return createHash('sha256').update(name, 'utf8').digest('hex').slice(0, 12);
}

/**
 * Every material the export uses, and what it is.
 *
 * The list is the union of the materials found in the scene bundles and those
 * already carried by the models in the store — 58 of them — plus two spellings
 * without their instance number, which a re-export can produce at any time.
 * Instances of one authored material are listed separately rather than folded
 * together by a pattern, so that an instance with different settings has
 * somewhere to go.
 */
export const MATERIAL_ROWS: Readonly<Record<string, MaterialRow>> = {
  // --- leaf --------------------------------------------------------------
  b2c02ca97471: { kind: 'leaf', note: 'birch leaf card, variant 1', tint: 'birch-leaf' },
  fe57438c34bf: { kind: 'leaf', note: 'birch leaf card, variant 2', tint: 'birch-leaf' },
  cd2d33391502: { kind: 'leaf', note: 'birch leaf card, variant 3, dark', tint: 'birch-leaf-dark' },
  ea2af043eb8c: { kind: 'leaf', note: 'birch leaf card, variant 3, dark, snow' },
  '15b59a7c5177': { kind: 'leaf', note: 'broadleaf leaf card, variant 1', tint: 'broadleaf' },
  e69bfc033a92: { kind: 'leaf', note: 'broadleaf leaf card, variant 2', tint: 'broadleaf' },
  '6c95d763e3e7': { kind: 'leaf', note: 'broadleaf leaf card, variant 3', tint: 'broadleaf' },
  f60b61868de0: { kind: 'leaf', note: 'maple leaf card', tint: 'maple-leaf' },
  '60baf15804ad': { kind: 'leaf', note: 'maple leaf card, instance 1', tint: 'maple-leaf' },
  '3204c1689cce': { kind: 'leaf', note: 'pine needle card, variant 1', tint: 'pine-needle' },
  f0a25899c39a: { kind: 'leaf', note: 'pine needle card, variant 2', tint: 'pine-needle' },
  // --- grass -------------------------------------------------------------
  a1b5b4a25daa: { kind: 'grass', note: 'short grass card, 1 instance', tint: 'grass-card' },
  '6fa61097c48b': {
    kind: 'grass',
    note: 'short grass card, low wild instance',
    tint: 'grass-card',
  },
  d8efa434992f: { kind: 'grass', note: 'short plant leaf card', tint: 'plant-leaf' },
  '28d03e41d8dd': { kind: 'grass', note: 'short plant leaf card, 2 variant', tint: 'grass-card' },
  '87d7cbb528de': { kind: 'grass', note: 'short plant leaf card, redblue variant' },
  dc91ba7b27d8: { kind: 'grass', note: 'short plant leaf card, snow variant' },
  ebe5743ecc05: { kind: 'grass', note: 'short plant leaf card, yellow variant' },
  // --- glass -------------------------------------------------------------
  ed4beb4a0f8f: { kind: 'glass', note: 'window glass' },
  // --- double-sided ------------------------------------------------------
  '696cbc98612c': { kind: 'double-sided', note: 'settlement atlas, authored double-sided' },
  // --- cloud -------------------------------------------------------------
  '70fcb7af3ba0': { kind: 'cloud', note: 'cloud card' },
  // --- backdrop ----------------------------------------------------------
  // Written by `pnpm import:backdrop`, so these three names are this
  // repository's own and are spelled out where they are made
  // (`tooling/asset-pipeline/backdrop.ts`) rather than being source names.
  '9b8dc47423d4': { kind: 'backdrop', note: 'painted mountain panorama, snow variant' },
  '8a9237d0efa8': { kind: 'backdrop', note: 'painted mountain panorama, snowless variant' },
  '6712663aedbc': { kind: 'backdrop', note: 'sky dome shell' },
  // --- self-lit ----------------------------------------------------------
  '614bf44e147d': { kind: 'self-lit', note: 'building atlas, self-lit variant' },
  '95f74a3961dd': { kind: 'self-lit', note: 'crystal item' },
  // --- bark --------------------------------------------------------------
  cae3a817bb06: { kind: 'bark', note: 'birch bark' },
  '43587e2626b3': { kind: 'bark', note: 'mixed trunk bark' },
  c41ecbe37729: { kind: 'bark', note: 'oak bark' },
  '1dae02e59b3c': { kind: 'bark', note: 'oak bark, dark instance' },
  // --- atlas -------------------------------------------------------------
  '9bbaded93ab1': { kind: 'atlas', note: 'building atlas' },
  ae2aff3ee0b7: { kind: 'atlas', note: 'building atlas, darkened instance' },
  b950e869e1fe: { kind: 'atlas', note: 'building atlas, instance 2' },
  '56d1c819966f': { kind: 'atlas', note: 'building atlas, instance 2 1' },
  '40e5ccfa665e': { kind: 'atlas', note: 'building atlas, instance 3' },
  '9b0540017f8b': { kind: 'atlas', note: 'building atlas, instance 3 1' },
  '3d5cfdf87c1b': { kind: 'atlas', note: 'building atlas, metal instance 2' },
  aa28d60f9197: { kind: 'atlas', note: 'building atlas, metal instance 5' },
  c6a59465fb27: { kind: 'atlas', note: 'castle wall atlas' },
  a5d51f017740: { kind: 'atlas', note: 'farm atlas' },
  a23f0d988ea1: { kind: 'atlas', note: 'nature atlas' },
  '7431a18b7845': { kind: 'atlas', note: 'settlement atlas' },
  '1bcc8efd1107': { kind: 'atlas', note: 'settlement atlas, dark' },
  c3f7ea8117d8: { kind: 'atlas', note: 'settlement atlas, dark instance 1' },
  e193742147d6: { kind: 'atlas', note: 'settlement atlas, darkened instance 1' },
  e64becce006f: { kind: 'atlas', note: 'settlement atlas, darkened instance 2' },
  dfc7125b7688: { kind: 'atlas', note: 'underground atlas 01' },
  c608cbe1c4ab: { kind: 'atlas', note: 'underground atlas 02' },
  a58af24a45c1: { kind: 'atlas', note: 'underground character atlas' },
  c352383d9bba: { kind: 'atlas', note: 'underground wall texture' },
  // --- other -------------------------------------------------------------
  '7e0df8755082': { kind: 'other', note: 'editor default material' },
  c17454510b43: { kind: 'other', note: 'engraved rune set A' },
  df815f8c3781: { kind: 'other', note: 'engraved rune set D' },
  '586c7fe760c0': { kind: 'other', note: 'engraved rune set P' },
  '2219565ffa60': { kind: 'other', note: 'exporter default material' },
  '2a1a6355ed7e': { kind: 'other', note: 'ice' },
  b2c15737ca31: { kind: 'other', note: 'log spike prop' },
  '032aaf736d0a': { kind: 'other', note: 'mesh effect surface' },
  '6a6ac8386005': { kind: 'other', note: 'one-off creature surface' },
  '9e70a6314092': { kind: 'other', note: 'plain wood block' },
  '922ad94ff9c6': { kind: 'other', note: 'potion item' },
  ba494e629860: { kind: 'other', note: 'ruined house surface' },
  d587e23e3064: { kind: 'other', note: 'unnamed lit surface' },
};

/** What an unlisted material gets, and what the importer reports it as. */
export const UNLISTED_SURFACE = OPAQUE;

/** Whether this material name is one the table has an answer for. */
export function isListedMaterial(name: string): boolean {
  return Object.hasOwn(MATERIAL_ROWS, materialKey(name));
}

/** The surface for one material name; {@link UNLISTED_SURFACE} when unlisted. */
export function surfaceFor(name: string): MaterialSurface {
  const row = MATERIAL_ROWS[materialKey(name)];
  return row === undefined ? UNLISTED_SURFACE : SURFACE_BY_KIND[row.kind];
}

/**
 * The base colour multiplier for one material name, or `undefined` when the
 * material carries its own colour and must keep it.
 *
 * A material the table does not list gets no tint: an unknown name is reported
 * by the importer and drawn as it arrived, never guessed at from its spelling.
 */
export function tintFor(name: string): Tint | undefined {
  const row = MATERIAL_ROWS[materialKey(name)];
  return row?.tint === undefined ? undefined : TINTS[row.tint];
}
