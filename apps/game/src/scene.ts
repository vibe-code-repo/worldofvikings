import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
// One specific builder rather than the whole `MeshBuilder` set — see ADR-0006.
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { createRenderer } from '@wov/engine';
import type { RenderConfig, RendererHandle } from '@wov/engine';

/**
 * Creates the Phase 0 placeholder scene: a camera looking at a flat ground
 * under a hemispheric light.
 *
 * Engine, scene, render loop and resize handling come from `@wov/engine`
 * (ADR-0006); this module only fills the scene. Nothing here is world data —
 * the real world is loaded from `content/worlds/` from Phase 4 on.
 */
export async function createGameRenderer(
  canvas: HTMLCanvasElement,
  overrides: Partial<RenderConfig> = {},
): Promise<RendererHandle> {
  const renderer = await createRenderer(canvas, overrides);
  const { scene } = renderer;

  scene.clearColor = new Color4(0.055, 0.067, 0.086, 1);

  const camera = new ArcRotateCamera(
    'camera',
    -Math.PI / 2,
    Math.PI / 3,
    18,
    Vector3.Zero(),
    scene,
  );
  camera.lowerRadiusLimit = 4;
  camera.upperRadiusLimit = 60;

  const light = new HemisphericLight('light', new Vector3(0.4, 1, 0.2), scene);
  light.intensity = 0.9;

  const ground = CreateGround('ground', { width: 40, height: 40, subdivisions: 4 }, scene);
  const groundMaterial = new StandardMaterial('ground-material', scene);
  groundMaterial.diffuseColor = new Color3(0.24, 0.3, 0.22);
  groundMaterial.specularColor = Color3.Black();
  ground.material = groundMaterial;

  return renderer;
}
