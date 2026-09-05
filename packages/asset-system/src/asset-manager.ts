import type { AssetContainer, InstantiatedEntries } from '@babylonjs/core/assetContainer.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { GlbLoader } from './glb-loader.js';
import type { AssetSourceConfig } from './url.js';
import { assetUrl } from './url.js';

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
}

/** Options for {@link AssetManager.instantiate}. */
export interface InstantiateOptions {
  /** Maps the source node name to the name of the instantiated copy. */
  readonly rename?: (sourceName: string) => string;
  /** Clone materials instead of sharing them. Sharing is cheaper; default off. */
  readonly cloneMaterials?: boolean;
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
  ) {
    super(`failed to load GLB "${assetPath}" from ${url}: ${describeCause(cause)}`, { cause });
  }
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Loads and caches GLB assets for one scene.
 *
 * The cache holds *promises*, keyed by the resolved URL, so two systems asking
 * for the same model during the same frame share one network request instead of
 * racing (agent rule 13). A failed load is dropped from the cache so a retry is
 * possible; a successful one is kept until {@link dispose}.
 *
 * The manager owns no gameplay state. It hands out containers and instantiated
 * nodes; what they mean is the caller's business (spec §25).
 */
export class AssetManager {
  readonly #source: AssetSourceConfig;
  readonly #scene: Scene;
  readonly #containers = new Map<string, Promise<AssetContainer>>();
  #loadContainer: GlbLoader | undefined;
  #loaderPromise: Promise<GlbLoader> | undefined;

  constructor(options: AssetManagerOptions) {
    this.#source = options.source;
    this.#scene = options.scene;
    this.#loadContainer = options.loadContainer;
  }

  /**
   * Loads a GLB and returns its container. Repeated calls for the same asset
   * return the same container without loading again.
   *
   * @param assetPath repository-relative, e.g. `environment/pine_tree_01.glb`.
   * @throws {AssetLoadError} when the file cannot be loaded.
   */
  async loadGlb(assetPath: string): Promise<AssetContainer> {
    const url = assetUrl(this.#source, assetPath);
    const cached = this.#containers.get(url);
    if (cached !== undefined) {
      return cached;
    }

    const pending = this.#load(assetPath, url);
    this.#containers.set(url, pending);
    pending.catch(() => {
      // A failure must not poison the cache: drop it, unless a newer load for
      // the same URL has already taken this slot.
      if (this.#containers.get(url) === pending) {
        this.#containers.delete(url);
      }
    });
    return pending;
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
    return container.instantiateModelsToScene(
      options.rename,
      options.cloneMaterials ?? false,
      undefined,
    );
  }

  /** Whether this asset is already loaded or currently loading. */
  isCached(assetPath: string): boolean {
    return this.#containers.has(assetUrl(this.#source, assetPath));
  }

  /**
   * Disposes every container and empties the cache. In-flight loads are awaited
   * first, so a container that arrives during teardown is disposed too instead
   * of leaking GPU memory.
   */
  async dispose(): Promise<void> {
    const pending = [...this.#containers.values()];
    this.#containers.clear();
    const settled = await Promise.allSettled(pending);
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        result.value.dispose();
      }
    }
  }

  async #load(assetPath: string, url: string): Promise<AssetContainer> {
    const load = await this.#resolveLoader();
    try {
      return await load(url, this.#scene);
    } catch (cause) {
      throw new AssetLoadError(assetPath, url, cause);
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
