/** Optional per-character red halo. Call setMeshes after equip/unequip and dispose on removal.
 * This adapter is shipped with the asset, not automatically enabled on running DEV.
 */
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
// Keep GLSL shaders in standalone bundles as well as the main client bundle.
import '@babylonjs/core/Shaders/postprocess.vertex';
import '@babylonjs/core/Shaders/pass.fragment';
import '@babylonjs/core/Shaders/kernelBlur.vertex';
import '@babylonjs/core/Shaders/kernelBlur.fragment';
import '@babylonjs/core/Shaders/glowMapMerge.vertex';
import '@babylonjs/core/Shaders/glowMapMerge.fragment';
import '@babylonjs/core/Shaders/glowMapGeneration.vertex';
import '@babylonjs/core/Shaders/glowMapGeneration.fragment';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

export function createEmberrageGlow(scene: Scene, meshes: AbstractMesh[], pulse = true) {
  const layer = new GlowLayer('Emberrage_equipment_glow', scene, { mainTextureRatio: .5, blurKernelSize: 32 });
  layer.intensity = .45;
  layer.customEmissiveColorSelector = (_mesh, _subMesh, material, color) => {
    if (material instanceof PBRMaterial && /^Emberrage_(glow|core|red|eyes)$/.test(material.name)) {
      color.set(material.emissiveColor.r, material.emissiveColor.g, material.emissiveColor.b, 1);
    } else color.set(0, 0, 0, 0);
  };
  let current: Mesh[] = [];
  const setMeshes = (next: AbstractMesh[]) => {
    for (const mesh of current) layer.removeIncludedOnlyMesh(mesh);
    current = next.filter((mesh): mesh is Mesh => mesh instanceof Mesh && !mesh.isDisposed());
    for (const mesh of current) layer.addIncludedOnlyMesh(mesh);
    // An empty include list otherwise means all scene meshes, not none.
    layer.isEnabled = current.length > 0;
  };
  setMeshes(meshes);
  let elapsed = 0;
  const observer = scene.onBeforeRenderObservable.add(() => {
    elapsed += Math.min(scene.getEngine().getDeltaTime(), 100) / 1000;
    if (pulse) layer.intensity = .45 + .075 * Math.sin(elapsed * Math.PI * 2 * .6);
  });
  return { layer, setMeshes, dispose: () => {
    scene.onBeforeRenderObservable.remove(observer);
    layer.dispose();
    current = [];
  } };
}
