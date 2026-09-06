/**
 * Drawing one prefab's whole field of copies as thin instances.
 *
 * **Why vegetation gets its own path.** The rest of the zone is placed as one
 * `TransformNode` per entity with an `InstancedMesh` under it — a real scene
 * node that can be picked, selected and moved, which is what a barrel or a
 * fence has to be. The scatter tool plants thousands of tufts of grass, and for
 * those the node is the cost: every one of them is a transform to recompute and
 * a node for the culler to consider each frame, for a plant nobody will ever
 * click on. A thin instance is a 4×4 matrix in a vertex buffer and nothing else
 * (no node, no picking, no per-instance material), which is the trade this
 * makes: the grass stops being addressable and starts being affordable.
 *
 * **The editor keeps the nodes.** There, every tuft *is* addressable, because
 * the whole point of the editor is to select and move what the world file says
 * (ADR-0018). The two agree on the world file, not on how it is drawn.
 *
 * **Why the matrices are composed here and not by Babylon.** A thin instance's
 * matrix is relative to its mesh's own world matrix, and a glTF container puts
 * its meshes under a `__root__` that carries the handedness flip. So the
 * instance matrix has to be the mesh's place inside its container followed by
 * the entity's own transform — in that order. Getting the order wrong mirrors
 * every plant through the origin, which is why {@link entityMatrix} and
 * {@link thinInstanceMatrices} are separate, tested functions.
 */
/**
 * The side-effect import that makes thin instances exist at all.
 *
 * With the ES6 packages, `Mesh.thinInstanceSetBuffer` is declared in
 * `mesh.d.ts` and is simply **absent at runtime** until this module has been
 * imported: `tsc` is happy, the bundle builds, and the first call throws
 * "mesh.thinInstanceSetBuffer is not a function" — which is exactly how this
 * was found, with every plant in the village reported as a failed prefab. It is
 * imported here rather than in `@wov/engine`'s shared side-effect module
 * because the editor does not draw thin instances and should not pay for them.
 */
import '@babylonjs/core/Meshes/thinInstanceMesh.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { EntityDefinition } from '@wov/world-schema';

/** Floats in one 4×4 matrix — the stride of the `matrix` thin-instance buffer. */
export const MATRIX_FLOATS = 16;

/**
 * One entity's transform as a matrix, in the order Babylon reads a `rotation`
 * vector: scale, then yaw-pitch-roll, then translation. The same order
 * `scene-sync.ts` and `world-scene.ts` put on a `TransformNode`, so a prop and
 * a tuft of grass with the same numbers stand in the same place.
 */
export function entityMatrix(entity: EntityDefinition): Matrix {
  const scale = entity.scale ?? [1, 1, 1];
  const rotation = entity.rotation ?? [0, 0, 0];
  return Matrix.Compose(
    new Vector3(scale[0], scale[1], scale[2]),
    Quaternion.RotationYawPitchRoll(rotation[1], rotation[0], rotation[2]),
    new Vector3(entity.position[0], entity.position[1], entity.position[2]),
  );
}

/**
 * The `matrix` buffer for one mesh: its place inside the container, followed by
 * each entity's transform.
 *
 * @param inContainer the mesh's world matrix while the container sits at the
 *   origin — the handedness flip of `__root__` included.
 */
export function thinInstanceMatrices(
  inContainer: Matrix,
  entities: readonly EntityDefinition[],
): Float32Array {
  const buffer = new Float32Array(entities.length * MATRIX_FLOATS);
  const world = new Matrix();
  entities.forEach((entity, index) => {
    inContainer.multiplyToRef(entityMatrix(entity), world);
    world.copyToArray(buffer, index * MATRIX_FLOATS);
  });
  return buffer;
}

/** A mesh that can carry thin instances — the part of `Mesh` used here. */
export type ThinInstanceTarget = Pick<
  Mesh,
  'thinInstanceSetBuffer' | 'thinInstanceRefreshBoundingInfo'
> &
  Pick<AbstractMesh, 'isPickable'>;

/**
 * Gives one mesh the whole field.
 *
 * The bounding info is refreshed over the instances afterwards, so the culler
 * knows the field spans the village rather than the single tuft the mesh was
 * loaded as — without it, walking past the first plant makes all of them
 * disappear at once.
 */
export function applyThinInstances(
  mesh: ThinInstanceTarget,
  matrices: Float32Array,
  options: { readonly pickable?: boolean } = {},
): void {
  mesh.thinInstanceSetBuffer('matrix', matrices, MATRIX_FLOATS, true);
  mesh.thinInstanceRefreshBoundingInfo(true);
  // Not pickable in the game on purpose: nothing in the game asks a tuft of
  // grass a question, and thin-instance picking costs a per-instance test.
  mesh.isPickable = options.pickable ?? false;
}
