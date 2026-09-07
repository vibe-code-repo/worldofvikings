import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { parsePrefabCatalog } from '@wov/world-schema';
import type { ApiConfig } from './config.js';
import { bodyValidators, contentFileValidators, sendConditional } from './conditional.js';
import { isContentId } from './content-ids.js';
import { listPrefabs, loadCatalog, saveCatalog } from './prefab-store.js';

interface CatalogParams {
  readonly catalog: string;
}

/**
 * The prefab routes (spec §19, ADR-0017, ADR-0033).
 *
 * `GET /prefabs` is the merged catalogue the editor's asset browser and the
 * game's world builder read. `GET /prefabs/:catalog` and `PUT /prefabs/:catalog`
 * are one file at a time, and they exist because a prefab's *collision shape*
 * had no way into the editor: it was decided by `generate:prefabs` from the
 * asset path and could only be corrected by editing JSON (ADR-0026). The editor
 * corrects it now, and writes the correction into `overrides.json` so the next
 * regeneration does not undo it (see `prefab-store.ts`).
 *
 * `PUT` replaces a whole catalogue rather than patching one prefab. The format
 * has no partial form, a partial write could not be validated as it is made,
 * and the editor holds the catalogue anyway — so "here is the file" is both the
 * honest request and the one that cannot half-succeed.
 *
 * Both reads are conditional (ADR-0052): they carry an `ETag` and answer `304`
 * when the editor already holds that version.
 */
export const prefabsRoutes: FastifyPluginAsync<{ config: ApiConfig }> = async (app, options) => {
  const { config } = options;

  app.get('/prefabs', async (request, reply) => {
    // The merged catalogue is composed from every file in `CONTENT_DIR/prefabs`,
    // so its validator is a hash of the answer rather than one file's mtime.
    const body = JSON.stringify(await listPrefabs(config.contentDir));
    return sendConditional(request, reply, bodyValidators(body), body);
  });

  app.get<{ Params: CatalogParams }>('/prefabs/:catalog', async (request, reply) => {
    const { catalog } = request.params;
    if (!isContentId(catalog)) {
      return invalidId(reply, catalog);
    }

    const loaded = await loadCatalog(config.contentDir, catalog);
    if (loaded.status === 'not-found') {
      return reply.code(404).send({
        error: 'not_found',
        message: `there is no prefab catalogue "${catalog}"`,
      });
    }
    if (loaded.status === 'invalid') {
      // The request was fine, the stored file is not — 422, not 400.
      return reply.code(422).send({
        error: 'invalid_prefab_catalog',
        message: `the stored catalogue "${catalog}" does not match the prefab schema`,
        errors: loaded.errors,
      });
    }
    return sendConditional(
      request,
      reply,
      contentFileValidators(loaded.updatedAt, loaded.size),
      loaded.catalog,
    );
  });

  app.put<{ Params: CatalogParams }>('/prefabs/:catalog', async (request, reply) => {
    const { catalog } = request.params;
    if (config.contentReadOnly) {
      return reply.code(403).send({
        error: 'read_only',
        message: 'this API serves content read-only (WORLDS_READ_ONLY is set)',
      });
    }
    if (!isContentId(catalog)) {
      return invalidId(reply, catalog);
    }

    const parsed = parsePrefabCatalog(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({
        error: 'invalid_prefab_catalog',
        message: 'the request body does not match the prefab catalogue schema',
        errors: parsed.errors,
      });
    }
    if (parsed.catalog.id !== catalog) {
      return reply.code(400).send({
        error: 'id_mismatch',
        message: `the catalogue id "${parsed.catalog.id}" does not match the url "/prefabs/${catalog}"`,
        errors: [`id: expected "${catalog}", got "${parsed.catalog.id}"`],
      });
    }

    const { created, updatedAt } = await saveCatalog(config.contentDir, parsed.catalog);
    app.log.info({ catalog, created }, 'prefab catalogue written');
    return reply.code(created ? 201 : 200).send({
      id: parsed.catalog.id,
      prefabs: parsed.catalog.prefabs.length,
      updatedAt,
      created,
    });
  });
};

function invalidId(reply: FastifyReply, id: string): FastifyReply {
  return reply.code(400).send({
    error: 'invalid_catalog_id',
    message: `"${id}" is not a valid catalogue id (lowercase a-z, 0-9, "_" and "-")`,
  });
}
