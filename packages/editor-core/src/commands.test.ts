import { describe, expect, it } from 'vitest';
import type { EditorDocument } from './document.js';
import { createDocument } from './document.js';
import {
  addEntity,
  addZone,
  applyCommand,
  duplicateEntities,
  invertCommand,
  removeEntities,
  removeZone,
  renameEntity,
  updateTransform,
  type EditorCommand,
} from './commands.js';
import { setSelection } from './selection.js';
import { entity, entityIds, villageWorld, world, zone } from './test-support.js';

const document = createDocument(villageWorld());

function apply(source: EditorDocument, command: EditorCommand): EditorDocument {
  const result = applyCommand(source, command);
  if (!result.ok) {
    throw new Error(`command failed: ${result.error}`);
  }
  return result.value.document;
}

function inverseOf(source: EditorDocument, command: EditorCommand): EditorCommand {
  const result = applyCommand(source, command);
  if (!result.ok) {
    throw new Error(`command failed: ${result.error}`);
  }
  return result.value.inverse;
}

/** Applying a command and then its inverse must restore the world exactly. */
function expectRoundtrip(source: EditorDocument, command: EditorCommand): void {
  const applied = apply(source, command);
  const restored = apply(applied, inverseOf(source, command));
  expect(restored.world).toEqual(source.world);
}

describe('addEntity', () => {
  const command = addEntity('village', entity('barrel_004'));

  it('appends the entity and reports it as created', () => {
    const result = applyCommand(document, command);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(entityIds(result.value.document.world, 'village')).toEqual([
        'barrel_001',
        'barrel_002',
        'barrel_003',
        'barrel_004',
      ]);
      expect(result.value.createdEntityIds).toEqual(['barrel_004']);
      expect(result.value.document.dirty).toBe(true);
    }
  });

  it('leaves the original document untouched', () => {
    apply(document, command);
    expect(entityIds(document.world, 'village')).toHaveLength(3);
  });

  it('rejects an unknown zone', () => {
    const result = applyCommand(document, addEntity('nowhere', entity('barrel_004')));
    expect(result).toEqual({ ok: false, error: 'unknown zone "nowhere"' });
  });

  it('rejects an id that is already taken', () => {
    const result = applyCommand(document, addEntity('village', entity('barrel_002')));
    expect(result.ok).toBe(false);
  });

  it('rejects an entity the world schema would reject', () => {
    const result = applyCommand(
      document,
      addEntity('village', entity('Barrel_004', { prefab: 'barrel-01' })),
    );
    expect(result.ok).toBe(false);
  });

  it('undoes by removing what it added', () => {
    expectRoundtrip(document, command);
    expect(inverseOf(document, command)).toEqual(removeEntities('village', ['barrel_004']));
  });
});

describe('removeEntities', () => {
  const command = removeEntities('village', ['barrel_001', 'barrel_003']);

  it('removes every named entity', () => {
    expect(entityIds(apply(document, command).world, 'village')).toEqual(['barrel_002']);
  });

  it('drops the removed entities from the selection', () => {
    const selected = setSelection(document, ['barrel_001', 'barrel_002']);
    expect(apply(selected, command).selection).toEqual(['barrel_002']);
  });

  it('rejects an entity that is not there', () => {
    expect(applyCommand(document, removeEntities('village', ['ghost'])).ok).toBe(false);
  });

  it('undoes by putting the entities back where they were', () => {
    const restored = apply(apply(document, command), inverseOf(document, command));
    expect(entityIds(restored.world, 'village')).toEqual([
      'barrel_001',
      'barrel_002',
      'barrel_003',
    ]);
    expectRoundtrip(document, command);
  });
});

describe('updateTransform', () => {
  const command = updateTransform('village', [
    { entityId: 'barrel_001', patch: { position: [1, 2, 3], rotation: [0, 1, 0] } },
  ]);

  it('writes the new transform', () => {
    const moved = apply(document, command);
    expect(moved.world.zones[0]?.entities[0]).toMatchObject({
      position: [1, 2, 3],
      rotation: [0, 1, 0],
    });
  });

  it('removes an optional field when the patch is null', () => {
    const rotated = apply(document, command);
    const cleared = apply(
      rotated,
      updateTransform('village', [{ entityId: 'barrel_001', patch: { rotation: null } }]),
    );
    expect(cleared.world.zones[0]?.entities[0] ?? {}).not.toHaveProperty('rotation');
  });

  it('rejects an entity that is not there', () => {
    const result = applyCommand(
      document,
      updateTransform('village', [{ entityId: 'ghost', patch: { position: [0, 0, 0] } }]),
    );
    expect(result.ok).toBe(false);
  });

  it('undoes back to the previous transform, including a field that was absent', () => {
    expectRoundtrip(document, command);
    expect(inverseOf(document, command)).toEqual(
      updateTransform('village', [
        { entityId: 'barrel_001', patch: { position: [0, 0, 0], rotation: null } },
      ]),
    );
  });
});

describe('duplicateEntities', () => {
  const command = duplicateEntities('village', ['barrel_001'], { offset: [1, 0, 0] });

  it('copies the entity with a deterministic id and the offset applied', () => {
    const result = applyCommand(document, command);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.createdEntityIds).toEqual(['barrel-01_001']);
      expect(result.value.document.world.zones[0]?.entities[3]).toMatchObject({
        id: 'barrel-01_001',
        prefab: 'barrel-01',
        position: [1, 0, 0],
      });
    }
  });

  it('gives every copy of one batch its own id', () => {
    const result = applyCommand(
      document,
      duplicateEntities('village', ['barrel_001', 'barrel_002']),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.createdEntityIds).toEqual(['barrel-01_001', 'barrel-01_002']);
    }
  });

  it('does not depend on the order the ids are named in', () => {
    const forwards = apply(document, duplicateEntities('village', ['barrel_001', 'barrel_002']));
    const backwards = apply(document, duplicateEntities('village', ['barrel_002', 'barrel_001']));
    expect(forwards.world).toEqual(backwards.world);
  });

  it('undoes by removing the copies', () => {
    expectRoundtrip(document, command);
    expect(inverseOf(document, command)).toEqual(removeEntities('village', ['barrel-01_001']));
  });
});

describe('renameEntity', () => {
  const command = renameEntity('village', 'barrel_002', 'barrel_042');

  it('renames in place, keeping its position in the file', () => {
    expect(entityIds(apply(document, command).world, 'village')).toEqual([
      'barrel_001',
      'barrel_042',
      'barrel_003',
    ]);
  });

  it('follows the rename in the selection', () => {
    const selected = setSelection(document, ['barrel_002']);
    expect(apply(selected, command).selection).toEqual(['barrel_042']);
  });

  it('rejects an id the world schema would reject, and one that is taken', () => {
    expect(applyCommand(document, renameEntity('village', 'barrel_002', 'Barrel')).ok).toBe(false);
    expect(applyCommand(document, renameEntity('village', 'barrel_002', 'barrel_003')).ok).toBe(
      false,
    );
  });

  it('undoes by renaming back', () => {
    expectRoundtrip(document, command);
    expect(inverseOf(document, command)).toEqual(
      renameEntity('village', 'barrel_042', 'barrel_002'),
    );
  });
});

describe('addZone', () => {
  const command = addZone(zone('forest', [entity('pine_001', { prefab: 'pine-1b1' })]));

  it('appends the zone', () => {
    expect(apply(document, command).world.zones.map((added) => added.id)).toEqual([
      'village',
      'forest',
    ]);
  });

  it('activates the new zone when the world had none', () => {
    const empty = createDocument(world([]));
    expect(apply(empty, command).activeZoneId).toBe('forest');
  });

  it('rejects a zone id that already exists', () => {
    expect(applyCommand(document, addZone(zone('village', []))).ok).toBe(false);
  });

  it('undoes by removing the zone', () => {
    expectRoundtrip(document, command);
    expect(inverseOf(document, command)).toEqual(removeZone('forest'));
  });
});

describe('removeZone', () => {
  const twoZones = createDocument(
    world([zone('village', [entity('barrel_001')]), zone('forest', [])]),
  );

  it('moves the active zone and clears the selection when the active zone goes', () => {
    const selected = setSelection(twoZones, ['barrel_001']);
    const removed = apply(selected, removeZone('village'));
    expect(removed.activeZoneId).toBe('forest');
    expect(removed.selection).toEqual([]);
  });

  it('leaves no active zone when the last one goes', () => {
    const one = createDocument(world([zone('village', [])]));
    expect(apply(one, removeZone('village')).activeZoneId).toBe(null);
  });

  it('undoes by putting the zone back at its old index, entities and all', () => {
    expectRoundtrip(twoZones, removeZone('village'));
  });
});

describe('invertCommand', () => {
  it('computes the inverse without applying anything', () => {
    const result = invertCommand(document, removeEntities('village', ['barrel_001']));
    expect(result.ok).toBe(true);
    expect(entityIds(document.world, 'village')).toHaveLength(3);
  });

  it('reports the same error the command would fail with', () => {
    expect(invertCommand(document, removeEntities('nowhere', []))).toEqual({
      ok: false,
      error: 'unknown zone "nowhere"',
    });
  });
});
