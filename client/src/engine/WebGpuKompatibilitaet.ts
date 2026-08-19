import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import { NodeMaterial } from '@babylonjs/core/Materials/Node/nodeMaterial';
import { PBRBaseMaterial } from '@babylonjs/core/Materials/PBR/pbrBaseMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess';
import { Layer } from '@babylonjs/core/Layers/layer';
import { ThinEffectLayer } from '@babylonjs/core/Layers/thinEffectLayer';
import { LensFlareSystem } from '@babylonjs/core/LensFlares/lensFlareSystem';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import { ThinParticleSystem } from '@babylonjs/core/Particles/thinParticleSystem';
import { DepthRenderer } from '@babylonjs/core/Rendering/depthRenderer';
import { GeometryBufferRenderer } from '@babylonjs/core/Rendering/geometryBufferRenderer';
import { SpriteRenderer } from '@babylonjs/core/Sprites/spriteRenderer';

/**
 * Laesst die bestehenden GLSL-Erweiterungen auf Babylons WebGPU-Backend
 * laufen. Babylon uebersetzt die erzeugten GLSL-Shader fuer WebGPU; damit
 * bleiben WaterPlugin, WindPlugin, Nebel- und Gamma-Fixes identisch zum
 * WebGL2-Pfad, waehrend die Renderbefehle bereits ueber WebGPU laufen.
 *
 * Muss vor der Erzeugung des ersten Materials/PostProcess aufgerufen werden.
 */
export function aktiviereWebGpuGlslKompatibilitaet(): void {
  StandardMaterial.ForceGLSL = true;
  PBRBaseMaterial.ForceGLSL = true;

  // Die eingebauten Post-Processes besitzen native WGSL-Shader und muessen
  // sie unter WebGPU auch benutzen duerfen. Ein globales ForceGLSL kollidiert
  // insbesondere mit ThinSSAO2PostProcess: Der Pass importiert dann GLSL,
  // behaelt aber seine WGSL-Sprachkennung und laedt als Fallback die nicht
  // vorhandene URL `src/ShadersWGSL/ssao2.fragment.fx` (bei Vite: index.html).
  // Eigene GLSL-Post-Processes legen ihre Sprache stattdessen am Pass fest.
  PostProcess.ForceGLSL = false;

  // Diese Babylon-Subsysteme waehlen ihre Shader-Sprache unabhaengig von
  // Standard-/PBR-Materialien. Ohne dieselbe Festlegung lud insbesondere
  // der ShadowGenerator WGSL-Includes in einen GLSL-Schatten-Shader. Das
  // liess #include<...> im Quelltext stehen und glslang brach am '<' ab.
  Layer.ForceGLSL = true;
  ThinEffectLayer.ForceGLSL = true;
  LensFlareSystem.ForceGLSL = true;
  ShadowGenerator.ForceGLSL = true;
  LinesMesh.ForceGLSL = true;
  ThinParticleSystem.ForceGLSL = true;
  DepthRenderer.ForceGLSL = true;
  GeometryBufferRenderer.ForceGLSL = true;
  SpriteRenderer.ForceGLSL = true;

  // Terrain und weitere prozedurale Materialien sind NodeMaterials. Babylon
  // verwendet derzeit standardmaessig GLSL, aber wir halten das hier explizit
  // fest, damit ein kuenftiges Default-Update die Material-Plugins nicht
  // unbemerkt wieder auf WGSL umstellt.
  NodeMaterial.UseNativeShaderLanguageOfEngine = false;
  NodeMaterial.DefaultShaderLanguage = ShaderLanguage.GLSL;
}

/** GPU-freie Diagnose fuer Test und Startprotokoll. */
export function istWebGpuGlslKompatibilitaetAktiv(): boolean {
  return (
    StandardMaterial.ForceGLSL &&
    PBRBaseMaterial.ForceGLSL &&
    !PostProcess.ForceGLSL &&
    Layer.ForceGLSL &&
    ThinEffectLayer.ForceGLSL &&
    LensFlareSystem.ForceGLSL &&
    ShadowGenerator.ForceGLSL &&
    LinesMesh.ForceGLSL &&
    ThinParticleSystem.ForceGLSL &&
    DepthRenderer.ForceGLSL &&
    GeometryBufferRenderer.ForceGLSL &&
    SpriteRenderer.ForceGLSL &&
    !NodeMaterial.UseNativeShaderLanguageOfEngine &&
    NodeMaterial.DefaultShaderLanguage === ShaderLanguage.GLSL
  );
}
