import { describe, expect, it } from 'vitest';
import { CURRENT_PREFAB_SCHEMA_VERSION, parsePrefabCatalog } from './prefab.js';

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
