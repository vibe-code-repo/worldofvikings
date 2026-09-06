/**
 * The editor viewport: renderer, camera, lights and grid.
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
 *    picture. A grid and a sky-coloured background make "the camera is
 *    somewhere" visible instead of leaving a white rectangle to interpret.
 * 2. Babylon sizes its drawing buffer from the canvas when the engine is
 *    created. In a React shell the canvas is laid out after that, so the first
 *    frames were rendered at the wrong size until the window happened to
 *    resize. A `ResizeObserver` on the canvas fixes the cause; `window`'s
 *    resize event never sees a panel change width.
 * 3. Two engines on one canvas: see `Viewport.tsx`.
 */
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import type { Scene } from '@babylonjs/core/scene';
import { createRenderer, type RenderConfig, type RendererHandle } from '@wov/engine';
import { tokens } from '@wov/ui';
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
  dispose(): void;
}

/** Babylon wants a `Color4`; the design tokens are `#rrggbb` strings. */
function backgroundColor(): Color4 {
  const rgb = Color3.FromHexString(tokens.colorBackground);
  return new Color4(rgb.r, rgb.g, rgb.b, 1);
}

/**
 * Lights the scene the way an editor wants it: a bright hemisphere so nothing
 * is ever a black silhouette, plus one directional light so shapes read as
 * shapes. No shadows — an author needs to see what is there, not what a sun
 * would hide (spec §13).
 */
function createLights(scene: Scene): void {
  const ambient = new HemisphericLight('editor-ambient', new Vector3(0, 1, 0), scene);
  ambient.intensity = 0.75;
  ambient.groundColor = new Color3(0.28, 0.3, 0.34);

  const sun = new DirectionalLight('editor-sun', new Vector3(-0.45, -1, -0.6), scene);
  sun.intensity = 1.1;
  sun.position = new Vector3(60, 120, 80);
}

export async function createViewport(
  canvas: HTMLCanvasElement,
  overrides: Partial<RenderConfig> = {},
): Promise<ViewportHandle> {
  const renderer = await createRenderer(canvas, overrides);
  const { scene } = renderer;

  scene.clearColor = backgroundColor();
  createLights(scene);
  const grid = createGrid(scene);
  const camera = createEditorCamera(scene, canvas);
  scene.activeCamera = camera.camera;

  let frameId = 0;
  const listeners = new Set<(frameId: number) => void>();
  const unsubscribeFrames = renderer.onFrame((frame) => {
    frameId = frame.index;
    camera.update(frame.deltaSeconds);
    for (const listener of [...listeners]) {
      listener(frameId);
    }
  });

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
    dispose() {
      observer?.disconnect();
      unsubscribeFrames();
      listeners.clear();
      camera.dispose();
      grid.dispose();
      renderer.dispose();
    },
  };
}
