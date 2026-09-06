import { describe, expect, it, vi } from 'vitest';
import { ApiError, createEditorApi, splitPrefabs } from './client.js';

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
  schemaVersion: 1,
  id: 'harbour',
  name: 'Harbour',
  zones: [{ id: 'docks', name: 'Docks', entities: [] }],
};

const prefab = {
  id: 'barrel_01',
  name: 'Barrel 01',
  asset: 'environment/barrel.glb',
  visibility: 'public',
  category: 'prop',
};

describe('createEditorApi', () => {
  it('lists worlds and keeps the invalid ones visible', async () => {
    const api = createEditorApi(
      BASE,
      respond({
        worlds: [{ id: 'a', name: 'A', zones: 1, updatedAt: 'x' }],
        invalid: [{ id: 'b', errors: ['broken'] }],
      }),
    );

    const listing = await api.listWorlds();

    expect(listing.worlds).toHaveLength(1);
    expect(listing.invalid[0]?.id).toBe('b');
  });

  it('validates a loaded world instead of trusting the service', async () => {
    const api = createEditorApi(BASE, respond({ ...world, zones: 'not a list' }));

    await expect(api.loadWorld('harbour')).rejects.toThrow(/does not match the schema/);
  });

  it('returns a world that validates', async () => {
    const api = createEditorApi(BASE, respond(world));

    await expect(api.loadWorld('harbour')).resolves.toMatchObject({ id: 'harbour' });
  });

  it('sends a world as a PUT to its own id', async () => {
    const doFetch = respond({
      id: 'harbour',
      name: 'Harbour',
      zones: 1,
      updatedAt: 'x',
      created: true,
    });
    const api = createEditorApi(BASE, doFetch);

    const saved = await api.saveWorld(world as never);

    expect(saved.created).toBe(true);
    const [url, init] = (doFetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0] ?? ['', {}];
    expect(url).toBe('http://api.test/worlds/harbour');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toMatchObject({ id: 'harbour' });
  });

  it('reports the API’s own message on a failure', async () => {
    const api = createEditorApi(
      BASE,
      respond({ error: 'read_only', message: 'this deployment is read-only' }, { status: 403 }),
    );

    await expect(api.loadWorld('harbour')).rejects.toThrow('this deployment is read-only');
  });

  it('names the URL it could not reach, which is the usual mistake', async () => {
    const dead = vi.fn(async () => Promise.reject(new TypeError('failed to fetch')));
    const api = createEditorApi(BASE, dead as unknown as typeof fetch);

    await expect(api.listWorlds()).rejects.toBeInstanceOf(ApiError);
    await expect(api.listWorlds()).rejects.toThrow(/http:\/\/api\.test\/worlds/);
  });
});

describe('splitPrefabs', () => {
  it('keeps the catalog name, which is not part of the prefab format', () => {
    const listing = splitPrefabs([{ ...prefab, catalog: 'base' }]);

    expect(listing.prefabs).toEqual([{ ...prefab, catalog: 'base' }]);
    expect(listing.invalid).toEqual([]);
  });

  it('lists a prefab that does not validate instead of passing it on', () => {
    const listing = splitPrefabs([{ ...prefab, category: 'spaceship', catalog: 'base' }]);

    expect(listing.prefabs).toEqual([]);
    expect(listing.invalid[0]?.file).toBe('base');
    expect(listing.invalid[0]?.errors.join(' ')).toContain('category');
  });

  it('carries the service’s own complaints through', () => {
    const listing = splitPrefabs([], [{ file: 'broken.json', errors: ['schemaVersion 2'] }]);

    expect(listing.invalid).toEqual([{ file: 'broken.json', errors: ['schemaVersion 2'] }]);
  });
});
