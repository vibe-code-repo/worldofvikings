import { describe, expect, it, vi } from 'vitest';
import { WorldApiError, createWorldApi, readPrefabs } from './world-api.js';

const BASE = 'http://api.test';

function respond(body: unknown, init: ResponseInit = {}): typeof fetch {
  return vi.fn(async () =>
    Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
        ...init,
      }),
    ),
  ) as unknown as typeof fetch;
}

const world = {
  schemaVersion: 2,
  id: 'village1',
  name: 'Village One',
  zones: [{ id: 'village', name: 'Village', entities: [] }],
};

const prefab = {
  id: 'barrel-01',
  name: 'Barrel 01',
  asset: 'environment/barrel.glb',
  visibility: 'public',
  category: 'prop',
  catalog: 'imported',
};

describe('createWorldApi', () => {
  it('returns a world that validates', async () => {
    const api = createWorldApi(BASE, respond(world));
    await expect(api.loadWorld('village1')).resolves.toMatchObject({ id: 'village1' });
  });

  it('validates the answer instead of trusting the service', async () => {
    const api = createWorldApi(BASE, respond({ ...world, zones: 'not a list' }));
    await expect(api.loadWorld('village1')).rejects.toThrow(/does not match the schema/);
  });

  it('names the URL it could not reach', async () => {
    const failing = vi.fn(async () =>
      Promise.reject(new Error('offline')),
    ) as unknown as typeof fetch;
    const api = createWorldApi(BASE, failing);
    const failure = await api.loadWorld('village1').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(WorldApiError);
    expect(failure).toMatchObject({ url: `${BASE}/worlds/village1` });
    expect(String(failure)).toContain(`cannot reach the API at ${BASE}/worlds/village1`);
  });

  it('reports the API own message for a failed request', async () => {
    const api = createWorldApi(
      BASE,
      respond({ error: 'not found', message: 'no world "ghost"' }, { status: 404 }),
    );
    await expect(api.loadWorld('ghost')).rejects.toThrow('no world "ghost"');
  });

  it('reads the prefab catalogue', async () => {
    const api = createWorldApi(BASE, respond({ prefabs: [prefab] }));
    await expect(api.loadPrefabs()).resolves.toEqual([
      expect.objectContaining({ id: 'barrel-01', asset: 'environment/barrel.glb' }),
    ]);
  });
});

describe('readPrefabs', () => {
  it('strips the catalog field the API adds before validating', () => {
    const { prefabs, invalid } = readPrefabs({ prefabs: [prefab] });
    expect(invalid).toEqual([]);
    expect(prefabs[0]).not.toHaveProperty('catalog');
  });

  it('keeps the good rows when one is broken, and names the problem', () => {
    const { prefabs, invalid } = readPrefabs({
      prefabs: [prefab, { ...prefab, id: 'Bad Id' }],
    });
    expect(prefabs.map((entry) => entry.id)).toEqual(['barrel-01']);
    expect(invalid).toHaveLength(1);
  });

  it('says so when the answer carries no list at all', () => {
    expect(readPrefabs({}).invalid).toEqual(['the API answered without a "prefabs" list']);
    expect(readPrefabs(null).prefabs).toEqual([]);
  });

  it('rejects a row that is not an object', () => {
    const { prefabs, invalid } = readPrefabs({ prefabs: [prefab, 'nonsense'] });
    expect(prefabs).toHaveLength(1);
    expect(invalid[0]).toMatch(/expected a prefab object/);
  });
});
