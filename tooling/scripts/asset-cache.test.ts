import { describe, expect, it } from 'vitest';
import {
  ASSET_CACHE_MAX_AGE_ENV,
  assetCacheHeaders,
  assetNotModified,
  readAssetCacheMaxAge,
} from './asset-cache.js';

const MODIFIED_MS = Date.UTC(2026, 8, 7, 19, 34, 56, 789);

describe('readAssetCacheMaxAge', () => {
  it('revalidates every time unless a deployment says otherwise', () => {
    expect(readAssetCacheMaxAge(undefined)).toBe(0);
    expect(readAssetCacheMaxAge('')).toBe(0);
    expect(readAssetCacheMaxAge('   ')).toBe(0);
  });

  it('reads whole seconds', () => {
    expect(readAssetCacheMaxAge('300')).toBe(300);
    expect(readAssetCacheMaxAge(' 0 ')).toBe(0);
  });

  it('refuses a value it cannot interpret instead of falling back to zero', () => {
    // Falling back would run a different policy than the one that was
    // configured, and nothing outside the process would ever say so.
    for (const bad of ['abc', '3600s', '-1', '1.5', '1e3']) {
      expect(() => readAssetCacheMaxAge(bad)).toThrow(ASSET_CACHE_MAX_AGE_ENV);
    }
  });
});

describe('assetCacheHeaders', () => {
  it('asks every time by default and states the validators', () => {
    const cache = assetCacheHeaders(1024, MODIFIED_MS);
    expect(cache['cache-control']).toBe('public, max-age=0, must-revalidate');
    expect(cache.etag).toMatch(/^W\/".+"$/);
    expect(cache['last-modified']).toBe('Mon, 07 Sep 2026 19:34:56 GMT');
  });

  it('carries the lifetime a deployment configured', () => {
    expect(assetCacheHeaders(1024, MODIFIED_MS, 3600)['cache-control']).toBe(
      'public, max-age=3600',
    );
  });

  it('changes the tag when the importer rewrote the file', () => {
    // Same path, new bytes: the store is re-imported whole, so both the size
    // and the mtime move. Either one alone is enough.
    const before = assetCacheHeaders(1024, MODIFIED_MS);
    expect(assetCacheHeaders(2048, MODIFIED_MS + 5000).etag).not.toBe(before.etag);
  });
});

describe('assetNotModified', () => {
  const cache = assetCacheHeaders(1024, MODIFIED_MS);

  it('says no when nothing was asked', () => {
    expect(assetNotModified({}, cache)).toBe(false);
  });

  it('says yes for the tag it handed out', () => {
    expect(assetNotModified({ 'if-none-match': cache.etag }, cache)).toBe(true);
  });

  it('says no once the file behind the tag changed', () => {
    const rewritten = assetCacheHeaders(2048, MODIFIED_MS + 5000);
    expect(assetNotModified({ 'if-none-match': cache.etag }, rewritten)).toBe(false);
  });

  it('honours If-Modified-Since when there is no tag', () => {
    expect(assetNotModified({ 'if-modified-since': cache['last-modified'] }, cache)).toBe(true);
    expect(assetNotModified({ 'if-modified-since': 'Sun, 06 Sep 2026 00:00:00 GMT' }, cache)).toBe(
      false,
    );
  });

  it('takes the first of a repeated header rather than the joined string', () => {
    // Node hands a repeated header over as an array; joining it would produce a
    // tag that matches nothing and a full body on every request.
    expect(assetNotModified({ 'if-none-match': [cache.etag, 'W/"other"'] }, cache)).toBe(true);
  });
});
