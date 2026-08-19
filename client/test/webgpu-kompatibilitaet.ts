import assert from 'node:assert/strict';
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
import {
  aktiviereWebGpuGlslKompatibilitaet,
  istWebGpuGlslKompatibilitaetAktiv,
} from '../src/engine/WebGpuKompatibilitaet';

// Ein Babylon-Update darf die fuer die bestehenden GLSL-Plugins notwendige
// Sprachwahl nicht still auf das native WGSL des WebGPU-Backends umstellen.
StandardMaterial.ForceGLSL = false;
PBRBaseMaterial.ForceGLSL = false;
// Der Aktivierer muss einen eventuell von anderem Code gesetzten globalen
// GLSL-Zwang wieder loesen, damit Babylons native WGSL-Post-Processes laufen.
PostProcess.ForceGLSL = true;
Layer.ForceGLSL = false;
ThinEffectLayer.ForceGLSL = false;
LensFlareSystem.ForceGLSL = false;
ShadowGenerator.ForceGLSL = false;
LinesMesh.ForceGLSL = false;
ThinParticleSystem.ForceGLSL = false;
DepthRenderer.ForceGLSL = false;
GeometryBufferRenderer.ForceGLSL = false;
SpriteRenderer.ForceGLSL = false;
NodeMaterial.UseNativeShaderLanguageOfEngine = true;
NodeMaterial.DefaultShaderLanguage = ShaderLanguage.WGSL;

assert.equal(istWebGpuGlslKompatibilitaetAktiv(), false);
aktiviereWebGpuGlslKompatibilitaet();

assert.equal(StandardMaterial.ForceGLSL, true);
assert.equal(PBRBaseMaterial.ForceGLSL, true);
assert.equal(PostProcess.ForceGLSL, false);
assert.equal(Layer.ForceGLSL, true);
assert.equal(ThinEffectLayer.ForceGLSL, true);
assert.equal(LensFlareSystem.ForceGLSL, true);
assert.equal(ShadowGenerator.ForceGLSL, true);
assert.equal(LinesMesh.ForceGLSL, true);
assert.equal(ThinParticleSystem.ForceGLSL, true);
assert.equal(DepthRenderer.ForceGLSL, true);
assert.equal(GeometryBufferRenderer.ForceGLSL, true);
assert.equal(SpriteRenderer.ForceGLSL, true);
assert.equal(NodeMaterial.UseNativeShaderLanguageOfEngine, false);
assert.equal(NodeMaterial.DefaultShaderLanguage, ShaderLanguage.GLSL);
assert.equal(istWebGpuGlslKompatibilitaetAktiv(), true);

console.log('WebGPU-GLSL-Kompatibilitaetsflags: OK');
