import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreateCapsule } from '@babylonjs/core/Meshes/Builders/capsuleBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { RenderConfig } from '@wov/engine';

/** Height of the placeholder capsule in metres — roughly a person. */
export const PLAYER_HEIGHT = 1.8;

/** Radius of the placeholder capsule in metres. */
export const PLAYER_RADIUS = 0.35;

export interface GameScene {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  /**
   * The player's stand-in until a character model exists.
   *
   * It is only a picture: its position is copied from the gameplay `Transform`
   * every frame and never written back (spec §25, ADR-0007).
   */
  readonly player: Mesh;
}

/**
 * Creates the Phase 1 placeholder scene: a capsule on a flat ground under a
 * hemispheric light, watched by an orbit camera. Nothing here is world data —
 * the real world is loaded from `content/worlds/` from Phase 4 on.
 */
export function createScene(canvas: HTMLCanvasElement, config: RenderConfig): GameScene {
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
  engine.setHardwareScalingLevel(1 / config.resolutionScale);

  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.055, 0.067, 0.086, 1);

  const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 3, 8, Vector3.Zero(), scene);
  camera.lowerRadiusLimit = 4;
  camera.upperRadiusLimit = 60;

  const light = new HemisphericLight('light', new Vector3(0.4, 1, 0.2), scene);
  light.intensity = 0.9;

  const ground = CreateGround('ground', { width: 40, height: 40, subdivisions: 4 }, scene);
  const groundMaterial = new StandardMaterial('ground-material', scene);
  groundMaterial.diffuseColor = new Color3(0.24, 0.3, 0.22);
  groundMaterial.specularColor = Color3.Black();
  ground.material = groundMaterial;

  const player = CreateCapsule(
    'player',
    { height: PLAYER_HEIGHT, radius: PLAYER_RADIUS, tessellation: 12 },
    scene,
  );
  const playerMaterial = new StandardMaterial('player-material', scene);
  playerMaterial.diffuseColor = new Color3(0.75, 0.58, 0.32);
  playerMaterial.specularColor = Color3.Black();
  player.material = playerMaterial;

  // The camera follows the capsule instead of the origin, so walking away does
  // not walk out of frame. The real third-person camera (spec §26) comes later.
  camera.setTarget(player);

  return { engine, scene, camera, player };
}
