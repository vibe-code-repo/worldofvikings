import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';

/** This checkout, for the fixture bundle and the catalogue it is matched against. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const fixtureScenes = join(repoRoot, 'tooling', 'fixtures', 'scenes');

let contentDir: string;
let app: FastifyInstance;

async function startServer(env: Record<string, string> = {}): Promise<FastifyInstance> {
  return buildServer(
    loadConfig({
      LOG_LEVEL: 'silent',
      CONTENT_DIR: contentDir,
      WOV_IMPORT_DIR: fixtureScenes,
      ...env,
    }),
  );
}

beforeEach(async () => {
  contentDir = await mkdtemp(join(tmpdir(), 'wov-api-actions-'));
  await mkdir(join(contentDir, 'worlds'), { recursive: true });
  await mkdir(join(contentDir, 'prefabs'), { recursive: true });
  // The real hand-written catalogue: the import matches bundle node names
  // against store file names, and `base.json` is the one every clone has.
  await cp(
    join(repoRoot, 'content', 'prefabs', 'base.json'),
    join(contentDir, 'prefabs', 'base.json'),
  );
});

afterEach(async () => {
  await app?.close();
  await rm(contentDir, { recursive: true, force: true });
});

/**
 * The claim ADR-0033 makes about this route: it is not "like" `pnpm
 * import:scene`, it *is* `pnpm import:scene` — the same function, over the same
 * fixture, writing the same file the editor would then open.
 */
describe('POST /actions/import-scene', () => {
  it('imports the fixture bundle into a world file', async () => {
    app = await startServer();
    const response = await app.inject({
      method: 'POST',
      url: '/actions/import-scene',
      payload: { scene: 'village-fixture.glb', world: 'fixture', name: 'Fixture World' },
    });

    expect(response.statusCode).toBe(200);
    const report = response.json<{ report: { entities: number; zones: { id: string }[] } }>()
      .report;
    expect(report.entities).toBe(2);
    expect(report.zones.map((zone) => zone.id)).toEqual(['village', 'interiors', 'surroundings']);

    const written = JSON.parse(await readFile(join(contentDir, 'worlds', 'fixture.json'), 'utf8'));
    expect(written.zones[0].entities).toHaveLength(2);
    expect(written.zones[0].entities[0].prefab).toBe('barrel-01');

    // And the file it wrote is one the API itself will serve.
    const reread = await app.inject({ method: 'GET', url: '/worlds/fixture' });
    expect(reread.statusCode).toBe(200);
  });

  it('writes nothing on a dry run but still reports what it would do', async () => {
    app = await startServer();
    const response = await app.inject({
      method: 'POST',
      url: '/actions/import-scene',
      payload: {
        scene: 'village-fixture.glb',
        world: 'fixture',
        name: 'Fixture World',
        dryRun: true,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ report: { entities: number } }>().report.entities).toBe(2);
    expect(await app.inject({ method: 'GET', url: '/worlds/fixture' })).toMatchObject({
      statusCode: 404,
    });
  });

  /**
   * ADR-0028: a bundle carries placements and nothing else, so re-importing
   * must not take the ground out from under them. The route runs the same
   * carry-over the command does.
   */
  it('carries an authored lighting block through a re-import', async () => {
    app = await startServer();
    const first = { scene: 'village-fixture.glb', world: 'fixture', name: 'Fixture World' };
    await app.inject({ method: 'POST', url: '/actions/import-scene', payload: first });

    const world = JSON.parse(await readFile(join(contentDir, 'worlds', 'fixture.json'), 'utf8'));
    await app.inject({
      method: 'PUT',
      url: '/worlds/fixture',
      payload: { ...world, lighting: { fog: { enabled: true, end: 120 } } },
    });

    const again = await app.inject({
      method: 'POST',
      url: '/actions/import-scene',
      payload: first,
    });
    expect(again.statusCode).toBe(200);
    expect(again.json<{ report: { lightingCarried: string[] } }>().report.lightingCarried).toEqual([
      'the world',
    ]);
    const reimported = JSON.parse(
      await readFile(join(contentDir, 'worlds', 'fixture.json'), 'utf8'),
    );
    expect(reimported.lighting).toEqual({ fog: { enabled: true, end: 120 } });
  });

  it('refuses a bundle outside WOV_IMPORT_DIR', async () => {
    app = await startServer();
    const response = await app.inject({
      method: 'POST',
      url: '/actions/import-scene',
      payload: { scene: '../../content/worlds/../../etc/passwd.glb', world: 'x', name: 'X' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toBe('invalid_scene_path');
  });

  it('answers 501 when the deployment has no import directory', async () => {
    app = await startServer({ WOV_IMPORT_DIR: '' });
    const response = await app.inject({
      method: 'POST',
      url: '/actions/import-scene',
      payload: { scene: 'village-fixture.glb', world: 'fixture', name: 'Fixture World' },
    });
    expect(response.statusCode).toBe(501);
    expect(response.json<{ error: string }>().error).toBe('not_configured');
  });

  it('refuses a world id that would not be a valid file name', async () => {
    app = await startServer();
    const response = await app.inject({
      method: 'POST',
      url: '/actions/import-scene',
      payload: { scene: 'village-fixture.glb', world: '../escape', name: 'X' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toBe('invalid_world_id');
  });

  it('says so instead of throwing when the bundle is not there', async () => {
    app = await startServer();
    const response = await app.inject({
      method: 'POST',
      url: '/actions/import-scene',
      payload: { scene: 'nothing-here.glb', world: 'fixture', name: 'X' },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json<{ error: string }>().error).toBe('import_failed');
  });

  it('writes nothing while the API is read-only', async () => {
    app = await startServer({ WORLDS_READ_ONLY: '1' });
    const response = await app.inject({
      method: 'POST',
      url: '/actions/import-scene',
      payload: { scene: 'village-fixture.glb', world: 'fixture', name: 'X' },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('POST /actions/generate-prefabs', () => {
  it('reports the reason instead of throwing when the manifest is not there', async () => {
    app = await startServer({ ASSETS_DIR: join(contentDir, 'no-assets') });
    const response = await app.inject({ method: 'POST', url: '/actions/generate-prefabs' });
    expect(response.statusCode).toBe(422);
    expect(response.json<{ errors: string[] }>().errors[0]).toContain('manifest');
  });

  it('writes nothing while the API is read-only', async () => {
    app = await startServer({ WORLDS_READ_ONLY: '1' });
    const response = await app.inject({ method: 'POST', url: '/actions/generate-prefabs' });
    expect(response.statusCode).toBe(403);
  });
});
