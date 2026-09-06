/**
 * Which files of the source export are world-building assets, what they are
 * called here, and what is honestly known about where they came from.
 *
 * Pure and file-system-free on purpose: "is this a world-building asset" is the
 * judgement in this pipeline most likely to be wrong, and it should be arguable
 * against a test rather than against a 3 GB directory.
 *
 * The source is a modelling export: one GLB per model, PNG textures, laid out
 * in three folders that matter here (see ADR-0015):
 *
 * | Folder                   | Holds                                    | Kind      |
 * | ------------------------ | ---------------------------------------- | --------- |
 * | `Mesh/`                  | single models, `SM_*` and trees           | `mesh`    |
 * | `PrefabHierarchyObject/` | authored hierarchies, mostly vegetation   | `prefab`  |
 * | `TerrainData/`           | height fields                             | `terrain` |
 */
import type { AssetKind } from '@wov/asset-system/manifest';
import type { Bounds } from './glb.js';

/** The three groups the store is organised into. */
export const ASSET_GROUPS = ['environment', 'vegetation', 'terrain'] as const;
export type AssetGroup = (typeof ASSET_GROUPS)[number];

/** What is known about the pack a file belongs to. */
export interface PackProvenance {
  readonly source: string;
  readonly author: string;
}

/**
 * The three sets the private collection is made of.
 *
 * Two of them are third-party commercial packs whose paperwork is not in hand.
 * The collection carries no licence file, no credits and no README, so no
 * attribution can be asserted from the files alone: they are recorded as
 * unconfirmed rather than filed under a name that would be a guess, and
 * everything imported stays `NOASSERTION` and not redistributable until a
 * person establishes otherwise.
 *
 * The two model sets are told apart by what is measurably in the files. The
 * `SM_*` family is flat-shaded, a few hundred triangles, palette-textured; the
 * tree and bush families are 14k–28k triangles with 1024 px photographic
 * leaves. Different sets, so their licence questions are answered separately.
 *
 * The terrain set is this project's own work and is attributed as such.
 */
export const ENVIRONMENT_SET: PackProvenance = {
  source: 'private asset collection — environment set',
  author: 'unconfirmed — third-party commercial pack, licence review open',
};

export const VEGETATION_SET: PackProvenance = {
  source: 'private asset collection — vegetation set',
  author: 'unconfirmed — third-party commercial pack, licence review open',
};

export const TERRAIN_SET: PackProvenance = {
  source: 'private asset collection — terrain set',
  author: 'World of Vikings project',
};

/** Vegetation by name, in both source folders. */
const VEGETATION = /^(tree_|pine_|bush_|grass|massive_tree|split_tree|branched_tree|sm_plant_)/i;

/** Environment by name: scenery, buildings, props and hand-held items. */
const ENVIRONMENT = /^sm_(env|bld|prop|item)_/i;

/**
 * Everything that is explicitly *not* world-building, listed so the exclusion is
 * a decision rather than a gap: characters, weapons, vehicles and the sky dome.
 */
const NOT_WORLD_BUILDING = /^sm_(chr|wep|veh|generic)_/i;

/** A file that was taken, and everything the manifest needs to say about it. */
export interface Selection {
  readonly id: string;
  readonly group: AssetGroup;
  readonly kind: AssetKind;
  /** Path inside the store, e.g. `vegetation/pine-1b1.glb`. */
  readonly path: string;
  readonly provenance: PackProvenance;
  /** Largest plausible extent in metres for this group; see {@link sizeLimitFor}. */
  readonly sizeLimit: number;
}

/** A file that was left behind, and why. */
export interface Rejection {
  readonly file: string;
  readonly reason: string;
}

/**
 * Lower-cases and kebab-cases one name.
 *
 * Deliberately identical in effect to `assetIdFromPath` in
 * `@wov/asset-system/manifest`, which is asserted by a test: the id in the
 * manifest and the file name in the store have to agree, and they are computed
 * in two places because one of them must not import Zod.
 */
export function toKebab(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The largest extent, in metres, that is still plausible for this group.
 *
 * Used to *exclude*, never to rescale. The source
 * is measurably in metres, so a model far outside its group's range is not a
 * unit problem to be divided away — it is something that is not what its name
 * says. The clearest case is the `SM_Item_` group: hand props measure 0.02–1.1 m,
 * but a dozen of them (`SM_Item_Goblin_WarBanner`, `SM_Item_Sword`, …) measure
 * 15–156 m because they were exported inside a 100× character rig. Guessing a
 * scale factor for those would silently ship a wrong-sized prop; leaving them
 * out names them in the report instead.
 */
export function sizeLimitFor(group: AssetGroup, fileName: string): number {
  if (/^sm_item_/i.test(fileName)) {
    return 20;
  }
  switch (group) {
    case 'terrain':
      return 4000;
    case 'vegetation':
      return 80;
    case 'environment':
      return 80;
  }
}

/**
 * How far to move an asset's origin, per group — the translation to apply.
 *
 * **Meshes and prefabs are not moved at all.** That is the opposite of what
 * "normalise the origin" usually means, and it is what the source measures to.
 * These are authored models, not raw scans, and their origins carry
 * intent: 79 of 96 vegetation models and 180 of 359 environment models place
 * geometry *below* `y=0` on purpose, because the origin is the ground-contact
 * point and roots, rock bases and post footings are meant to sit in the soil.
 * Snapping those to the hull's base would lift every tree and half the rocks
 * out of the ground. On x and z the same holds for a different reason: a wall
 * or stair module anchored at its corner rotates correctly about that corner,
 * and re-centring it would break kit-bashing.
 *
 * **Terrain is moved on x and z.** All twelve height fields are authored
 * with the origin at a corner, the surface spanning `0..200`, and
 * none of them is centred. That is a container artefact rather than an authored
 * anchor, so a terrain tile is centred and can be placed by its middle. Their
 * `y` is already zero-based in all twelve and is left alone.
 *
 * The rule is measured, not assumed, and the measurement is what changed it:
 * the first version of this pipeline snapped every origin to the hull base
 * before the numbers above were counted.
 */
export function originShiftFor(group: AssetGroup, bounds: Bounds): [number, number, number] {
  if (group !== 'terrain') {
    return [0, 0, 0];
  }
  return [-(bounds.min[0] + bounds.max[0]) / 2, 0, -(bounds.min[2] + bounds.max[2]) / 2];
}

/** One folder of the source export, and what it means. */
export interface SourceFolder {
  readonly folder: string;
  readonly kind: AssetKind;
}

/**
 * The source folders, **in priority order**.
 *
 * Prefabs come first because many models appear in both folders under the same
 * name, and the two are not equivalent: `Mesh/Tree_1A3.glb` is 188 kB of
 * geometry with a single `DefaultMaterial` and no texture at all, while
 * `PrefabHierarchyObject/Tree_1A3.glb` is the same tree with `Birch_Bark_A`,
 * `Leaves Birch 1` and both textures embedded. Taking the first file found
 * would import 31 untextured duplicates and silently discard the authored ones.
 */
export const SOURCE_FOLDERS: readonly SourceFolder[] = [
  { folder: 'PrefabHierarchyObject', kind: 'prefab' },
  { folder: 'Mesh', kind: 'mesh' },
  { folder: 'TerrainData', kind: 'terrain' },
];

/**
 * The folder of the export that holds the assembled scenes.
 *
 * Not a source of models — nothing is imported *from* it. It is where the
 * material assignment lives that the per-model files dropped, which is why the
 * pipeline reads it at all (`scene-bindings.ts`).
 */
export const SCENE_BUNDLE_FOLDER = 'SceneHierarchyObject';

/**
 * Decides whether one exported file is a world-building asset, and what to call
 * it here.
 *
 * @param folder the source folder, e.g. `PrefabHierarchyObject`.
 * @param fileName the file name including its `.glb` extension.
 */
export function select(folder: string, fileName: string): Selection | Rejection {
  const file = `${folder}/${fileName}`;
  if (!/\.glb$/i.test(fileName)) {
    return { file, reason: 'not a GLB' };
  }
  const stem = fileName.replace(/\.glb$/i, '');

  const kind = SOURCE_FOLDERS.find((source) => source.folder === folder)?.kind;
  if (kind === undefined) {
    return { file, reason: `folder "${folder}" holds nothing world-building` };
  }

  let group: AssetGroup;
  let provenance: PackProvenance;

  if (kind === 'terrain') {
    group = 'terrain';
    provenance = TERRAIN_SET;
  } else if (NOT_WORLD_BUILDING.test(stem)) {
    return { file, reason: 'character, weapon, vehicle or sky geometry, not world building' };
  } else if (VEGETATION.test(stem)) {
    group = 'vegetation';
    // Set membership follows the model, not the folder: `SM_Plant_*` is
    // flat-shaded and belongs to the environment set even though it is planted
    // as vegetation, while the named tree and bush families do not.
    provenance = /^sm_plant_/i.test(stem) ? ENVIRONMENT_SET : VEGETATION_SET;
  } else if (ENVIRONMENT.test(stem)) {
    group = 'environment';
    provenance = ENVIRONMENT_SET;
  } else {
    return { file, reason: 'name matches no world-building family' };
  }

  const name = toKebab(stem);
  return {
    id: `${group}/${name}`,
    group,
    kind,
    path: `${group}/${name}.glb`,
    provenance,
    sizeLimit: sizeLimitFor(group, stem),
  };
}

/** Narrows the result of {@link select}. */
export function isSelection(result: Selection | Rejection): result is Selection {
  return 'id' in result;
}
