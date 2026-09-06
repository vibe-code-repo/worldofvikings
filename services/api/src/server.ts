import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { ApiConfig } from './config.js';
import { prefabsRoutes } from './prefabs-routes.js';
import { worldsRoutes } from './worlds-routes.js';

/** Shape of the `/health` response. Kept stable — CI and the smoke test read it. */
export interface HealthResponse {
  readonly status: 'ok';
  readonly service: 'world-of-vikings-api';
  readonly uptimeSeconds: number;
}

/**
 * Builds the Fastify instance without listening, so tests can use
 * `app.inject()` instead of binding a port.
 */
export async function buildServer(config: ApiConfig): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.logLevel } });

  // The website, game and editor run on their own ports in development.
  await app.register(cors, { origin: [...config.corsOrigins] });

  app.get('/health', (): HealthResponse => {
    return {
      status: 'ok',
      service: 'world-of-vikings-api',
      uptimeSeconds: Math.round(process.uptime()),
    };
  });

  // World and prefab data from `config.contentDir` (ADR-0017).
  await app.register(worldsRoutes, { config });
  await app.register(prefabsRoutes, { config });

  return app;
}
