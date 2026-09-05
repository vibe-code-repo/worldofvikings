import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ASSET_BASE_URL,
  assetStoreUrl,
  assetUrl,
  resolveAssetSourceConfig,
} from './url.js';

describe('assetStoreUrl', () => {
  it('hangs the store off the asset host when no store URL is configured', () => {
    expect(assetStoreUrl({ baseUrl: 'http://localhost:9000' }, 'vegetation/pine.glb')).toBe(
      'http://localhost:9000/store/vegetation/pine.glb',
    );
  });

  it('uses a separately hosted store when one is configured', () => {
    expect(
      assetStoreUrl(
        { baseUrl: 'https://assets.example.com', storeUrl: 'https://store.example.com/' },
        'vegetation/pine.glb',
      ),
    ).toBe('https://store.example.com/vegetation/pine.glb');
  });

  it('rejects traversal, exactly like the public root', () => {
    expect(() => assetStoreUrl({ baseUrl: 'http://x' }, '../secret')).toThrow();
  });
});

describe('assetUrl', () => {
  it('joins base and path with exactly one slash', () => {
    expect(assetUrl({ baseUrl: 'http://localhost:9000/' }, '/environment/tree.glb')).toBe(
      'http://localhost:9000/environment/tree.glb',
    );
  });

  it('rejects empty paths', () => {
    expect(() => assetUrl({ baseUrl: 'http://x' }, '')).toThrow();
  });

  it('rejects traversal', () => {
    expect(() => assetUrl({ baseUrl: 'http://x' }, '../secret')).toThrow();
  });
});

describe('resolveAssetSourceConfig', () => {
  it('uses VITE_ASSET_URL when it is set', () => {
    expect(resolveAssetSourceConfig({ VITE_ASSET_URL: 'https://assets.example.com/' })).toEqual({
      baseUrl: 'https://assets.example.com',
    });
  });

  it('falls back to the local development asset server', () => {
    expect(resolveAssetSourceConfig({})).toEqual({ baseUrl: DEFAULT_ASSET_BASE_URL });
    expect(resolveAssetSourceConfig()).toEqual({ baseUrl: DEFAULT_ASSET_BASE_URL });
  });

  it('ignores an empty value instead of building "undefined/..." URLs', () => {
    expect(resolveAssetSourceConfig({ VITE_ASSET_URL: '   ' })).toEqual({
      baseUrl: DEFAULT_ASSET_BASE_URL,
    });
  });

  it('rejects a relative VITE_ASSET_URL with a message naming the variable', () => {
    expect(() => resolveAssetSourceConfig({ VITE_ASSET_URL: '/assets' })).toThrow(/VITE_ASSET_URL/);
  });

  it('leaves storeUrl absent unless a deployment names one', () => {
    expect(resolveAssetSourceConfig({}).storeUrl).toBeUndefined();
    expect(
      resolveAssetSourceConfig({ VITE_ASSET_STORE_URL: 'https://store.example.com/' }),
    ).toEqual({ baseUrl: DEFAULT_ASSET_BASE_URL, storeUrl: 'https://store.example.com' });
  });

  it('rejects a relative VITE_ASSET_STORE_URL with a message naming the variable', () => {
    expect(() => resolveAssetSourceConfig({ VITE_ASSET_STORE_URL: '/store' })).toThrow(
      /VITE_ASSET_STORE_URL/,
    );
  });
});
