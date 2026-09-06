import {
  applyLighting,
  createBaseScene,
  createRenderer,
  createThirdPersonCamera,
} from '@wov/engine';
import type {
  BaseSceneHandle,
  BaseSceneOptions,
  LightingHandle,
  LightingProfileOptions,
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
  /** The light rig currently in the scene (ADR-0024). */
  lighting(): LightingHandle;
  /**
   * Replaces the rig with the one the loaded world describes.
   *
   * The scene is lit before the world file has arrived — a client that shows a
   * black void for two seconds while a 400 kB JSON downloads has lost the race
   * it was trying to win (spec §38) — so the profile is applied twice: the
   * engine's defaults at startup, the world's own the moment it is parsed.
   * The old rig is disposed, which is why nothing may hold on to it; the sun
   * and the fill light survive, because they are the base scene's and only
   * their settings change.
   */
  relight(profiles: readonly (LightingProfileOptions | undefined)[]): LightingHandle;
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
  /**
   * The profile the scene opens with, before the world file has arrived.
   *
   * Defaults to nothing, which resolves to `@wov/engine`'s own defaults. The
   * game passes `?flat=1`'s profile through here as well as into `relight`,
   * because a client that spends two seconds under a shadow map it is about to
   * throw away has paid for it twice.
   */
  readonly lighting?: readonly (LightingProfileOptions | undefined)[];
}

/** Applies a profile to the scene, taking over the base scene's two lights. */
function light(
  scene: GameSceneParts,
  profiles: readonly (LightingProfileOptions | undefined)[],
): LightingHandle {
  return applyLighting(scene.renderer.scene, {
    profiles,
    sun: scene.base.sun,
    ambient: scene.base.ambientLight,
    cameras: [scene.camera.camera],
  });
}

/** The pieces `light` needs, named so the helper does not take four arguments. */
interface GameSceneParts {
  readonly renderer: RendererHandle;
  readonly base: BaseSceneHandle;
  readonly camera: ThirdPersonCameraHandle;
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

  const parts: GameSceneParts = { renderer, base, camera };
  let lighting = light(parts, options.lighting ?? []);

  return {
    renderer,
    base,
    camera,
    player,
    lighting: () => lighting,
    relight(profiles) {
      lighting.dispose();
      lighting = light(parts, profiles);
      return lighting;
    },
  };
}
