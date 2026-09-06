/**
 * Resolving the one file a scene import is allowed to read (ADR-0033).
 *
 * A scene import takes a *file path* from a browser. That is the shape of every
 * directory-traversal hole there is, so the rule here is an allow-list and not
 * a filter:
 *
 * 1. Without `WOV_IMPORT_DIR` the action does not exist. A service nobody
 *    configured for imports cannot be talked into reading the disk, which is
 *    what makes this safe to leave in a deployed API.
 * 2. The request names a path *relative to* that directory. An absolute path is
 *    refused rather than joined, because `join('/import', '/etc/passwd')` is
 *    `/import/etc/passwd` and `resolve` is not.
 * 3. The resolved path is then checked to still be inside the directory. That
 *    is what catches `../`, a symbolic link out of the tree is *not* caught by
 *    it, and the operator is told so: `WOV_IMPORT_DIR` is a directory you
 *    control, not a shared drop box.
 * 4. It must end in `.glb`. A scene bundle is a binary glTF; anything else is
 *    somebody exploring.
 *
 * The check is separated from the route so it can be tested on its own — a path
 * guard that is only exercised through HTTP is a path guard nobody has read the
 * failing cases of.
 */
import { isAbsolute, relative, resolve, sep } from 'node:path';

export type ImportPathResult =
  | { readonly ok: true; readonly path: string }
  | {
      readonly ok: false;
      readonly reason: 'not-configured' | 'rejected';
      readonly message: string;
    };

/** The suffix a scene bundle has. */
const BUNDLE_SUFFIX = '.glb';

export function resolveImportPath(
  importDir: string | undefined,
  requested: string,
): ImportPathResult {
  if (importDir === undefined) {
    return {
      ok: false,
      reason: 'not-configured',
      message:
        'this API cannot import scene bundles: set WOV_IMPORT_DIR to the directory the bundles live in',
    };
  }
  const trimmed = requested.trim();
  if (trimmed === '') {
    return { ok: false, reason: 'rejected', message: 'name a bundle inside WOV_IMPORT_DIR' };
  }
  if (isAbsolute(trimmed) || /^[a-zA-Z]:/.test(trimmed)) {
    return {
      ok: false,
      reason: 'rejected',
      message: 'the bundle is named relative to WOV_IMPORT_DIR, not by an absolute path',
    };
  }
  if (trimmed.includes('\0')) {
    return { ok: false, reason: 'rejected', message: 'that is not a file name' };
  }
  if (!trimmed.toLowerCase().endsWith(BUNDLE_SUFFIX)) {
    return { ok: false, reason: 'rejected', message: `a scene bundle is a ${BUNDLE_SUFFIX} file` };
  }

  const root = resolve(importDir);
  const path = resolve(root, trimmed);
  const inside = relative(root, path);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
    return {
      ok: false,
      reason: 'rejected',
      message: 'that path is outside WOV_IMPORT_DIR',
    };
  }
  // `relative` uses the platform separator; a leading `..` segment is the only
  // way out of the tree and is caught above. This is the belt for the braces.
  if (inside.split(sep).includes('..')) {
    return { ok: false, reason: 'rejected', message: 'that path is outside WOV_IMPORT_DIR' };
  }
  return { ok: true, path };
}
