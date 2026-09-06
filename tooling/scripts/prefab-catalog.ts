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
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CURRENT_PREFAB_SCHEMA_VERSION,
  type PrefabCatalog,
  type PrefabCategory,
  type PrefabDefinition,
} from '@wov/world-schema';
import type { AssetEntry } from '@wov/asset-system/manifest';

/** Repository root, resolved from this file so the script is location-safe. */
export const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));

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
 * Export markers the the source project assets carry in their file names.
 * `sm-prop-` and `sm-item-` mark the small, movable things; everything else in
 * `environment/` is scenery.
 */
const PROP_MARKERS = ['sm-prop-', 'sm-item-'];

/** Tokens that say which export a file came from, not what the thing is. */
const NAME_NOISE = new Set(['sm', 'env', 'prop', 'item', 'bld', 'plant']);

/** Whether this manifest entry becomes a prefab. */
export function isPlaceableAsset(entry: AssetEntry): boolean {
  return PLACEABLE_KINDS.has(entry.kind) && !entry.path.startsWith(PLACEHOLDER_PREFIX);
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
 * whether it is a small movable thing (`prop`) or scenery (`environment`).
 * Returns `null` for a folder the importer has no rule for, so a new asset
 * folder fails loudly instead of being filed under a guess.
 */
export function prefabCategoryFromAssetPath(assetPath: string): PrefabCategory | null {
  const [folder = '', ...rest] = assetPath.split('/');
  const fileName = rest.at(-1) ?? '';
  switch (folder) {
    case 'vegetation':
      return 'vegetation';
    case 'terrain':
      return 'terrain';
    case 'environment':
      return PROP_MARKERS.some((marker) => fileName.toLowerCase().startsWith(marker))
        ? 'prop'
        : 'environment';
    default:
      return null;
  }
}

/** Builds one prefab from one manifest entry. */
export function prefabFromAsset(entry: AssetEntry): PrefabDefinition {
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
  };
}

/**
 * The whole generated catalog, sorted by asset path so the file order does not
 * depend on the manifest's order.
 */
export function buildImportedCatalog(assets: readonly AssetEntry[]): PrefabCatalog {
  const placeable = assets.filter(isPlaceableAsset);
  const sorted = [...placeable].sort((left, right) => left.path.localeCompare(right.path, 'en'));

  const prefabs: PrefabDefinition[] = [];
  const seen = new Map<string, string>();
  for (const entry of sorted) {
    const prefab = prefabFromAsset(entry);
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
