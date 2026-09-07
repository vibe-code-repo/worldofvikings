import { describe, expect, it } from 'vitest';
import { fileValidators, httpDate, isNotModified, revalidatingCacheControl } from './http-cache.js';

/** 07.09.2026, 19:34:56.789 UTC — a time with milliseconds, on purpose. */
const MODIFIED_MS = Date.UTC(2026, 8, 7, 19, 34, 56, 789);

describe('httpDate', () => {
  it('formats an HTTP-date, not an ISO string', () => {
    // The bug this replaces: `new Date(…).toISOString()` in a `Last-Modified`
    // header. Browsers do not reject that, they ignore it.
    expect(httpDate(MODIFIED_MS)).toBe('Mon, 07 Sep 2026 19:34:56 GMT');
    expect(httpDate(MODIFIED_MS)).not.toBe(new Date(MODIFIED_MS).toISOString());
    // An HTTP-date round-trips through the parser a browser uses for
    // `If-Modified-Since`; the sub-second part is what it drops.
    expect(Date.parse(httpDate(MODIFIED_MS))).toBe(MODIFIED_MS - 789);
  });
});

describe('fileValidators', () => {
  it('is weak, and says so', () => {
    // Size and mtime do not prove the bytes, so the tag must not claim they do.
    expect(fileValidators(1024, MODIFIED_MS).etag).toMatch(/^W\/".+"$/);
  });

  it('drops the sub-second part from Last-Modified but keeps it in the tag', () => {
    const validators = fileValidators(1024, MODIFIED_MS);
    expect(validators.lastModified).toBe('Mon, 07 Sep 2026 19:34:56 GMT');
    // The whole point of preferring the ETag: a file rewritten 200 ms later is
    // a different tag but the same HTTP-date.
    const later = fileValidators(1024, MODIFIED_MS + 200);
    expect(later.lastModified).toBe(validators.lastModified);
    expect(later.etag).not.toBe(validators.etag);
  });

  it('changes when either the size or the modification time changes', () => {
    const base = fileValidators(1024, MODIFIED_MS).etag;
    expect(fileValidators(1025, MODIFIED_MS).etag).not.toBe(base);
    expect(fileValidators(1024, MODIFIED_MS + 1000).etag).not.toBe(base);
  });

  it('is stable for the same file', () => {
    expect(fileValidators(1024, MODIFIED_MS).etag).toBe(fileValidators(1024, MODIFIED_MS).etag);
  });

  it('separates two representations of the same file by revision', () => {
    // The API re-serialises a world rather than serving the file, so a change
    // in how it serialises has to invalidate caches the mtime knows nothing of.
    expect(fileValidators(1024, MODIFIED_MS, 'w1').etag).not.toBe(
      fileValidators(1024, MODIFIED_MS, 'w2').etag,
    );
  });
});

describe('isNotModified', () => {
  const validators = fileValidators(1024, MODIFIED_MS);

  it('says no when the request asked nothing', () => {
    expect(isNotModified({}, validators)).toBe(false);
    expect(isNotModified({ ifNoneMatch: '  ' }, validators)).toBe(false);
  });

  it('matches its own tag', () => {
    expect(isNotModified({ ifNoneMatch: validators.etag }, validators)).toBe(true);
  });

  it('does not match a different file', () => {
    const other = fileValidators(2048, MODIFIED_MS);
    expect(isNotModified({ ifNoneMatch: other.etag }, validators)).toBe(false);
  });

  it('compares weakly, so a proxy that stripped the W/ still revalidates', () => {
    // Nginx downgrades a strong ETag to a weak one when it gzips on the fly.
    // Comparing textually would make every one of those requests a full body.
    const stripped = validators.etag.slice(2);
    expect(isNotModified({ ifNoneMatch: stripped }, validators)).toBe(true);
    expect(isNotModified({ ifNoneMatch: `W/${stripped}` }, validators)).toBe(true);
  });

  it('accepts a list, as a browser sends after a redirect chain', () => {
    expect(
      isNotModified({ ifNoneMatch: `W/"nope", ${validators.etag}, W/"also-nope"` }, validators),
    ).toBe(true);
    expect(isNotModified({ ifNoneMatch: 'W/"nope", W/"also-nope"' }, validators)).toBe(false);
  });

  it('accepts the wildcard', () => {
    expect(isNotModified({ ifNoneMatch: '*' }, validators)).toBe(true);
  });

  it('answers 304 for an If-Modified-Since at or after the file', () => {
    expect(isNotModified({ ifModifiedSince: validators.lastModified }, validators)).toBe(true);
    expect(isNotModified({ ifModifiedSince: httpDate(MODIFIED_MS + 60_000) }, validators)).toBe(
      true,
    );
  });

  it('answers 200 for an If-Modified-Since before the file', () => {
    expect(isNotModified({ ifModifiedSince: httpDate(MODIFIED_MS - 60_000) }, validators)).toBe(
      false,
    );
  });

  it('ignores an unparseable date rather than guessing', () => {
    expect(isNotModified({ ifModifiedSince: 'yesterday' }, validators)).toBe(false);
  });

  it('lets If-None-Match decide alone when both headers are present', () => {
    // The dangerous case: the file was rewritten within the same second, so the
    // date says "unchanged" and the tag says "changed". The tag has to win, or
    // the editor shows the old texture.
    const rewritten = fileValidators(999, MODIFIED_MS + 300);
    expect(
      isNotModified(
        { ifNoneMatch: validators.etag, ifModifiedSince: validators.lastModified },
        rewritten,
      ),
    ).toBe(false);
  });
});

describe('revalidatingCacheControl', () => {
  it('asks every time by default', () => {
    expect(revalidatingCacheControl()).toBe('public, max-age=0, must-revalidate');
    expect(revalidatingCacheControl(0)).toBe('public, max-age=0, must-revalidate');
    expect(revalidatingCacheControl(-5)).toBe('public, max-age=0, must-revalidate');
  });

  it('states a lifetime when a deployment asked for one', () => {
    expect(revalidatingCacheControl(300)).toBe('public, max-age=300');
  });
});
