/**
 * The painted distance: which files it is made of, and what it is called here.
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
 * here, which bundle nodes mean them, and how large one may plausibly be.
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
 * This module is the **identity** half — the names, the node aliases and the
 * size limits. It lives in this package rather than next to the importer
 * because the scene import needs the same answers, and that import runs from
 * `pnpm import:scene` *and* from the editor's *World ▸ Import scene bundle…*
 * (ADR-0033). The half that rewrites GLB bytes stays in
 * `tooling/asset-pipeline/backdrop.ts`, which only the command line runs.
 */
import type { PrefabCategory } from '@wov/world-schema';

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
 * Whether a bundle node must **not** be cut into a store model.
 *
 * A backdrop must not. It comes from the modelling export, where each shell is
 * its own file beside its own panorama; inside the scene bundle both shells are
 * one mesh pointing at one embedded image, because the exporter dropped the
 * material that told them apart (ADR-0031). So cutting one out of the bundle
 * yields one backdrop where the world needs two, painted with whichever of the
 * two panoramas happened to be embedded — and it lands in the store under a
 * name folded from the source spelling, which rule 1 of `docs/assets.md` does
 * not allow.
 *
 * This replaced a raised size limit. Lifting the 80 m plausibility ceiling for
 * a backdrop let one *through* the gate that was keeping it out, so running the
 * documented import chain end to end wrote a 594 m shell into the store and a
 * source-spelled id into the manifest and the prefab catalogue. The limit was
 * never what placed the shells either — the scene import finds them by node
 * alias (`withBackdropAliases`), and it applies no size limit at all.
 *
 * Name list plus category, the two halves independent: a node this pipeline
 * knows as a backdrop, or one whose prefab the catalogue already files under
 * `backdrop`, is left to `pnpm import:backdrop`.
 */
export function skipsBundleCut(stem: string, category?: PrefabCategory): boolean {
  return category === 'backdrop' || isBackdropName(stem);
}
