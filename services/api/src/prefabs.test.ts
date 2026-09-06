import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { format } from 'prettier';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';

let contentDir: string;
let app: FastifyInstance;

async function startServer(): Promise<FastifyInstance> {
  return buildServer(loadConfig({ LOG_LEVEL: 'silent', CONTENT_DIR: contentDir }));
}

async function startReadOnly(): Promise<FastifyInstance> {
  return buildServer(
    loadConfig({ LOG_LEVEL: 'silent', CONTENT_DIR: contentDir, WORLDS_READ_ONLY: '1' }),
  );
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
      { id: 'buildings', file: 'buildings.json', prefabs: 1, overlay: false },
      { id: 'vegetation', file: 'vegetation.json', prefabs: 2, overlay: false },
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

/**
 * The overlay (ADR-0033).
 *
 * `imported.json` is rewritten whole by `generate:prefabs`, so a collision
 * shape corrected in the editor cannot be saved there — the next regeneration
 * would revert it with no error and no diff anybody reads. `overrides.json` is
 * the one file that may redefine a prefab, and it is applied last.
 */
describe('the overrides catalogue', () => {
  it('replaces a generated prefab instead of clashing with it', async () => {
    await writeCatalog('imported.json', {
      schemaVersion: 1,
      id: 'imported',
      prefabs: [prefab('pine_tree_01', 'Pine Tree 01', { collision: { kind: 'box' } })],
    });
    await writeCatalog('overrides.json', {
      schemaVersion: 1,
      id: 'overrides',
      prefabs: [prefab('pine_tree_01', 'Pine Tree 01', { collision: { kind: 'none' } })],
    });
    app = await startServer();

    const body = (await app.inject({ method: 'GET', url: '/prefabs' })).json();

    expect(body.invalid).toEqual([]);
    expect(body.prefabs).toHaveLength(1);
    expect(body.prefabs[0].collision).toEqual({ kind: 'none' });
    expect(body.prefabs[0].catalog).toBe('overrides');
  });

  /** Alphabetically `overrides.json` comes before `zzz.json`; precedence is not alphabetical. */
  it('wins over a catalogue that is read after it', async () => {
    await writeCatalog('overrides.json', {
      schemaVersion: 1,
      id: 'overrides',
      prefabs: [prefab('pine_tree_01', 'Corrected')],
    });
    await writeCatalog('zzz.json', {
      schemaVersion: 1,
      id: 'zzz',
      prefabs: [prefab('pine_tree_01', 'Original')],
    });
    app = await startServer();

    const body = (await app.inject({ method: 'GET', url: '/prefabs' })).json();
    expect(body.prefabs[0].name).toBe('Corrected');
    expect(body.invalid).toEqual([]);
  });

  it('can also carry a prefab no other catalogue declares', async () => {
    await writeCatalog('overrides.json', {
      schemaVersion: 1,
      id: 'overrides',
      prefabs: [prefab('only_here', 'Only Here')],
    });
    app = await startServer();

    const body = (await app.inject({ method: 'GET', url: '/prefabs' })).json();
    expect(body.prefabs.map((entry: { id: string }) => entry.id)).toEqual(['only_here']);
  });
});

describe('GET /prefabs/:catalog', () => {
  it('serves one catalogue file', async () => {
    await writeCatalog('base.json', {
      schemaVersion: 1,
      id: 'base',
      prefabs: [prefab('barrel_01', 'Barrel')],
    });
    app = await startServer();

    const response = await app.inject({ method: 'GET', url: '/prefabs/base' });
    expect(response.statusCode).toBe(200);
    expect(response.json().prefabs).toHaveLength(1);
  });

  it('answers 404 for a catalogue that is not there', async () => {
    app = await startServer();
    expect((await app.inject({ method: 'GET', url: '/prefabs/nothing' })).statusCode).toBe(404);
  });

  it('refuses an id that is not a valid file name', async () => {
    app = await startServer();
    const response = await app.inject({ method: 'GET', url: '/prefabs/..%2f..%2fsecrets' });
    expect(response.statusCode).toBe(400);
  });

  it('answers 422 when the stored file is broken, because the request was fine', async () => {
    await writeCatalog('broken.json', { schemaVersion: 9, id: 'broken', prefabs: [] });
    app = await startServer();
    expect((await app.inject({ method: 'GET', url: '/prefabs/broken' })).statusCode).toBe(422);
  });
});

describe('PUT /prefabs/:catalog', () => {
  const overrides = {
    schemaVersion: 1,
    id: 'overrides',
    prefabs: [prefab('pine_tree_01', 'Pine Tree 01', { collision: { kind: 'hull' } })],
  };

  it('creates the file and then updates it', async () => {
    app = await startServer();

    const created = await app.inject({
      method: 'PUT',
      url: '/prefabs/overrides',
      payload: overrides,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ id: 'overrides', prefabs: 1, created: true });

    const updated = await app.inject({
      method: 'PUT',
      url: '/prefabs/overrides',
      payload: overrides,
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().created).toBe(false);
  });

  /** The file the API writes has to be one `pnpm format:check` leaves alone. */
  it('writes the catalogue the way Prettier would', async () => {
    app = await startServer();
    await app.inject({ method: 'PUT', url: '/prefabs/overrides', payload: overrides });

    const text = await readFile(join(contentDir, 'prefabs', 'overrides.json'), 'utf8');
    // The acceptance criterion is `pnpm format:check`, which is idempotency:
    // Prettier run over the written file must not change a byte of it.
    expect(await format(text, { parser: 'json' })).toBe(text);
  });

  it('refuses a body that is not a catalogue', async () => {
    app = await startServer();
    const response = await app.inject({
      method: 'PUT',
      url: '/prefabs/overrides',
      payload: { schemaVersion: 1, id: 'overrides', prefabs: [{ id: 'x' }] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invalid_prefab_catalog');
  });

  it('refuses a catalogue whose id does not match the url', async () => {
    app = await startServer();
    const response = await app.inject({
      method: 'PUT',
      url: '/prefabs/base',
      payload: overrides,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('id_mismatch');
  });

  it('answers 403 while the API is read-only', async () => {
    app = await startReadOnly();
    const response = await app.inject({
      method: 'PUT',
      url: '/prefabs/overrides',
      payload: overrides,
    });
    expect(response.statusCode).toBe(403);
  });
});
