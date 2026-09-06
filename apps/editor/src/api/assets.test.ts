import { describe, expect, it } from 'vitest';
import { createAssetIndex, emptyAssetIndex, loadAssetIndex } from './assets.js';

const MANIFEST = {
  manifestVersion: 2,
  generatedAt: '2026-09-06T12:00:00Z',
  assets: [
    {
      id: 'textures/terrain-grass-a',
      path: 'textures/terrain-grass-a.png',
      kind: 'texture',
      bytes: 12,
      hash: `sha256-${'a'.repeat(64)}`,
      origin: 'a test fixture',
      source: 'a test fixture',
      author: 'the test',
      license: 'NOASSERTION',
      redistributable: false,
      visibility: 'private',
      placeholder: 'placeholders/textures/terrain-grass-a.png',
    },
    {
      id: 'textures/terrain-rock-a',
      path: 'textures/terrain-rock-a.png',
      kind: 'texture',
      bytes: 12,
      hash: `sha256-${'b'.repeat(64)}`,
      origin: 'a test fixture',
      source: 'a test fixture',
      author: 'the test',
      license: 'NOASSERTION',
      redistributable: false,
      visibility: 'private',
      placeholder: 'placeholders/textures/terrain-rock-a.png',
    },
    {
      id: 'terrain/village-257',
      path: 'terrain/village-257.glb',
      kind: 'terrain',
      bytes: 12,
      hash: `sha256-${'c'.repeat(64)}`,
      bounds: { min: [0, 0, 0], max: [300, 40, 300] },
      origin: 'a test fixture',
      source: 'a test fixture',
      author: 'the test',
      license: 'NOASSERTION',
      redistributable: false,
      visibility: 'private',
      placeholder: 'placeholders/terrain/village-257.glb',
    },
  ],
};

function answering(body: unknown, status = 200): typeof fetch {
  return (() =>
    Promise.resolve({
      ok: status < 400,
      status,
      json: () => Promise.resolve(body),
    } as Response)) as unknown as typeof fetch;
}

describe('createAssetIndex', () => {
  it('groups paths by kind and sorts them, so the same store draws the same list', () => {
    const index = createAssetIndex([
      { path: 'textures/b.png', kind: 'texture' },
      { path: 'textures/a.png', kind: 'texture' },
      { path: 'terrain/one.glb', kind: 'terrain' },
    ]);
    expect(index.ofKind('texture')).toEqual(['textures/a.png', 'textures/b.png']);
    expect(index.ofKind('terrain')).toEqual(['terrain/one.glb']);
    expect(index.total).toBe(3);
  });

  it('answers an empty list for a kind nothing has, instead of undefined', () => {
    expect(createAssetIndex([]).ofKind('mesh')).toEqual([]);
    expect(emptyAssetIndex().ofKind('texture')).toEqual([]);
  });
});

describe('loadAssetIndex', () => {
  it('reads the manifest off the asset server', async () => {
    const index = await loadAssetIndex({ baseUrl: 'http://assets.test' }, answering(MANIFEST));
    expect(index.ofKind('texture')).toEqual([
      'textures/terrain-grass-a.png',
      'textures/terrain-rock-a.png',
    ]);
    expect(index.ofKind('terrain')).toEqual(['terrain/village-257.glb']);
  });

  it('asks the configured host, not a hard-coded one', async () => {
    const asked: string[] = [];
    const spy = ((url: string) => {
      asked.push(url);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(MANIFEST) });
    }) as unknown as typeof fetch;
    await loadAssetIndex({ baseUrl: 'http://assets.test/' }, spy);
    expect(asked).toEqual(['http://assets.test/manifest.json']);
  });

  it('says what answered when the asset server does not have one', async () => {
    await expect(
      loadAssetIndex({ baseUrl: 'http://assets.test' }, answering(null, 404)),
    ).rejects.toThrow(/404/);
  });

  /** A version skew must name itself, not surface as an empty dropdown. */
  it('refuses a manifest this build does not understand', async () => {
    await expect(
      loadAssetIndex(
        { baseUrl: 'http://assets.test' },
        answering({ manifestVersion: 99, generatedAt: '2026-09-06T12:00:00Z', assets: [] }),
      ),
    ).rejects.toThrow(/manifestVersion/);
  });
});
