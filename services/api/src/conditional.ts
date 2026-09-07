/**
 * Answering a `GET` so the same answer is not sent twice (ADR-0052).
 *
 * The editor asks this service for the same three things on every open — the
 * world list, the merged prefab catalogue and one 1.0 MB world — and
 * before this module it received all three in full every time. The route sent
 * `last-modified: <ISO string>`, which is not an HTTP-date and which every
 * browser therefore ignores, and no `ETag` at all, so there was nothing to
 * revalidate against.
 *
 * **Hand-written rather than `@fastify/etag`.** The plugin hashes the
 * *serialised body* of every response, which for `GET /worlds/:id` means
 * hashing 1.0 MB on a request whose answer is already fully described by the
 * file's size and modification time — and would hash it on the writes and the
 * error bodies too. What is needed here is forty lines, is exercised by the
 * route tests, and shares its comparison with the asset server through
 * `@wov/shared`. A dependency for that is a dependency for nothing (AGENTS §7,
 * agent rule 12).
 *
 * **What is not done here: compression.** A world is 1.0 MB of JSON that gzips
 * to 144 kB, but only on the *first* request — every later one
 * is an empty 304, which is what this change is about. The reverse proxy in
 * front of staging already compresses the editor's JavaScript and is the right
 * place to add `application/json`; see `services/api/README.md` and ADR-0052.
 */
import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CURRENT_WORLD_SCHEMA_VERSION } from '@wov/world-schema';
import {
  fileValidators,
  isNotModified,
  revalidatingCacheControl,
  type ComparableValidators,
} from '@wov/shared';

/**
 * Folded into every file-derived tag.
 *
 * The API does not serve the file, it serves a representation it builds from
 * the parsed file — so a service that starts shaping that JSON differently has
 * to invalidate caches whose only other input is a modification time the file
 * never changed. The schema version is the one number that moves whenever the
 * shape does (AGENTS §7: no silent format changes).
 */
const REPRESENTATION_REVISION = `v${String(CURRENT_WORLD_SCHEMA_VERSION)}`;

/**
 * Validators for a representation the service built from one content file.
 *
 * The content id is folded into the tag as well. Size and modification time
 * describe *a* file, not *which* file: two worlds written in the same
 * millisecond with names of the same length are byte-for-byte the same stamp,
 * and a tag that cannot tell them apart is a tag a test can prove wrong.
 */
export function contentFileValidators(
  id: string,
  updatedAt: string,
  size: number,
): ComparableValidators {
  return fileValidators(size, Date.parse(updatedAt), `${REPRESENTATION_REVISION}-${id}`);
}

/**
 * Validators for a body the service composed from several files.
 *
 * A listing has no single modification time — inventing one would be a claim
 * nothing backs — so it gets a tag and no `Last-Modified`. The tag is a hash of
 * the bytes that are about to be sent, which is the only thing that is true
 * about an aggregate; it is weak because the route may hand the same bytes back
 * through a proxy that recompresses them.
 */
export function bodyValidators(json: string): ComparableValidators {
  return {
    etag: `W/"${REPRESENTATION_REVISION}-${createHash('sha1').update(json).digest('base64url')}"`,
  };
}

/** The conditional headers of a Fastify request. */
function conditionalHeaders(request: FastifyRequest): {
  ifNoneMatch?: string | undefined;
  ifModifiedSince?: string | undefined;
} {
  return {
    ifNoneMatch: request.headers['if-none-match'],
    ifModifiedSince: request.headers['if-modified-since'],
  };
}

/**
 * Sends `body`, or `304` when the client already holds this representation.
 *
 * The validators go out either way: RFC 9110 §15.4.5 wants the 304 to carry
 * what the 200 would have carried, and a 304 without them leaves the client
 * with nothing to ask about next time — the saving would last exactly one
 * round.
 *
 * `body` is either an object Fastify serialises or an already-serialised
 * string; a listing is serialised by the caller because its tag is a hash of
 * exactly those bytes.
 */
export function sendConditional(
  request: FastifyRequest,
  reply: FastifyReply,
  validators: ComparableValidators,
  body: unknown,
): FastifyReply {
  reply.header('etag', validators.etag);
  if (validators.lastModified !== undefined) {
    reply.header('last-modified', validators.lastModified);
  }
  reply.header('cache-control', revalidatingCacheControl());

  if (isNotModified(conditionalHeaders(request), validators)) {
    return reply.code(304).send();
  }
  if (typeof body === 'string') {
    return reply.type('application/json; charset=utf-8').send(body);
  }
  return reply.send(body);
}
