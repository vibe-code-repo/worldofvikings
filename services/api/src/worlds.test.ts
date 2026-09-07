import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { CURRENT_WORLD_SCHEMA_VERSION } from '@wov/world-schema';
import type { WorldDefinition } from '@wov/world-schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { serializeWorld } from './world-file.js';
import { buildServer } from './server.js';

const VILLAGE_WORLD: WorldDefinition = {
  schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
  id: 'village',
  name: 'Village',
  zones: [
    { id: 'center', name: 'Center', entities: [] },
    {
      id: 'docks',
      name: 'Docks',
      entities: [{ id: 'tree_001', prefab: 'pine_tree_01', position: [1, 2, 3] }],
    },
  ],
};

let contentDir: string;
let app: FastifyInstance;

/** A server on a throwaway content directory, so tests never touch `content/`. */
async function startServer(env: NodeJS.ProcessEnv = {}): Promise<FastifyInstance> {
  const instance = await buildServer(
    loadConfig({ LOG_LEVEL: 'silent', CONTENT_DIR: contentDir, ...env }),
  );
  return instance;
}

async function writeWorldFile(name: string, contents: unknown): Promise<void> {
  const text = typeof contents === 'string' ? contents : `${JSON.stringify(contents, null, 2)}\n`;
  await writeFile(join(contentDir, 'worlds', name), text, 'utf8');
}

beforeEach(async () => {
  contentDir = await mkdtemp(join(tmpdir(), 'wov-api-worlds-'));
  await mkdir(join(contentDir, 'worlds'), { recursive: true });
});

afterEach(async () => {
  await app?.close();
  await rm(contentDir, { recursive: true, force: true });
});

describe('GET /worlds', () => {
  it('lists every world file with its zone count and modification time', async () => {
    await writeWorldFile('village.json', VILLAGE_WORLD);
    await writeWorldFile('example.json', { ...VILLAGE_WORLD, id: 'example', name: 'Example' });
    app = await startServer();

    const response = await app.inject({ method: 'GET', url: '/worlds' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.worlds).toEqual([
      { id: 'example', name: 'Example', zones: 2, updatedAt: expect.any(String) },
      { id: 'village', name: 'Village', zones: 2, updatedAt: expect.any(String) },
    ]);
    expect(Date.parse(body.worlds[0].updatedAt)).not.toBeNaN();
    expect(body.invalid).toEqual([]);
  });

  it('reports broken files instead of hiding them', async () => {
    await writeWorldFile('village.json', VILLAGE_WORLD);
    await writeWorldFile('broken.json', {
      schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
      id: 'broken',
    });
    app = await startServer();

    const body = (await app.inject({ method: 'GET', url: '/worlds' })).json();

    expect(body.worlds.map((world: { id: string }) => world.id)).toEqual(['village']);
    expect(body.invalid).toHaveLength(1);
    expect(body.invalid[0].id).toBe('broken');
    expect(body.invalid[0].errors.join(' ')).toContain('name');
  });

  it('answers with an empty list when the worlds folder does not exist', async () => {
    await rm(join(contentDir, 'worlds'), { recursive: true });
    app = await startServer();

    const response = await app.inject({ method: 'GET', url: '/worlds' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ worlds: [], invalid: [] });
  });
});

describe('GET /worlds/:id', () => {
  it('returns the stored world', async () => {
    await writeWorldFile('village.json', VILLAGE_WORLD);
    app = await startServer();

    const response = await app.inject({ method: 'GET', url: '/worlds/village' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(VILLAGE_WORLD);
  });

  it('answers 404 for a world that does not exist', async () => {
    app = await startServer();

    const response = await app.inject({ method: 'GET', url: '/worlds/missing' });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('not_found');
  });

  it('answers 422 with the validation errors for a broken file', async () => {
    await writeWorldFile('broken.json', {
      schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
      id: 'broken',
      name: 'Broken',
    });
    app = await startServer();

    const response = await app.inject({ method: 'GET', url: '/worlds/broken' });

    expect(response.statusCode).toBe(422);
    expect(response.json().error).toBe('invalid_world');
    expect(response.json().errors.join(' ')).toContain('zones');
  });

  it('answers 422 when the file is not JSON at all', async () => {
    await writeWorldFile('garbage.json', 'not json');
    app = await startServer();

    const response = await app.inject({ method: 'GET', url: '/worlds/garbage' });

    expect(response.statusCode).toBe(422);
    expect(response.json().error).toBe('invalid_world');
  });

  it('rejects ids that try to escape the content directory', async () => {
    app = await startServer();

    for (const id of ['..%2F..%2Fpackage', '.hidden', 'Village', 'a%2Fb']) {
      const response = await app.inject({ method: 'GET', url: `/worlds/${id}` });
      expect(response.statusCode, id).toBe(400);
      expect(response.json().error, id).toBe('invalid_world_id');
    }
  });
});

/**
 * The editor asks for the same 1.4 MB world on every open (ADR-0052). What is
 * asserted here is the pair that makes an empty answer possible *and* keeps a
 * changed file visible: a validator on the way out, and 304 only while the file
 * behind it is the same one.
 */
describe('GET /worlds/:id, asked conditionally', () => {
  it('sends validators the client can come back with', async () => {
    await writeWorldFile('village.json', VILLAGE_WORLD);
    app = await startServer();

    const response = await app.inject({ method: 'GET', url: '/worlds/village' });

    expect(response.headers['etag']).toMatch(/^W\/".+"$/);
    // An HTTP-date, not the ISO string this used to send — browsers ignore that
    // one silently, which is why the header looked present and did nothing.
    expect(response.headers['last-modified']).toMatch(/GMT$/);
    expect(Date.parse(String(response.headers['last-modified']))).not.toBeNaN();
    expect(response.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
    // `updatedAt` in the *body* is unchanged: it is what the client reads.
    expect(response.json()).toEqual(VILLAGE_WORLD);
  });

  it('answers 304 with no body when the client already holds this world', async () => {
    await writeWorldFile('village.json', VILLAGE_WORLD);
    app = await startServer();
    const first = await app.inject({ method: 'GET', url: '/worlds/village' });

    const second = await app.inject({
      method: 'GET',
      url: '/worlds/village',
      headers: { 'if-none-match': String(first.headers['etag']) },
    });

    expect(second.statusCode).toBe(304);
    expect(second.body).toBe('');
    // Repeated, or the next request has nothing to revalidate against.
    expect(second.headers['etag']).toBe(first.headers['etag']);
    expect(second.headers['last-modified']).toBe(first.headers['last-modified']);
  });

  it('answers 304 for an If-Modified-Since that is not older than the file', async () => {
    await writeWorldFile('village.json', VILLAGE_WORLD);
    app = await startServer();
    const first = await app.inject({ method: 'GET', url: '/worlds/village' });

    const response = await app.inject({
      method: 'GET',
      url: '/worlds/village',
      headers: { 'if-modified-since': String(first.headers['last-modified']) },
    });

    expect(response.statusCode).toBe(304);
  });

  it('sends the world again once the file changed', async () => {
    // The property the whole change has to keep: an author who saves is not
    // shown the version they replaced.
    await writeWorldFile('village.json', VILLAGE_WORLD);
    app = await startServer();
    const first = await app.inject({ method: 'GET', url: '/worlds/village' });

    await writeWorldFile('village.json', {
      ...VILLAGE_WORLD,
      name: 'Village by the fjord',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/worlds/village',
      headers: { 'if-none-match': String(first.headers['etag']) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().name).toBe('Village by the fjord');
    expect(response.headers['etag']).not.toBe(first.headers['etag']);
  });

  it('does not confuse two worlds that happen to share a modification time', async () => {
    await writeWorldFile('village.json', VILLAGE_WORLD);
    await writeWorldFile('example.json', { ...VILLAGE_WORLD, id: 'example', name: 'Example' });
    app = await startServer();

    const village = await app.inject({ method: 'GET', url: '/worlds/village' });
    const example = await app.inject({
      method: 'GET',
      url: '/worlds/example',
      headers: { 'if-none-match': String(village.headers['etag']) },
    });

    expect(example.statusCode).toBe(200);
    expect(example.json().name).toBe('Example');
  });
});

describe('GET /worlds, asked conditionally', () => {
  it('answers 304 while the listing is unchanged and 200 once it is not', async () => {
    await writeWorldFile('village.json', VILLAGE_WORLD);
    app = await startServer();
    const first = await app.inject({ method: 'GET', url: '/worlds' });

    expect(first.headers['etag']).toMatch(/^W\/".+"$/);
    // A listing is composed from several files and has no single modification
    // time; claiming one would be a claim nothing backs.
    expect(first.headers['last-modified']).toBeUndefined();

    const unchanged = await app.inject({
      method: 'GET',
      url: '/worlds',
      headers: { 'if-none-match': String(first.headers['etag']) },
    });
    expect(unchanged.statusCode).toBe(304);
    expect(unchanged.body).toBe('');

    await writeWorldFile('example.json', { ...VILLAGE_WORLD, id: 'example', name: 'Example' });
    const changed = await app.inject({
      method: 'GET',
      url: '/worlds',
      headers: { 'if-none-match': String(first.headers['etag']) },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().worlds).toHaveLength(2);
  });
});

describe('PUT /worlds/:id', () => {
  it('creates a world file and answers 201', async () => {
    app = await startServer();

    const response = await app.inject({
      method: 'PUT',
      url: '/worlds/village',
      payload: VILLAGE_WORLD,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ id: 'village', zones: 2, created: true });
    const written = await readFile(join(contentDir, 'worlds/village.json'), 'utf8');
    expect(written).toBe(serializeWorld(VILLAGE_WORLD));
    expect(written.endsWith('}\n')).toBe(true);
  });

  it('overwrites an existing world and answers 200', async () => {
    await writeWorldFile('village.json', VILLAGE_WORLD);
    app = await startServer();

    const response = await app.inject({
      method: 'PUT',
      url: '/worlds/village',
      payload: { ...VILLAGE_WORLD, name: 'Renamed' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: 'village', created: false });
    const stored = JSON.parse(await readFile(join(contentDir, 'worlds/village.json'), 'utf8'));
    expect(stored.name).toBe('Renamed');
  });

  it('leaves no temporary file behind', async () => {
    app = await startServer();

    await app.inject({ method: 'PUT', url: '/worlds/village', payload: VILLAGE_WORLD });

    expect(await readdir(join(contentDir, 'worlds'))).toEqual(['village.json']);
  });

  it('rejects an invalid world with 400 and keeps the old file', async () => {
    await writeWorldFile('village.json', VILLAGE_WORLD);
    app = await startServer();

    const response = await app.inject({
      method: 'PUT',
      url: '/worlds/village',
      payload: { schemaVersion: CURRENT_WORLD_SCHEMA_VERSION, id: 'village', name: 'Village' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invalid_world');
    expect(response.json().errors.join(' ')).toContain('zones');
    const stored = JSON.parse(await readFile(join(contentDir, 'worlds/village.json'), 'utf8'));
    expect(stored.name).toBe('Village');
  });

  it('rejects a body whose id does not match the url', async () => {
    app = await startServer();

    const response = await app.inject({
      method: 'PUT',
      url: '/worlds/village',
      payload: { ...VILLAGE_WORLD, id: 'harbour' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('id_mismatch');
    await expect(readdir(join(contentDir, 'worlds'))).resolves.toEqual([]);
  });

  it('rejects an unparseable body with 400 rather than failing', async () => {
    app = await startServer();

    const response = await app.inject({
      method: 'PUT',
      url: '/worlds/village',
      headers: { 'content-type': 'application/json' },
      payload: '{ this is not json',
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects an id that could escape the content directory', async () => {
    app = await startServer();

    const response = await app.inject({
      method: 'PUT',
      url: '/worlds/..%2Fescaped',
      payload: VILLAGE_WORLD,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invalid_world_id');
  });

  it('answers 403 and writes nothing when WORLDS_READ_ONLY is set', async () => {
    app = await startServer({ WORLDS_READ_ONLY: '1' });

    const response = await app.inject({
      method: 'PUT',
      url: '/worlds/village',
      payload: VILLAGE_WORLD,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('read_only');
    await expect(readdir(join(contentDir, 'worlds'))).resolves.toEqual([]);
  });

  it('still serves reads while write protection is on', async () => {
    await writeWorldFile('village.json', VILLAGE_WORLD);
    app = await startServer({ WORLDS_READ_ONLY: '1' });

    const response = await app.inject({ method: 'GET', url: '/worlds/village' });

    expect(response.statusCode).toBe(200);
  });
});
