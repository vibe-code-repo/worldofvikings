import { describe, expect, it } from 'vitest';
import {
  CURRENT_PREFAB_SCHEMA_VERSION,
  PREFAB_CATEGORIES,
  isBackdrop,
  parsePrefabCatalog,
} from './prefab.js';

const publicPrefab = {
  id: 'barrel-01',
  name: 'Barrel',
  asset: 'environment/kenney-retro-fantasy-kit/detail-barrel.glb',
  visibility: 'public',
  category: 'prop',
};

const privatePrefab = {
  id: 'pine-1b1',
  name: 'Pine 1b1',
  asset: 'vegetation/pine-1b1.glb',
  visibility: 'private',
  placeholder: 'placeholders/vegetation/pine-1b1.glb',
  category: 'vegetation',
  bounds: { min: [-3.1334, -0.5613, -3.3268], max: [3.6463, 15.5783, 2.9648] },
  defaultScale: [1, 1, 1],
};

const validCatalog = {
  schemaVersion: CURRENT_PREFAB_SCHEMA_VERSION,
  id: 'base',
  prefabs: [publicPrefab, privatePrefab],
};

function parse(overrides: Record<string, unknown>) {
  return parsePrefabCatalog({ ...validCatalog, ...overrides });
}

function withPrefab(prefab: Record<string, unknown>) {
  return parse({ prefabs: [prefab] });
}

describe('parsePrefabCatalog', () => {
  it('accepts a catalog with a public and a private prefab', () => {
    const result = parsePrefabCatalog(validCatalog);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.catalog.prefabs).toHaveLength(2);
      expect(result.catalog.prefabs[1]?.placeholder).toBe('placeholders/vegetation/pine-1b1.glb');
    }
  });

  it('rejects an unsupported schema version with a dedicated message', () => {
    const result = parse({ schemaVersion: 99 });
    expect(result).toEqual({
      ok: false,
      errors: ['unsupported schemaVersion 99, expected 1'],
    });
  });

  it('rejects unknown fields instead of dropping them', () => {
    expect(parse({ secret: true }).ok).toBe(false);
    expect(withPrefab({ ...publicPrefab, tags: ['x'] }).ok).toBe(false);
  });

  it('rejects duplicate prefab ids', () => {
    const result = parse({ prefabs: [publicPrefab, publicPrefab] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('duplicate prefab id');
    }
  });

  it('rejects ids that are not lowercase identifiers', () => {
    expect(withPrefab({ ...publicPrefab, id: 'Barrel_01' }).ok).toBe(false);
    expect(withPrefab({ ...publicPrefab, id: 'environment/barrel' }).ok).toBe(false);
  });

  it('requires a placeholder for a private prefab and forbids one for a public prefab', () => {
    const { placeholder: _placeholder, ...withoutPlaceholder } = privatePrefab;
    const missing = withPrefab(withoutPlaceholder);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.errors.join(' ')).toContain('placeholder');
    }

    expect(
      withPrefab({ ...publicPrefab, placeholder: 'placeholders/environment/barrel.glb' }).ok,
    ).toBe(false);
  });

  it('rejects asset paths that are absolute, escape the asset root or use backslashes', () => {
    expect(withPrefab({ ...publicPrefab, asset: '/environment/barrel.glb' }).ok).toBe(false);
    expect(withPrefab({ ...publicPrefab, asset: '../secrets/barrel.glb' }).ok).toBe(false);
    expect(withPrefab({ ...publicPrefab, asset: 'environment\\barrel.glb' }).ok).toBe(false);
    expect(withPrefab({ ...publicPrefab, asset: 'environment//barrel.glb' }).ok).toBe(false);
  });

  it('rejects an unknown category', () => {
    expect(withPrefab({ ...publicPrefab, category: 'furniture' }).ok).toBe(false);
  });

  it('rejects bounds whose max is smaller than its min', () => {
    const result = withPrefab({
      ...publicPrefab,
      bounds: { min: [0, 0, 0], max: [1, -1, 1] },
    });
    expect(result.ok).toBe(false);
  });

  it('reports the path of a failing field so a big catalog stays reviewable', () => {
    const result = parse({ prefabs: [publicPrefab, { ...privatePrefab, category: 'furniture' }] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain('prefabs.1.category');
    }
  });
});

describe('prefab collision', () => {
  it('accepts a prefab without a collision shape', () => {
    expect(withPrefab(publicPrefab).ok).toBe(true);
  });

  it('accepts every collision kind', () => {
    for (const kind of ['none', 'box', 'hull', 'mesh']) {
      const result = withPrefab({ ...publicPrefab, collision: { kind } });
      expect(result.ok, kind).toBe(true);
    }
  });

  it('rejects a collision kind it does not know', () => {
    const result = withPrefab({ ...publicPrefab, collision: { kind: 'capsule' } });
    expect(result.ok).toBe(false);
  });

  it('accepts a mesh collision that names its own collider asset', () => {
    const result = withPrefab({
      ...privatePrefab,
      collision: {
        kind: 'mesh',
        asset: {
          path: 'vegetation/pine-1b1-collision.glb',
          visibility: 'private',
          placeholder: 'placeholders/vegetation/pine-1b1-collision.glb',
        },
      },
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a collider asset on a shape that is not a mesh', () => {
    const result = withPrefab({
      ...publicPrefab,
      collision: {
        kind: 'box',
        asset: { path: 'environment/x-collision.glb', visibility: 'public' },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('collider asset');
    }
  });

  it('rejects a private collider asset without a placeholder', () => {
    const result = withPrefab({
      ...privatePrefab,
      collision: {
        kind: 'mesh',
        asset: { path: 'vegetation/pine-1b1-collision.glb', visibility: 'private' },
      },
    });
    expect(result.ok).toBe(false);
  });

  it('accepts an explicit collision box, in the same space as bounds', () => {
    const result = withPrefab({
      ...privatePrefab,
      collision: { kind: 'box', box: { min: [-0.52, -0.56, -0.52], max: [0.52, 15.58, 0.52] } },
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an explicit box on a shape that is not a box', () => {
    const result = withPrefab({
      ...publicPrefab,
      collision: { kind: 'hull', box: { min: [0, 0, 0], max: [1, 1, 1] } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('collision box');
    }
  });

  it('rejects an inverted collision box', () => {
    const result = withPrefab({
      ...publicPrefab,
      collision: { kind: 'box', box: { min: [1, 0, 0], max: [0, 1, 1] } },
    });
    expect(result.ok).toBe(false);
  });
});

describe('the backdrop category', () => {
  it('is one of the categories a catalogue may name', () => {
    expect(PREFAB_CATEGORIES).toContain('backdrop');
  });

  it('was additive: a catalogue written before it still parses', () => {
    // Every value the previous list had is still in this one, in the same
    // order, so no file that validated before this change stopped validating.
    expect(PREFAB_CATEGORIES.slice(0, 5)).toEqual([
      'environment',
      'vegetation',
      'terrain',
      'prop',
      'dungeon',
    ]);
    expect(CURRENT_PREFAB_SCHEMA_VERSION).toBe(1);
  });

  it('answers isBackdrop for it and for nothing else', () => {
    expect(isBackdrop({ category: 'backdrop' })).toBe(true);
    for (const category of PREFAB_CATEGORIES.filter((each) => each !== 'backdrop')) {
      expect(isBackdrop({ category })).toBe(false);
    }
  });
});
