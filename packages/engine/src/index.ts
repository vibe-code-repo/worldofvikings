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
  terrainLayerSources,
  clearLoaderTransform,
} from './terrain.js';
export type {
  TerrainHandle,
  TerrainLayerData,
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
  plainSurface,
  shadowTapOffsets,
  terrainFragmentSource,
  terrainSamplerNames,
  terrainUniformNames,
  terrainVertexSource,
} from './terrain-shader.js';
export type { TerrainShadowShader, TerrainSurfaceShader } from './terrain-shader.js';

export {
  DEFAULT_SKY_GRADIENT,
  clearSceneSkyGradient,
  sceneSkyGradient,
  setSceneSkyGradient,
} from './sky-gradient.js';
export type { SkyGradient } from './sky-gradient.js';

// The fog curve (ADR-0041): arithmetic, no Babylon, because the game, the
// editor, the terrain shader and a test that never opens a scene all have to
// agree about how much haze sits at a distance.
export {
  BABYLON_FOGMODE,
  FOG_ENCODE_POWER,
  MAX_BACKDROP_HAZE,
  backdropTakesFog,
  fogModeCode,
  fogVisibility,
  hazeAt,
  rawFogFactor,
  sceneFogCurve,
} from './fog.js';
export type { FogCurve, FogCurveMode, SceneFogFields } from './fog.js';
export { applyLighting } from './lighting.js';
export type { LightingHandle, LightingOptions } from './lighting.js';
export { defaultLightingProfile, resolveLightingProfile } from './lighting-profile.js';
// The shadow map's quantisation (ADR-0039): exported because it is the
// arithmetic a stability measurement checks, not because an app has to call it
// — `applyLighting` applies it by itself.
export { shadowBasis, snapShadowFocus } from './shadow-snap.js';
export type { ShadowBasis, ShadowVec3 } from './shadow-snap.js';
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
  SKY_GRADIENT_FUNCTION,
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

export {
  freezeMaterialsWhenReady,
  freezeStaticNodes,
  unfreezeStaticNodes,
} from './static-freeze.js';
export type { FreezableScene, FreezeReport, StaticNode } from './static-freeze.js';
