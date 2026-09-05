/**
 * The one file in `apps/game` that knows a physics backend exists (ADR-0008).
 *
 * Everything else in the game talks to `PhysicsWorld` from `@wov/physics`, which
 * contains no Babylon.js and no Havok. The backend is pulled in with a dynamic
 * `import()` so Vite emits it — and the ~2 MB `HavokPhysics.wasm` behind it — as
 * its own chunk instead of putting it in the bootstrap. Nothing is downloaded
 * until a caller actually asks for a world.
 *
 * `pnpm lint:boundaries` allows `@babylonjs/havok` and `@wov/physics/havok` here
 * and nowhere else in the game.
 */
import type { Scene } from '@babylonjs/core/scene';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { PhysicsWorld, StaticMeshData } from '@wov/physics';
// The URL of the emitted asset, not the asset itself: this is a string in the
// bundle. Havok's own loader would otherwise guess a path that does not survive
// bundling, so we hand it the one Vite produced.
import havokWasmUrl from '@babylonjs/havok/lib/esm/HavokPhysics.wasm?url';

/** Loads the Havok backend and returns a world for the given scene. */
export async function createGamePhysicsWorld(scene: Scene): Promise<PhysicsWorld> {
  const { createHavokPhysicsWorld } = await import('@wov/physics/havok');
  return createHavokPhysicsWorld(scene, { locateWasm: () => havokWasmUrl });
}

/**
 * Reads a rendered mesh's triangles into the renderer-free shape the physics
 * contract accepts (`StaticMeshData`).
 *
 * This is the one direction the boundary allows: rendering data flows *into*
 * physics, never the other way round. Positions are baked into world space, so
 * a collider does not silently move when the mesh's parent transform changes.
 *
 * Moves to `@wov/engine` once that package owns the shared Babylon bootstrap.
 */
export function toStaticMeshData(mesh: AbstractMesh): StaticMeshData {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  const indices = mesh.getIndices();
  if (!positions || !indices) {
    throw new Error(`Mesh "${mesh.name}" has no geometry to collide with.`);
  }

  const worldMatrix = mesh.computeWorldMatrix(true);
  const world = new Float32Array(positions.length);
  const point = new Vector3();
  for (let index = 0; index < positions.length; index += 3) {
    point.set(positions[index] ?? 0, positions[index + 1] ?? 0, positions[index + 2] ?? 0);
    Vector3.TransformCoordinatesToRef(point, worldMatrix, point);
    world[index] = point.x;
    world[index + 1] = point.y;
    world[index + 2] = point.z;
  }

  return { name: mesh.name, positions: world, indices: Uint32Array.from(indices) };
}
