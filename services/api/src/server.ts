import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { ApiConfig } from './config.js';
import { actionsRoutes } from './actions-routes.js';
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
  //
  // `methods` has to be spelled out. `@fastify/cors` defaults to the CORS-safe
  // list — GET, HEAD, POST — so a browser's preflight for `PUT /worlds/:id`
  // came back without it and the editor could not save at all. The route tests
  // never saw it: `app.inject()` does not run a preflight, and neither does
  // `curl`. Only a real browser does.
  await app.register(cors, {
    origin: [...config.corsOrigins],
    // `POST` is here for the content actions (ADR-0033), which the editor's
    // World menu calls from a browser and which therefore need a preflight
    // exactly as `PUT` did.
    methods: ['GET', 'HEAD', 'PUT', 'POST', 'OPTIONS'],
  });

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
  // The scene import and the prefab catalogue, run for the editor (ADR-0033).
  await app.register(actionsRoutes, { config });

  return app;
}
