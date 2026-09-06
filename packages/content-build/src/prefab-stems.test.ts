import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPrefabStems } from './prefab-stems.js';

let directory = '';

function catalog(id: string, prefabs: { id: string; asset: string }[]): string {
  return JSON.stringify({
    schemaVersion: 1,
    id,
    prefabs: prefabs.map((prefab) => ({
      ...prefab,
      name: prefab.id,
      visibility: 'public',
      category: 'prop',
    })),
  });
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'wov-prefab-stems-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('loadPrefabStems', () => {
  it('indexes a prefab by the store file name, folder and extension dropped', async () => {
    await writeFile(
      join(directory, 'imported.json'),
      catalog('imported', [
        { id: 'environment-sm-env-stonewall-01', asset: 'environment/sm-env-stonewall-01.glb' },
      ]),
    );
    const { byStem, ambiguous } = await loadPrefabStems(directory);
    expect(byStem.get('sm-env-stonewall-01')).toBe('environment-sm-env-stonewall-01');
    expect(ambiguous).toEqual([]);
  });

  it('drops a stem two catalogues claim instead of picking one', async () => {
    await writeFile(
      join(directory, 'a.json'),
      catalog('a', [{ id: 'barrel-01', asset: 'kit/detail-barrel.glb' }]),
    );
    await writeFile(
      join(directory, 'b.json'),
      catalog('b', [{ id: 'environment-detail-barrel', asset: 'environment/detail-barrel.glb' }]),
    );
    const { byStem, ambiguous } = await loadPrefabStems(directory);
    expect(byStem.has('detail-barrel')).toBe(false);
    expect(ambiguous).toEqual(['detail-barrel']);
  });

  it('names the file when a catalogue is invalid', async () => {
    await writeFile(join(directory, 'broken.json'), '{"schemaVersion":1,"id":"broken"}');
    await expect(loadPrefabStems(directory)).rejects.toThrow(/broken\.json/);
  });

  it('ignores anything that is not a catalogue file', async () => {
    await writeFile(join(directory, 'README.md'), 'not a catalogue');
    await expect(loadPrefabStems(directory)).resolves.toEqual({
      byStem: new Map(),
      ambiguous: [],
    });
  });
});
