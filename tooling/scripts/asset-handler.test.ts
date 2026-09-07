import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAssetHandler } from './asset-handler.js';

/**
 * The one test that goes over a socket.
 *
 * The unit tests above it decide what the headers should say; this one proves
 * the server actually says it — that a 304 arrives with no body, that the
 * validators come back on the 304 as well (or the saving lasts exactly one
 * round), and that a rewritten file is fetched again. None of that can be
 * asserted from the outside without a real request: the shape of a bodyless
 * response is decided by `writeHead`/`end`, not by the policy module.
 */
describe('the asset server over a socket', () => {
  let root = '';
  let server: Server;
  let origin = '';

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'wov-asset-handler-'));
    await writeFile(join(root, 'barrel.glb'), 'first-bytes');
    server = createServer(createAssetHandler({ assetRoot: root }));
    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
    origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise<void>((closed) => server.close(() => closed()));
    await rm(root, { recursive: true, force: true });
  });

  it('serves a file with validators and a revalidating cache-control', async () => {
    const response = await fetch(`${origin}/barrel.glb`);
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toMatch(/^W\/".+"$/);
    expect(response.headers.get('last-modified')).toMatch(/GMT$/);
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    // Unchanged by ADR-0052: the editor and the game load cross-origin.
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.text()).toBe('first-bytes');
  });

  it('answers 304 with no body when the client already holds the file', async () => {
    const first = await fetch(`${origin}/barrel.glb`);
    const etag = first.headers.get('etag') ?? '';
    await first.text();

    const second = await fetch(`${origin}/barrel.glb`, { headers: { 'if-none-match': etag } });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');
    // A length that describes a body which is not there is what hangs a client.
    expect(second.headers.get('content-length')).toBeNull();
    // The 304 has to repeat the validators, or the *next* request has nothing
    // to revalidate against and the whole file comes back once more.
    expect(second.headers.get('etag')).toBe(etag);
    expect(second.headers.get('last-modified')).toBe(first.headers.get('last-modified'));
    expect(second.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    expect(second.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('answers 304 for a HEAD as well as a GET', async () => {
    const probe = await fetch(`${origin}/barrel.glb`, { method: 'HEAD' });
    expect(probe.status).toBe(200);
    expect(probe.headers.get('content-length')).toBe(String('first-bytes'.length));

    const again = await fetch(`${origin}/barrel.glb`, {
      method: 'HEAD',
      headers: { 'if-none-match': probe.headers.get('etag') ?? '' },
    });
    expect(again.status).toBe(304);
  });

  it('honours If-Modified-Since', async () => {
    const first = await fetch(`${origin}/barrel.glb`);
    await first.text();
    const response = await fetch(`${origin}/barrel.glb`, {
      headers: { 'if-modified-since': first.headers.get('last-modified') ?? '' },
    });
    expect(response.status).toBe(304);
  });

  it('sends the new bytes once the file was rewritten under the same name', async () => {
    // The property the whole change has to keep: a texture swapped in the store
    // shows up on the next reload. Same path, new content — and the client is
    // holding the old tag.
    const first = await fetch(`${origin}/barrel.glb`);
    const etag = first.headers.get('etag') ?? '';
    await first.text();

    await writeFile(join(root, 'barrel.glb'), 'second-bytes-longer');
    const future = new Date(Date.now() + 5000);
    await utimes(join(root, 'barrel.glb'), future, future);

    const response = await fetch(`${origin}/barrel.glb`, { headers: { 'if-none-match': etag } });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('second-bytes-longer');
    expect(response.headers.get('etag')).not.toBe(etag);
  });

  it('still refuses a path that leaves the root, and says so with CORS', async () => {
    const response = await fetch(`${origin}/../../etc/passwd`);
    expect([403, 404]).toContain(response.status);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('etag')).toBeNull();
  });
});

describe('the asset server with a configured lifetime', () => {
  let root = '';
  let server: Server;
  let origin = '';

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'wov-asset-maxage-'));
    await writeFile(join(root, 'pine.glb'), 'bytes');
    server = createServer(createAssetHandler({ assetRoot: root, maxAgeSeconds: 3600 }));
    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
    origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise<void>((closed) => server.close(() => closed()));
    await rm(root, { recursive: true, force: true });
  });

  it('states the lifetime and keeps the validators', async () => {
    const response = await fetch(`${origin}/pine.glb`);
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(response.headers.get('etag')).toMatch(/^W\/".+"$/);
    await response.text();
  });
});
