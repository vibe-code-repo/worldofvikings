import { describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { EntityDefinition, PrefabDefinition } from '@wov/world-schema';
import {
  bakeScale,
  boxShape,
  collisionShapeOf,
  entityRotation,
  groupByScale,
  placementOf,
  scaleKey,
  transformBounds,
  windingFor,
} from './entity-collision.js';

const UNIT: { min: [number, number, number]; max: [number, number, number]; rootMatrix: Matrix } = {
  min: [-1, 0, -1],
  max: [1, 2, 1],
  rootMatrix: Matrix.Identity(),
};

function prefab(overrides: Partial<PrefabDefinition> = {}): PrefabDefinition {
  return {
    id: 'thing',
    name: 'Thing',
    asset: 'environment/thing.glb',
    visibility: 'public',
    category: 'environment',
    ...overrides,
  } as PrefabDefinition;
}

function entity(overrides: Partial<EntityDefinition> = {}): EntityDefinition {
  return { id: 'e', prefab: 'thing', position: [0, 0, 0], ...overrides } as EntityDefinition;
}

describe('entityRotation', () => {
  it('is the quaternion Babylon builds from the same three angles', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const angles: [number, number, number] = [0.3, -1.2, 2.4];

    // Measured, not asserted: the node is rotated the way the renderer rotates
    // an entity root, and its world matrix is compared with one composed from
    // the quaternion the collision body would be given.
    const node = new TransformNode('probe', scene);
    node.rotation.set(angles[0], angles[1], angles[2]);
    const rendered = node.computeWorldMatrix(true);

    const quat = entityRotation(angles);
    const composed = Matrix.Compose(
      Vector3.One(),
      new Quaternion(quat.x, quat.y, quat.z, quat.w),
      Vector3.Zero(),
    );

    for (let index = 0; index < 16; index += 1) {
      expect(composed.m[index], `element ${String(index)}`).toBeCloseTo(rendered.m[index] ?? 0, 6);
    }
    scene.dispose();
    engine.dispose();
  });
});

describe('scaleKey and groupByScale', () => {
  it('puts entities of one scale into one group', () => {
    const groups = groupByScale([
      entity({ id: 'a', scale: [2, 2, 2] }),
      entity({ id: 'b' }),
      entity({ id: 'c', scale: [2, 2, 2] }),
    ]);
    expect(groups.size).toBe(2);
    expect(groups.get(scaleKey([2, 2, 2]))?.entities.map((e) => e.id)).toEqual(['a', 'c']);
    expect(groups.get(scaleKey([1, 1, 1]))?.entities.map((e) => e.id)).toEqual(['b']);
  });

  it('keeps a mirrored entity apart from an unmirrored one', () => {
    expect(scaleKey([-1, 1, 1])).not.toBe(scaleKey([1, 1, 1]));
  });
});

describe('placementOf', () => {
  it('carries position and rotation and nothing else', () => {
    const placement = placementOf(entity({ position: [1, 2, 3], scale: [9, 9, 9] }));
    expect(placement.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(placement.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(Object.keys(placement).sort()).toEqual(['position', 'rotation']);
  });
});

describe('boxShape', () => {
  it('takes the middle and half the size of the hull', () => {
    expect(boxShape([-1, 0, -2], [1, 4, 2], [1, 1, 1])).toEqual({
      kind: 'box',
      center: { x: 0, y: 2, z: 0 },
      halfExtents: { x: 1, y: 2, z: 2 },
    });
  });

  it('scales an off-centre hull about the entity origin, not about itself', () => {
    // A model standing on its origin has min.y = 0: doubled, it must still
    // stand on it, not sink half its height into the ground.
    const shape = boxShape([-1, 0, -1], [1, 2, 1], [1, 2, 1]);
    expect(shape).toMatchObject({ center: { y: 2 }, halfExtents: { y: 2 } });
  });

  it('never reports a negative half extent for a mirrored entity', () => {
    const shape = boxShape([-1, 0, -1], [1, 2, 1], [-2, 1, 1]);
    expect(shape).toMatchObject({
      center: { x: 0, y: 1, z: 0 },
      halfExtents: { x: 2, y: 1, z: 1 },
    });
  });
});

describe('bakeScale and windingFor', () => {
  it('multiplies every vertex by the entity scale', () => {
    expect([...bakeScale(Float32Array.from([1, 2, 3, 4, 5, 6]), [2, 3, 4])]).toEqual([
      2, 6, 12, 8, 15, 24,
    ]);
  });

  it('leaves the triangles alone when the entity is not mirrored', () => {
    const indices = Uint32Array.from([0, 1, 2]);
    expect(windingFor(indices, [1, 2, 3])).toBe(indices);
    expect(windingFor(indices, [-1, -1, 1])).toBe(indices);
  });

  it('turns every triangle round when the entity is mirrored', () => {
    expect([...windingFor(Uint32Array.from([0, 1, 2, 3, 4, 5]), [-1, 1, 1])]).toEqual([
      0, 2, 1, 3, 5, 4,
    ]);
  });
});

describe('transformBounds', () => {
  it('mirrors a file-space box the way the loaded model is mirrored', () => {
    const mirrored = Matrix.Scaling(-1, 1, 1);
    expect(transformBounds({ min: [1, 0, 0], max: [3, 2, 1] }, mirrored)).toEqual({
      min: [-3, 0, 0],
      max: [-1, 2, 1],
    });
  });
});

describe('collisionShapeOf', () => {
  const geometry = {
    ...UNIT,
    positions: Float32Array.from([-1, 0, -1, 1, 0, -1, 1, 2, -1]),
    indices: Uint32Array.from([0, 1, 2]),
  };

  it('has no shape for a prefab that says it collides against nothing', () => {
    expect(collisionShapeOf(prefab({ collision: { kind: 'none' } }), [1, 1, 1], UNIT)).toBeNull();
  });

  it('has no shape for a prefab that says nothing at all', () => {
    // Undecided must read as "walk through it", which is what the game did
    // before prefabs carried a collision shape — never as an invented box.
    expect(collisionShapeOf(prefab(), [1, 1, 1], UNIT)).toBeNull();
  });

  it('boxes the measured hull of the loaded model', () => {
    expect(collisionShapeOf(prefab({ collision: { kind: 'box' } }), [1, 1, 1], UNIT)).toEqual({
      kind: 'box',
      center: { x: 0, y: 1, z: 0 },
      halfExtents: { x: 1, y: 1, z: 1 },
    });
  });

  it('prefers an explicit box, brought into the loaded model’s space', () => {
    const shape = collisionShapeOf(
      prefab({ collision: { kind: 'box', box: { min: [-0.2, 0, -0.2], max: [0.2, 10, 0.2] } } }),
      [1, 1, 1],
      { ...UNIT, rootMatrix: Matrix.Scaling(-1, 1, 1) },
    );
    expect(shape).toMatchObject({ halfExtents: { x: 0.2, y: 5, z: 0.2 } });
  });

  it('bakes the scale into a mesh shape and turns its triangles round', () => {
    const shape = collisionShapeOf(prefab({ collision: { kind: 'mesh' } }), [-2, 1, 1], geometry);
    expect(shape?.kind).toBe('mesh');
    if (shape?.kind !== 'mesh') {
      return;
    }
    expect([...shape.positions].slice(0, 3)).toEqual([2, 0, -1]);
    expect([...shape.indices]).toEqual([0, 2, 1]);
  });

  it('hands a hull its points', () => {
    const shape = collisionShapeOf(prefab({ collision: { kind: 'hull' } }), [1, 1, 1], geometry);
    expect(shape?.kind).toBe('hull');
  });

  it('refuses to build triangles from a hull measurement', () => {
    expect(() =>
      collisionShapeOf(prefab({ collision: { kind: 'mesh' } }), [1, 1, 1], UNIT),
    ).toThrow(/triangles/);
  });
});
