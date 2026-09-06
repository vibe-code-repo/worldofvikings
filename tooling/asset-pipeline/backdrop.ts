/**
 * The painted distance: which files it is made of, and what they become here.
 *
 * A backdrop is the part of the view nobody ever walks to — the mountain range
 * on the horizon, the shell of sky above it, the clouds hanging in front of it.
 * In the source level it is three ordinary meshes standing very far away, and
 * the only thing that makes them special is their size: a range 1 188 m across
 * is not a world object, and every rule this pipeline has about world objects
 * is wrong for it (`environment` collision boxes, an 80 m plausibility limit, a
 * shadow map, fog).
 *
 * So `backdrop` is a category (`@wov/world-schema`), and this module is the
 * data behind it: **which** export files are backdrop, what they are called
 * here, and how one store model is built from a mesh file plus a texture file.
 *
 * **Why the models come from the export and not from the scene bundle.** The
 * bundle has both mountain shells pointing at *one* embedded image, because the
 * exporter wrote the mesh reference and dropped the material that told them
 * apart. The export folder still has both panoramas as separate files, so
 * reading them from there is the difference between two backdrops and one
 * backdrop drawn twice.
 *
 * **Why the names are new ones.** Everything here is renamed on the way in:
 * store paths, node names and material names are this repository's own words
 * (`docs/assets.md`), and the source spelling stays in the manifest's
 * provenance field where an unconfirmed attribution belongs.
 *
 * Deterministic: the same export produces byte-identical store files.
 */
import type { PrefabCategory } from '@wov/world-schema';
import { applySurfaces } from './material-binding.js';
import type { Glb, Gltf } from './glb.js';

/**
 * How large a cut model may be before the scene import calls it a backdrop
 * rather than a world object, in metres.
 *
 * The number that was there before this file existed, and the reason it was
 * there: a bundle contains a sky dome and distance backdrops, and a "barrel"
 * 300 m across is a name that does not mean what it says. It still excludes and
 * still never rescales.
 */
export const WORLD_OBJECT_SIZE_LIMIT = 80;

/**
 * The same limit for a backdrop, in metres.
 *
 * Four kilometres, which is the sky dome (r ≈ 3 204 m as the village places it)
 * with room to spare and still small enough to catch a unit mistake — a shell
 * exported in centimetres would measure 118 km and be reported rather than
 * shipped.
 */
export const BACKDROP_SIZE_LIMIT = 4000;

/**
 * Store file stems this pipeline gives its own backdrops.
 *
 * Everything written by `pnpm import:backdrop` starts with this, which is also
 * how {@link prefabCategoryFromAssetPath} recognises one: a prefix inside the
 * `environment/` folder rather than a folder of its own, because a model may
 * only name a texture with a URI free of `..` and a fourth store folder would
 * mean a fourth copy of the shared textures (ADR-0019).
 */
export const BACKDROP_STEM_PREFIX = 'backdrop-';

/** One backdrop model: what it is made of and what it is called here. */
export interface BackdropModel {
  /** Store file stem, e.g. `backdrop-mountains-snow`. */
  readonly stem: string;
  /** File name in the export's model folder. */
  readonly model: string;
  /** File name in the export's texture folder, painted onto it. */
  readonly texture?: string;
  /** What it is, in words a reviewer can check against a screenshot. */
  readonly note: string;
  /**
   * Bundle node names that mean this model, most specific first.
   *
   * This is the **name list** half of the backdrop rule. The scene import
   * matches a node against store file stems, and these files are not cut from
   * the bundle, so without an alias the shells are two nodes nothing knows and
   * the world file would say the village has no horizon.
   */
  readonly nodes: readonly string[];
}

/**
 * Every backdrop the export has, and what this repository calls it.
 *
 * Three entries, and the third one is not placed by the scene import — see
 * `docs/adr/0031-the-backdrop-is-its-own-prefab-category.md`: the sky dome's
 * material did not survive the export, and this repository already draws a
 * gradient sky of its own (ADR-0024). It is imported so the editor has it and
 * so the decision not to place it is written down instead of being a gap.
 */
export const BACKDROP_MODELS: readonly BackdropModel[] = [
  {
    stem: 'backdrop-mountains-snow',
    model: 'MountainSkybox.glb',
    texture: 'Skybox_Diff.png',
    note: 'painted mountain range, snow on the peaks — the outer of the two shells',
    nodes: ['MountainSkybox'],
  },
  {
    stem: 'backdrop-mountains-clear',
    model: 'MountainSkybox.glb',
    texture: 'Skybox_No_Snow_Diff.png',
    note: 'the same range without snow — the inner, nearer shell',
    nodes: ['MountainSkybox (1)'],
  },
  {
    stem: 'backdrop-sky-dome',
    model: 'SM_Generic_SkyDome_02.glb',
    note: 'sky dome shell; the export carries no material for it',
    nodes: [],
  },
];

/** `backdrop-mountains-snow` → `environment/backdrop-mountains-snow.glb`. */
export function backdropModelPath(stem: string): string {
  return `environment/${stem}.glb`;
}

/** `backdrop-mountains-snow` → `environment/textures/backdrop-mountains-snow.png`. */
export function backdropTexturePath(stem: string): string {
  return `environment/textures/${stem}.png`;
}

/**
 * Whether this store stem or node name is one of the backdrops.
 *
 * Two questions in one, because they have the same answer: a name in
 * {@link BACKDROP_MODELS} and a name carrying {@link BACKDROP_STEM_PREFIX} are
 * both a backdrop, and a caller that only knows one of the two spellings still
 * gets the right answer.
 */
export function isBackdropName(name: string): boolean {
  const stem = name.toLowerCase();
  if (stem.startsWith(BACKDROP_STEM_PREFIX)) {
    return true;
  }
  return BACKDROP_MODELS.some(
    (model) =>
      model.stem === stem || model.nodes.some((node) => node.toLowerCase() === name.toLowerCase()),
  );
}

/**
 * The largest a model cut out of a scene bundle may plausibly be, in metres.
 *
 * The rule the task of lifting the limit asks for, stated as **name list plus
 * category** rather than as a global number: a cut whose name this pipeline
 * knows as a backdrop, or whose prefab the catalogue files under `backdrop`,
 * is measured against {@link BACKDROP_SIZE_LIMIT}; everything else keeps the
 * 80 m limit it had. Raising the number for everyone would have let a
 * mis-exported 100× character prop back in, which is what the limit is for.
 */
export function cutSizeLimit(stem: string, category?: PrefabCategory): number {
  return category === 'backdrop' || isBackdropName(stem)
    ? BACKDROP_SIZE_LIMIT
    : WORLD_OBJECT_SIZE_LIMIT;
}

/**
 * The widest and tallest a backdrop panorama may be, in pixels.
 *
 * Twice the store's usual 2 048 px ceiling on the long side, and the exception
 * is measured rather than granted: this one image is stretched over the whole
 * 360° horizon, so 4 096 px is 11.4 texels per degree, while a 1 920 px viewport
 * at a 60° field of view wants 32. Halving it to 2 048 would put 5.7 texels per
 * degree behind the village — visibly soft on the one surface that fills the
 * top half of every outdoor screenshot. Every other texture in the store covers
 * a few metres of a model and gets nothing from the extra pixels.
 *
 * The height is *not* doubled: the panorama is 2:1, and its vertical half is
 * already 2 048 px over roughly 40° of elevation.
 */
export const PANORAMA_MAX_WIDTH = 4096;
export const PANORAMA_MAX_HEIGHT = 2048;

/** Whether an image may be stored at its full size as a panorama. */
export function fitsPanorama(width: number, height: number): boolean {
  return width <= PANORAMA_MAX_WIDTH && height <= PANORAMA_MAX_HEIGHT;
}

/**
 * Rewrites a source shell into a store model: one material, one texture URI.
 *
 * **No vertex is touched.** Positions, normals, tangents and UVs are the ones
 * the export wrote — the shell's smooth normals are what make a painted range
 * read as distance, and recomputing them would be the same mistake as
 * smoothing a flat-shaded cliff.
 *
 * The material is replaced rather than edited: the source file arrives with the
 * exporter's default material and no texture at all, so there is nothing in it
 * to keep. Its new name is what {@link applySurfaces} looks up in the surface
 * table, which is where `MASK`, `doubleSided` and the metalness fix come from.
 *
 * @param glb the source model, modified in place and returned.
 * @param stem the store stem; the root node, the material and the texture file
 *   all take their name from it, so a file says what it is on its own.
 */
export function buildBackdropModel(glb: Glb, stem: string, texture: string | undefined): Glb {
  const json: Gltf = glb.json;

  json.materials = [{ name: stem, pbrMetallicRoughness: {} }];
  if (texture !== undefined) {
    json.images = [{ uri: texture }];
    json.textures = [{ source: 0 }];
    const pbr = json.materials[0]?.['pbrMetallicRoughness'] as Record<string, unknown>;
    pbr['baseColorTexture'] = { index: 0 };
  } else {
    delete json.images;
    delete json.textures;
  }
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      primitive.material = 0;
    }
  }

  // The store file, its placeholder and the node inside it share one name
  // (ADR-0015), and it is never the source file's name (rule 1 of docs/assets.md).
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? [];
  for (const [index, node] of (json.nodes ?? []).entries()) {
    node.name = roots.includes(index) ? stem : `${stem}-${String(index)}`;
  }

  applySurfaces(json);
  return glb;
}
