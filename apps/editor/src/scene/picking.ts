/**
 * Turning a click into a place in the world.
 *
 * Two questions, and they are not the same one:
 *
 * - *What did I click on?* — a pick, walked up to the entity it belongs to.
 * - *Where did I click?* — a point on whatever surface is under the cursor,
 *   falling back to the ground plane when the cursor is over empty sky.
 *
 * The second one is what makes "click to place" land where the author is
 * looking rather than at the origin, and the downward ray after it is the
 * surface snapping of spec §14: the grid decides x and z, the world decides y.
 */
import { Ray } from '@babylonjs/core/Culling/ray';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Scene } from '@babylonjs/core/scene';

/**
 * A point in the world, in the world format's own shape.
 *
 * Deliberately the mutable tuple `@wov/world-schema` uses rather than the
 * readonly `Vec3` of the camera maths: what comes out of a pick goes straight
 * into an `EntityDefinition.position`.
 */
export type WorldPoint = [number, number, number];

/** How far above the target the surface ray starts, in metres. */
export const SURFACE_RAY_HEIGHT = 500;

/**
 * Where a ray crosses the `y = 0` plane, or `null` when it never does.
 *
 * Pure, because the sign mistake this can hide — a ray pointing up still
 * "hits" the plane behind the camera — puts the new prop somewhere off screen
 * and looks like a failed placement rather than a wrong one.
 */
export function rayToGroundPlane(origin: WorldPoint, direction: WorldPoint): WorldPoint | null {
  const dy = direction[1];
  if (Math.abs(dy) < 1e-6) {
    return null;
  }
  const distance = -origin[1] / dy;
  if (distance < 0) {
    return null;
  }
  return [origin[0] + direction[0] * distance, 0, origin[2] + direction[2] * distance];
}

/** The mesh under the cursor, ignoring meshes that opted out of picking. */
export function pickMesh(scene: Scene, x: number, y: number): AbstractMesh | null {
  const pick = scene.pick(x, y, (mesh) => mesh.isPickable && mesh.isEnabled());
  return pick?.hit ? pick.pickedMesh : null;
}

/**
 * The world point under the cursor: on a surface if there is one, otherwise on
 * the ground plane.
 */
export function pickWorldPoint(scene: Scene, x: number, y: number): WorldPoint | null {
  const pick = scene.pick(x, y, (mesh) => mesh.isPickable && mesh.isEnabled());
  if (pick?.hit && pick.pickedPoint) {
    const point = pick.pickedPoint;
    return [point.x, point.y, point.z];
  }

  const camera = scene.activeCamera;
  if (!camera) {
    return null;
  }
  const ray = scene.createPickingRay(x, y, Matrix.Identity(), camera);
  return rayToGroundPlane(
    [ray.origin.x, ray.origin.y, ray.origin.z],
    [ray.direction.x, ray.direction.y, ray.direction.z],
  );
}

/**
 * Drops a point onto the first surface below it.
 *
 * `ignore` keeps an entity from landing on itself while it is being placed —
 * without it the stand-in cube of the thing being dropped is the first thing
 * the ray meets.
 */
export function dropToSurface(
  scene: Scene,
  x: number,
  z: number,
  ignore: (mesh: AbstractMesh) => boolean = () => false,
): number {
  const ray = new Ray(new Vector3(x, SURFACE_RAY_HEIGHT, z), new Vector3(0, -1, 0), Infinity);
  const pick = scene.pickWithRay(
    ray,
    (mesh) => mesh.isPickable && mesh.isEnabled() && !ignore(mesh),
  );
  // No surface under this spot is not a failure: an empty world is flat ground.
  return pick?.hit && pick.pickedPoint ? pick.pickedPoint.y : 0;
}
