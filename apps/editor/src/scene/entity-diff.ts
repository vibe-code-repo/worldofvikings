/**
 * What changed between two versions of a zone.
 *
 * The viewport derives its scene from the document (ADR-0018), and the naive
 * way to do that is to throw the scene away and rebuild it after every edit.
 * That is correct and unusable: rebuilding means re-instantiating every model
 * in the zone, so dragging one barrel would stall on a hundred trees.
 *
 * This module answers the only question the rebuild would have asked anyway —
 * *which* entities differ — as a pure function, so the rule can be tested
 * without a GPU and the Babylon side stays a straight translation of the
 * answer.
 */
import type { EntityDefinition, Vector3 } from '@wov/world-schema';

export interface EntityDiff {
  /** In `next` and not in `previous`. */
  readonly added: readonly EntityDefinition[];
  /** Ids in `previous` and not in `next`. */
  readonly removed: readonly string[];
  /** Same id, different prefab: the instance has to be rebuilt. */
  readonly replaced: readonly EntityDefinition[];
  /** Same id and prefab, different transform: the node only has to be moved. */
  readonly moved: readonly EntityDefinition[];
}

/** An absent rotation or scale means the default, not "unknown". */
const NO_ROTATION: Vector3 = [0, 0, 0];
const UNIT_SCALE: Vector3 = [1, 1, 1];

function sameVector(
  left: Vector3 | undefined,
  right: Vector3 | undefined,
  fallback: Vector3,
): boolean {
  const a = left ?? fallback;
  const b = right ?? fallback;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** True when both entities would place the same node in the same place. */
export function sameTransform(left: EntityDefinition, right: EntityDefinition): boolean {
  return (
    sameVector(left.position, right.position, NO_ROTATION) &&
    sameVector(left.rotation, right.rotation, NO_ROTATION) &&
    sameVector(left.scale, right.scale, UNIT_SCALE)
  );
}

/**
 * Compares two entity lists by id.
 *
 * Order is not part of the comparison: a world file lists entities in author
 * order and moving a row up and down is not a change to the picture.
 */
export function diffEntities(
  previous: readonly EntityDefinition[],
  next: readonly EntityDefinition[],
): EntityDiff {
  const before = new Map(previous.map((entity) => [entity.id, entity]));
  const added: EntityDefinition[] = [];
  const replaced: EntityDefinition[] = [];
  const moved: EntityDefinition[] = [];
  const seen = new Set<string>();

  for (const entity of next) {
    seen.add(entity.id);
    const old = before.get(entity.id);
    if (old === undefined) {
      added.push(entity);
    } else if (old.prefab !== entity.prefab) {
      replaced.push(entity);
    } else if (!sameTransform(old, entity)) {
      moved.push(entity);
    }
  }

  const removed = previous.filter((entity) => !seen.has(entity.id)).map((entity) => entity.id);
  return { added, removed, replaced, moved };
}

/** True when nothing at all changed — the common case while orbiting. */
export function isEmptyDiff(diff: EntityDiff): boolean {
  return (
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.replaced.length === 0 &&
    diff.moved.length === 0
  );
}
