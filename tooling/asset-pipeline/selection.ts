/**
 * Which files of the source export are world-building assets, what they are
 * called here, and what is honestly known about where they came from.
 *
 * Pure and file-system-free on purpose: "is this a world-building asset" is the
 * judgement in this pipeline most likely to be wrong, and it should be arguable
 * against a test rather than against a 3 GB directory.
 *
 * The source is an the export tool export of the earlier _the source project_
 * project. Three of its folders matter (see ADR-0015):
 *
 * | Folder                   | Holds                                    | Kind      |
 * | ------------------------ | ---------------------------------------- | --------- |
 * | `Mesh/`                  | single exported models, `SM_*` and trees  | `mesh`    |
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
 * Two packs, told apart by name and corroborated by what is inside the files.
 *
 * The export carries no licence, no credits and no README, so provenance had to
 * be read off the assets themselves. Two independent traces point at third-party
 * Studios for the flat-shaded `SM_*` family: shader names
 * (`Vendor_VegitationShader`, `Vendor_WaterShader`,
 * `Shader Graphs_POLYGON_CustomCharacters_URP`) and, more specifically, the
 * material names inside the prefabs — `atlas-a_Mat_01_A`,
 * `atlas-b_Material_01`, `atlas-c_01`, `atlas-e_01` — which
 * name four separate POLYGON packs.
 *
 * The tree and leaf materials carry no such marking (`Oak_Bark_A`,
 * `Leaves Birch 1`, `Pine 1`, `Trunks`) and the geometry contradicts the look
 * entirely: 14k–28k triangles against third-party's usual few hundred, 1024 px
 * photographic leaves against a flat palette. They are recorded as a second,
 * unidentified pack rather than filed under a name that would be a guess.
 *
 * Both attributions are marked unconfirmed, and everything imported is
 * `NOASSERTION` and not redistributable until a person checks.
 */
/** How the export is named in every provenance line this pipeline writes. */
const EXPORT_NAME = 'the export tool export of the source project';

export const ENVIRONMENT_FAMILY: PackProvenance = {
  source:
    'the source project — a third-party vendor POLYGON packs (material names atlas-a, ' +
    'atlas-b, atlas-c, atlas-e; unconfirmed)',
  author: 'a third-party vendor (unconfirmed)',
};

export const REALISTIC_VEGETATION: PackProvenance = {
  source:
    'the source project — unidentified realistic vegetation pack (no vendor marking in any ' +
    'material or texture name)',
  author: 'unknown',
};

export const PROJECT_TERRAIN: PackProvenance = {
  source: 'the source project — project terrain data',
  author: 'the source project project',
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
  /** Where this came from, concretely enough to find it again. */
  readonly origin: string;
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
 * Used to *exclude*, never to rescale. the source engine's unit is a metre and this export
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
 * These are authored the source engine prefabs, not raw scans, and their origins carry
 * intent: 79 of 96 vegetation models and 180 of 359 environment models place
 * geometry *below* `y=0` on purpose, because the origin is the ground-contact
 * point and roots, rock bases and post footings are meant to sit in the soil.
 * Snapping those to the hull's base would lift every tree and half the rocks
 * out of the ground. On x and z the same holds for a different reason: a wall
 * or stair module anchored at its corner rotates correctly about that corner,
 * and re-centring it would break kit-bashing.
 *
 * **Terrain is moved on x and z.** All twelve height fields carry the source engine's
 * terrain-container origin — a corner, with the surface spanning `0..200` — and
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

/** One source folder of the export, and what it means. */
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
 * The one sentence that says where a file came from.
 *
 * Composed in one place so every manifest entry this pipeline writes — models,
 * extracted textures, textures taken from a scene bundle — words its provenance
 * identically, and so that changing the wording is one edit rather than four.
 */
export function originFor(file: string): string {
  return `${EXPORT_NAME}, ${file}`;
}

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
    provenance = PROJECT_TERRAIN;
  } else if (NOT_WORLD_BUILDING.test(stem)) {
    return { file, reason: 'character, weapon, vehicle or sky geometry, not world building' };
  } else if (VEGETATION.test(stem)) {
    group = 'vegetation';
    // `SM_Plant_*` is flat-shaded and belongs to the low-poly family; the named
    // tree and bush families do not, whatever folder they sit in.
    provenance = /^sm_plant_/i.test(stem) ? ENVIRONMENT_FAMILY : REALISTIC_VEGETATION;
  } else if (ENVIRONMENT.test(stem)) {
    group = 'environment';
    provenance = ENVIRONMENT_FAMILY;
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
    origin: originFor(file),
    sizeLimit: sizeLimitFor(group, stem),
  };
}

/** Narrows the result of {@link select}. */
export function isSelection(result: Selection | Rejection): result is Selection {
  return 'id' in result;
}
