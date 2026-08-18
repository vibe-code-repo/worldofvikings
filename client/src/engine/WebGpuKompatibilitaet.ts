import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import { NodeMaterial } from '@babylonjs/core/Materials/Node/nodeMaterial';
import { PBRBaseMaterial } from '@babylonjs/core/Materials/PBR/pbrBaseMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess';

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
  PostProcess.ForceGLSL = true;

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
    PostProcess.ForceGLSL &&
    !NodeMaterial.UseNativeShaderLanguageOfEngine &&
    NodeMaterial.DefaultShaderLanguage === ShaderLanguage.GLSL
  );
}
