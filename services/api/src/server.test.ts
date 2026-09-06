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
    expect(loadConfig({}).worldsReadOnly).toBe(false);
    expect(loadConfig({ WORLDS_READ_ONLY: '1' }).worldsReadOnly).toBe(true);
    expect(loadConfig({ WORLDS_READ_ONLY: 'true' }).worldsReadOnly).toBe(true);
    expect(loadConfig({ WORLDS_READ_ONLY: '0' }).worldsReadOnly).toBe(false);
  });

  it('refuses a write protection flag it does not understand', () => {
    expect(() => loadConfig({ WORLDS_READ_ONLY: 'maybe' })).toThrow();
  });
});
