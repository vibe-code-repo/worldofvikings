/**
 * Turning a zone's entities into collision shapes (ADR-0026).
 *
 * The world file says what stands where; `content/prefabs/imported.json` says
 * what each of those things is shaped like. This module joins the two and hands
 * `@wov/physics` one shape per distinct *(prefab, scale)* pair together with
 * every place it stands — 220 shapes for the village's 1216 entities, because
 * eighty copies of one fence at one scale are eighty bodies pointing at one box.
 *
 * **Why scale is baked in and rotation is not.** A rigid-body transform is a
 * position and a rotation; a solver has nowhere to put a scale, least of all an
 * uneven or a negative one — and the village has 632 unevenly scaled entities
 * and 133 mirrored ones. So the scale is multiplied into the shape's own
 * coordinates here, which also means a mirrored entity gets a mirrored shape
 * with its triangles wound the other way round, and the body itself only ever
 * carries a position and a quaternion.
 *
 * **Why the geometry is read out of the loaded model rather than the manifest.**
 * The manifest's `bounds` are in the model file's space. Babylon flips a glTF's
 * handedness on the root node it creates, so a box copied out of the manifest
 * would be mirrored against the thing the player can see. The hull is therefore
 * measured on the container that was actually loaded — the same nodes the
 * renderer draws (ADR-0022, "measure, do not assume").
 */
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import type { AssetContainer } from '@babylonjs/core/assetContainer.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { EntityDefinition, PrefabBounds, PrefabDefinition } from '@wov/world-schema';
import type { Quat, StaticPlacement, StaticShapeDescription } from '@wov/physics';

/** How many digits of a scale still make two entities share one shape. */
const SCALE_DIGITS = 4;

/** What a loaded model looks like in the space its entity root sits in. */
export interface ModelGeometry {
  /** Flat `x, y, z`, every mesh of the container baked into container space. */
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  /** The container's hull, the two corners of it. */
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  /**
   * The matrix the container's root node applies.
   *
   * Kept because a box measured in the *model file's* space — a tree's trunk,
   * measured by the importer — has to be brought into this space before it can
   * be used, and this matrix is the only honest way to do it.
   */
  readonly rootMatrix: Matrix;
}

/** The hull of a loaded container, without touching a vertex buffer. */
export function readContainerBounds(container: AssetContainer): {
  readonly min: [number, number, number];
  readonly max: [number, number, number];
  readonly rootMatrix: Matrix;
} {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (const mesh of container.meshes) {
    if (mesh.getTotalVertices() === 0) {
      continue;
    }
    mesh.computeWorldMatrix(true);
    const box = mesh.getBoundingInfo().boundingBox;
    for (const corner of [box.minimumWorld, box.maximumWorld]) {
      min[0] = Math.min(min[0], corner.x);
      min[1] = Math.min(min[1], corner.y);
      min[2] = Math.min(min[2], corner.z);
      max[0] = Math.max(max[0], corner.x);
      max[1] = Math.max(max[1], corner.y);
      max[2] = Math.max(max[2], corner.z);
    }
  }

  return { min, max, rootMatrix: rootMatrixOf(container) };
}

/** Every triangle of a loaded container, baked into container space. */
export function readContainerGeometry(container: AssetContainer): ModelGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const point = new Vector3();

  for (const mesh of container.meshes) {
    const local = mesh.getVerticesData(VertexBuffer.PositionKind);
    const meshIndices = mesh.getIndices();
    if (!local || !meshIndices) {
      continue;
    }
    const offset = positions.length / 3;
    const matrix = mesh.computeWorldMatrix(true);
    for (let index = 0; index < local.length; index += 3) {
      point.set(local[index] ?? 0, local[index + 1] ?? 0, local[index + 2] ?? 0);
      Vector3.TransformCoordinatesToRef(point, matrix, point);
      positions.push(point.x, point.y, point.z);
      min[0] = Math.min(min[0], point.x);
      min[1] = Math.min(min[1], point.y);
      min[2] = Math.min(min[2], point.z);
      max[0] = Math.max(max[0], point.x);
      max[1] = Math.max(max[1], point.y);
      max[2] = Math.max(max[2], point.z);
    }
    for (const index of meshIndices) {
      indices.push(index + offset);
    }
  }

  return {
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
    min,
    max,
    rootMatrix: rootMatrixOf(container),
  };
}

/** The transform the container's own root node applies to everything under it. */
function rootMatrixOf(container: AssetContainer): Matrix {
  const root = container.rootNodes[0];
  return root && 'computeWorldMatrix' in root
    ? (root as AbstractMesh).computeWorldMatrix(true).clone()
    : Matrix.Identity();
}

/**
 * The rotation of an entity as a quaternion, exactly as Babylon reads its
 * `TransformNode.rotation`.
 *
 * The world file stores three angles; a solver needs a quaternion, and an Euler
 * triple means nothing without an axis order. This is the order the renderer
 * uses (`RotationYawPitchRoll(y, x, z)`), so the body and the picture agree —
 * `entity-collision.test.ts` checks that against a real transform node rather
 * than taking this comment's word for it.
 */
export function entityRotation(rotation: readonly [number, number, number]): Quat {
  const quaternion = Quaternion.RotationYawPitchRoll(rotation[1], rotation[0], rotation[2]);
  return { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w };
}

/** The scale two entities have to share to share one collision shape. */
export function scaleKey(scale: readonly [number, number, number]): string {
  return scale.map((value) => value.toFixed(SCALE_DIGITS)).join(',');
}

/** Entities of one prefab, split by the scale they are placed at. */
export function groupByScale(
  entities: readonly EntityDefinition[],
): ReadonlyMap<string, { scale: [number, number, number]; entities: EntityDefinition[] }> {
  const groups = new Map<
    string,
    { scale: [number, number, number]; entities: EntityDefinition[] }
  >();
  for (const entity of entities) {
    const raw = entity.scale ?? [1, 1, 1];
    const scale: [number, number, number] = [raw[0], raw[1], raw[2]];
    const key = scaleKey(scale);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { scale, entities: [entity] });
    } else {
      group.entities.push(entity);
    }
  }
  return groups;
}

/** Where one entity's body stands. */
export function placementOf(entity: EntityDefinition): StaticPlacement {
  return {
    position: { x: entity.position[0], y: entity.position[1], z: entity.position[2] },
    rotation: entityRotation(entity.rotation ?? [0, 0, 0]),
  };
}

/**
 * The shape one prefab is collided against, at one scale.
 *
 * @returns `null` when this prefab has no collision at all — either it says so
 * (`none`) or it says nothing, which a reader must treat as `none` rather than
 * inventing a shape for it.
 */
export function collisionShapeOf(
  prefab: PrefabDefinition,
  scale: readonly [number, number, number],
  geometry: ModelGeometry | Pick<ModelGeometry, 'min' | 'max' | 'rootMatrix'>,
): StaticShapeDescription | null {
  const collision = prefab.collision;
  if (collision === undefined || collision.kind === 'none') {
    return null;
  }

  if (collision.kind === 'box') {
    const hull =
      collision.box === undefined ? geometry : transformBounds(collision.box, geometry.rootMatrix);
    return boxShape(hull.min, hull.max, scale);
  }

  if (!('positions' in geometry)) {
    throw new Error(`collision kind "${collision.kind}" needs the model's triangles`);
  }
  const positions = bakeScale(geometry.positions, scale);
  if (collision.kind === 'hull') {
    return { kind: 'hull', positions };
  }
  return { kind: 'mesh', positions, indices: windingFor(geometry.indices, scale) };
}

/** An axis-aligned box, scaled about the entity's own origin. */
export function boxShape(
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  scale: readonly [number, number, number],
): StaticShapeDescription {
  const axis = (index: 0 | 1 | 2): { center: number; half: number } => {
    const low = (min[index] ?? 0) * (scale[index] ?? 1);
    const high = (max[index] ?? 0) * (scale[index] ?? 1);
    return { center: (low + high) / 2, half: Math.abs(high - low) / 2 };
  };
  const [x, y, z] = [axis(0), axis(1), axis(2)];
  return {
    kind: 'box',
    center: { x: x.center, y: y.center, z: z.center },
    halfExtents: { x: x.half, y: y.half, z: z.half },
  };
}

/** A box in the model file's space, brought into the loaded model's space. */
export function transformBounds(
  bounds: PrefabBounds,
  matrix: Matrix,
): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const point = new Vector3();
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) {
        point.set(x, y, z);
        Vector3.TransformCoordinatesToRef(point, matrix, point);
        min[0] = Math.min(min[0], point.x);
        min[1] = Math.min(min[1], point.y);
        min[2] = Math.min(min[2], point.z);
        max[0] = Math.max(max[0], point.x);
        max[1] = Math.max(max[1], point.y);
        max[2] = Math.max(max[2], point.z);
      }
    }
  }
  return { min, max };
}

/** Multiplies every vertex by the entity's scale. */
export function bakeScale(
  positions: Float32Array,
  scale: readonly [number, number, number],
): Float32Array {
  const scaled = new Float32Array(positions.length);
  for (let index = 0; index < positions.length; index += 3) {
    scaled[index] = (positions[index] ?? 0) * (scale[0] ?? 1);
    scaled[index + 1] = (positions[index + 1] ?? 0) * (scale[1] ?? 1);
    scaled[index + 2] = (positions[index + 2] ?? 0) * (scale[2] ?? 1);
  }
  return scaled;
}

/**
 * The triangle list a mirrored entity needs.
 *
 * A scale with an odd number of negative axes turns every triangle inside out.
 * The renderer has its own answer for that; a collision mesh's answer is to
 * swap two indices, so the surface still faces the way it did.
 */
export function windingFor(
  indices: Uint32Array,
  scale: readonly [number, number, number],
): Uint32Array {
  if ((scale[0] ?? 1) * (scale[1] ?? 1) * (scale[2] ?? 1) >= 0) {
    return indices;
  }
  const flipped = Uint32Array.from(indices);
  for (let index = 0; index + 2 < flipped.length; index += 3) {
    const swap = flipped[index + 1] ?? 0;
    flipped[index + 1] = flipped[index + 2] ?? 0;
    flipped[index + 2] = swap;
  }
  return flipped;
}
