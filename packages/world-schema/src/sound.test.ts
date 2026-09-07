import { describe, expect, it } from 'vitest';
import { CURRENT_WORLD_SCHEMA_VERSION, parseWorldDefinition } from './world.js';
import { SoundEmitterSchema, SoundProfileSchema } from './sound.js';

const world = {
  schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
  id: 'main',
  name: 'Main',
  zones: [{ id: 'village', name: 'Village', entities: [] }],
};

describe('the sound block', () => {
  it('is optional — a world that says nothing about sound still validates', () => {
    expect(parseWorldDefinition(world).ok).toBe(true);
  });

  it('is accepted on the world and on a zone', () => {
    const result = parseWorldDefinition({
      ...world,
      sound: { master: { volume: 0.8 } },
      zones: [
        {
          ...world.zones[0],
          sound: { ambience: { clip: 'audio/ambience/forest.ogg', volume: 0.35 } },
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('refuses a field it does not know, so a typo is not silently ignored', () => {
    const result = parseWorldDefinition({ ...world, sound: { ambiance: {} } });
    expect(result.ok).toBe(false);
  });

  it('refuses an ambience clip that is an absolute path', () => {
    const result = SoundProfileSchema.safeParse({ ambience: { clip: '/etc/passwd' } });
    expect(result.success).toBe(false);
  });

  it('refuses two emitters with the same id', () => {
    const result = SoundProfileSchema.safeParse({
      emitters: [
        { id: 'fire', prefab: 'brazier', clip: 'audio/emitters/fire.ogg' },
        { id: 'fire', prefab: 'candle', clip: 'audio/emitters/fire.ogg' },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('an emitter', () => {
  const clip = 'audio/emitters/fire-small-loop.ogg';

  it.each([
    ['a prefab rule', { prefab: 'environment-sm-prop-camp-brazier-01' }],
    ['one entity', { entity: 'village-e0421' }],
    ['a bare point', { position: [212, 14, 96] }],
  ])('accepts %s as its anchor', (_name, anchor) => {
    expect(SoundEmitterSchema.safeParse({ id: 'fire', clip, ...anchor }).success).toBe(true);
  });

  it('refuses no anchor at all — a sound has to be somewhere', () => {
    expect(SoundEmitterSchema.safeParse({ id: 'fire', clip }).success).toBe(false);
  });

  it('refuses two anchors — which one wins is not a question worth having', () => {
    const result = SoundEmitterSchema.safeParse({
      id: 'fire',
      clip,
      prefab: 'brazier',
      entity: 'village-e0421',
    });
    expect(result.success).toBe(false);
  });

  it('refuses an interval whose end is before its start', () => {
    const result = SoundEmitterSchema.safeParse({
      id: 'crows',
      clip,
      position: [0, 0, 0],
      intervalSeconds: [55, 18],
    });
    expect(result.success).toBe(false);
  });
});

describe('the version bump', () => {
  it('brings a v4 file forward and reports where it came from', () => {
    const result = parseWorldDefinition({ ...world, schemaVersion: 4 });
    expect(result.ok && result.migratedFrom).toBe(4);
    expect(result.ok && result.world.schemaVersion).toBe(CURRENT_WORLD_SCHEMA_VERSION);
  });

  it('adds no sound of its own — a silent world stays silent', () => {
    const result = parseWorldDefinition({ ...world, schemaVersion: 4 });
    expect(result.ok && result.world.sound).toBeUndefined();
  });
});
