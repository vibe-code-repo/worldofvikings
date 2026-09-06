import { describe, expect, it } from 'vitest';
import type { CatalogedPrefab } from '../api/client.js';
import { createPrefabIndex, formatBounds } from './prefab-index.js';

function prefab(overrides: Partial<CatalogedPrefab> = {}): CatalogedPrefab {
  return {
    id: 'barrel_01',
    name: 'Barrel 01',
    asset: 'environment/barrel.glb',
    visibility: 'public',
    category: 'prop',
    catalog: 'base',
    ...overrides,
  } as CatalogedPrefab;
}

describe('createPrefabIndex', () => {
  it('finds a prefab by the id an entity references', () => {
    const index = createPrefabIndex([prefab()]);

    expect(index.get('barrel_01')?.name).toBe('Barrel 01');
    expect(index.get('nothing_here')).toBeUndefined();
  });

  it('sorts by name so the browser does not reshuffle between reloads', () => {
    const index = createPrefabIndex([
      prefab({ id: 'z', name: 'Zebra' }),
      prefab({ id: 'a', name: 'Anvil' }),
    ]);

    expect(index.all().map((entry) => entry.name)).toEqual(['Anvil', 'Zebra']);
  });

  it('offers only the categories that carry something, in a fixed order', () => {
    const index = createPrefabIndex([
      prefab({ id: 'p', category: 'prop' }),
      prefab({ id: 'v', category: 'vegetation', asset: 'vegetation/pine.glb' }),
    ]);

    expect(index.categories()).toEqual(['vegetation', 'prop']);
    expect(index.inCategory('vegetation').map((entry) => entry.id)).toEqual(['v']);
    expect(index.inCategory('terrain')).toEqual([]);
  });

  it('builds one asset catalog entry per file, not per prefab', () => {
    // Two prefabs of the same model — a plain barrel and a scaled one — is the
    // ordinary case, and `createAssetCatalog` throws on a duplicate path.
    const index = createPrefabIndex([
      prefab({ id: 'barrel_01' }),
      prefab({ id: 'barrel_big', name: 'Big Barrel', defaultScale: [2, 2, 2] }),
    ]);

    expect(index.assets.lookup('environment/barrel.glb')?.visibility).toBe('public');
  });

  it('carries the placeholder a private prefab needs', () => {
    const index = createPrefabIndex([
      prefab({
        id: 'shelter',
        asset: 'environment/shelter.glb',
        visibility: 'private',
        placeholder: 'placeholders/environment/shelter.glb',
      }),
    ]);

    expect(index.assets.lookup('environment/shelter.glb')).toMatchObject({
      visibility: 'private',
      placeholder: 'placeholders/environment/shelter.glb',
    });
  });
});

describe('formatBounds', () => {
  it('states the measured hull rather than assuming a size', () => {
    expect(formatBounds(prefab({ bounds: { min: [-1, 0, -1.2], max: [1.4, 3.1, 1.2] } }))).toBe(
      '2.4 × 3.1 × 2.4 m',
    );
  });

  it('drops a trailing zero, so a 2 m cube does not read as 2.0', () => {
    expect(formatBounds(prefab({ bounds: { min: [0, 0, 0], max: [2, 2, 2] } }))).toBe(
      '2 × 2 × 2 m',
    );
  });

  it('says so when the manifest recorded no hull', () => {
    expect(formatBounds(prefab())).toBe('size unknown');
  });
});
