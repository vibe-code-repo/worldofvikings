import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { parseWorldDefinition } from '@wov/world-schema';
import type { ApiConfig } from './config.js';
import { isContentId } from './content-ids.js';
import { listWorlds, loadWorld, saveWorld } from './world-store.js';

interface WorldParams {
  readonly id: string;
}

/**
 * The world routes (ADR-0017).
 *
 * `GET /worlds`, `GET /worlds/:id`, `PUT /worlds/:id` — the editor's only way
 * to the files in `CONTENT_DIR/worlds`. Nothing here knows about Babylon.js or
 * the editor's UI; the schema decides what a world is (`@wov/world-schema`),
 * and this plugin only decides which status code says so.
 */
export const worldsRoutes: FastifyPluginAsync<{ config: ApiConfig }> = async (app, options) => {
  const { config } = options;

  app.get('/worlds', async () => listWorlds(config.contentDir));

  app.get<{ Params: WorldParams }>('/worlds/:id', async (request, reply) => {
    const { id } = request.params;
    if (!isContentId(id)) {
      return invalidId(reply, id);
    }

    const loaded = await loadWorld(config.contentDir, id);
    if (loaded.status === 'not-found') {
      return reply.code(404).send({
        error: 'not_found',
        message: `there is no world "${id}"`,
      });
    }
    if (loaded.status === 'invalid') {
      // The request was fine, the stored file is not — 422, not 400.
      return reply.code(422).send({
        error: 'invalid_world',
        message: `the stored world "${id}" does not match the world schema`,
        errors: loaded.errors,
      });
    }
    return reply.header('last-modified', loaded.updatedAt).send(loaded.world);
  });

  app.put<{ Params: WorldParams }>('/worlds/:id', async (request, reply) => {
    const { id } = request.params;
    if (config.contentReadOnly) {
      // Editor clients never write production data directly (spec §49).
      return reply.code(403).send({
        error: 'read_only',
        message: 'this API serves worlds read-only (WORLDS_READ_ONLY is set)',
      });
    }
    if (!isContentId(id)) {
      return invalidId(reply, id);
    }

    const parsed = parseWorldDefinition(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({
        error: 'invalid_world',
        message: 'the request body does not match the world schema',
        errors: parsed.errors,
      });
    }
    if (parsed.world.id !== id) {
      return reply.code(400).send({
        error: 'id_mismatch',
        message: `the world id "${parsed.world.id}" does not match the url "/worlds/${id}"`,
        errors: [`id: expected "${id}", got "${parsed.world.id}"`],
      });
    }

    const { created, updatedAt } = await saveWorld(config.contentDir, parsed.world);
    app.log.info({ world: id, created }, 'world written');
    return reply.code(created ? 201 : 200).send({
      id: parsed.world.id,
      name: parsed.world.name,
      zones: parsed.world.zones.length,
      updatedAt,
      created,
    });
  });
};

function invalidId(reply: FastifyReply, id: string): FastifyReply {
  return reply.code(400).send({
    error: 'invalid_world_id',
    message: `"${id}" is not a valid world id (lowercase a-z, 0-9, "_" and "-")`,
  });
}
