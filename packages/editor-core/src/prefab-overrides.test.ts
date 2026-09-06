import { describe, expect, it } from 'vitest';
import { parsePrefabCatalog, type PrefabCatalog, type PrefabDefinition } from '@wov/world-schema';
import { IMPORTED_CATALOG_ID as GENERATED_CATALOG_ID } from '@wov/content-build';
import {
  IMPORTED_CATALOG_ID,
  OVERRIDE_CATALOG_ID,
  catalogForEdit,
  editedPrefab,
  emptyOverrideCatalog,
  withPrefab,
} from './prefab-overrides.js';

const pine: PrefabDefinition = {
  id: 'vegetation-pine-1b1',
  name: 'Pine 1b1',
  asset: 'vegetation/pine-1b1.glb',
  visibility: 'private',
  placeholder: 'placeholders/vegetation/pine-1b1.glb',
  category: 'vegetation',
  collision: { kind: 'box', box: { min: [-0.4, 0, -0.4], max: [0.4, 2, 0.4] } },
};

/**
 * The one string this package copies out of `@wov/content-build`, checked here
 * so the copy cannot drift (see the note in `prefab-overrides.ts`).
 */
describe('the generated catalogue id', () => {
  it('is the same word both packages use', () => {
    expect(IMPORTED_CATALOG_ID).toBe(GENERATED_CATALOG_ID);
  });
});

describe('catalogForEdit', () => {
  it('sends a correction to a generated prefab into the overlay', () => {
    expect(catalogForEdit(IMPORTED_CATALOG_ID)).toBe(OVERRIDE_CATALOG_ID);
  });

  it('edits a hand-written catalogue in place, because nothing regenerates it', () => {
    expect(catalogForEdit('base')).toBe('base');
  });
});

describe('editedPrefab', () => {
  it('changes the collision shape and leaves everything else alone', () => {
    const edited = editedPrefab(pine, { collision: { kind: 'hull' } });
    expect(edited.collision).toEqual({ kind: 'hull' });
    expect(edited.asset).toBe(pine.asset);
    expect(edited.placeholder).toBe(pine.placeholder);
  });

  it('changes the category', () => {
    expect(editedPrefab(pine, { category: 'environment' }).category).toBe('environment');
  });

  it('removes the block entirely, which the schema reads as undecided', () => {
    const edited = editedPrefab(pine, { collision: null });
    expect('collision' in edited).toBe(false);
  });

  it('leaves the prefab untouched when the edit says nothing', () => {
    expect(editedPrefab(pine, {})).toEqual(pine);
  });

  it('produces something the prefab schema accepts', () => {
    const catalog = withPrefab(
      emptyOverrideCatalog(),
      editedPrefab(pine, { collision: { kind: 'mesh' } }),
    );
    expect(parsePrefabCatalog(catalog).ok).toBe(true);
  });
});

describe('withPrefab', () => {
  it('appends a prefab the overlay does not have yet', () => {
    const catalog = withPrefab(emptyOverrideCatalog(), pine);
    expect(catalog.prefabs.map((prefab) => prefab.id)).toEqual([pine.id]);
  });

  it('replaces the entry instead of adding a second one with the same id', () => {
    const once = withPrefab(emptyOverrideCatalog(), pine);
    const twice = withPrefab(once, editedPrefab(pine, { collision: { kind: 'none' } }));
    expect(twice.prefabs).toHaveLength(1);
    expect(twice.prefabs[0]?.collision).toEqual({ kind: 'none' });
  });

  /** The overlay grows one prefab at a time over months; sorted keeps its diff readable. */
  it('keeps the overlay sorted by id', () => {
    const catalog = withPrefab(withPrefab(emptyOverrideCatalog(), { ...pine, id: 'zebra' }), {
      ...pine,
      id: 'apple',
    });
    expect(catalog.prefabs.map((prefab) => prefab.id)).toEqual(['apple', 'zebra']);
  });

  it('keeps a hand-written catalogue in its authored order', () => {
    const base: PrefabCatalog = {
      schemaVersion: 1,
      id: 'base',
      prefabs: [{ ...pine, id: 'zebra' }],
    };
    const catalog = withPrefab(base, { ...pine, id: 'apple' });
    expect(catalog.prefabs.map((prefab) => prefab.id)).toEqual(['zebra', 'apple']);
  });
});
