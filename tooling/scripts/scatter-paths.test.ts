import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveContentDir, resolveStoreRoot } from './scatter-paths.js';

const FALLBACK_STORE = '/repo/../asset-store';
const REPOSITORY_CONTENT = '/repo/content';

describe('resolveStoreRoot', () => {
  it('prefers --store over the environment', () => {
    expect(resolveStoreRoot('/given/store', '/env/store', FALLBACK_STORE)).toBe('/given/store');
  });

  it('falls back to WOV_ASSET_STORE', () => {
    expect(resolveStoreRoot(undefined, '/env/store', FALLBACK_STORE)).toBe('/env/store');
  });

  it('treats a blank value as absent, on both', () => {
    expect(resolveStoreRoot('  ', '  ', FALLBACK_STORE)).toBe(FALLBACK_STORE);
    expect(resolveStoreRoot('', '/env/store', FALLBACK_STORE)).toBe('/env/store');
  });

  it('resolves a relative path against the working directory', () => {
    expect(resolveStoreRoot('./store', undefined, FALLBACK_STORE)).toBe(resolve('./store'));
  });

  /*
   * The reason this module exists. The old default was an absolute path on one
   * contributor's machine, named after a directory this repository must not
   * name at all. A default that is a sibling of the checkout is right nowhere
   * and wrong nowhere, and it reads as "put your store here" instead of as
   * "your store is here".
   */
  it('defaults to a neutral sibling of the checkout', () => {
    const chosen = resolveStoreRoot(undefined, undefined, FALLBACK_STORE);
    expect(chosen).toBe(FALLBACK_STORE);
    expect(chosen).not.toMatch(/home|Users/);
  });
});

describe('resolveContentDir', () => {
  /*
   * The same meaning `CONTENT_DIR` has for the API (`services/api/src/config.ts`).
   * When the two disagreed, a reviewer pointed the API at a throwaway copy,
   * ran a scatter, and changed the committed village.
   */
  it('uses CONTENT_DIR when it is set', () => {
    expect(resolveContentDir('/tmp/copy', REPOSITORY_CONTENT)).toBe('/tmp/copy');
  });

  it('resolves a relative CONTENT_DIR, as the API does', () => {
    expect(resolveContentDir('content', REPOSITORY_CONTENT)).toBe(resolve('content'));
  });

  it('falls back to the repository content directory', () => {
    expect(resolveContentDir(undefined, REPOSITORY_CONTENT)).toBe(REPOSITORY_CONTENT);
    expect(resolveContentDir('   ', REPOSITORY_CONTENT)).toBe(REPOSITORY_CONTENT);
  });
});
