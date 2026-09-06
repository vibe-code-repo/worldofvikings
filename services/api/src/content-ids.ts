import { join } from 'node:path';

/**
 * The identifier rule of `@wov/world-schema`, repeated here on purpose: it is
 * also the path guard. A world id becomes a file name, so anything outside
 * `a-z0-9_-` — a slash, a dot, a backslash, a null byte, `..` — is refused
 * before it can reach the file system, whatever the URL decoder produced.
 */
export const CONTENT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/** Longest id we accept, so a request cannot exceed the file name limit. */
const MAX_ID_LENGTH = 64;

export function isContentId(value: string): boolean {
  return value.length <= MAX_ID_LENGTH && CONTENT_ID_PATTERN.test(value);
}

/**
 * The absolute file for a content id, or an error for an id that does not
 * pass {@link isContentId}. There is no second line of defence because there
 * is no way past this one: the caller never joins a raw id itself.
 */
export function contentFilePath(contentDir: string, folder: string, id: string): string {
  if (!isContentId(id)) {
    throw new Error(`invalid content id "${id}"`);
  }
  return join(contentDir, folder, `${id}.json`);
}
