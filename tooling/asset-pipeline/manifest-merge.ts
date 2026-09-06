/**
 * Merging a manifest that no single importer owns.
 *
 * `assets/manifest.json` is written by three commands — `import:world-assets`,
 * `import:scene-models` and the terrain step — over one shared private store.
 * Each of them owns some rows and must leave the rest alone. Getting that wrong
 * is not a cosmetic problem: an importer that deletes another one's rows silently
 * shrinks the prefab catalogue the world file references, and the next world
 * import then writes a world with a quarter of its entities missing.
 *
 * The rule, in one sentence: **a row is the manifest's until this run produces
 * it; a private row nobody produced survives exactly as long as its file is
 * still in the store.**
 *
 * That makes the store a second source of truth next to the manifest, which is
 * what an importer needs in order to be idempotent over a *persistent* store —
 * the store is not rebuilt from scratch per run, so "I did not produce this row"
 * cannot mean "this asset is gone". Pruning the store is how an asset leaves;
 * `validate:assets` already tolerates store files the manifest does not name, so
 * the two directions stay consistent.
 */
import type { AssetEntry } from '@wov/asset-system/manifest';

export interface MergedManifest {
  /** Every row the manifest should now carry, sorted by path. */
  assets: AssetEntry[];
  /** Private paths kept because the store still holds them, sorted. */
  carriedOver: string[];
  /** Private paths dropped because the store no longer holds them, sorted. */
  dropped: string[];
}

/**
 * Merges what a run produced into the manifest it found.
 *
 * @param existing  the manifest's rows as they were read.
 * @param produced  the rows this run owns; they replace same-path rows.
 * @param storeHas  whether the private store still holds a path. A dry run may
 *                  pass a store that holds nothing this run would have written —
 *                  produced rows are never tested against it, only inherited ones.
 */
export function mergeOwnedEntries(
  existing: readonly AssetEntry[],
  produced: readonly AssetEntry[],
  storeHas: (path: string) => boolean,
): MergedManifest {
  const owned = new Map(produced.map((entry) => [entry.path, entry]));
  const kept: AssetEntry[] = [];
  const carriedOver: string[] = [];
  const dropped: string[] = [];

  for (const entry of existing) {
    if (owned.has(entry.path)) {
      continue;
    }
    if (entry.visibility === 'public') {
      kept.push(entry);
      continue;
    }
    if (storeHas(entry.path)) {
      kept.push(entry);
      carriedOver.push(entry.path);
    } else {
      dropped.push(entry.path);
    }
  }

  const byPath = (a: { path: string }, b: { path: string }): number =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

  return {
    assets: [...kept, ...owned.values()].sort(byPath),
    carriedOver: carriedOver.sort(),
    dropped: dropped.sort(),
  };
}
