import { describe, expect, it } from 'vitest';
import { CURRENT_WORLD_SCHEMA_VERSION, parseWorldDefinition } from './world.js';

const validWorld = {
  schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
  id: 'main',
  name: 'Main World',
  zones: [
    {
      id: 'village',
      name: 'Village',
      entities: [{ id: 'tree_001', prefab: 'pine_tree_01', position: [24.3, 1.2, -56.4] }],
    },
  ],
};

describe('parseWorldDefinition', () => {
  it('accepts a minimal valid world', () => {
    const result = parseWorldDefinition(validWorld);
    expect(result.ok).toBe(true);
  });

  it('rejects a newer schema version with a dedicated message', () => {
    const result = parseWorldDefinition({ ...validWorld, schemaVersion: 99 });
    expect(result).toEqual({
      ok: false,
      errors: [
        'world file is schemaVersion 99, but this build understands ' +
          `${String(CURRENT_WORLD_SCHEMA_VERSION)} — ` +
          'update the project instead of downgrading the file',
      ],
    });
  });

  it('rejects an older version that has no recorded migration', () => {
    const result = parseWorldDefinition({ ...validWorld, schemaVersion: 0 });
    expect(result).toEqual({
      ok: false,
      errors: [`unsupported schemaVersion 0, expected ${String(CURRENT_WORLD_SCHEMA_VERSION)}`],
    });
  });

  it('reads a version 1 file and says which version it came from', () => {
    const result = parseWorldDefinition({ ...validWorld, schemaVersion: 1 });
    expect(result.ok && result.migratedFrom).toBe(1);
    expect(result.ok && result.world.schemaVersion).toBe(CURRENT_WORLD_SCHEMA_VERSION);
  });

  it('does not report a migration for a file that is already current', () => {
    const result = parseWorldDefinition(validWorld);
    expect(result.ok && result.migratedFrom).toBeUndefined();
  });

  it('accepts a zone with terrain, and one without', () => {
    const withTerrain = parseWorldDefinition({
      ...validWorld,
      zones: [
        {
          ...validWorld.zones[0],
          terrain: {
            heightField: 'terrain/village-257.glb',
            position: [0, 0, 0],
            size: [300, 300],
            layers: [{ texture: 'textures/terrain-grass-a.png', tileSize: 2 }],
            splat: ['textures/village-splat-a.png'],
          },
        },
      ],
    });
    expect(withTerrain.ok).toBe(true);
    expect(parseWorldDefinition(validWorld).ok).toBe(true);
  });

  it('rejects a terrain whose layers outnumber its splat channels', () => {
    const result = parseWorldDefinition({
      ...validWorld,
      zones: [
        {
          ...validWorld.zones[0],
          terrain: {
            heightField: 'terrain/village-257.glb',
            position: [0, 0, 0],
            size: [300, 300],
            layers: Array.from({ length: 5 }, () => ({
              texture: 'textures/terrain-grass-a.png',
              tileSize: 2,
            })),
            splat: ['textures/village-splat-a.png'],
          },
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects unknown fields instead of dropping them', () => {
    const result = parseWorldDefinition({ ...validWorld, secret: true });
    expect(result.ok).toBe(false);
  });

  it('rejects duplicate entity ids inside a zone', () => {
    const zone = validWorld.zones[0];
    const entity = zone?.entities[0];
    const result = parseWorldDefinition({
      ...validWorld,
      zones: [{ ...zone, entities: [entity, entity] }],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a position that is not a 3-tuple', () => {
    const result = parseWorldDefinition({
      ...validWorld,
      zones: [
        {
          id: 'village',
          name: 'Village',
          entities: [{ id: 'tree_001', prefab: 'pine_tree_01', position: [1, 2] }],
        },
      ],
    });
    expect(result.ok).toBe(false);
  });
});

describe('the order a parsed world comes back in', () => {
  it('matches the order services/api writes a file in', () => {
    const parsed = parseWorldDefinition({
      schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
      id: 'village1',
      name: 'Village One',
      zones: [{ id: 'village', name: 'Village', entities: [] }],
      lighting: { sun: { intensity: 2 } },
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      // Zod rebuilds the object in schema order, so this *is* the order every
      // writer that round-trips through the schema produces.
      expect(Object.keys(parsed.world)).toEqual([
        'schemaVersion',
        'id',
        'name',
        'lighting',
        'zones',
      ]);
    }
  });
});
