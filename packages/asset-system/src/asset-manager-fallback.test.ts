/**
 * The private-store fallback (ADR-0015).
 *
 * This is the code path that only ever runs when something is missing, which
 * makes it exactly the kind of code that rots unnoticed. So it is tested from
 * both sides: the store answering, and the store not being there at all.
 */
import type { AssetContainer } from '@babylonjs/core/assetContainer.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AssetLoadError, AssetManager } from './asset-manager.js';
import { createAssetCatalog, summarizeAssetSources } from './asset-catalog.js';
import type { GlbLoader } from './glb-loader.js';

const scene = {} as unknown as Scene;
const source = { baseUrl: 'http://localhost:9000' };

const catalog = createAssetCatalog([
  {
    path: 'vegetation/pine-1b1.glb',
    visibility: 'private',
    placeholder: 'placeholders/vegetation/pine-1b1.glb',
  },
  { path: 'environment/kenney-retro-fantasy-kit/detail-barrel.glb', visibility: 'public' },
]);

function fakeContainer(): AssetContainer {
  return { dispose: vi.fn(), instantiateModelsToScene: vi.fn() } as unknown as AssetContainer;
}

/** A loader that serves the listed URLs and 404s on everything else. */
function serving(...urls: readonly string[]): Mock<GlbLoader> {
  const served = new Set(urls);
  return vi.fn<GlbLoader>((url) =>
    served.has(url) ? Promise.resolve(fakeContainer()) : Promise.reject(new Error('404')),
  );
}

function managerWith(loadContainer: Mock<GlbLoader>): AssetManager {
  return new AssetManager({ source, scene, catalog, loadContainer });
}

describe('a private asset', () => {
  const storeUrl = 'http://localhost:9000/store/vegetation/pine-1b1.glb';
  const placeholderUrl = 'http://localhost:9000/placeholders/vegetation/pine-1b1.glb';

  it('is requested from the store, not from assets/', async () => {
    const loadContainer = serving(storeUrl);
    await managerWith(loadContainer).loadGlb('vegetation/pine-1b1.glb');

    expect(loadContainer).toHaveBeenCalledTimes(1);
    expect(loadContainer).toHaveBeenCalledWith(storeUrl, scene);
  });

  it('falls back to the committed placeholder when the store has nothing', async () => {
    const loadContainer = serving(placeholderUrl);
    const manager = managerWith(loadContainer);

    await expect(manager.loadGlb('vegetation/pine-1b1.glb')).resolves.toBeDefined();
    expect(loadContainer.mock.calls.map(([url]) => url)).toEqual([storeUrl, placeholderUrl]);
  });

  it('counts what it actually loaded, so the fallback is visible', async () => {
    const served = managerWith(serving(storeUrl));
    await served.loadGlb('vegetation/pine-1b1.glb');
    expect(served.sources()).toEqual({ repository: 0, store: 1, placeholder: 0 });
    expect(summarizeAssetSources(served.sources())).toBe('assets: 1 private, 0 placeholder');

    const fellBack = managerWith(serving(placeholderUrl));
    await fellBack.loadGlb('vegetation/pine-1b1.glb');
    expect(fellBack.sources()).toEqual({ repository: 0, store: 0, placeholder: 1 });
    expect(summarizeAssetSources(fellBack.sources())).toBe('assets: 1 private, 1 placeholder');
  });

  it('counts an asset once however often it is placed', async () => {
    const manager = managerWith(serving(placeholderUrl));
    await Promise.all([
      manager.loadGlb('vegetation/pine-1b1.glb'),
      manager.loadGlb('vegetation/pine-1b1.glb'),
    ]);
    await manager.loadGlb('vegetation/pine-1b1.glb');
    expect(manager.sources().placeholder).toBe(1);
  });

  it('names both URLs when neither the store nor the placeholder answers', async () => {
    const manager = managerWith(serving());
    await expect(manager.loadGlb('vegetation/pine-1b1.glb')).rejects.toThrow(AssetLoadError);
    await expect(manager.loadGlb('vegetation/pine-1b1.glb')).rejects.toThrow(
      /store\/vegetation\/pine-1b1\.glb.*placeholders\/vegetation\/pine-1b1\.glb/s,
    );
  });
});

describe('a public asset', () => {
  const barrel = 'environment/kenney-retro-fantasy-kit/detail-barrel.glb';

  it('is served from assets/ and never from the store', async () => {
    const loadContainer = serving(`http://localhost:9000/${barrel}`);
    const manager = managerWith(loadContainer);
    await manager.loadGlb(barrel);

    expect(loadContainer).toHaveBeenCalledTimes(1);
    expect(manager.sources()).toEqual({ repository: 1, store: 0, placeholder: 0 });
  });

  it('has no fallback: a missing public file is a bug, not a licence question', async () => {
    const loadContainer = serving();
    await expect(managerWith(loadContainer).loadGlb(barrel)).rejects.toThrow(AssetLoadError);
    expect(loadContainer).toHaveBeenCalledTimes(1);
  });
});

describe('an asset the catalog does not know', () => {
  it('is loaded from assets/, exactly as before there was a catalog', async () => {
    const loadContainer = serving('http://localhost:9000/environment/unlisted.glb');
    const manager = managerWith(loadContainer);
    await manager.loadGlb('environment/unlisted.glb');

    expect(loadContainer).toHaveBeenCalledWith(
      'http://localhost:9000/environment/unlisted.glb',
      scene,
    );
    expect(manager.sources().repository).toBe(1);
  });

  it('behaves the same when there is no catalog at all', async () => {
    const loadContainer = serving('http://localhost:9000/environment/barrel.glb');
    const manager = new AssetManager({ source, scene, loadContainer });
    await expect(manager.loadGlb('environment/barrel.glb')).resolves.toBeDefined();
    expect(manager.sources()).toEqual({ repository: 1, store: 0, placeholder: 0 });
  });
});
