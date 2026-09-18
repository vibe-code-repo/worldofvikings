import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Skeleton } from '@babylonjs/core/Bones/skeleton';
import { Bone } from '@babylonjs/core/Bones/bone';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { stabilizeHeadSkin } from '../src/player/headSkin.js';

const engine = new NullEngine();
const scene = new Scene(engine);
const skeleton = new Skeleton('body', 'body', scene);
new Bone('Neck', skeleton, null, undefined, undefined, undefined, 0);
new Bone('Head', skeleton, null, undefined, undefined, undefined, 1);
function mesh(name: string) {
  const result = new Mesh(name, scene);
  result.skeleton = skeleton;
  result.setVerticesData(VertexBuffer.PositionKind, [0, 0, 0, 0, .25, 0, 0, .6, 0, 0, 1, 0]);
  result.setVerticesData(VertexBuffer.MatricesIndicesKind, [0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0]);
  result.setVerticesData(VertexBuffer.MatricesWeightsKind, [.75, .25, 0, 0, .75, .25, 0, 0, .75, .25, 0, 0, .75, .25, 0, 0]);
  return result;
}
try {
  for (const sex of ['Male', 'Female']) {
    const head = mesh(`Chr_Head_${sex}_00`), hair = mesh('H_02');
    const sharedClone = head.clone('unmodified-cache')!;
    const original = Array.from(head.getVerticesData(VertexBuffer.MatricesWeightsKind)!);
    stabilizeHeadSkin([head], [hair]);
    for (const part of [head, hair]) {
      const weights = Array.from(part.getVerticesData(VertexBuffer.MatricesWeightsKind)!);
      const indices = part.getVerticesData(VertexBuffer.MatricesIndicesKind)!;
      assert.deepEqual(weights.slice(0, 4), original.slice(0, 4), 'neck seam stays unchanged');
      assert(weights[4]! > .25 && weights[4]! < 1, 'soft transition');
      for (const v of [2, 3]) {
        assert.equal(indices[v * 4], 1);
        assert.deepEqual(weights.slice(v * 4, v * 4 + 4), [1, 0, 0, 0], 'skull and hair follow Head only');
      }
      for (let v = 0; v < 4; v++) assert(Math.abs(weights.slice(v * 4, v * 4 + 4).reduce((a, b) => a + b, 0) - 1) < 1e-6);
      stabilizeHeadSkin([head], [hair]);
      assert.deepEqual(Array.from(part.getVerticesData(VertexBuffer.MatricesWeightsKind)!), weights, 'idempotent');
    }
    assert.deepEqual(Array.from(sharedClone.getVerticesData(VertexBuffer.MatricesWeightsKind)!), original, 'cached geometry untouched');
  }
  const legacy = mesh('mesh_node');
  const original = Array.from(legacy.getVerticesData(VertexBuffer.MatricesWeightsKind)!);
  stabilizeHeadSkin([legacy]);
  assert.deepEqual(Array.from(legacy.getVerticesData(VertexBuffer.MatricesWeightsKind)!), original);
  console.log('PASS head skin: both bodies, rigid scalp/hair, neck transition, normalized weights, cache isolation and idempotence');
} finally { scene.dispose(); engine.dispose(); }
