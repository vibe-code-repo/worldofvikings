import { describe, expect, it } from 'vitest';
import { parseWorldDefinition } from '@wov/world-schema';
import {
  activeZone,
  createDocument,
  createEmptyWorld,
  findEntity,
  findZone,
  markSaved,
  selectedEntities,
  serializeDocument,
} from './document.js';
import { entity, villageWorld, world, zone } from './test-support.js';

describe('createDocument', () => {
  it('starts clean, unselected and on the first zone', () => {
    const document = createDocument(villageWorld());
    expect(document.dirty).toBe(false);
    expect(document.selection).toEqual([]);
    expect(document.activeZoneId).toBe('village');
  });

  it('has no active zone in an empty world', () => {
    expect(createDocument(createEmptyWorld('draft', 'Draft')).activeZoneId).toBe(null);
  });
});

describe('createEmptyWorld', () => {
  it('creates a document that validates against the world schema', () => {
    expect(parseWorldDefinition(createEmptyWorld('draft', 'Draft World')).ok).toBe(true);
  });
});

describe('lookups', () => {
  const document = createDocument(villageWorld());

  it('finds a zone and an entity, and says nothing when there is none', () => {
    expect(findZone(document, 'village')?.id).toBe('village');
    expect(findZone(document, 'nowhere')).toBeUndefined();
    expect(activeZone(document)?.id).toBe('village');
    expect(findEntity(document, 'village', 'barrel_002')?.id).toBe('barrel_002');
    expect(findEntity(document, 'village', 'ghost')).toBeUndefined();
  });

  it('resolves the selection to entities in file order', () => {
    const selected = { ...document, selection: ['barrel_003', 'barrel_001'] };
    expect(selectedEntities(selected).map((found) => found.id)).toEqual([
      'barrel_001',
      'barrel_003',
    ]);
  });
});

describe('markSaved', () => {
  it('clears the dirty flag without touching the world', () => {
    const document = { ...createDocument(villageWorld()), dirty: true };
    const saved = markSaved(document);
    expect(saved.dirty).toBe(false);
    expect(saved.world).toBe(document.world);
  });
});

describe('serializeDocument', () => {
  it('returns the world when it is valid', () => {
    const result = serializeDocument(createDocument(villageWorld()));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.world.zones[0]?.entities).toHaveLength(3);
    }
  });

  it('reports the schema errors instead of writing a broken world', () => {
    // A world the commands cannot produce, but a caller can construct: two
    // zones with the same id. Saving must fail loudly, not later at load time.
    const broken = createDocument(world([zone('village', [entity('barrel_001')])]));
    const result = serializeDocument({
      ...broken,
      world: { ...broken.world, zones: [...broken.world.zones, ...broken.world.zones] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('duplicate zone id');
    }
  });
});
