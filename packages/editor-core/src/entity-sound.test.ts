import { describe, expect, it } from 'vitest';
import type { SoundProfile, WorldDefinition } from '@wov/world-schema';
import { applyCommand, setSound } from './commands.js';
import { createDocument } from './document.js';
import {
  addEntityEmitter,
  emitterForEntity,
  emitterIdFor,
  removeEmitterAt,
  zoneScopeOf,
} from './entity-sound.js';
import { entity, world, zone } from './test-support.js';
import type { SoundScope } from './blocks.js';

const CLIP = 'audio/emitters/fire-small-loop.ogg';

/** The zone scope, or a failure that names the reason rather than a `!`. */
function scopeOf(document: Parameters<typeof zoneScopeOf>[0]): SoundScope {
  const scope = zoneScopeOf(document);
  if (scope === null) {
    throw new Error('the fixture has no active zone');
  }
  return scope;
}

function villageWith(sound: SoundProfile | undefined): WorldDefinition {
  const base = world([
    zone('village', [
      entity('brazier_001', { prefab: 'camp-brazier-01' }),
      entity('brazier_002', { prefab: 'camp-brazier-01' }),
      entity('well_001', { prefab: 'well-01' }),
    ]),
  ]);
  return {
    ...base,
    zones: base.zones.map((each) => (sound === undefined ? each : { ...each, sound })),
  };
}

describe('emitterForEntity', () => {
  it('finds nothing in a zone with no sound block', () => {
    const document = createDocument(villageWith(undefined));
    expect(emitterForEntity(document, 'brazier_001')).toBeNull();
  });

  it('finds a prefab rule from any entity it matches, and says how many', () => {
    const document = createDocument(
      villageWith({ emitters: [{ id: 'fires', prefab: 'camp-brazier-01', clip: CLIP }] }),
    );
    const found = emitterForEntity(document, 'brazier_002');
    expect(found?.via).toBe('prefab');
    expect(found?.index).toBe(0);
    // The number the panel warns with: editing this changes both braziers.
    expect(found?.matches).toBe(2);
    // …and it does not reach the well, which is a different prefab.
    expect(emitterForEntity(document, 'well_001')).toBeNull();
  });

  it('prefers the emitter that names the entity over a rule that merely matches it', () => {
    const document = createDocument(
      villageWith({
        emitters: [
          { id: 'fires', prefab: 'camp-brazier-01', clip: CLIP },
          { id: 'loud-one', entity: 'brazier_002', clip: CLIP, volume: 2 },
        ],
      }),
    );
    const found = emitterForEntity(document, 'brazier_002');
    expect(found?.via).toBe('entity');
    expect(found?.emitter.id).toBe('loud-one');
    expect(found?.matches).toBe(1);
    // The other brazier still hears the rule.
    expect(emitterForEntity(document, 'brazier_001')?.emitter.id).toBe('fires');
  });

  it('finds nothing for an entity that is not in the active zone', () => {
    const document = createDocument(
      villageWith({ emitters: [{ id: 'fires', prefab: 'camp-brazier-01', clip: CLIP }] }),
    );
    expect(emitterForEntity(document, 'nobody')).toBeNull();
  });
});

describe('emitterIdFor', () => {
  it('derives the id from the entity so the same entity twice is the same id', () => {
    expect(emitterIdFor('brazier_001', [])).toBe('brazier_001-sound');
    expect(emitterIdFor('brazier_001', [])).toBe('brazier_001-sound');
  });

  it('steps past an id that is taken rather than producing a duplicate', () => {
    expect(emitterIdFor('brazier_001', ['brazier_001-sound'])).toBe('brazier_001-sound-2');
    expect(emitterIdFor('brazier_001', ['brazier_001-sound', 'brazier_001-sound-2'])).toBe(
      'brazier_001-sound-3',
    );
  });
});

describe('adding an emitter to a selected entity', () => {
  it('writes one that the schema accepts, into a zone that had no sound block', () => {
    const document = createDocument(villageWith(undefined));
    const patch = addEntityEmitter({ profile: undefined, entityId: 'well_001', clip: CLIP });
    const applied = applyCommand(document, setSound(scopeOf(document), [patch]));
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }

    const after = createDocument(applied.value.document.world);
    const found = emitterForEntity(after, 'well_001');
    expect(found?.via).toBe('entity');
    expect(found?.emitter).toEqual({
      id: 'well_001-sound',
      entity: 'well_001',
      clip: CLIP,
      loop: true,
    });
  });

  it('is one undo step, and the undo takes the whole block back out', () => {
    const document = createDocument(villageWith(undefined));
    const applied = applyCommand(
      document,
      setSound(scopeOf(document), [
        addEntityEmitter({ profile: undefined, entityId: 'well_001', clip: CLIP }),
      ]),
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }

    const undone = applyCommand(applied.value.document, applied.value.inverse);
    expect(undone.ok).toBe(true);
    if (!undone.ok) {
      return;
    }
    // Not an empty `emitters` array — no `sound` key at all, which is what the
    // file said before.
    expect(undone.value.document.world.zones[0]?.sound).toBeUndefined();
  });

  it('refuses a second emitter that would duplicate an id', () => {
    const existing: SoundProfile = {
      emitters: [{ id: 'well_001-sound', entity: 'well_001', clip: CLIP }],
    };
    const document = createDocument(villageWith(existing));
    const patch = addEntityEmitter({ profile: existing, entityId: 'well_001', clip: CLIP });
    const applied = applyCommand(document, setSound(scopeOf(document), [patch]));
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    const ids = applied.value.document.world.zones[0]?.sound?.emitters?.map((each) => each.id);
    expect(ids).toEqual(['well_001-sound', 'well_001-sound-2']);
  });
});

describe('removeEmitterAt', () => {
  it('leaves the rest of the list in order', () => {
    const profile: SoundProfile = {
      emitters: [
        { id: 'a', entity: 'well_001', clip: CLIP },
        { id: 'b', prefab: 'camp-brazier-01', clip: CLIP },
        { id: 'c', position: [0, 0, 0], clip: CLIP },
      ],
    };
    const patch = removeEmitterAt(profile, 1);
    expect(patch.path).toEqual(['emitters']);
    expect((patch.value as { id: string }[]).map((each) => each.id)).toEqual(['a', 'c']);
  });
});
