/**
 * The asset server's caching policy (ADR-0052).
 *
 * A module of its own for the same reason `asset-routes.ts` is one: importing
 * `asset-server.ts` starts a listening server, so nothing decided in that file
 * can be unit-tested. What is decided here is which headers a file answers with
 * and whether a request may be answered empty — the two things that, when
 * wrong, fail *silently*: a missing validator only shows up as bytes on the
 * wire, and a validator that is too eager only shows up as a texture that
 * refuses to change.
 *
 * The validators themselves come from `@wov/shared` because `services/api`
 * needs exactly the same comparison, and a second copy of it would drift.
 */
import { fileValidators, isNotModified, revalidatingCacheControl } from '@wov/shared';

/** How long a client may use an asset without asking. `0` means: ask every time. */
export const ASSET_CACHE_MAX_AGE_ENV = 'ASSET_CACHE_MAX_AGE';

/**
 * Reads `ASSET_CACHE_MAX_AGE`, in seconds.
 *
 * Default `0`, and a deployment has to type a whole number to get anything
 * else: an unreadable value throws at startup rather than quietly falling back,
 * because "the lifetime I configured is not the lifetime that is running" is
 * not something anybody notices from the outside.
 */
export function readAssetCacheMaxAge(raw: string | undefined): number {
  const value = raw?.trim() ?? '';
  if (value === '') {
    return 0;
  }
  const seconds = Number.parseInt(value, 10);
  if (!Number.isInteger(seconds) || seconds < 0 || String(seconds) !== value) {
    throw new Error(`${ASSET_CACHE_MAX_AGE_ENV} must be a whole number of seconds, got "${raw}"`);
  }
  return seconds;
}

/** The cache headers a file answers with, exactly as they go on the wire. */
export interface AssetCacheHeaders {
  readonly 'cache-control': string;
  readonly etag: string;
  readonly 'last-modified': string;
}

/**
 * The cache headers for one file.
 *
 * They are the same on a 200 and on a 304 — RFC 9110 §15.4.5 requires the 304
 * to carry the validators it would have sent with the body, or the client's
 * *next* request has nothing to revalidate against and the saving lasts exactly
 * one round.
 */
export function assetCacheHeaders(
  size: number,
  modifiedMs: number,
  maxAgeSeconds = 0,
): AssetCacheHeaders {
  const validators = fileValidators(size, modifiedMs);
  return {
    'cache-control': revalidatingCacheControl(maxAgeSeconds),
    etag: validators.etag,
    'last-modified': validators.lastModified,
  };
}

/** The conditional headers of a Node request, and the answer they ask for. */
export interface RawConditionalHeaders {
  readonly 'if-none-match'?: string | string[] | undefined;
  readonly 'if-modified-since'?: string | string[] | undefined;
}

/**
 * Whether this request may be answered `304` for a file carrying `cache`.
 *
 * Takes the headers the response *would* have sent rather than the file's size
 * and mtime, so the comparison can never be made against a different tag than
 * the one that goes out with the answer.
 */
export function assetNotModified(
  request: RawConditionalHeaders,
  cache: AssetCacheHeaders,
): boolean {
  return isNotModified(
    {
      ifNoneMatch: first(request['if-none-match']),
      ifModifiedSince: first(request['if-modified-since']),
    },
    { etag: cache.etag, lastModified: cache['last-modified'] },
  );
}

/**
 * Node hands a repeated header over as an array. A client that sent
 * `If-None-Match` twice gets the first one honoured, rather than the joined
 * string silently failing to match anything.
 */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
