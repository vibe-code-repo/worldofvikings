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

/** A minimal valid `PrefabDefinition` — exactly the fields `@wov/world-schema` requires. */
function prefab(
  id: string,
  name: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    name,
    asset: `models/${id}.glb`,
    visibility: 'public',
    category: 'prop',
    ...overrides,
  };
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
        prefab('pine_tree_01', 'Pine Tree 01', { category: 'vegetation' }),
        prefab('birch_tree_01', 'Birch Tree 01', { category: 'vegetation' }),
      ],
    });
    await writeCatalog('buildings.json', {
      schemaVersion: 1,
      id: 'buildings',
      prefabs: [prefab('viking_house_01', 'Viking House 01', { category: 'environment' })],
    });
    app = await startServer();

    const response = await app.inject({ method: 'GET', url: '/prefabs' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.prefabs).toEqual([
      {
        ...prefab('birch_tree_01', 'Birch Tree 01', { category: 'vegetation' }),
        catalog: 'vegetation',
      },
      {
        ...prefab('pine_tree_01', 'Pine Tree 01', { category: 'vegetation' }),
        catalog: 'vegetation',
      },
      {
        ...prefab('viking_house_01', 'Viking House 01', { category: 'environment' }),
        catalog: 'buildings',
      },
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
      prefabs: [prefab('pine_tree_01', 'Pine Tree 01')],
    });
    await writeCatalog('bad.json', { schemaVersion: 2, id: 'bad', prefabs: [] });
    await writeCatalog('worse.json', 'not json');
    app = await startServer();

    const body = (await app.inject({ method: 'GET', url: '/prefabs' })).json();

    expect(body.prefabs.map((entry: { id: string }) => entry.id)).toEqual(['pine_tree_01']);
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
      prefabs: [prefab('pine_tree_01', 'From A')],
    });
    await writeCatalog('b-second.json', {
      schemaVersion: 1,
      id: 'b_second',
      prefabs: [prefab('pine_tree_01', 'From B')],
    });
    app = await startServer();

    const body = (await app.inject({ method: 'GET', url: '/prefabs' })).json();

    expect(body.prefabs).toEqual([{ ...prefab('pine_tree_01', 'From A'), catalog: 'a_first' }]);
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

  it('rejects a prefab entry without a name', async () => {
    await writeCatalog('vegetation.json', {
      schemaVersion: 1,
      id: 'vegetation',
      prefabs: [
        { id: 'pine_tree_01', asset: 'models/pine.glb', visibility: 'public', category: 'prop' },
      ],
    });
    app = await startServer();

    const body = (await app.inject({ method: 'GET', url: '/prefabs' })).json();

    expect(body.prefabs).toEqual([]);
    expect(body.invalid[0].errors.join(' ')).toContain('name');
  });

  it('rejects a private prefab that has no placeholder', async () => {
    await writeCatalog('private.json', {
      schemaVersion: 1,
      id: 'private_kit',
      prefabs: [prefab('longhouse_01', 'Longhouse 01', { visibility: 'private' })],
    });
    app = await startServer();

    const body = (await app.inject({ method: 'GET', url: '/prefabs' })).json();

    expect(body.prefabs).toEqual([]);
    expect(body.invalid[0].errors.join(' ')).toContain('placeholder');
  });
});
