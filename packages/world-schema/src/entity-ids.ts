/**
 * Who minted an entity id — and why a world file has to be able to say so.
 *
 * Three tools put entities into a world file, and only one of them may be
 * overwritten by a re-import:
 *
 * | minted by             | shape                       | on a re-import |
 * | --------------------- | --------------------------- | -------------- |
 * | the scene import      | `<prefab>_0001`             | replaced       |
 * | a scatter run         | `<prefab>_s<seed>_<n>`      | kept           |
 * | placing in the editor | `<prefab>_001`              | kept           |
 *
 * A scene bundle is the truth about what it describes, so a placement it no
 * longer has must disappear — and an entity nobody authored into the bundle,
 * a scattered tuft or a prop dropped by hand, must survive (ADR-0036). The
 * question "did the last import write this?" therefore has to be answerable
 * from the file alone, without a second file recording what was written.
 *
 * **The id is the answer, and this module is where that is decided once.**
 * The scene import pads its instance number to four digits; the editor pads to
 * three and never reaches four ({@link SCENE_ENTITY_ID_DIGITS} is what it
 * checks itself against); a scatter id carries `s<seed>` in front of its
 * number and so is never all digits. The three namespaces do not overlap, and
 * a test in each package proves its own minter stays inside its own.
 *
 * **Why not a field on the entity.** An `origin: "scene"` on 1 582 entities
 * would be a schema change, a migration and a rewrite of every world file on
 * disk — for information those files already carry. It is also information
 * that can go stale in a way an id cannot: an entity can be copied, and a
 * copied marker lies while a copied id cannot exist twice.
 */

/**
 * The width the scene import pads its instance numbers to.
 *
 * Four rather than three because the village is 1 582 bundle placements and a
 * sorted list of `_1`, `_10`, `_100` reads wrong; three is what the editor
 * uses, which is exactly what keeps the two apart.
 */
export const SCENE_ENTITY_ID_DIGITS = 4;

/**
 * The id the scene import gives instance `instance` of `prefab`.
 *
 * `instance` counts across the whole world and not per zone, so the id names
 * one thing no matter which zone a later edit moves it to.
 */
export function sceneEntityId(prefab: string, instance: number): string {
  return `${prefab}_${String(instance).padStart(SCENE_ENTITY_ID_DIGITS, '0')}`;
}

/**
 * Whether this is an id the scene import minted — the test a re-import uses to
 * decide that an entity is the bundle's to replace.
 *
 * Both halves matter. The prefix must be the entity's *own* prefab, so that a
 * prefab whose name happens to end in digits cannot be read as a number; and
 * the rest must be nothing but digits, four or more of them, so that
 * `barrel_001` (the editor) and `barrel_s7_0001` (a scatter run) are outside
 * it. Anything else in a world file was authored, and authored work is kept.
 */
export function isSceneEntityId(id: string, prefab: string): boolean {
  const prefix = `${prefab}_`;
  if (!id.startsWith(prefix)) {
    return false;
  }
  const number = id.slice(prefix.length);
  return number.length >= SCENE_ENTITY_ID_DIGITS && /^\d+$/.test(number);
}
