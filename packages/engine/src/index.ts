/**
 * @wov/engine — the rendering layer shared by the game and the editor.
 *
 * It owns the Babylon.js bootstrap (engine selection, scene, render loop,
 * resize handling and the required side-effect imports) plus the opt-in base
 * stage every view starts from (ground, lights, sky and fog). Gameplay state,
 * cameras, entities and world data stay in the apps and in `@wov/gameplay`
 * (spec §25, ADR-0006, ADR-0007).
 */
export { createBaseScene, defaultBaseSceneOptions, resolveBaseSceneOptions } from './base-scene.js';
export type {
  BaseSceneHandle,
  BaseSceneOptions,
  ColorHex,
  ResolvedBaseSceneOptions,
  Vector3Tuple,
} from './base-scene.js';

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
