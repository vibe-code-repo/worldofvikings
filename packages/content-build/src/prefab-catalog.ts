/**
 * Turns the asset manifest into a prefab catalog (ADR-0016).
 *
 * This is a **data import**, not a world generator: it runs when assets change,
 * its result is committed as `content/prefabs/imported.json`, and the game and
 * the editor only ever read that file. Nothing here decides where anything
 * stands in the world — that stays authored (agent rules 16 and 17).
 *
 * Every decision below is a pure function of the manifest, so two runs on the
 * same manifest produce byte-identical output and a diff means the assets
 * changed.
 */
import {
  CURRENT_PREFAB_SCHEMA_VERSION,
  type PrefabCatalog,
  type PrefabCategory,
  type PrefabCollision,
  type PrefabDefinition,
} from '@wov/world-schema';
import type { AssetEntry } from '@wov/asset-system/manifest';
import { BACKDROP_STEM_PREFIX } from './backdrop.js';
import type { Bounds } from './glb.js';

/** Catalog id and file name (`content/prefabs/imported.json`). */
export const IMPORTED_CATALOG_ID = 'imported';

/**
 * Asset kinds that can be placed in the world. `texture` is not one of them,
 * and neither is a placeholder box: a placeholder is what a private prefab
 * falls back to, never a prefab of its own (ADR-0015).
 */
const PLACEABLE_KINDS: ReadonlySet<string> = new Set(['mesh', 'prefab', 'terrain']);
const PLACEHOLDER_PREFIX = 'placeholders/';

/**
 * Markers the imported model files carry in their names.
 * `sm-prop-` and `sm-item-` mark the small, movable things; everything else in
 * `environment/` is scenery.
 */
const PROP_MARKERS = ['sm-prop-', 'sm-item-'];

/** Tokens that say which export a file came from, not what the thing is. */
const NAME_NOISE = new Set(['sm', 'env', 'prop', 'item', 'bld', 'plant']);

/**
 * The suffix a hand-made, low-triangle collider file carries.
 *
 * Twelve models in the export come with one — the buildings you can walk into,
 * whose real geometry is far too heavy to collide against and whose hull would
 * seal the door shut. The file is a collider, never a placeable thing, so it is
 * attached to the model it belongs to and is not a prefab of its own.
 */
const COLLIDER_SUFFIX = '-collision';

/**
 * Vegetation whose *trunk* is what stops the player.
 *
 * Everything else in `vegetation/` — bushes, grass, ferns, mushrooms, loose
 * branches — is walked through, which is both what a player expects and what
 * keeps a meadow from costing a thousand collision shapes.
 */
const TRUNK_MARKERS = ['tree', 'pine'];

/**
 * Names that mark a hole the player walks through.
 *
 * These are the only models that get `mesh` without bringing their own collider
 * file: a box or a convex hull would brick up the opening, which is the one
 * mistake a screenshot does not show. The list is short because the export
 * contains one such model; it grows with the assets, not with a guess.
 */
const OPENING_MARKERS = ['archway', 'arch', 'gateway', 'portal'];

/** Whether this manifest entry becomes a prefab. */
export function isPlaceableAsset(entry: AssetEntry): boolean {
  return (
    PLACEABLE_KINDS.has(entry.kind) &&
    !entry.path.startsWith(PLACEHOLDER_PREFIX) &&
    !isColliderAsset(entry.path)
  );
}

/** Whether this path is a collider file rather than something to place. */
export function isColliderAsset(assetPath: string): boolean {
  return stemOf(assetPath).endsWith(COLLIDER_SUFFIX);
}

/** `environment/x.glb` → `environment/x-collision.glb`. */
export function colliderPathFor(assetPath: string): string {
  const dot = assetPath.lastIndexOf('.');
  return dot < 0
    ? `${assetPath}${COLLIDER_SUFFIX}`
    : `${assetPath.slice(0, dot)}${COLLIDER_SUFFIX}${assetPath.slice(dot)}`;
}

/** The lower-case file name of a path, without its folder or its extension. */
function stemOf(assetPath: string): string {
  const fileName = assetPath.split('/').at(-1) ?? assetPath;
  return fileName.replace(/\.[^./]+$/, '').toLowerCase();
}

/** The `-` separated words of a file name, for the marker lists above. */
function tokensOf(assetPath: string): ReadonlySet<string> {
  return new Set(
    stemOf(assetPath)
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
}

/** Whether this model's collision shape is its trunk rather than its hull. */
export function hasTrunk(assetPath: string): boolean {
  const tokens = tokensOf(assetPath);
  return TRUNK_MARKERS.some((marker) => tokens.has(marker));
}

/**
 * The collision shape this asset gets by default (ADR-0026).
 *
 * Every branch is a rule about a *category*, never about one file, so the
 * catalogue can be regenerated after an import without anyone re-deciding
 * anything:
 *
 * - a model with its own collider file collides against that file's triangles;
 * - `terrain` is the ground and needs every triangle of it;
 * - a `vegetation` model with a trunk gets a narrow box around the **trunk**,
 *   measured on the model — its hull is its crown, and a wood of crowns is a
 *   wall;
 * - the rest of `vegetation` is walked through;
 * - a model named as an opening gets `mesh`, because a box fills the opening;
 * - everything else is its hull as one box, which is one plane test per face
 *   and the right answer for a crate, a wall segment or a sack.
 *
 * @param trunkBox the measured trunk, for a model that needs one. Absent for a
 * model that does not; absent *for one that does* is an error the caller
 * reports, because falling back to the crown is the exact bug this rule exists
 * to prevent.
 */
export function prefabCollisionFor(
  entry: AssetEntry,
  category: PrefabCategory,
  collider: AssetEntry | undefined,
  trunkBox: Bounds | undefined,
): PrefabCollision {
  if (collider !== undefined) {
    return {
      kind: 'mesh',
      asset: {
        path: collider.path,
        visibility: collider.visibility,
        ...(collider.placeholder === undefined ? {} : { placeholder: collider.placeholder }),
      },
    };
  }
  // Nothing can reach a backdrop: the mountain shells stand 430 m beyond the
  // last metre of ground. A shape for one is therefore a shape nothing will
  // ever touch — and a hull box around a 1 188 m shell is a box that contains
  // the entire world, which is the one wrong answer with consequences.
  if (category === 'backdrop') {
    return { kind: 'none' };
  }
  if (category === 'terrain') {
    return { kind: 'mesh' };
  }
  if (category === 'vegetation') {
    if (!hasTrunk(entry.path)) {
      return { kind: 'none' };
    }
    if (trunkBox === undefined) {
      throw new Error(
        `no trunk measured for "${entry.path}" — run generate:prefabs with --store so the ` +
          'trunk can be measured on the model instead of guessed from its crown',
      );
    }
    return { kind: 'box', box: trunkBox };
  }
  const tokens = tokensOf(entry.path);
  if (OPENING_MARKERS.some((marker) => tokens.has(marker))) {
    return { kind: 'mesh' };
  }
  return { kind: 'box' };
}

/**
 * `vegetation/pine-1b1.glb` → `vegetation-pine-1b1`.
 *
 * The whole path is folded in, because the file name alone is not unique across
 * folders, and every character outside `a-z0-9` becomes `-` so the result always
 * satisfies the world schema's identifier rule.
 */
export function prefabIdFromAssetPath(assetPath: string): string {
  const withoutExtension = assetPath.replace(/\.[^./]+$/, '');
  return withoutExtension
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * `environment/sm-prop-barrel-01.glb` → `Barrel 01`.
 *
 * The label a human reads in the hierarchy and the asset browser: file name
 * only, export markers dropped, words capitalised. Names are not unique and do
 * not have to be — the id is.
 */
export function prefabNameFromAssetPath(assetPath: string): string {
  const fileName = assetPath.split('/').at(-1) ?? assetPath;
  const tokens = prefabIdFromAssetPath(fileName).split('-').filter(Boolean);
  const meaningful = dropLeadingNoise(tokens);
  const words = (meaningful.length > 0 ? meaningful : tokens).map(capitalize);
  return words.join(' ');
}

/**
 * Which group the editor's asset browser shows this prefab in.
 *
 * The folder decides, except inside `environment/`, where the file name says
 * whether it is painted distance (`backdrop`), a small movable thing (`prop`)
 * or scenery (`environment`). Returns `null` for a folder the importer has no
 * rule for, so a new asset folder fails loudly instead of being filed under a
 * guess.
 *
 * Backdrop is asked first and it is asked in two ways, because two kinds of
 * file arrive under that name. The models `pnpm import:backdrop` writes carry
 * {@link BACKDROP_STEM_PREFIX}, which is this repository's own naming and is
 * therefore reliable. The clouds do not: they were cut out of the scene bundle
 * long before this category existed and are named as props. A cloud is not a
 * prop — nobody picks one up, nobody walks into one, and it hangs a hundred
 * metres above the village — so it is recognised by the one word in its name
 * that says what it is. Renaming those files instead would change their prefab
 * ids, and a prefab id is what 23 entities in `content/worlds/village1.json`
 * point at.
 */
export function prefabCategoryFromAssetPath(assetPath: string): PrefabCategory | null {
  const [folder = '', ...rest] = assetPath.split('/');
  const fileName = (rest.at(-1) ?? '').toLowerCase();
  switch (folder) {
    case 'vegetation':
      return 'vegetation';
    case 'terrain':
      return 'terrain';
    case 'environment':
      if (fileName.startsWith(BACKDROP_STEM_PREFIX) || tokensOf(fileName).has('cloud')) {
        return 'backdrop';
      }
      return PROP_MARKERS.some((marker) => fileName.startsWith(marker)) ? 'prop' : 'environment';
    default:
      return null;
  }
}

/** What `buildImportedCatalog` needs besides the manifest. */
export interface CatalogInputs {
  /**
   * Trunk boxes by asset path, measured on the model by the caller.
   *
   * Passed in rather than measured here so this module stays a pure function of
   * its arguments: the same manifest and the same measurements produce the same
   * file on every machine, and the measuring — which reads the private store —
   * is the command's business, not the catalogue's.
   */
  readonly trunkBoxes?: ReadonlyMap<string, Bounds>;
}

/** Builds one prefab from one manifest entry. */
export function prefabFromAsset(
  entry: AssetEntry,
  collider?: AssetEntry,
  trunkBox?: Bounds,
): PrefabDefinition {
  const category = prefabCategoryFromAssetPath(entry.path);
  if (category === null) {
    throw new Error(
      `no prefab category for "${entry.path}" — add a rule in tooling/scripts/prefab-catalog.ts`,
    );
  }

  return {
    id: prefabIdFromAssetPath(entry.path),
    name: prefabNameFromAssetPath(entry.path),
    asset: entry.path,
    visibility: entry.visibility,
    // Optional fields are only present when the manifest has them: an absent
    // placeholder on a public asset is meaningful, `undefined` is not.
    ...(entry.placeholder === undefined ? {} : { placeholder: entry.placeholder }),
    category,
    ...(entry.bounds === undefined ? {} : { bounds: entry.bounds }),
    collision: prefabCollisionFor(entry, category, collider, trunkBox),
  };
}

/**
 * The whole generated catalog, sorted by asset path so the file order does not
 * depend on the manifest's order.
 */
export function buildImportedCatalog(
  assets: readonly AssetEntry[],
  inputs: CatalogInputs = {},
): PrefabCatalog {
  const colliders = new Map<string, AssetEntry>();
  for (const entry of assets) {
    if (isColliderAsset(entry.path) && !entry.path.startsWith(PLACEHOLDER_PREFIX)) {
      colliders.set(entry.path, entry);
    }
  }

  const placeable = assets.filter(isPlaceableAsset);
  const sorted = [...placeable].sort((left, right) => left.path.localeCompare(right.path, 'en'));

  const prefabs: PrefabDefinition[] = [];
  const seen = new Map<string, string>();
  for (const entry of sorted) {
    const prefab = prefabFromAsset(
      entry,
      colliders.get(colliderPathFor(entry.path)),
      inputs.trunkBoxes?.get(entry.path),
    );
    const previous = seen.get(prefab.id);
    if (previous !== undefined) {
      throw new Error(
        `prefab id "${prefab.id}" would be used by both "${previous}" and "${entry.path}"`,
      );
    }
    seen.set(prefab.id, entry.path);
    prefabs.push(prefab);
  }

  return {
    schemaVersion: CURRENT_PREFAB_SCHEMA_VERSION,
    id: IMPORTED_CATALOG_ID,
    prefabs,
  };
}

function dropLeadingNoise(tokens: readonly string[]): string[] {
  let index = 0;
  while (index < tokens.length && NAME_NOISE.has(tokens[index] ?? '')) {
    index += 1;
  }
  return tokens.slice(index);
}

function capitalize(token: string): string {
  return token.charAt(0).toUpperCase() + token.slice(1);
}
