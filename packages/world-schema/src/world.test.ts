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

  it('rejects an unsupported schema version with a dedicated message', () => {
    const result = parseWorldDefinition({ ...validWorld, schemaVersion: 99 });
    expect(result).toEqual({
      ok: false,
      errors: ['unsupported schemaVersion 99, expected 1'],
    });
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
