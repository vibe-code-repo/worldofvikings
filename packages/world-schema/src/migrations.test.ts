import { describe, expect, it } from 'vitest';
import { migrateWorldData } from './migrations.js';
import { CURRENT_WORLD_SCHEMA_VERSION } from './world.js';

describe('migrateWorldData', () => {
  it('leaves a current file untouched and reports no step', () => {
    const data = { schemaVersion: CURRENT_WORLD_SCHEMA_VERSION, id: 'main' };
    const result = migrateWorldData(data, CURRENT_WORLD_SCHEMA_VERSION);
    expect(result).toEqual({
      ok: true,
      data,
      from: CURRENT_WORLD_SCHEMA_VERSION,
      to: CURRENT_WORLD_SCHEMA_VERSION,
    });
  });

  it('upgrades version 1 additively: only the version number changes', () => {
    const v1 = { schemaVersion: 1, id: 'main', name: 'Main', zones: [] };
    const result = migrateWorldData(v1, 2);
    expect(result).toEqual({
      ok: true,
      data: { schemaVersion: 2, id: 'main', name: 'Main', zones: [] },
      from: 1,
      to: 2,
    });
  });

  it('does not mutate the document it was given', () => {
    const v1 = { schemaVersion: 1, id: 'main' };
    migrateWorldData(v1, 2);
    expect(v1.schemaVersion).toBe(1);
  });

  it('refuses a version newer than this build', () => {
    const result = migrateWorldData({ schemaVersion: 3 }, 2);
    expect(result.ok).toBe(false);
  });

  it('refuses a version with no recorded step', () => {
    const result = migrateWorldData({ schemaVersion: 0 }, 2);
    expect(result).toEqual({ ok: false, error: 'unsupported schemaVersion 0, expected 2' });
  });

  it('refuses a non-integer version instead of rounding it', () => {
    expect(migrateWorldData({ schemaVersion: '1' }, 2).ok).toBe(false);
    expect(migrateWorldData({ schemaVersion: 1.5 }, 2).ok).toBe(false);
  });

  it('passes a document with no version on, so the schema reports the missing field', () => {
    const result = migrateWorldData({ id: 'main' }, 2);
    expect(result).toEqual({ ok: true, data: { id: 'main' }, from: 2, to: 2 });
  });
});
