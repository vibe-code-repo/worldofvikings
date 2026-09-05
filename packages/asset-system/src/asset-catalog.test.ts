import { describe, expect, it } from 'vitest';
import { createAssetCatalog, summarizeAssetSources } from './asset-catalog.js';

const entries = [
  { path: 'vegetation/pine-1b1.glb', visibility: 'private' as const, placeholder: 'p/pine.glb' },
  { path: 'environment/barrel.glb', visibility: 'public' as const },
];

describe('createAssetCatalog', () => {
  it('answers what is known about an asset', () => {
    const catalog = createAssetCatalog(entries);
    expect(catalog.lookup('vegetation/pine-1b1.glb')?.visibility).toBe('private');
    expect(catalog.lookup('vegetation/pine-1b1.glb')?.placeholder).toBe('p/pine.glb');
    expect(catalog.lookup('environment/barrel.glb')?.visibility).toBe('public');
  });

  it('answers nothing for an asset it has never heard of, instead of guessing', () => {
    expect(createAssetCatalog(entries).lookup('environment/unknown.glb')).toBeUndefined();
  });

  it('refuses a private entry with no placeholder, which could only 404', () => {
    expect(() => createAssetCatalog([{ path: 'a.glb', visibility: 'private' }])).toThrow(
      /placeholder/,
    );
  });

  it('refuses two entries for the same path rather than silently keeping one', () => {
    expect(() => createAssetCatalog([...entries, ...entries])).toThrow(/duplicate/);
  });
});

describe('summarizeAssetSources', () => {
  it('names both numbers, including the zeroes', () => {
    expect(summarizeAssetSources({ repository: 3, store: 2, placeholder: 0 })).toBe(
      'assets: 2 private, 0 placeholder',
    );
  });

  it('counts an asset the store could not serve as a placeholder', () => {
    expect(summarizeAssetSources({ repository: 1, store: 0, placeholder: 4 })).toBe(
      'assets: 4 private, 4 placeholder',
    );
  });
});
