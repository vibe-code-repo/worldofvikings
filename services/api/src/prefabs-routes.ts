import type { FastifyPluginAsync } from 'fastify';
import type { ApiConfig } from './config.js';
import { listPrefabs } from './prefab-store.js';

/**
 * `GET /prefabs` — the merged prefab catalogue for the editor's asset browser
 * (spec §19, ADR-0017). Read-only: prefabs are authored in `content/prefabs`
 * and reviewed there, not edited through the API.
 */
export const prefabsRoutes: FastifyPluginAsync<{ config: ApiConfig }> = async (app, options) => {
  app.get('/prefabs', async () => listPrefabs(options.config.contentDir));
};
