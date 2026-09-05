/**
 * The Babylon.js bootstrap shared by `apps/game` and `apps/editor`.
 *
 * It owns exactly four things: engine selection (WebGPU with a WebGL2
 * fallback), the `Scene`, the render loop and resize handling. It owns no
 * gameplay state and creates no camera, light or mesh — those belong to the
 * app that calls it (spec §25: rendering must not own the game state).
 */
import './side-effects.js';

import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine.js';
import { resolveRenderConfig } from './render-config.js';
import type { RenderConfig } from './render-config.js';

/** Surfaces Babylon.js can render into. */
export type RenderCanvas = HTMLCanvasElement | OffscreenCanvas;

/** Which engine implementation a {@link RendererHandle} ended up on. */
export type RendererBackend = 'webgpu' | 'webgl2' | 'headless';

/** The engine implementations {@link selectBackend} chooses between. */
export type EngineKind = 'webgpu' | 'webgl2';

/** What the host environment offers. Passed in so the choice stays testable. */
export interface RenderCapabilities {
  readonly webgpu: boolean;
}

/** One tick of the render loop. */
export interface FrameInfo {
  /** Zero-based frame counter since the renderer was created. */
  readonly index: number;
  /** Seconds since the previous frame; `0` for the first frame. */
  readonly deltaSeconds: number;
  /** Seconds accumulated since the renderer was created. */
  readonly elapsedSeconds: number;
}

export type FrameListener = (frame: FrameInfo) => void;

/** Removes a previously registered listener. Safe to call more than once. */
export type Unsubscribe = () => void;

/**
 * The part of `window` the renderer needs. Declared as its own type so tests
 * (and future offscreen/worker hosts) can supply their own.
 */
export interface ResizeHost {
  addEventListener(type: 'resize', listener: () => void): void;
  removeEventListener(type: 'resize', listener: () => void): void;
}

/** Builds the engine. Tests pass a `NullEngine`; apps use the default. */
export type EngineFactory = (
  canvas: RenderCanvas | null,
  config: RenderConfig,
) => AbstractEngine | Promise<AbstractEngine>;

export interface RendererOptions extends Partial<RenderConfig> {
  /** Start the engine render loop immediately. Default `true`. */
  readonly autoStart?: boolean;
  /**
   * Where to listen for resize events. Defaults to `window` when one exists,
   * `null` disables the automatic wiring (call {@link RendererHandle.resize}).
   */
  readonly resizeHost?: ResizeHost | null;
  /** Overrides engine creation, e.g. with a headless `NullEngine` in tests. */
  readonly createEngine?: EngineFactory;
}

/** Everything an app needs to drive and tear down a render surface. */
export interface RendererHandle {
  readonly engine: AbstractEngine;
  readonly scene: Scene;
  readonly backend: RendererBackend;
  readonly config: RenderConfig;
  /** `true` once {@link RendererHandle.dispose} has run. */
  readonly disposed: boolean;
  /** Registers a per-frame listener and returns its unsubscribe function. */
  onFrame(listener: FrameListener): Unsubscribe;
  /** Renders one frame and notifies the listeners. The loop calls this. */
  renderFrame(): void;
  /** Tells the engine the canvas size changed. */
  resize(): void;
  /** Stops the loop, unhooks the resize host and disposes scene and engine. */
  dispose(): void;
}

/**
 * Picks the engine implementation: WebGPU only when it is both wanted and
 * available, otherwise WebGL2 (spec §2.1, ADR-0002).
 */
export function selectBackend(config: RenderConfig, capabilities: RenderCapabilities): EngineKind {
  return config.preferWebGPU && capabilities.webgpu ? 'webgpu' : 'webgl2';
}

/** Reads the capabilities of the current browser. */
export function detectRenderCapabilities(): RenderCapabilities {
  return { webgpu: typeof navigator !== 'undefined' && 'gpu' in navigator };
}

/**
 * An engine without a rendering canvas is headless (`NullEngine` in tests).
 * Babylon has no reliable class-name check: `NullEngine.getClassName()`
 * reports `ThinEngine`, so the canvas is the honest signal.
 */
function detectBackend(engine: AbstractEngine): RendererBackend {
  if (engine.isWebGPU) {
    return 'webgpu';
  }
  return engine.getRenderingCanvas() ? 'webgl2' : 'headless';
}

async function createDefaultEngine(
  canvas: RenderCanvas | null,
  config: RenderConfig,
): Promise<AbstractEngine> {
  if (!canvas) {
    throw new Error('createRenderer: a canvas is required unless `createEngine` is supplied');
  }

  if (selectBackend(config, detectRenderCapabilities()) === 'webgpu') {
    try {
      // Dynamic so the WebGPU engine stays out of the main chunk on WebGL2.
      const { WebGPUEngine } = await import('@babylonjs/core/Engines/webgpuEngine.js');
      const engine = new WebGPUEngine(canvas, { antialias: true, stencil: true });
      await engine.initAsync();
      return engine;
    } catch (error) {
      console.warn('[@wov/engine] WebGPU initialisation failed, falling back to WebGL2:', error);
    }
  }

  return new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
}

/**
 * Creates engine, scene and render loop for `canvas`.
 *
 * Asynchronous because WebGPU can only be initialised asynchronously; the
 * WebGL2 path resolves on the next microtask.
 */
export async function createRenderer(
  canvas: RenderCanvas | null,
  options: RendererOptions = {},
): Promise<RendererHandle> {
  const {
    autoStart = true,
    resizeHost,
    createEngine = createDefaultEngine,
    ...overrides
  } = options;
  const config = resolveRenderConfig(overrides);

  const engine = await createEngine(canvas, config);
  engine.setHardwareScalingLevel(1 / config.resolutionScale);

  const scene = new Scene(engine);
  const listeners = new Set<FrameListener>();

  let disposed = false;
  let index = 0;
  let elapsedSeconds = 0;

  const host = resizeHost === undefined ? defaultResizeHost() : resizeHost;

  const resize = (): void => {
    if (!disposed) {
      engine.resize();
    }
  };

  const handle: RendererHandle = {
    engine,
    scene,
    backend: detectBackend(engine),
    config,
    get disposed() {
      return disposed;
    },
    onFrame(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    renderFrame() {
      if (disposed) {
        return;
      }
      // Babylon only logs "No camera defined" and renders nothing without a
      // camera. The app installs one right after createRenderer resolves, so
      // skip the render but still tick the listeners.
      const hasCamera = Boolean(scene.activeCamera) || scene.cameras.length > 0;
      if (hasCamera) {
        scene.render();
      }
      const deltaSeconds = index === 0 ? 0 : engine.getDeltaTime() / 1000;
      elapsedSeconds += deltaSeconds;
      const frame: FrameInfo = { index, deltaSeconds, elapsedSeconds };
      index += 1;
      for (const listener of [...listeners]) {
        listener(frame);
      }
    },
    resize,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      listeners.clear();
      host?.removeEventListener('resize', resize);
      engine.stopRenderLoop();
      scene.dispose();
      engine.dispose();
    },
  };

  host?.addEventListener('resize', resize);

  if (autoStart) {
    engine.runRenderLoop(() => handle.renderFrame());
  }

  return handle;
}

function defaultResizeHost(): ResizeHost | null {
  return typeof window === 'undefined' ? null : window;
}
