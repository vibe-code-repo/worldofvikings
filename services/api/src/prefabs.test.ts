import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';

let contentDir: string;
let app: FastifyInstance;

async function startServer(): Promise<FastifyInstance> {
  return buildServer(loadConfig({ LOG_LEVEL: 'silent', CONTENT_DIR: contentDir }));
}

async function writeCatalog(name: string, contents: unknown): Promise<void> {
  const text = typeof contents === 'string' ? contents : `${JSON.stringify(contents, null, 2)}\n`;
  await writeFile(join(contentDir, 'prefabs', name), text, 'utf8');
}

beforeEach(async () => {
  contentDir = await mkdtemp(join(tmpdir(), 'wov-api-prefabs-'));
  await mkdir(join(contentDir, 'prefabs'), { recursive: true });
});

afterEach(async () => {
  await app?.close();
  await rm(contentDir, { recursive: true, force: true });
});

describe('GET /prefabs', () => {
  it('merges every catalog and says which one a prefab came from', async () => {
    await writeCatalog('vegetation.json', {
      schemaVersion: 1,
      id: 'vegetation',
      prefabs: [
        { id: 'pine_tree_01', name: 'Pine Tree 01', asset: 'models/pine_tree_01.glb' },
        { id: 'birch_tree_01', name: 'Birch Tree 01' },
      ],
    });
    await writeCatalog('buildings.json', {
      schemaVersion: 1,
      id: 'buildings',
      prefabs: [{ id: 'viking_house_01', name: 'Viking House 01' }],
    });
    app = await startServer();

    const response = await app.inject({ method: 'GET', url: '/prefabs' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.prefabs).toEqual([
      { id: 'birch_tree_01', name: 'Birch Tree 01', catalog: 'vegetation' },
      {
        id: 'pine_tree_01',
        name: 'Pine Tree 01',
        asset: 'models/pine_tree_01.glb',
        catalog: 'vegetation',
      },
      { id: 'viking_house_01', name: 'Viking House 01', catalog: 'buildings' },
    ]);
    expect(body.catalogs).toEqual([
      { id: 'buildings', file: 'buildings.json', prefabs: 1 },
      { id: 'vegetation', file: 'vegetation.json', prefabs: 2 },
    ]);
    expect(body.invalid).toEqual([]);
  });

  it('serves the valid catalogs and reports the broken one', async () => {
    await writeCatalog('good.json', {
      schemaVersion: 1,
      id: 'good',
      prefabs: [{ id: 'pine_tree_01', name: 'Pine Tree 01' }],
    });
    await writeCatalog('bad.json', { schemaVersion: 2, id: 'bad', prefabs: [] });
    await writeCatalog('worse.json', 'not json');
    app = await startServer();

    const body = (await app.inject({ method: 'GET', url: '/prefabs' })).json();

    expect(body.prefabs.map((prefab: { id: string }) => prefab.id)).toEqual(['pine_tree_01']);
    expect(body.invalid.map((entry: { file: string }) => entry.file)).toEqual([
      'bad.json',
      'worse.json',
    ]);
    expect(body.invalid[0].errors.join(' ')).toContain('schemaVersion');
  });

  it('keeps the first definition of a duplicated prefab id and reports the clash', async () => {
    await writeCatalog('a-first.json', {
      schemaVersion: 1,
      id: 'a_first',
      prefabs: [{ id: 'pine_tree_01', name: 'From A' }],
    });
    await writeCatalog('b-second.json', {
      schemaVersion: 1,
      id: 'b_second',
      prefabs: [{ id: 'pine_tree_01', name: 'From B' }],
    });
    app = await startServer();

    const body = (await app.inject({ method: 'GET', url: '/prefabs' })).json();

    expect(body.prefabs).toEqual([{ id: 'pine_tree_01', name: 'From A', catalog: 'a_first' }]);
    expect(body.invalid).toHaveLength(1);
    expect(body.invalid[0].file).toBe('b-second.json');
    expect(body.invalid[0].errors.join(' ')).toContain('pine_tree_01');
  });

  it('answers with an empty catalogue when the folder does not exist', async () => {
    await rm(join(contentDir, 'prefabs'), { recursive: true });
    app = await startServer();

    const response = await app.inject({ method: 'GET', url: '/prefabs' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ prefabs: [], catalogs: [], invalid: [] });
  });

  it('rejects a prefab entry without an id or name', async () => {
    await writeCatalog('vegetation.json', {
      schemaVersion: 1,
      id: 'vegetation',
      prefabs: [{ id: 'pine_tree_01' }],
    });
    app = await startServer();

    const body = (await app.inject({ method: 'GET', url: '/prefabs' })).json();

    expect(body.prefabs).toEqual([]);
    expect(body.invalid[0].errors.join(' ')).toContain('name');
  });
});
