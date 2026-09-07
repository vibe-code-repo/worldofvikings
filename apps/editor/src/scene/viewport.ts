/**
 * The editor viewport: renderer, camera, light rig and grid.
 *
 * Engine, scene, render loop and resize handling come from `@wov/engine`
 * (ADR-0006) — the same bootstrap the game uses. What this module adds is the
 * part an *editor* needs and a game does not: a free camera, a measurable grid
 * and a published debug bridge.
 *
 * Three things here were bugs before they were code, and each carries the note
 * that explains it:
 *
 * 1. The Phase 0 viewport drew an unlit-looking white ground that filled the
 *    frame. There was nothing wrong with the renderer — the ground *was* the
 *    picture. A grid and a sky make "the camera is somewhere" visible instead
 *    of leaving a white rectangle to interpret.
 * 2. Babylon sizes its drawing buffer from the canvas when the engine is
 *    created. In a React shell the canvas is laid out after that, so the first
 *    frames were rendered at the wrong size until the window happened to
 *    resize. A `ResizeObserver` on the canvas fixes the cause; `window`'s
 *    resize event never sees a panel change width.
 * 3. Two engines on one canvas: see `Viewport.tsx`.
 *
 * The light itself is not this module's taste. It is `applyLighting` from
 * `@wov/engine`, fed with the profile of the open world — the same function and
 * the same numbers the game uses (ADR-0024).
 */
import type { Scene } from '@babylonjs/core/scene.js';
import {
  applyLighting,
  createRenderer,
  type LightingHandle,
  type LightingProfileOptions,
  type RenderConfig,
  type RendererHandle,
} from '@wov/engine';
import { attachEditorRenderDebug } from '../dev-debug.js';
import { createEditorCamera, type EditorCamera } from './editor-camera.js';
import { createGrid, type GridHandle } from './grid.js';

export interface ViewportHandle {
  readonly renderer: RendererHandle;
  readonly scene: Scene;
  readonly camera: EditorCamera;
  readonly grid: GridHandle;
  /** Which engine implementation the browser gave us: `webgl2` or `webgpu`. */
  readonly backend: string;
  /** Frames rendered since the viewport opened. */
  frameId(): number;
  /** Registers a per-frame callback; returns its unsubscribe function. */
  onFrame(listener: (frameId: number) => void): () => void;
  /** The light rig currently in the scene (ADR-0024). */
  lighting(): LightingHandle;
  /**
   * Relights the viewport from the profile of the open world and zone.
   *
   * The same `applyLighting` the game calls, with the same numbers out of the
   * same file — which is the whole point. An author who places a torch under an
   * evening sun and then finds a flat noon in the game has been shown the wrong
   * picture, and no amount of editor-side taste settings fixes that.
   */
  relight(profiles: readonly (LightingProfileOptions | undefined)[]): LightingHandle;
  dispose(): void;
}

export async function createViewport(
  canvas: HTMLCanvasElement,
  overrides: Partial<RenderConfig> = {},
): Promise<ViewportHandle> {
  const renderer = await createRenderer(canvas, overrides);
  const { scene } = renderer;

  const grid = createGrid(scene);
  const camera = createEditorCamera(scene, canvas);
  scene.activeCamera = camera.camera;

  /** The grid is a measuring aid, not scenery: it must not throw a shadow. */
  const gridMeshes = [grid.minor, grid.major, grid.axes];
  const light = (profiles: readonly (LightingProfileOptions | undefined)[]): LightingHandle => {
    const handle = applyLighting(scene, { profiles, cameras: [camera.camera] });
    handle.excludeFromShadows(gridMeshes);
    return handle;
  };
  let lighting = light([]);

  let frameId = 0;
  const listeners = new Set<(frameId: number) => void>();
  const unsubscribeFrames = renderer.onFrame((frame) => {
    frameId = frame.index;
    camera.update(frame.deltaSeconds);
    // The shadow map covers a box, not the world (ADR-0024). In the editor the
    // box follows what the camera is looking at, which is the orbit target —
    // the same point `F` frames and the same point the author is working on.
    const target = camera.camera.target;
    lighting.focusShadows(target.x, target.y, target.z);
    for (const listener of [...listeners]) {
      listener(frameId);
    }
  });

  // The render counters `pnpm perf:editor` reads (ADR-0047). Both operands are
  // build-time literals, so a default `pnpm build` folds this to `false` and
  // drops `attachEditorRenderDebug` — and Babylon's instrumentation with it
  // (ADR-0030). It is a second no-op when no bridge was installed, which is
  // every debug-capable build opened without `?debug=1`.
  const detachRenderDebug =
    import.meta.env.DEV || __WOV_DEBUG_BRIDGE__
      ? attachEditorRenderDebug({
          scene,
          onFrame: (listener) => renderer.onFrame(() => listener()),
          shadowMap: () => lighting.shadows?.getShadowMap() ?? null,
          camera: () => camera.camera,
        })
      : null;

  // See note 2 in the module comment: the canvas changes size when a panel
  // does, and `window` never hears about it.
  const observer =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => renderer.resize());
  observer?.observe(canvas);
  renderer.resize();

  return {
    renderer,
    scene,
    camera,
    grid,
    backend: renderer.backend,
    frameId: () => frameId,
    onFrame(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    lighting: () => lighting,
    relight(profiles) {
      lighting.dispose();
      lighting = light(profiles);
      return lighting;
    },
    dispose() {
      observer?.disconnect();
      detachRenderDebug?.();
      unsubscribeFrames();
      listeners.clear();
      lighting.dispose();
      camera.dispose();
      grid.dispose();
      renderer.dispose();
    },
  };
}
