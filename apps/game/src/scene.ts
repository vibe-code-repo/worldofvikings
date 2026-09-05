import { createBaseScene, createRenderer, createThirdPersonCamera } from '@wov/engine';
import type {
  BaseSceneHandle,
  BaseSceneOptions,
  RendererHandle,
  RendererOptions,
  ThirdPersonCameraHandle,
  ThirdPersonCameraSettings,
} from '@wov/engine';
import { createPlaceholderTarget } from './placeholder-target.js';
import type { PlaceholderTarget } from './placeholder-target.js';

/**
 * The game's Phase 1 view: the shared base stage from `@wov/engine`, the
 * placeholder the camera follows, and the third-person camera itself.
 *
 * Engine, scene, render loop and resize handling come from `createRenderer`;
 * ground, lights, sky and fog from `createBaseScene`; the camera from
 * `createThirdPersonCamera` (ADR-0006, ADR-0007, ADR-0008). What is left here
 * is the wiring: which point the camera follows, and which element its mouse
 * input comes from.
 *
 * Nothing here is world data or gameplay. The authored world arrives from
 * `content/` in Phase 4 and the player replaces the capsule in Phase 2 — the
 * only line that has to change then is the `target` getter below.
 */
export interface GameScene {
  readonly renderer: RendererHandle;
  readonly base: BaseSceneHandle;
  readonly camera: ThirdPersonCameraHandle;
  /** The capsule standing in for the player until Phase 2. */
  readonly player: PlaceholderTarget;
}

export interface GameSceneOptions {
  /**
   * Passed to `createRenderer` (resolution scale, WebGPU preference — and
   * `autoStart`, which the game turns off because its own loop drives the
   * frames, see `./main.ts` and ADR-0010).
   */
  readonly render?: RendererOptions;
  /** Passed to `createBaseScene` (ground size, sky and fog colours). */
  readonly base?: BaseSceneOptions;
  /** Passed to `createThirdPersonCamera` (distance, pitch limits, smoothing). */
  readonly camera?: ThirdPersonCameraSettings;
}

export async function createGameScene(
  canvas: HTMLCanvasElement,
  options: GameSceneOptions = {},
): Promise<GameScene> {
  const renderer = await createRenderer(canvas, options.render);
  const base = createBaseScene(renderer.scene, options.base);
  const player = createPlaceholderTarget(renderer.scene);

  const camera = createThirdPersonCamera(renderer.scene, {
    ...options.camera,
    // A getter, not the mesh: the camera sees a position and nothing else, so
    // it never becomes a route from the renderer into gameplay (spec §25).
    target: player.position,
  });
  // Pointer lock, drag-look and the wheel are read from the canvas the game is
  // drawn on, so the input follows the picture rather than the whole document.
  camera.attachControl(canvas);

  return { renderer, base, camera, player };
}
