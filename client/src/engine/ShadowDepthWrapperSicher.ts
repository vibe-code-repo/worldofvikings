/**
 * ShadowDepthWrapper that never builds its depth effect from a stale base effect.
 * ShadowDepthWrapper, der seinen Tiefen-Shader nie aus einer veralteten Vorlage baut.
 *
 * Problem (WebGPU render freeze, measured 26.09.2026 on 13 of 127 loads):
 * Babylon's `ShadowDepthWrapper` remembers, per sub mesh, the effect the colour pass
 * created (`_subMeshToEffect`, with the id of the render pass it was created in) and
 * copies that draw wrapper's `defines` when it builds the depth effect. If the
 * sub mesh's draw cache is reset in between (`resetDrawCache`, e.g. when a material
 * plugin such as PbrNebelFix is added to the shared laub material after its first
 * effect), the colour pass draw wrapper is gone and the copied `defines` are `null`.
 * `PBRMaterial.bindForSubMesh` then returns early ("no defines"), so the material
 * buffer, the lights and the textures are never bound for the depth pass. WebGL
 * tolerates that; WebGPU logs `Can't find buffer "Material" in the draw context` and
 * `createBindGroup` throws in EVERY frame's shadow pass. The colour pass that would
 * repair the entry never runs any more, so the freeze is permanent.
 *
 * Fix: while the base draw wrapper has no usable defines, report "not ready". The
 * shadow pass skips the sub mesh, the colour pass re-creates the base effect (and
 * with it the wrapper's entry), and the next frame builds the depth effect for real.
 *
 * Deutsch: Solange der Farbpass-Draw-Wrapper eines Sub-Meshes keine `defines` mehr
 * hat (Draw-Cache zurueckgesetzt), meldet der Wrapper „nicht bereit". Der
 * Schattenpass ueberspringt den Sub-Mesh, der Farbpass legt die Vorlage neu an,
 * und erst dann entsteht der Tiefen-Shader. Vorher warf `createBindGroup` unter
 * WebGPU in jedem Bild und der Render-Stillstand blieb dauerhaft.
 */
import { ShadowDepthWrapper } from '@babylonjs/core/Materials/shadowDepthWrapper';
import type { Material } from '@babylonjs/core/Materials/material';
import type { SubMesh } from '@babylonjs/core/Meshes/subMesh';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type { Scene } from '@babylonjs/core/scene';

/** Babylon's private table: sub mesh → [base effect, render pass id it was created in]. */
interface WrapperIntern {
  _subMeshToEffect: Map<SubMesh, [unknown, number]>;
}

/**
 * False when the wrapper holds a base effect for this sub mesh whose draw wrapper
 * has lost its `defines` (Babylon would copy `null`). True otherwise, including
 * "no base effect yet" — Babylon itself answers "not ready" in that case.
 */
export function vorlageHatDefines(wrapper: ShadowDepthWrapper, subMesh: SubMesh): boolean {
  const eintrag = (wrapper as unknown as WrapperIntern)._subMeshToEffect.get(subMesh);
  if (!eintrag) return true;
  const defines = subMesh._getDrawWrapper(eintrag[1])?.defines;
  // A string means "no defines object" for Babylon's copy as well.
  return defines != null && typeof defines !== 'string';
}

export class SicherTiefenWrapper extends ShadowDepthWrapper {
  override isReadyForSubMesh(
    subMesh: SubMesh,
    defines: string[],
    shadowGenerator: ShadowGenerator,
    useInstances: boolean,
    passIdForDrawWrapper: number
  ): boolean {
    if (!vorlageHatDefines(this, subMesh)) return false;
    return super.isReadyForSubMesh(subMesh, defines, shadowGenerator, useInstances, passIdForDrawWrapper);
  }
}

/** Creates the guarded depth wrapper for a material (the one place that does). */
export function erzeugeTiefenWrapper(material: Material, scene: Scene): ShadowDepthWrapper {
  return new SicherTiefenWrapper(material, scene);
}
