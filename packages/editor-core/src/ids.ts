/**
 * Entity ids the editor hands out.
 *
 * Deterministic on purpose (agent rule 17): the id of a placed or duplicated
 * entity is a function of the prefab and of the ids already in use, never of
 * `Math.random`. Two people doing the same steps produce the same world file,
 * and a test can state the expected id.
 */

/** `<prefab>_042` — the separator is `_`, as in the authored example world. */
const SEPARATOR = '_';
const MINIMUM_DIGITS = 3;

/**
 * The part of an entity id that says which prefab it came from.
 *
 * Anything outside `a-z0-9_-` folds to `-`, and a leading character the world
 * schema's identifier rule would reject gets an `e` in front, so the result is
 * always a valid id.
 */
export function entityIdBase(prefabId: string): string {
  const folded = prefabId
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+$/g, '');
  if (folded === '') {
    return 'entity';
  }
  return /^[a-z0-9]/.test(folded) ? folded : `e${folded}`;
}

/**
 * The lowest unused id for this prefab.
 *
 * Counting from one and taking the first gap keeps ids short and stable: after
 * deleting `barrel-01_002` the next placed barrel takes that number back
 * instead of the world file drifting to ever larger numbers.
 */
export function nextEntityId(usedIds: Iterable<string>, prefabId: string): string {
  const used = usedIds instanceof Set ? usedIds : new Set(usedIds);
  const base = entityIdBase(prefabId);
  for (let counter = 1; ; counter += 1) {
    const candidate = `${base}${SEPARATOR}${String(counter).padStart(MINIMUM_DIGITS, '0')}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
}

/**
 * One id per prefab, each reserved as it is handed out — so duplicating three
 * copies of the same prefab in one command cannot produce the same id twice.
 */
export function nextEntityIds(
  usedIds: Iterable<string>,
  prefabIds: readonly string[],
): readonly string[] {
  const used = new Set(usedIds);
  const created: string[] = [];
  for (const prefabId of prefabIds) {
    const id = nextEntityId(used, prefabId);
    used.add(id);
    created.push(id);
  }
  return created;
}
