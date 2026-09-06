import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';

const app = await buildServer(loadConfig({ LOG_LEVEL: 'silent' }));

afterAll(async () => {
  await app.close();
});

describe('GET /health', () => {
  it('reports the service as healthy', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: 'world-of-vikings-api' });
  });

  /**
   * A browser will not send `PUT /worlds/:id` unless the preflight names PUT,
   * and `@fastify/cors` defaults to the CORS-safe list without it. Every route
   * test passed while the editor could not save a single world, because
   * `app.inject()` never issues a preflight.
   */
  it('lets a browser preflight a world save', async () => {
    const app = await buildServer(loadConfig({ LOG_LEVEL: 'silent' }));
    try {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/worlds/example',
        headers: {
          origin: 'http://localhost:5174',
          'access-control-request-method': 'PUT',
          'access-control-request-headers': 'content-type',
        },
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5174');
      expect(String(response.headers['access-control-allow-methods'])).toContain('PUT');
    } finally {
      await app.close();
    }
  });
});

describe('loadConfig', () => {
  it('uses port 3000 by default', () => {
    expect(loadConfig({}).port).toBe(3000);
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ API_PORT: 'nope' })).toThrow();
  });

  it('points at the repository content folder by default', () => {
    expect(loadConfig({}).contentDir).toBe(resolve(import.meta.dirname, '../../../content'));
  });

  it('resolves CONTENT_DIR to an absolute path', () => {
    expect(loadConfig({ CONTENT_DIR: 'content' }).contentDir).toBe(resolve('content'));
  });

  it('allows writing worlds by default and blocks them on request', () => {
    expect(loadConfig({}).contentReadOnly).toBe(false);
    expect(loadConfig({ WORLDS_READ_ONLY: '1' }).contentReadOnly).toBe(true);
    expect(loadConfig({ WORLDS_READ_ONLY: 'true' }).contentReadOnly).toBe(true);
    expect(loadConfig({ WORLDS_READ_ONLY: '0' }).contentReadOnly).toBe(false);
  });

  it('refuses a write protection flag it does not understand', () => {
    expect(() => loadConfig({ WORLDS_READ_ONLY: 'maybe' })).toThrow();
  });
});
