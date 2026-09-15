import { armorBodyForFigure, legacyFemaleRegionForBone } from '@wov/shared';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';

type MaskState = { original: number[]; partitions: Map<string, number[]>; key: string };
const masks = new WeakMap<AbstractMesh, MaskState>();

/** Call only for freshly loaded BODY meshes, never an entire scene with attachments. */
export function prepareLegacyFemaleBody(meshes: readonly AbstractMesh[], figure: string): void {
  if (armorBodyForFigure(figure)?.bodyProfile !== 'legacy-female-v1') return;
  for (const mesh of meshes) {
    if (!(mesh instanceof Mesh) || !mesh.skeleton || masks.has(mesh)
        || !mesh.skeleton.bones.some(b => b.name === 'L_Thigh')) continue;
    const indices = mesh.getIndices();
    const joints = mesh.getVerticesData(VertexBuffer.MatricesIndicesKind);
    const weights = mesh.getVerticesData(VertexBuffer.MatricesWeightsKind);
    if (!indices || !joints || !weights) continue;
    const boneNames = new Map(mesh.skeleton.bones.map(b => [b.getIndex(), b.name]));
    const partitions = new Map<string, number[]>();
    for (let t = 0; t < indices.length; t += 3) {
      const scores = new Map<string, number>();
      for (let v = 0; v < 3; v++) for (let k = 0; k < 4; k++) {
        const index = indices[t + v]! * 4 + k;
        const weight = weights[index]!;
        if (weight <= 0) continue;
        const name = boneNames.get(joints[index]!);
        if (name === undefined) throw new Error('Unknown legacy female skin joint');
        const region = legacyFemaleRegionForBone(name);
        scores.set(region, (scores.get(region) ?? 0) + weight);
      }
      const region = [...scores].sort((a, b) => Math.floor(b[1] * 1e6 + .5) - Math.floor(a[1] * 1e6 + .5)
        || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0]?.[0];
      if (!region) throw new Error('Unweighted legacy female body triangle');
      const bucket = partitions.get(region) ?? [];
      bucket.push(indices[t]!, indices[t + 1]!, indices[t + 2]!); partitions.set(region, bucket);
    }
    // Remote characters may share a cached geometry. Never mask another player.
    mesh.makeGeometryUnique();
    masks.set(mesh, { original: Array.from(indices), partitions, key: '' });
  }
}

/** Preserve vertices, UVs, textures and weights; only original body triangles change visibility. */
export function updateLegacyFemaleMask(mesh: AbstractMesh, hidden: ReadonlySet<string>): boolean {
  const state = masks.get(mesh);
  if (!state || !(mesh instanceof Mesh)) return false;
  const key = [...hidden].filter(r => state.partitions.has(r)).sort().join('|');
  if (state.key === key) return true;
  const indices = key ? [...state.partitions].flatMap(([r, list]) => hidden.has(r) ? [] : list) : state.original;
  mesh.setIndices(indices, mesh.getTotalVertices(), true);
  mesh.setEnabled(indices.length > 0);
  state.key = key;
  return true;
}
