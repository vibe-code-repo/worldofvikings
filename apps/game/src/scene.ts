import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { createBaseScene, createRenderer } from '@wov/engine';
import type { BaseSceneHandle, BaseSceneOptions, RenderConfig, RendererHandle } from '@wov/engine';

/**
 * The game's Phase 1 view: the shared base stage from `@wov/engine` plus the
 * camera looking at it.
 *
 * Engine, scene, render loop and resize handling come from `createRenderer`;
 * ground, lights, sky and fog from `createBaseScene` (ADR-0006, ADR-0007).
 * What stays here is the part the editor would do differently — the camera,
 * which becomes the third-person follow camera of spec §26.
 *
 * Nothing here is world data. The authored world arrives from `content/` in
 * Phase 4; the base ground is a placeholder, not a generator (agent rule 16).
 */
export interface GameScene {
  readonly renderer: RendererHandle;
  readonly base: BaseSceneHandle;
  readonly camera: ArcRotateCamera;
}

export interface GameSceneOptions {
  /** Passed to `createRenderer` (resolution scale, WebGPU preference). */
  readonly render?: Partial<RenderConfig>;
  /** Passed to `createBaseScene` (ground size, sky and fog colours). */
  readonly base?: BaseSceneOptions;
}

export async function createGameScene(
  canvas: HTMLCanvasElement,
  options: GameSceneOptions = {},
): Promise<GameScene> {
  const renderer = await createRenderer(canvas, options.render);
  const base = createBaseScene(renderer.scene, options.base);

  // Framed for the 100 m ground: far enough out to show the fogged horizon,
  // aimed slightly above the surface so a player-sized figure would sit in the
  // middle. Not attached to any input yet — camera control is its own step.
  const camera = new ArcRotateCamera(
    'game-camera',
    -Math.PI / 2,
    Math.PI / 3,
    34,
    new Vector3(0, 1, 0),
    renderer.scene,
  );
  camera.lowerRadiusLimit = 6;
  camera.upperRadiusLimit = base.options.groundSize * 1.4;

  return { renderer, base, camera };
}
