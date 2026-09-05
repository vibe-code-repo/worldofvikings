/**
 * @wov/engine — the rendering layer shared by the game and the editor.
 *
 * It owns the Babylon.js bootstrap (engine selection, scene, render loop,
 * resize handling and the required side-effect imports) and nothing else.
 * Gameplay state, cameras, lights and content stay in the apps and in
 * `@wov/gameplay` (spec §25, ADR-0006).
 */
export { defaultRenderConfig, resolveRenderConfig } from './render-config.js';
export type { RenderConfig } from './render-config.js';

export { createRenderer, detectRenderCapabilities, selectBackend } from './renderer.js';
export type {
  EngineFactory,
  EngineKind,
  FrameInfo,
  FrameListener,
  RenderCanvas,
  RenderCapabilities,
  RendererBackend,
  RendererHandle,
  RendererOptions,
  ResizeHost,
  Unsubscribe,
} from './renderer.js';
