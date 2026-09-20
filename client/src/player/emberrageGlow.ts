/** Optional per-character red halo. Call setMeshes after equip/unequip and dispose on removal.
 * The shared visibility refresh connects this adapter to all four rendering paths.
 * Despite the file name it serves every emissive-mesh profile (ArmorVfxProfile): Emberrage and Gravethorn.
 */
import type { ArmorVfxProfile } from '@wov/shared';
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
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial';

/**
 * The materials that belong to each profile: `prefix` marks a mesh as that set's, `emissive` picks the glowing
 * ones. The Record type makes a new profile in the registry fail to compile until it is listed here.
 */
const GLOW_PROFILES: Readonly<Record<ArmorVfxProfile, { prefix: string; emissive: RegExp }>> = {
  emberrage_red: { prefix: 'Emberrage_', emissive: /^Emberrage_(glow|core|red|eyes)$/ },
  gravethorn_red: { prefix: 'Gravethorn_', emissive: /^Gravethorn_(glow|core|red|eyes)$/ },
};
const profiles = Object.values(GLOW_PROFILES);

export function createEmberrageGlow(scene: Scene, meshes: AbstractMesh[], pulse = true) {
  const layer = new GlowLayer('Emberrage_equipment_glow', scene, { mainTextureRatio: .5, blurKernelSize: 32 });
  layer.intensity = .45;
  layer.customEmissiveColorSelector = (_mesh, _subMesh, material, color) => {
    if (material instanceof PBRMaterial && profiles.some(profile => profile.emissive.test(material.name))) {
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

const sceneEffects = new WeakMap<Scene, ReturnType<typeof createEmberrageGlow>>();
/** One selective layer per scene, rather than one postprocess per remote player. */
export function syncEmberrageGlow(scene: Scene): void {
  const meshes = scene.meshes.filter(mesh => {
    const materials = mesh.material instanceof MultiMaterial ? mesh.material.subMaterials : [mesh.material];
    return !mesh.isDisposed() && mesh.isEnabled() && mesh.isVisible && materials.some(m => m && profiles.some(profile => m.name.startsWith(profile.prefix)));
  });
  let effect = sceneEffects.get(scene);
  if (!effect && meshes.length) {
    effect = createEmberrageGlow(scene, meshes);
    sceneEffects.set(scene, effect);
    scene.onDisposeObservable.addOnce(() => { effect!.dispose(); sceneEffects.delete(scene); });
  } else effect?.setMeshes(meshes);
}
