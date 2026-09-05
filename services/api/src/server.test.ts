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
});

describe('loadConfig', () => {
  it('uses port 3000 by default', () => {
    expect(loadConfig({}).port).toBe(3000);
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ API_PORT: 'nope' })).toThrow();
  });
});
