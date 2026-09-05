import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { resolveRenderConfig } from '@wov/engine';

export interface ViewportScene {
  readonly engine: Engine;
  readonly scene: Scene;
}

/** Creates the placeholder editor viewport: a grid-less ground under a light. */
export function createViewportScene(canvas: HTMLCanvasElement): ViewportScene {
  const config = resolveRenderConfig();
  const engine = new Engine(canvas, true);
  engine.setHardwareScalingLevel(1 / config.resolutionScale);

  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.09, 0.11, 0.14, 1);

  new ArcRotateCamera('editor-camera', -Math.PI / 2, Math.PI / 3, 24, Vector3.Zero(), scene);
  new HemisphericLight('editor-light', new Vector3(0.4, 1, 0.2), scene);
  CreateGround('editor-ground', { width: 40, height: 40, subdivisions: 8 }, scene);

  return { engine, scene };
}
