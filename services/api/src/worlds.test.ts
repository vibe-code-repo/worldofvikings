import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { WorldDefinition } from '@wov/world-schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { serializeWorld } from './world-file.js';
import { buildServer } from './server.js';

const VILLAGE_WORLD: WorldDefinition = {
  schemaVersion: 1,
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
    await writeWorldFile('broken.json', { schemaVersion: 1, id: 'broken' });
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
    await writeWorldFile('broken.json', { schemaVersion: 1, id: 'broken', name: 'Broken' });
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
      payload: { schemaVersion: 1, id: 'village', name: 'Village' },
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
