/**
 * The prefab catalogue, indexed the two ways the editor reads it: by id (the
 * viewport, resolving `EntityDefinition.prefab`) and by category (the asset
 * browser's tabs, spec §13).
 *
 * It also builds the `AssetCatalog` the loader needs. That is a separate shape
 * on purpose: a prefab is a *design* decision (name, category, default scale),
 * an asset catalog entry is a *delivery* one (repository or private store, and
 * what to draw instead — ADR-0015). Several prefabs may name the same GLB, so
 * the catalog is keyed by asset path and deduplicated here rather than
 * throwing inside `createAssetCatalog`.
 */
import { createAssetCatalog, type AssetCatalog, type AssetCatalogEntry } from '@wov/asset-system';
import type { PrefabCategory } from '@wov/world-schema';
import type { CatalogedPrefab } from '../api/client.js';

export interface PrefabIndex {
  /** The prefab with this id, or `undefined` for a dangling reference. */
  get(prefabId: string): CatalogedPrefab | undefined;
  /** Every prefab, sorted by name so the browser is stable between reloads. */
  all(): readonly CatalogedPrefab[];
  /** The categories that actually carry prefabs, in the schema's own order. */
  categories(): readonly PrefabCategory[];
  /** Everything in one category. */
  inCategory(category: PrefabCategory): readonly CatalogedPrefab[];
  /** Where each prefab's bytes come from, for the {@link AssetManager}. */
  readonly assets: AssetCatalog;
}

/** The order the asset browser shows its tabs in: broad scenery first. */
const CATEGORY_ORDER: readonly PrefabCategory[] = [
  'environment',
  'vegetation',
  'terrain',
  'prop',
  'dungeon',
];

export function createPrefabIndex(prefabs: readonly CatalogedPrefab[]): PrefabIndex {
  const byId = new Map<string, CatalogedPrefab>();
  const byAsset = new Map<string, AssetCatalogEntry>();

  for (const prefab of prefabs) {
    // The API already reports duplicate ids as a clash and keeps the first; a
    // second guard here would hide that report rather than add to it.
    byId.set(prefab.id, prefab);
    if (!byAsset.has(prefab.asset)) {
      byAsset.set(prefab.asset, {
        path: prefab.asset,
        visibility: prefab.visibility,
        placeholder: prefab.placeholder,
      });
    }
  }

  const sorted = [...byId.values()].sort((left, right) =>
    left.name.localeCompare(right.name, 'en'),
  );
  const categories = CATEGORY_ORDER.filter((category) =>
    sorted.some((prefab) => prefab.category === category),
  );

  return {
    get: (prefabId) => byId.get(prefabId),
    all: () => sorted,
    categories: () => categories,
    inCategory: (category) => sorted.filter((prefab) => prefab.category === category),
    assets: createAssetCatalog([...byAsset.values()]),
  };
}

/** A readable size for the asset browser, e.g. `2.4 × 3.1 × 2.4 m`. */
export function formatBounds(prefab: CatalogedPrefab): string {
  const bounds = prefab.bounds;
  if (bounds === undefined) {
    return 'size unknown';
  }
  const extent = (axis: 0 | 1 | 2): string =>
    (bounds.max[axis] - bounds.min[axis]).toFixed(1).replace(/\.0$/, '');
  return `${extent(0)} × ${extent(1)} × ${extent(2)} m`;
}
