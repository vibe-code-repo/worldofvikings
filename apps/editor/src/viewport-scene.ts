import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
// One specific builder rather than the whole `MeshBuilder` set — see ADR-0006.
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { createRenderer } from '@wov/engine';
import type { RenderConfig, RendererHandle } from '@wov/engine';

/**
 * Creates the placeholder editor viewport: a grid-less ground under a light.
 *
 * Engine, scene, render loop, resize handling and the Babylon side-effect
 * imports come from `@wov/engine` (ADR-0006); this module only fills the
 * scene. Selection, gizmos and the asset browser follow in Phase 3.
 */
export async function createViewportRenderer(
  canvas: HTMLCanvasElement,
  overrides: Partial<RenderConfig> = {},
): Promise<RendererHandle> {
  const renderer = await createRenderer(canvas, overrides);
  const { scene } = renderer;

  scene.clearColor = new Color4(0.09, 0.11, 0.14, 1);

  new ArcRotateCamera('editor-camera', -Math.PI / 2, Math.PI / 3, 24, Vector3.Zero(), scene);
  new HemisphericLight('editor-light', new Vector3(0.4, 1, 0.2), scene);
  CreateGround('editor-ground', { width: 40, height: 40, subdivisions: 8 }, scene);

  return renderer;
}
