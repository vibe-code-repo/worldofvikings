import assert from 'node:assert/strict';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import { NodeMaterial } from '@babylonjs/core/Materials/Node/nodeMaterial';
import { PBRBaseMaterial } from '@babylonjs/core/Materials/PBR/pbrBaseMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess';
import {
  aktiviereWebGpuGlslKompatibilitaet,
  istWebGpuGlslKompatibilitaetAktiv,
} from '../src/engine/WebGpuKompatibilitaet';

// Ein Babylon-Update darf die fuer die bestehenden GLSL-Plugins notwendige
// Sprachwahl nicht still auf das native WGSL des WebGPU-Backends umstellen.
StandardMaterial.ForceGLSL = false;
PBRBaseMaterial.ForceGLSL = false;
PostProcess.ForceGLSL = false;
NodeMaterial.UseNativeShaderLanguageOfEngine = true;
NodeMaterial.DefaultShaderLanguage = ShaderLanguage.WGSL;

assert.equal(istWebGpuGlslKompatibilitaetAktiv(), false);
aktiviereWebGpuGlslKompatibilitaet();

assert.equal(StandardMaterial.ForceGLSL, true);
assert.equal(PBRBaseMaterial.ForceGLSL, true);
assert.equal(PostProcess.ForceGLSL, true);
assert.equal(NodeMaterial.UseNativeShaderLanguageOfEngine, false);
assert.equal(NodeMaterial.DefaultShaderLanguage, ShaderLanguage.GLSL);
assert.equal(istWebGpuGlslKompatibilitaetAktiv(), true);

console.log('WebGPU-GLSL-Kompatibilitaetsflags: OK');
