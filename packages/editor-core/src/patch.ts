/**
 * Changing one field of a nested block, without mutating anything.
 *
 * The lighting profile and the terrain block are trees of small optional
 * objects, and a panel edits one leaf of them at a time: `sun.intensity`,
 * `layers.2.tileSize`, `shadows.filter`. Spelling that out as a spread per
 * level in every command would be six near-identical copies of the same
 * mistake, so the address is a path and this module walks it.
 *
 * Two rules the rest of the editor depends on:
 *
 * - **`null` removes.** A world file distinguishes "no fog block" from "a fog
 *   block that says nothing", and a panel needs to be able to produce both. A
 *   patch whose value is `null` deletes the key; `undefined` is not used,
 *   because it does not survive `JSON.stringify` and would silently become
 *   "leave it alone" on the way through the API.
 * - **The empty path is the whole block.** `{ path: [], value: … }` replaces
 *   everything, which is what a lighting preset does and what every undo of
 *   these commands is (see `commands.ts`).
 */

/** One field of a block, addressed by path. `null` removes it. */
export interface FieldPatch {
  /** Object keys and array indices, outermost first. `[]` is the block itself. */
  readonly path: readonly string[];
  readonly value: unknown;
}

/** Whether this path segment addresses an array element. */
function arrayIndex(segment: string): number | null {
  if (!/^\d+$/.test(segment)) {
    return null;
  }
  return Number.parseInt(segment, 10);
}

/** The value at `path`, or `undefined` when nothing lives there. */
export function valueAtPath(root: unknown, path: readonly string[]): unknown {
  let current = root;
  for (const segment of path) {
    if (Array.isArray(current)) {
      const index = arrayIndex(segment);
      if (index === null) {
        return undefined;
      }
      current = current[index];
      continue;
    }
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * `root` with `path` set to `value`, or with it removed when `value` is `null`.
 *
 * Missing intermediate levels are created as objects — setting `sun.intensity`
 * on a world that says nothing about light must work, or the first slider drag
 * of a session would do nothing. An index into a missing array is refused
 * instead of inventing one, because an array with a hole is not a thing any of
 * these schemas allows.
 */
export function applyFieldPatch(root: unknown, patch: FieldPatch): unknown {
  if (patch.path.length === 0) {
    return patch.value === null ? undefined : patch.value;
  }
  return set(root, patch.path, patch.value);
}

function set(current: unknown, path: readonly string[], value: unknown): unknown {
  const [segment = '', ...rest] = path;

  if (Array.isArray(current)) {
    const index = arrayIndex(segment);
    if (index === null || index < 0 || index >= current.length) {
      return current;
    }
    const next = [...(current as unknown[])];
    if (rest.length === 0) {
      if (value === null) {
        next.splice(index, 1);
      } else {
        next[index] = value;
      }
      return next;
    }
    next[index] = set(next[index], rest, value);
    return next;
  }

  const object: Record<string, unknown> =
    typeof current === 'object' && current !== null
      ? { ...(current as Record<string, unknown>) }
      : {};

  if (rest.length === 0) {
    if (value === null) {
      delete object[segment];
    } else {
      object[segment] = value;
    }
    return object;
  }
  object[segment] = set(object[segment], rest, value);
  return object;
}

/** Applies patches in order, each one to the result of the last. */
export function applyFieldPatches(root: unknown, patches: readonly FieldPatch[]): unknown {
  let current = root;
  for (const patch of patches) {
    current = applyFieldPatch(current, patch);
  }
  return current;
}

/**
 * The one patch that puts a whole block back the way it was.
 *
 * Every command in this editor that edits a block by path inverts to *this*
 * rather than to a field-for-field inverse, and the reason is exactness: a
 * patch that created `sun.intensity` on a world with no lighting at all cannot
 * be undone by removing that one key — that would leave `{ "sun": {} }`, which
 * is a different file. These blocks are a few hundred bytes, so remembering the
 * old one costs nothing and is right in every case.
 */
export function restorePatch(previous: unknown): FieldPatch {
  return { path: [], value: previous === undefined ? null : previous };
}
