/**
 * What the *client* needs to know about an asset: where its bytes are served
 * from, and what to draw instead when they are not there (ADR-0015).
 *
 * This is deliberately not the manifest. The manifest is the full record —
 * hashes, sizes, licences, 470 rows of it, validated with Zod — and the game
 * must not be able to reach it (ADR-0012). The catalog is the two fields
 * loading actually needs, as plain data, so a caller can build one from a
 * manifest in tooling, from a fixture in a test, or by hand.
 */
import type { AssetVisibility } from './asset-facts.js';

/** One asset, as far as loading is concerned. */
export interface AssetCatalogEntry {
  /** Path the asset is requested under, relative to whichever root serves it. */
  readonly path: string;
  readonly visibility: AssetVisibility;
  /**
   * Repository-relative path of the stand-in. Required for a private asset —
   * without it a store that is not reachable means a 404 and nothing else.
   */
  readonly placeholder?: string | undefined;
}

/** A lookup from asset path to what is known about it. */
export interface AssetCatalog {
  lookup(assetPath: string): AssetCatalogEntry | undefined;
}

/**
 * Builds a catalog, rejecting the two shapes that could only fail at runtime:
 * a private asset with no placeholder, and two entries for one path.
 *
 * Both are cheap to check here and expensive to diagnose in a browser, where
 * they show up as a missing prop rather than as a message.
 */
export function createAssetCatalog(entries: readonly AssetCatalogEntry[]): AssetCatalog {
  const byPath = new Map<string, AssetCatalogEntry>();
  for (const entry of entries) {
    if (byPath.has(entry.path)) {
      throw new Error(`asset catalog: duplicate entry for "${entry.path}"`);
    }
    if (entry.visibility === 'private' && (entry.placeholder ?? '') === '') {
      throw new Error(
        `asset catalog: private asset "${entry.path}" has no placeholder — a clone without ` +
          `access to the store would have nothing to load`,
      );
    }
    byPath.set(entry.path, entry);
  }
  return {
    lookup: (assetPath) => byPath.get(assetPath),
  };
}

/** How many assets came from where. See {@link summarizeAssetSources}. */
export interface AssetSourceCounts {
  /** Public assets loaded from `assets/` in this repository. */
  readonly repository: number;
  /** Private assets the store actually served. */
  readonly store: number;
  /** Private assets that fell back to their committed placeholder. */
  readonly placeholder: number;
}

/**
 * The one status line for where assets came from, e.g.
 * `assets: 12 private, 12 placeholder`.
 *
 * It lives here rather than in the game app because the smoke test asserts this
 * exact wording — one spelling, not two that drift apart (same reason as
 * `summarizePlacement`).
 *
 * The first number is how many private assets were asked for, the second how
 * many of them the store could not serve. Both are always printed, zeroes
 * included: a line that says nothing when the store is missing would hide
 * exactly the situation it exists to report.
 */
export function summarizeAssetSources(counts: AssetSourceCounts): string {
  const requested = counts.store + counts.placeholder;
  return `assets: ${String(requested)} private, ${String(counts.placeholder)} placeholder`;
}
