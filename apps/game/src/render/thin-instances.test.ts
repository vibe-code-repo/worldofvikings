import { describe, expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
// A builder module: it defines `CreateBox` and registers nothing, so it cannot
// install the thin-instance side effect this file is checking for.
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { Scene } from '@babylonjs/core/scene.js';
import type { EntityDefinition } from '@wov/world-schema';
import {
  MATRIX_FLOATS,
  applyThinInstances,
  entityMatrix,
  thinInstanceMatrices,
  type ThinInstanceTarget,
} from './thin-instances.js';

const at = (position: [number, number, number], rest: Partial<EntityDefinition> = {}) =>
  ({ id: 'grass_001', prefab: 'vegetation-grass', position, ...rest }) as EntityDefinition;

/** Where a point ends up once a matrix is applied to it. */
const moved = (matrix: Matrix, point: [number, number, number]): number[] => {
  const result = Vector3.TransformCoordinates(new Vector3(...point), matrix);
  return [result.x, result.y, result.z].map((value) => Number(value.toFixed(4)));
};

describe('entityMatrix', () => {
  it('translates by the entity position', () => {
    expect(moved(entityMatrix(at([10, 2, -4])), [0, 0, 0])).toEqual([10, 2, -4]);
  });

  it('scales before it translates, as a transform node does', () => {
    const matrix = entityMatrix(at([10, 0, 0], { scale: [2, 1, 1] }));
    expect(moved(matrix, [1, 0, 0])).toEqual([12, 0, 0]);
  });

  it('turns around y by the yaw in the rotation vector', () => {
    const matrix = entityMatrix(at([0, 0, 0], { rotation: [0, Math.PI / 2, 0] }));
    expect(moved(matrix, [1, 0, 0])).toEqual([0, 0, -1]);
  });

  it('treats a missing rotation and scale as none, not as zero size', () => {
    expect(moved(entityMatrix(at([0, 0, 0])), [3, 4, 5])).toEqual([3, 4, 5]);
  });
});

describe('thinInstanceMatrices', () => {
  it('writes sixteen floats per entity', () => {
    const buffer = thinInstanceMatrices(Matrix.Identity(), [at([0, 0, 0]), at([1, 1, 1])]);
    expect(buffer).toHaveLength(2 * MATRIX_FLOATS);
  });

  it('applies the mesh place inside the container before the entity transform', () => {
    // A container root that mirrors x, as a glTF `__root__` does, and a mesh
    // standing one metre up inside it.
    const inContainer = Matrix.Scaling(-1, 1, 1).multiply(Matrix.Translation(0, 1, 0));
    const buffer = thinInstanceMatrices(inContainer, [at([10, 0, 0])]);
    const world = Matrix.FromArray([...buffer.slice(0, MATRIX_FLOATS)]);
    // The mesh's own offset is kept, the entity's translation is added on top,
    // and the mirroring applies to the mesh, not to the entity's position.
    expect(moved(world, [1, 0, 0])).toEqual([9, 1, 0]);
  });

  it('gives an empty field an empty buffer instead of failing', () => {
    expect(thinInstanceMatrices(Matrix.Identity(), [])).toHaveLength(0);
  });

  it('places each entity at its own position', () => {
    const buffer = thinInstanceMatrices(Matrix.Identity(), [at([1, 0, 0]), at([0, 0, 7])]);
    expect(moved(Matrix.FromArray([...buffer.slice(0, 16)]), [0, 0, 0])).toEqual([1, 0, 0]);
    expect(moved(Matrix.FromArray([...buffer.slice(16, 32)]), [0, 0, 0])).toEqual([0, 0, 7]);
  });
});

describe('applyThinInstances', () => {
  const target = (): ThinInstanceTarget & { isPickable: boolean } => ({
    thinInstanceSetBuffer: vi.fn(),
    thinInstanceRefreshBoundingInfo: vi.fn(),
    isPickable: true,
  });

  it('hands the buffer over with the matrix stride', () => {
    const mesh = target();
    const matrices = thinInstanceMatrices(Matrix.Identity(), [at([0, 0, 0])]);
    applyThinInstances(mesh, matrices);
    expect(mesh.thinInstanceSetBuffer).toHaveBeenCalledWith(
      'matrix',
      matrices,
      MATRIX_FLOATS,
      true,
    );
  });

  it('refreshes the bounding info, so the field is not culled at the first plant', () => {
    const mesh = target();
    applyThinInstances(mesh, thinInstanceMatrices(Matrix.Identity(), [at([0, 0, 0])]));
    expect(mesh.thinInstanceRefreshBoundingInfo).toHaveBeenCalledWith(true);
  });

  it('makes the field unpickable in the game, and pickable only when asked', () => {
    const unpickable = target();
    applyThinInstances(unpickable, new Float32Array(0));
    expect(unpickable.isPickable).toBe(false);

    const pickable = target();
    applyThinInstances(pickable, new Float32Array(0), { pickable: true });
    expect(pickable.isPickable).toBe(true);
  });
});

/**
 * The side-effect import, exercised rather than asserted.
 *
 * `mesh.thinInstanceSetBuffer` is not a stub that throws — before
 * `Meshes/thinInstanceMesh.js` is imported it is not there at all, and a
 * `typeof` check on a mesh created in this file would only prove that
 * *something* in the test's own import graph installed it. Calling it on a real
 * mesh and reading the count back is the witness.
 */
describe('thin instances are registered on Mesh', () => {
  it('accepts a matrix buffer and reports the instances back', () => {
    const engine = new NullEngine({
      renderWidth: 64,
      renderHeight: 64,
      textureSize: 64,
      deterministicLockstep: false,
      lockstepMaxSteps: 1,
    });
    try {
      const scene = new Scene(engine);
      const box = CreateBox('box', { size: 1 }, scene);
      applyThinInstances(
        box,
        thinInstanceMatrices(Matrix.Identity(), [at([1, 0, 0]), at([0, 0, 2])]),
      );
      expect(box.thinInstanceCount).toBe(2);
      expect(box.isPickable).toBe(false);
      scene.dispose();
    } finally {
      engine.dispose();
    }
  });
});
