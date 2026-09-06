import type { AssetContainer, InstantiatedEntries } from '@babylonjs/core/assetContainer.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { AssetCatalog, AssetSourceCounts } from './asset-catalog.js';
import type { GlbLoader } from './glb-loader.js';
import type { AssetSourceConfig } from './url.js';
import { assetStoreUrl, assetUrl, normalizeAssetPath } from './url.js';

/** How to build an {@link AssetManager}. */
export interface AssetManagerOptions {
  /** Where assets are served from — see `resolveAssetSourceConfig`. */
  readonly source: AssetSourceConfig;
  /** The scene loaded containers belong to. */
  readonly scene: Scene;
  /**
   * Loader to use. Defaults to the Babylon.js glTF loader, imported on first
   * use so that importing this package costs nothing until an asset is needed.
   */
  readonly loadContainer?: GlbLoader;
  /**
   * Which assets live in the private store and what to draw instead when it is
   * not reachable (ADR-0015). Without one, every path is loaded from `assets/`
   * — which is exactly how this worked before the store existed.
   */
  readonly catalog?: AssetCatalog;
}

/** Options for {@link AssetManager.instantiate}. */
export interface InstantiateOptions {
  /** Maps the source node name to the name of the instantiated copy. */
  readonly rename?: (sourceName: string) => string;
  /** Clone materials instead of sharing them. Sharing is cheaper; default off. */
  readonly cloneMaterials?: boolean;
  /**
   * Draw repeated copies as GPU instances instead of cloning the meshes.
   *
   * Off by default, because an instance is not a free copy of a mesh: it
   * shares the source's geometry *and* its material, so a caller that wants to
   * recolour or reshape one copy must not ask for one. A world file that
   * places the same fence eighty times wants exactly this — eighty instances
   * of one mesh are one draw call, eighty clones are eighty.
   *
   * Babylon falls back to a clone per node it cannot instance (transform
   * nodes, skinned meshes, meshes without vertices), so asking for instances
   * is always safe; it is a request, not an assertion.
   */
  readonly instanced?: boolean;
}

/**
 * A GLB failed to load. Carries the asset path *and* the resolved URL, because
 * the usual cause is a wrong `VITE_ASSET_URL` or a missing file, and the two
 * are told apart by looking at the URL that was actually requested.
 */
export class AssetLoadError extends Error {
  override readonly name = 'AssetLoadError';

  constructor(
    readonly assetPath: string,
    readonly url: string,
    cause: unknown,
    /**
     * The placeholder that was tried after `url` failed, if there was one. Both
     * URLs are named because "the store is down" and "the placeholder was never
     * committed" are different problems with different fixes.
     */
    readonly placeholderUrl?: string,
  ) {
    const tried =
      placeholderUrl === undefined ? `from ${url}` : `from ${url} and from ${placeholderUrl}`;
    super(`failed to load GLB "${assetPath}" ${tried}: ${describeCause(cause)}`, { cause });
  }
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Loads and caches GLB assets for one scene.
 *
 * The cache holds *promises*, keyed by the asset path, so two systems asking
 * for the same model during the same frame share one network request instead of
 * racing (agent rule 13). A failed load is dropped from the cache so a retry is
 * possible; a successful one is kept until {@link dispose}. The key is the path
 * and not the URL because one asset can resolve to two of them — the store and
 * its placeholder — and the whole point is to try the second only once.
 *
 * With a catalog, a `private` asset is requested from the store and falls back
 * to its committed placeholder when the store answers 404 (ADR-0015).
 * {@link sources} says which of the two actually happened, so a clone running
 * entirely on placeholders can say so instead of looking subtly wrong.
 *
 * The manager owns no gameplay state. It hands out containers and instantiated
 * nodes; what they mean is the caller's business (spec §25).
 */
export class AssetManager {
  readonly #source: AssetSourceConfig;
  readonly #scene: Scene;
  readonly #catalog: AssetCatalog | undefined;
  readonly #containers = new Map<string, Promise<AssetContainer>>();
  /** Where each successfully loaded asset came from; one entry per asset. */
  readonly #origins = new Map<string, keyof AssetSourceCounts>();
  #loadContainer: GlbLoader | undefined;
  #loaderPromise: Promise<GlbLoader> | undefined;

  constructor(options: AssetManagerOptions) {
    this.#source = options.source;
    this.#scene = options.scene;
    this.#catalog = options.catalog;
    this.#loadContainer = options.loadContainer;
  }

  /**
   * Loads a GLB and returns its container. Repeated calls for the same asset
   * return the same container without loading again.
   *
   * @param assetPath the path in the catalog, e.g. `vegetation/pine-1b1.glb`.
   * @throws {AssetLoadError} when neither the file nor its placeholder loads.
   */
  async loadGlb(rawAssetPath: string): Promise<AssetContainer> {
    const assetPath = normalizeAssetPath(rawAssetPath);
    const cached = this.#containers.get(assetPath);
    if (cached !== undefined) {
      return cached;
    }

    const pending = this.#load(assetPath);
    this.#containers.set(assetPath, pending);
    pending.catch(() => {
      // A failure must not poison the cache: drop it, unless a newer load for
      // the same asset has already taken this slot.
      if (this.#containers.get(assetPath) === pending) {
        this.#containers.delete(assetPath);
      }
    });
    return pending;
  }

  /**
   * How many assets came from the repository, from the store, and from a
   * placeholder. Counts assets, not placements: a tree placed a hundred times
   * is one entry, because it was one download.
   *
   * Render it with `summarizeAssetSources` — one spelling for the status line
   * the game shows and the smoke test asserts.
   */
  sources(): AssetSourceCounts {
    const counts = { repository: 0, store: 0, placeholder: 0 };
    for (const origin of this.#origins.values()) {
      counts[origin] += 1;
    }
    return counts;
  }

  /**
   * Loads the asset if needed and instantiates a copy of its models into the
   * scene. Repeated calls reuse the one loaded container, which is what makes
   * placing a hundred trees affordable (spec §38).
   */
  async instantiate(
    assetPath: string,
    options: InstantiateOptions = {},
  ): Promise<InstantiatedEntries> {
    const container = await this.loadGlb(assetPath);
    return container.instantiateModelsToScene(options.rename, options.cloneMaterials ?? false, {
      doNotInstantiate: options.instanced !== true,
    });
  }

  /** Whether this asset is already loaded or currently loading. */
  isCached(assetPath: string): boolean {
    return this.#containers.has(normalizeAssetPath(assetPath));
  }

  /**
   * Disposes every container and empties the cache. In-flight loads are awaited
   * first, so a container that arrives during teardown is disposed too instead
   * of leaking GPU memory.
   */
  async dispose(): Promise<void> {
    const pending = [...this.#containers.values()];
    this.#containers.clear();
    this.#origins.clear();
    const settled = await Promise.allSettled(pending);
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        result.value.dispose();
      }
    }
  }

  async #load(assetPath: string): Promise<AssetContainer> {
    const load = await this.#resolveLoader();
    const entry = this.#catalog?.lookup(assetPath);

    // An asset the catalog does not describe is a public one: that is how this
    // worked before the store existed, and a missing catalog row must not turn
    // a working asset into a 404.
    if (entry?.visibility !== 'private' || entry.placeholder === undefined) {
      const url = assetUrl(this.#source, assetPath);
      try {
        const container = await load(url, this.#scene);
        this.#origins.set(assetPath, 'repository');
        return container;
      } catch (cause) {
        throw new AssetLoadError(assetPath, url, cause);
      }
    }

    const storeUrl = assetStoreUrl(this.#source, assetPath);
    try {
      const container = await load(storeUrl, this.#scene);
      this.#origins.set(assetPath, 'store');
      return container;
    } catch (storeFailure) {
      // The store is unreachable, or this asset is not in it yet. Neither is a
      // reason to lose the object: draw the box that has its hull and let
      // `sources()` report that this is what happened.
      const placeholderUrl = assetUrl(this.#source, entry.placeholder);
      try {
        const container = await load(placeholderUrl, this.#scene);
        this.#origins.set(assetPath, 'placeholder');
        return container;
      } catch {
        // Report the *store* failure as the cause: the placeholder failing too
        // is a second symptom, not the thing that went wrong first.
        throw new AssetLoadError(assetPath, storeUrl, storeFailure, placeholderUrl);
      }
    }
  }

  async #resolveLoader(): Promise<GlbLoader> {
    if (this.#loadContainer !== undefined) {
      return this.#loadContainer;
    }
    this.#loaderPromise ??= import('./babylon-glb-loader.js').then((module) =>
      module.createBabylonGlbLoader(),
    );
    const loader = await this.#loaderPromise;
    this.#loadContainer = loader;
    return loader;
  }
}
