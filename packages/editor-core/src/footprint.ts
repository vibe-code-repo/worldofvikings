/**
 * What an already-placed entity covers on the ground.
 *
 * A scatter needs this to keep out of things: grass belongs between the
 * flagstones, not through them, and not through a house floor. The keep-outs
 * are therefore derived from the world file itself — the buildings and paving
 * that are already there — rather than typed in by hand as a second, drifting
 * description of where the village is.
 *
 * **Why a rectangle and not the mesh.** The answer only has to be good enough
 * to decide whether a tuft of grass may stand somewhere, and the prefab
 * catalogue already carries a hull box per prefab (`PrefabDefinition.bounds`).
 * Asking the real geometry would mean loading 139 GLBs in a command-line tool
 * to place grass. The rectangle is the honest approximation, and `margin`
 * exists because a hull box is not the silhouette: a pitched roof's box reaches
 * further than its walls do, and a doorway's does not reach as far as the step
 * in front of it.
 */
import type { EntityDefinition, PrefabDefinition, Vector3 } from '@wov/world-schema';
import type { Rect } from './scatter.js';

/** The eight corners of a box, as `[x, y, z]` multipliers of min and max. */
const CORNERS = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
] as const;

export interface FootprintOptions {
  /** Metres added on every side. Negative shrinks the rectangle. */
  readonly margin?: number;
}

/**
 * The `[x0, z0, x1, z1]` an entity covers, hull box and transform included.
 *
 * The rotation is read the way Babylon.js reads a `rotation` vector — yaw,
 * then pitch, then roll — because that is what the game and the editor both do
 * with these numbers (`apps/game/src/world-scene.ts`). A footprint computed in
 * another order would be a different rectangle for every rotated house.
 */
export function footprintOf(
  entity: EntityDefinition,
  prefab: PrefabDefinition,
  options: FootprintOptions = {},
): Rect | undefined {
  const bounds = prefab.bounds;
  if (bounds === undefined) {
    return undefined;
  }
  const scale = entity.scale ?? [1, 1, 1];
  const rotation = entity.rotation ?? [0, 0, 0];
  const margin = options.margin ?? 0;

  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const corner of CORNERS) {
    const local: Vector3 = [
      (corner[0] === 0 ? bounds.min[0] : bounds.max[0]) * scale[0],
      (corner[1] === 0 ? bounds.min[1] : bounds.max[1]) * scale[1],
      (corner[2] === 0 ? bounds.min[2] : bounds.max[2]) * scale[2],
    ];
    const turned = rotate(local, rotation);
    const x = entity.position[0] + turned[0];
    const z = entity.position[2] + turned[2];
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return [minX - margin, minZ - margin, maxX + margin, maxZ + margin];
}

/**
 * The footprints of every entity whose prefab id one of the `patterns` is a
 * substring of.
 *
 * Substring rather than an exact id because the things to keep out of come in
 * families — every `…path-wood-plank…`, every `…bld-…` — and naming eighty ids
 * one by one in a command line is how a keep-out list goes stale.
 */
export function footprintsOf(
  entities: readonly EntityDefinition[],
  prefabs: ReadonlyMap<string, PrefabDefinition>,
  patterns: readonly string[],
  options: FootprintOptions = {},
): readonly Rect[] {
  if (patterns.length === 0) {
    return [];
  }
  const rects: Rect[] = [];
  for (const entity of entities) {
    if (!patterns.some((pattern) => entity.prefab.includes(pattern))) {
      continue;
    }
    const prefab = prefabs.get(entity.prefab);
    if (prefab === undefined) {
      continue;
    }
    const rect = footprintOf(entity, prefab, options);
    if (rect !== undefined) {
      rects.push(rect);
    }
  }
  return rects;
}

/** Babylon.js's `rotation` order: roll (z), then pitch (x), then yaw (y). */
function rotate(point: Vector3, rotation: Vector3): Vector3 {
  const [pitch, yaw, roll] = rotation;
  let [x, y, z] = point;

  const cosRoll = Math.cos(roll);
  const sinRoll = Math.sin(roll);
  [x, y] = [x * cosRoll - y * sinRoll, x * sinRoll + y * cosRoll];

  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  [y, z] = [y * cosPitch - z * sinPitch, y * sinPitch + z * cosPitch];

  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  [x, z] = [x * cosYaw + z * sinYaw, -x * sinYaw + z * cosYaw];

  return [x, y, z];
}
