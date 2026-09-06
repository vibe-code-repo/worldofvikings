/**
 * The content actions: the two build steps, run for the editor (ADR-0033).
 *
 * `POST /actions/import-scene` and `POST /actions/generate-prefabs` call
 * `importSceneBundle` and `generatePrefabCatalog` from `@wov/content-build` —
 * the same functions `pnpm import:scene` and `pnpm generate:prefabs` call, with
 * the same serialiser this service uses for every other file it writes. That is
 * the whole point of the editor-parity rule: not "the editor can do something
 * similar", but "the editor runs the command".
 *
 * **Why the API and not the browser.** Both steps read files — a 150 MB scene
 * bundle, the asset manifest, and the private asset store to measure a tree's
 * trunk on the model. None of that is reachable from a tab, and shipping a GLB
 * parser and a trunk measurement into the editor bundle to have them work on
 * uploads would be a second implementation of the thing this ADR just
 * de-duplicated.
 *
 * **Why that is safe.** The import path is an allow-list, not a filter — see
 * `import-paths.ts`. The catalogue action takes no path at all: the manifest,
 * the public assets and the asset store are the service's own configuration,
 * so there is nothing in that request for an attacker to aim. Both refuse when
 * `WORLDS_READ_ONLY` is set, like every other write.
 */
import type { FastifyPluginAsync } from 'fastify';
import { generatePrefabCatalog, importSceneBundle } from '@wov/content-build';
import { join } from 'node:path';
import type { ApiConfig } from './config.js';
import { isContentId } from './content-ids.js';
import { resolveImportPath } from './import-paths.js';
import { serializePrefabCatalog } from './prefab-file.js';
import { serializeWorld } from './world-file.js';

interface ImportSceneBody {
  /** The bundle, named relative to `WOV_IMPORT_DIR`. */
  readonly scene?: unknown;
  readonly world?: unknown;
  readonly name?: unknown;
  readonly zoneRoot?: unknown;
  readonly dryRun?: unknown;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export const actionsRoutes: FastifyPluginAsync<{ config: ApiConfig }> = async (app, options) => {
  const { config } = options;

  app.post<{ Body: ImportSceneBody }>('/actions/import-scene', async (request, reply) => {
    if (config.contentReadOnly) {
      return reply.code(403).send({
        error: 'read_only',
        message: 'this API serves content read-only (WORLDS_READ_ONLY is set)',
      });
    }

    const body = request.body ?? {};
    const worldId = text(body.world);
    const worldName = text(body.name);
    if (!isContentId(worldId)) {
      return reply.code(400).send({
        error: 'invalid_world_id',
        message: `"${worldId}" is not a valid world id (lowercase a-z, 0-9, "_" and "-")`,
      });
    }
    if (worldName === '') {
      return reply
        .code(400)
        .send({ error: 'invalid_world_name', message: 'the world needs a name' });
    }

    const scene = resolveImportPath(config.importDir, text(body.scene));
    if (!scene.ok) {
      // 501 when the deployment has no import directory at all, 400 when the
      // request asked for something outside it: one is a service that cannot do
      // this, the other is a request that must not.
      return reply.code(scene.reason === 'not-configured' ? 501 : 400).send({
        error: scene.reason === 'not-configured' ? 'not_configured' : 'invalid_scene_path',
        message: scene.message,
      });
    }

    let result;
    try {
      result = await importSceneBundle({
        sceneFile: scene.path,
        worldId,
        worldName,
        contentDir: config.contentDir,
        zoneRoot: text(body.zoneRoot) === '' ? undefined : text(body.zoneRoot),
        dryRun: body.dryRun === true,
        // The same spelling every other world file written by this service has
        // (ADR-0017), so an imported world and a saved one are the same bytes.
        serialize: serializeWorld,
      });
    } catch (error) {
      return reply.code(422).send({
        error: 'import_failed',
        message: 'the scene bundle could not be read',
        errors: [error instanceof Error ? error.message : String(error)],
      });
    }

    if (!result.ok) {
      return reply
        .code(422)
        .send({
          error: 'import_failed',
          message: 'the scene import did not finish',
          errors: result.errors,
        });
    }
    app.log.info(
      { world: worldId, entities: result.report.entities, dryRun: result.report.dryRun },
      'scene bundle imported',
    );
    return reply.send({ report: result.report });
  });

  app.post('/actions/generate-prefabs', async (_request, reply) => {
    if (config.contentReadOnly) {
      return reply.code(403).send({
        error: 'read_only',
        message: 'this API serves content read-only (WORLDS_READ_ONLY is set)',
      });
    }

    const result = await generatePrefabCatalog({
      manifestFile: join(config.assetsDir, 'manifest.json'),
      assetsDir: config.assetsDir,
      storeDir: config.assetStoreDir,
      contentDir: config.contentDir,
      serialize: serializePrefabCatalog,
    });
    if (!result.ok) {
      return reply.code(422).send({
        error: 'generate_failed',
        message: 'the prefab catalogue was not written',
        errors: result.errors,
      });
    }
    app.log.info({ prefabs: result.report.prefabs }, 'prefab catalogue regenerated');
    return reply.send({ report: result.report });
  });
};
