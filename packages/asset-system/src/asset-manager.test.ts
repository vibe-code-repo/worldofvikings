import type { AssetContainer } from '@babylonjs/core/assetContainer.js';
import type { InstantiatedEntries } from '@babylonjs/core/assetContainer.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { describe, expect, it, vi } from 'vitest';
import { AssetLoadError, AssetManager } from './asset-manager.js';
import type { GlbLoader } from './glb-loader.js';

const scene = {} as unknown as Scene;
const source = { baseUrl: 'http://localhost:9000' };

/** A stand-in for a Babylon `AssetContainer`; no renderer is created in tests. */
function fakeContainer(): AssetContainer & {
  readonly disposeSpy: ReturnType<typeof vi.fn>;
  readonly instantiateSpy: ReturnType<typeof vi.fn>;
} {
  const entries = {
    rootNodes: [],
    skeletons: [],
    animationGroups: [],
  } as unknown as InstantiatedEntries;
  const disposeSpy = vi.fn();
  const instantiateSpy = vi.fn(() => entries);
  return {
    disposeSpy,
    instantiateSpy,
    dispose: disposeSpy,
    instantiateModelsToScene: instantiateSpy,
  } as unknown as AssetContainer & {
    readonly disposeSpy: ReturnType<typeof vi.fn>;
    readonly instantiateSpy: ReturnType<typeof vi.fn>;
  };
}

function managerWith(loadContainer: GlbLoader): AssetManager {
  return new AssetManager({ source, scene, loadContainer });
}

/**
 * A promise plus its resolver, created *before* the loader is called.
 *
 * Capturing the resolver inside `new Promise(...)` at call time does not work
 * here: `loadGlb` awaits the loader lookup first, so the executor has not run
 * yet when the test wants to release the load, and the test hangs on a resolver
 * that is still the no-op placeholder.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('AssetManager.loadGlb', () => {
  it('resolves the asset path against the base URL before loading', async () => {
    const container = fakeContainer();
    const loadContainer = vi.fn<GlbLoader>(async () => container);

    await managerWith(loadContainer).loadGlb('environment/tree.glb');

    expect(loadContainer).toHaveBeenCalledWith('http://localhost:9000/environment/tree.glb', scene);
  });

  it('loads each URL once even when two callers ask concurrently', async () => {
    const container = fakeContainer();
    const gate = deferred<AssetContainer>();
    const loadContainer = vi.fn<GlbLoader>(() => gate.promise);
    const manager = managerWith(loadContainer);

    const first = manager.loadGlb('environment/tree.glb');
    const second = manager.loadGlb('environment/tree.glb');
    gate.resolve(container);

    expect(await first).toBe(container);
    expect(await second).toBe(container);
    expect(loadContainer).toHaveBeenCalledTimes(1);
  });

  it('serves a second, later request from the cache', async () => {
    const container = fakeContainer();
    const loadContainer = vi.fn<GlbLoader>(async () => container);
    const manager = managerWith(loadContainer);

    await manager.loadGlb('environment/tree.glb');
    expect(await manager.loadGlb('/environment/tree.glb')).toBe(container);
    expect(loadContainer).toHaveBeenCalledTimes(1);
  });

  it('keeps different assets apart', async () => {
    const loadContainer = vi.fn<GlbLoader>(async () => fakeContainer());
    const manager = managerWith(loadContainer);

    await manager.loadGlb('environment/tree.glb');
    await manager.loadGlb('environment/rock.glb');

    expect(loadContainer).toHaveBeenCalledTimes(2);
  });

  it('reports the asset path, the URL and the cause when loading fails', async () => {
    const loadContainer = vi.fn<GlbLoader>(async () => {
      throw new Error('404 Not Found');
    });

    const error = await managerWith(loadContainer)
      .loadGlb('environment/tree.glb')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AssetLoadError);
    const loadError = error as AssetLoadError;
    expect(loadError.assetPath).toBe('environment/tree.glb');
    expect(loadError.url).toBe('http://localhost:9000/environment/tree.glb');
    expect(loadError.message).toContain('environment/tree.glb');
    expect(loadError.message).toContain('http://localhost:9000/environment/tree.glb');
    expect(loadError.message).toContain('404 Not Found');
    expect(loadError.cause).toBeInstanceOf(Error);
  });

  it('does not cache a failure, so a retry can succeed', async () => {
    const container = fakeContainer();
    const loadContainer = vi
      .fn<GlbLoader>()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(container);
    const manager = managerWith(loadContainer);

    await expect(manager.loadGlb('environment/tree.glb')).rejects.toBeInstanceOf(AssetLoadError);
    expect(manager.isCached('environment/tree.glb')).toBe(false);
    expect(await manager.loadGlb('environment/tree.glb')).toBe(container);
    expect(loadContainer).toHaveBeenCalledTimes(2);
  });

  it('rejects a traversing asset path before any request is made', async () => {
    const loadContainer = vi.fn<GlbLoader>(async () => fakeContainer());

    await expect(managerWith(loadContainer).loadGlb('../secret.glb')).rejects.toThrow();
    expect(loadContainer).not.toHaveBeenCalled();
  });
});

describe('AssetManager.instantiate', () => {
  it('instantiates from the cached container instead of loading twice', async () => {
    const container = fakeContainer();
    const loadContainer = vi.fn<GlbLoader>(async () => container);
    const manager = managerWith(loadContainer);

    const entries = await manager.instantiate('environment/tree.glb');
    await manager.instantiate('environment/tree.glb');

    expect(loadContainer).toHaveBeenCalledTimes(1);
    expect(container.instantiateSpy).toHaveBeenCalledTimes(2);
    expect(entries.rootNodes).toEqual([]);
  });

  it('forwards the naming function and the material cloning flag', async () => {
    const container = fakeContainer();
    const rename = (sourceName: string): string => `tree:${sourceName}`;
    const manager = managerWith(async () => container);

    await manager.instantiate('environment/tree.glb', { rename, cloneMaterials: true });

    expect(container.instantiateSpy).toHaveBeenCalledWith(rename, true, {
      doNotInstantiate: true,
    });
  });

  it('clones by default and only instances when asked', async () => {
    // Babylon's own default is `doNotInstantiate: true`; this asserts that the
    // flag is *always* stated, so the behaviour cannot change under us with a
    // Babylon upgrade, and that `instanced` is what flips it (ADR-0022).
    const container = fakeContainer();
    const manager = managerWith(async () => container);

    await manager.instantiate('environment/tree.glb');
    expect(container.instantiateSpy).toHaveBeenLastCalledWith(undefined, false, {
      doNotInstantiate: true,
    });

    await manager.instantiate('environment/tree.glb', { instanced: true });
    expect(container.instantiateSpy).toHaveBeenLastCalledWith(undefined, false, {
      doNotInstantiate: false,
    });
  });
});

describe('AssetManager.dispose', () => {
  it('disposes every cached container and empties the cache', async () => {
    const container = fakeContainer();
    const loadContainer = vi.fn<GlbLoader>(async () => container);
    const manager = managerWith(loadContainer);
    await manager.loadGlb('environment/tree.glb');

    expect(manager.isCached('environment/tree.glb')).toBe(true);
    await manager.dispose();

    expect(container.disposeSpy).toHaveBeenCalledTimes(1);
    expect(manager.isCached('environment/tree.glb')).toBe(false);
  });

  it('waits for an in-flight load instead of leaking its container', async () => {
    const container = fakeContainer();
    const gate = deferred<AssetContainer>();
    const manager = managerWith(() => gate.promise);

    const pending = manager.loadGlb('environment/tree.glb');
    const disposed = manager.dispose();
    gate.resolve(container);
    await pending;
    await disposed;

    expect(container.disposeSpy).toHaveBeenCalledTimes(1);
  });
});
