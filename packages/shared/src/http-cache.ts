/**
 * Conditional requests: the validators a response carries, and the one
 * decision "may this request be answered with 304?".
 *
 * Two servers in this repository hand out files that a browser sees again on
 * every editor open: `tooling/scripts/asset-server.ts` (models, textures, the
 * height field, the manifest) and `services/api` (a world, a prefab
 * catalogue). Both were sending `cache-control: no-cache` with **no validator**
 * at all, which is the one combination that cannot work: `no-cache` means
 * "revalidate before using this", and with nothing to revalidate *against* the
 * browser has no choice but to download the bytes again. Opening the village
 * twice therefore cost the same 154 MB twice (ADR-0052).
 *
 * The rule this module implements is validators, not lifetime: every answer
 * still gets asked about, and an answer that has not changed comes back
 * empty. A texture swapped in the store is visible on the next reload, which is
 * the property a long `max-age` would have destroyed.
 *
 * **Why the ETag is weak.** It is built from size and modification time, not
 * from the bytes. A strong ETag promises byte-for-byte identity, and size plus
 * mtime cannot promise that — two different files can share both. Weak is the
 * honest claim, and weak is all a full-body GET needs: RFC 9110 §13.1.2
 * requires `If-None-Match` to be compared *weakly*, so a weak tag revalidates
 * exactly like a strong one. It also survives a reverse proxy that compresses
 * on the fly, which downgrades a strong ETag to a weak one and would otherwise
 * make every comparison fail.
 *
 * **Why size and mtime are enough here.** Both stores are written whole: the
 * importers and `writeJsonFileAtomically` build a new file and rename it over
 * the old one. Nothing in this project edits bytes inside an existing file, so
 * "same size, same mtime" and "same content" do not come apart. The pair is a
 * statement about how these files are produced, not a general truth — a store
 * somebody patches in place would need a content hash instead.
 *
 * Framework-free on purpose: it is used from a Node `http` server and from
 * Fastify, and it must not know about either.
 */

/** The validators a cacheable response carries. */
export interface CacheValidators {
  /** `ETag`, always weak (`W/"…"`) — see the module comment. */
  readonly etag: string;
  /** `Last-Modified` as an HTTP-date (IMF-fixdate), never an ISO string. */
  readonly lastModified: string;
}

/**
 * What {@link isNotModified} compares against.
 *
 * The date is optional because not every representation has one: a listing the
 * API composes from several files has no single modification time, and
 * inventing one would be a claim nothing backs. A tag alone still revalidates.
 */
export interface ComparableValidators {
  readonly etag: string;
  readonly lastModified?: string | undefined;
}

/** The two request headers that ask "has it changed?". */
export interface ConditionalHeaders {
  readonly ifNoneMatch?: string | undefined;
  readonly ifModifiedSince?: string | undefined;
}

/**
 * An instant as an HTTP-date (RFC 9110 §5.6.7), which is what `Last-Modified`
 * has to be.
 *
 * The reason this function exists at all: both services were sending
 * `updatedAt.toISOString()`, and `2026-09-07T19:34:00.000Z` is not an
 * HTTP-date. Browsers do not reject it, they ignore it — so the header looked
 * present in a response dump and did nothing whatsoever.
 */
export function httpDate(epochMs: number): string {
  return new Date(epochMs).toUTCString();
}

/**
 * Validators for a file, or for a representation derived from one.
 *
 * @param size bytes of the file on disk.
 * @param modifiedMs its modification time, epoch milliseconds.
 * @param revision an extra token folded into the tag for a representation that
 *   the *service* shapes rather than serving verbatim — the API re-serialises a
 *   world from the parsed file, so a service that starts writing that JSON
 *   differently has to invalidate caches the file's mtime knows nothing about.
 */
export function fileValidators(size: number, modifiedMs: number, revision = ''): CacheValidators {
  const prefix = revision === '' ? '' : `${revision}-`;
  const stamp = `${prefix}${Math.trunc(size).toString(16)}-${Math.trunc(modifiedMs).toString(16)}`;
  return { etag: `W/"${stamp}"`, lastModified: httpDate(modifiedMs) };
}

/**
 * Whether this request may be answered with `304 Not Modified`.
 *
 * `If-None-Match` decides alone when it is present (RFC 9110 §13.2.2):
 * `If-Modified-Since` only has one-second resolution, so a file rewritten
 * within the same second as the one the client holds would otherwise be
 * declared unchanged — precisely the stale picture this whole change is
 * supposed to keep impossible.
 */
export function isNotModified(
  request: ConditionalHeaders,
  validators: ComparableValidators,
): boolean {
  const ifNoneMatch = request.ifNoneMatch?.trim() ?? '';
  if (ifNoneMatch !== '') {
    return etagSatisfies(ifNoneMatch, validators.etag);
  }

  const ifModifiedSince = request.ifModifiedSince?.trim() ?? '';
  if (ifModifiedSince === '' || validators.lastModified === undefined) {
    return false;
  }
  const asked = Date.parse(ifModifiedSince);
  const own = Date.parse(validators.lastModified);
  if (Number.isNaN(asked) || Number.isNaN(own)) {
    return false;
  }
  return own <= asked;
}

/**
 * The `Cache-Control` a validated response carries.
 *
 * Zero — the default everywhere in this repository — means "you may store this,
 * but ask every time"; the saving then comes from the empty 304, not from
 * skipping the question. A deployment that knowingly wants a lifetime passes
 * seconds, and accepts that a file replaced under the same name stays invisible
 * for that long.
 */
export function revalidatingCacheControl(maxAgeSeconds = 0): string {
  const seconds = Math.trunc(maxAgeSeconds);
  return seconds <= 0 ? 'public, max-age=0, must-revalidate' : `public, max-age=${String(seconds)}`;
}

/** Weak comparison (RFC 9110 §8.8.3.2): the `W/` prefix is not part of the tag. */
function etagSatisfies(ifNoneMatch: string, etag: string): boolean {
  const own = opaqueTag(etag);
  for (const raw of ifNoneMatch.split(',')) {
    const candidate = raw.trim();
    if (candidate === '*') {
      return true;
    }
    if (candidate !== '' && opaqueTag(candidate) === own) {
      return true;
    }
  }
  return false;
}

function opaqueTag(value: string): string {
  return value.startsWith('W/') ? value.slice(2) : value;
}
