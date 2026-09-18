import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';

const headName = /^Chr_Head_(?:Male|Female)_\d+(?:$|[. ])/;
const prepared = new WeakSet<AbstractMesh>();

/** Keep the skull rigid with Head, retaining a soft transition at the neck seam.
 * Applies only to the split Synty bodies, never the old one-piece female mesh.
 * Bounds and skin positions are in the same exported mesh coordinate system.
 */
export function stabilizeHeadSkin(bodyMeshes: readonly AbstractMesh[], hairMeshes: readonly AbstractMesh[] = []): void {
  const head = bodyMeshes.find(mesh => headName.test(mesh.name));
  if (!head?.skeleton) return;
  const bone = head.skeleton.bones.find(b => b.name === 'Head');
  const positions = head.getVerticesData(VertexBuffer.PositionKind);
  if (!bone || bone.getIndex() < 0 || !positions?.length) return;
  let bottom = Infinity, top = -Infinity;
  for (let i = 1; i < positions.length; i += 3) {
    bottom = Math.min(bottom, positions[i]!);
    top = Math.max(top, positions[i]!);
  }
  if (top <= bottom) return;
  // Preserve the lowest neck vertices exactly; the skull above the lower
  // third must not inherit the original 75% Neck / 25% Head blend.
  const start = bottom + (top - bottom) * .15;
  const end = bottom + (top - bottom) * .35;
  for (const mesh of [head, ...hairMeshes]) {
    if (!(mesh instanceof Mesh) || prepared.has(mesh) || mesh.skeleton !== head.skeleton) continue;
    const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
    const indices = mesh.getVerticesData(VertexBuffer.MatricesIndicesKind);
    const weights = mesh.getVerticesData(VertexBuffer.MatricesWeightsKind);
    // These exports use four influences; leave unknown formats untouched.
    if (!pos || !indices || !weights || mesh.numBoneInfluencers > 4) continue;
    const nextIndices = Array.from(indices), nextWeights = Array.from(weights);
    for (let v = 0; v < pos.length / 3; v++) {
      const t = Math.min(1, Math.max(0, (pos[v * 3 + 1]! - start) / (end - start)));
      if (t === 0) continue;
      const blend = t * t * (3 - 2 * t);
      const influences = new Map<number, number>();
      for (let k = 0; k < 4; k++) {
        const index = indices[v * 4 + k]!, weight = weights[v * 4 + k]! * (1 - blend);
        if (weight > 0) influences.set(index, (influences.get(index) ?? 0) + weight);
      }
      influences.set(bone.getIndex(), (influences.get(bone.getIndex()) ?? 0) + blend);
      const kept = [...influences].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const total = kept.reduce((sum, [, weight]) => sum + weight, 0);
      for (let k = 0; k < 4; k++) {
        nextIndices[v * 4 + k] = kept[k]?.[0] ?? 0;
        nextWeights[v * 4 + k] = (kept[k]?.[1] ?? 0) / total;
      }
    }
    // Remote instances share geometry with the cache and with other players.
    mesh.makeGeometryUnique();
    mesh.setVerticesData(VertexBuffer.MatricesIndicesKind, nextIndices);
    mesh.setVerticesData(VertexBuffer.MatricesWeightsKind, nextWeights);
    prepared.add(mesh);
  }
}
