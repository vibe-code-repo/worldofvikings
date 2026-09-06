/**
 * @wov/engine — the rendering layer shared by the game and the editor.
 *
 * It owns the Babylon.js bootstrap (engine selection, scene, render loop,
 * resize handling and the required side-effect imports), the opt-in base stage
 * every view starts from (ground, lights, sky and fog) and the third-person
 * camera the game views the world through. Gameplay state, entities and world
 * data stay in the apps and in `@wov/gameplay` (spec §25, ADR-0006, ADR-0007,
 * ADR-0008).
 */
export { createCameraLookInput } from './camera-input.js';
export type {
  CameraButtonEvent,
  CameraInputSink,
  CameraLookInput,
  CameraLookInputOptions,
  CameraMoveEvent,
  CameraWheelEvent,
} from './camera-input.js';

export { createThirdPersonCamera } from './third-person-camera.js';
export type { ThirdPersonCameraHandle, ThirdPersonCameraOptions } from './third-person-camera.js';

export {
  applyLook,
  applyZoom,
  createThirdPersonCameraState,
  defaultThirdPersonCameraSettings,
  noCameraObstacles,
  orbitDirection,
  pointOnRay,
  resolveObstacleLimit,
  resolveThirdPersonCameraSettings,
  settleDistance,
  smoothingFactor,
  smoothPoint,
  smoothScalar,
  stepThirdPersonCamera,
  wheelTicks,
  wrapAngle,
} from './third-person-camera-math.js';
export type {
  CameraFrameInput,
  CameraLookMovement,
  CameraObstacleProbe,
  CameraObstacleQuery,
  CameraOrientation,
  ResolvedThirdPersonCameraSettings,
  ThirdPersonCameraSettings,
  ThirdPersonCameraState,
  ThirdPersonCameraStep,
  Vec3,
} from './third-person-camera-math.js';
export { createBaseScene, defaultBaseSceneOptions, resolveBaseSceneOptions } from './base-scene.js';
export type {
  BaseSceneHandle,
  BaseSceneOptions,
  ColorHex,
  ResolvedBaseSceneOptions,
  Vector3Tuple,
} from './base-scene.js';

export {
  DEFAULT_TERRAIN_COLOR,
  createTerrain,
  createTerrainMaterial,
  clearLoaderTransform,
} from './terrain.js';
export type {
  TerrainHandle,
  TerrainLayerSource,
  TerrainOptions,
  TerrainTextureSource,
} from './terrain.js';
export {
  CHANNELS_PER_SPLAT_MAP,
  MAX_TERRAIN_LAYERS,
  TERRAIN_ATTRIBUTES,
  TERRAIN_VERTEX_SOURCE,
  layerRepeats,
  shadowTapOffsets,
  terrainFragmentSource,
  terrainSamplerNames,
  terrainUniformNames,
  terrainVertexSource,
} from './terrain-shader.js';
export type { TerrainShadowShader } from './terrain-shader.js';

export { applyLighting } from './lighting.js';
export type { LightingHandle, LightingOptions } from './lighting.js';
export { defaultLightingProfile, resolveLightingProfile } from './lighting-profile.js';
export type {
  AmbientOptions,
  BloomOptions,
  FogOptions,
  LightingProfileOptions,
  PostProcessingOptions,
  ResolvedLightingProfile,
  ShadowFilterMode,
  ShadowOptions,
  SkyOptions,
  SsaoOptions,
  SunOptions,
  ToneMappingMode,
  VignetteOptions,
} from './lighting-profile.js';
export {
  SKY_ATTRIBUTES,
  SKY_FRAGMENT_SOURCE,
  SKY_UNIFORMS,
  SKY_VERTEX_SOURCE,
} from './sky-shader.js';

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
