/**
 * The light rig a world describes, put into a Babylon scene (ADR-0024).
 *
 * One function for both clients. The game and the editor must agree about
 * light for the same reason they already agree about ground: an author who
 * places a torch under an evening sun and then sees a flat noon in the game has
 * been shown the wrong picture. So `applyLighting` is the only place a sun, a
 * shadow map, a sky or a grading pipeline is created, and both apps call it
 * with the same profile out of the same world file.
 *
 * What it owns: the key light and the fill light, the sun's shadow map, the
 * gradient sky, the scene's fog and the post-processing pipeline. What it does
 * not own: which meshes exist. Casters and receivers are handed in by the app
 * that loaded them, because only the app knows when a zone has finished
 * arriving.
 *
 * The shadow map is one map, not a cascade. A cascade is the right answer for
 * a view that has to be sharp at two metres and correct at four hundred; this
 * one is a third-person camera looking at a village, so a single map that
 * follows the player buys the same sharpness for one pass instead of three —
 * and, decisively, for one lookup in the hand-written terrain shader instead of
 * a cascade-selecting one (`terrain-shader.ts`, ADR-0020). The measurement is
 * in ADR-0024.
 */
// The shadow pass is a scene component, and a `ShadowGenerator` without it is
// a texture nobody renders into — see `side-effects.ts` for the whole list and
// why it is one list.
import './side-effects.js';
import type { Camera } from '@babylonjs/core/Cameras/camera.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration.js';
import { ColorCurves } from '@babylonjs/core/Materials/colorCurves.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';
// One specific builder rather than the whole `MeshBuilder` set — see ADR-0006.
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline.js';
import { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline.js';
// The whole effect, shaders included: the module imports its own four programs,
// so `side-effects.ts` needs no entry for it (ADR-0006, ADR-0029).
import { VolumetricLightScatteringPostProcess } from '@babylonjs/core/PostProcesses/volumetricLightScatteringPostProcess.js';
import { Scene } from '@babylonjs/core/scene.js';
import {
  SKY_ATTRIBUTES,
  SKY_FRAGMENT_SOURCE,
  SKY_UNIFORMS,
  SKY_VERTEX_SOURCE,
} from './sky-shader.js';
import { clearSceneSkyGradient, setSceneSkyGradient } from './sky-gradient.js';
import { resolveLightingProfile } from './lighting-profile.js';
import { shadowBasis, snapShadowFocus } from './shadow-snap.js';
import { sunAnchorPosition, sunShaftsGate } from './sun-shafts.js';
import type { LightingProfileOptions, ResolvedLightingProfile } from './lighting-profile.js';
import type { Vector3Tuple } from './base-scene.js';

/**
 * Edge length of the sky box in metres.
 *
 * It rides with the camera (`infiniteDistance`), so this is not a distance to
 * anything — it only has to sit inside every camera's far plane. The game's
 * camera keeps Babylon's default 10 000 m and the editor's 5 000 m, and the
 * box's far corner at this size is 1 732 m away, comfortably inside both.
 */
const SKY_SIZE = 2000;

/** The ShaderStore key the sky program is registered under. */
const SKY_SHADER_KEY = 'wovSky';

/** What {@link applyLighting} may be given. */
export interface LightingOptions {
  /**
   * Profiles merged left to right; later wins, group by group and field by
   * field. The game passes `[world.lighting, zone.lighting]`.
   */
  readonly profiles?: readonly (LightingProfileOptions | undefined)[];
  /**
   * An existing key light to take over instead of adding a second sun.
   *
   * `createBaseScene` already put one in the scene, and two directional lights
   * are not brighter — they are two rigs to keep in step, and the terrain
   * material would bind whichever came first (`terrain.ts`).
   */
  readonly sun?: DirectionalLight | undefined;
  /** An existing fill light to take over, for the same reason. */
  readonly ambient?: HemisphericLight | undefined;
  /**
   * Which cameras the post-processing pipeline attaches to. Defaults to the
   * active camera, which is what both apps have by the time they call this.
   */
  readonly cameras?: readonly Camera[] | undefined;
}

/**
 * The sun shafts, once a world has asked for them (ADR-0042).
 *
 * The effect is *not* simply attached and left there. It is a second render of
 * the scene's geometry, and it is only correct while the sun is near the view
 * axis, so it is attached and detached as the player turns. Everything about
 * that is on this object rather than hidden inside the rig, because "is the
 * expensive thing running right now" is the first question a measurement asks.
 */
export interface SunShaftsHandle {
  /** Babylon's scattering pass. Detached from the camera while gated off. */
  readonly effect: VolumetricLightScatteringPostProcess;
  /**
   * The stand-in for the sun: a billboarded disc the camera carries with it.
   *
   * It exists because the profile's sun is a direction and the effect needs a
   * place. It is invisible in the camera pass and bright in the occlusion pass,
   * so the only sun anybody sees is still the sky shader's own glow.
   */
  readonly anchor: Mesh;
  /** Whether the effect is attached to the camera as of the last frame. */
  isActive(): boolean;
}

/** What {@link applyLighting} put into the scene, and how to take it out. */
export interface LightingHandle {
  /** The complete profile in use, defaults filled in. */
  readonly profile: ResolvedLightingProfile;
  readonly sun: DirectionalLight;
  readonly ambient: HemisphericLight;
  /** The sun's shadow map, or `null` when the profile turned shadows off. */
  readonly shadows: ShadowGenerator | null;
  /** The sky box, or `null` when the profile turned the sky off. */
  readonly sky: Mesh | null;
  /** The grading pipeline, or `null` when post-processing is off. */
  readonly pipeline: DefaultRenderingPipeline | null;
  /** The ambient-occlusion pipeline, or `null` — off unless measured. */
  readonly ssao: SSAO2RenderingPipeline | null;
  /** The sun shafts, or `null` — off unless a world asked for them. */
  readonly sunShafts: SunShaftsHandle | null;
  /**
   * Takes meshes out of the shadow map, as casters and as receivers.
   *
   * The rule is the other way round from Babylon's: **everything casts and
   * receives unless it is excluded here.** A village arrives over several
   * seconds, one prefab at a time, and a rule that has to be applied to each
   * mesh as it lands is a rule that is one `await` away from being applied to
   * none of them — which looks exactly like a scene with no shadows at all.
   * So the shadow map is built from a predicate over the scene and new meshes
   * are made receivers as they are added, and the three things that must *not*
   * take part say so once: the sky (excluded here), the ground (which receives
   * through its own shader and must not shadow itself, ADR-0020) and the
   * editor's grid.
   */
  excludeFromShadows(meshes: readonly AbstractMesh[]): void;
  /**
   * Takes meshes out of the shadow map as **casters only**; they still receive.
   *
   * The separate method exists because the two halves have separate costs and
   * separate reasons. Receiving is a define on a material and costs a texture
   * lookup on pixels that are drawn anyway. Casting is a second draw of the
   * geometry, every frame, into the map — which for a field of scattered grass
   * (ADR-0025) is thousands of thin instances rendered twice to darken a few
   * texels each, and which measurably makes the ground *look worse*, because
   * every tuft also shadows the tufts around it into a dark mat.
   *
   * So: a tuft of grass takes the shadow of the house beside it and throws
   * none of its own. What is "small enough" for that is not decided here — the
   * caller knows what its meshes are (`apps/game/src/world-scene.ts`).
   */
  excludeFromCasting(meshes: readonly AbstractMesh[]): void;
  /**
   * Centres the shadow map on a point — the player, in the game.
   *
   * The map covers `shadows.distance` metres, not the whole world, which is
   * what makes 2048 texels worth having. Something has to say where those
   * metres are, and only the app knows: the engine must not reach into gameplay
   * to find the player (spec §25).
   *
   * The point is quantised onto whole texels of the map before it is used
   * (`shadow-snap.ts`, ADR-0039), so a caller may hand this a position that
   * changes every frame without the map's grid sliding underneath the world.
   */
  focusShadows(x: number, y: number, z: number): void;
  dispose(): void;
}

/**
 * The mesh whose material actually carries `receiveShadows`.
 *
 * For an instance that is its source: the two share one material, and the flag
 * is a shader define on it.
 */
function target(mesh: AbstractMesh): AbstractMesh {
  return mesh.isAnInstance ? (mesh as InstancedMesh).sourceMesh : mesh;
}

/**
 * Whether the mesh that carries this one's material is out of step with the
 * scene's lights.
 *
 * Only ever true for a mesh whose material owner is *not in the scene* — which
 * is every loaded model drawn as an instance, because the source it draws from
 * stays in its asset container. Babylon keeps "which lights reach this mesh"
 * up to date by walking `scene.meshes`, in both directions: `Scene.addLight`
 * adds the new light to every mesh in the scene, `Light.dispose` removes the
 * dead one from every mesh in the scene. A mesh outside the scene is in
 * neither walk, and `InstancedMesh` answers `_removeLightSource` with nothing
 * at all while forwarding `lightSources` straight to its source — so a
 * disposed sun is never taken out of the list and a new one is pushed on top
 * of it without the material ever being told.
 *
 * Both directions are asked, because both go wrong and they look different: a
 * light the source has never heard of is a flat picture, a light it still holds
 * after the rig that owned it was disposed is a picture nothing can change any
 * more.
 */
function hasStaleLights(scene: Scene, mesh: AbstractMesh): boolean {
  const owner = target(mesh);
  if (owner === mesh) {
    // In the scene, so Babylon's own two walks already reach it.
    return false;
  }
  const known = owner.lightSources;
  return (
    known.some((light) => !scene.lights.includes(light)) ||
    scene.lights.some((light) => light.isEnabled() && !known.includes(light))
  );
}

/**
 * How many drawn meshes are lit by something other than this scene's lights.
 *
 * Zero is the only right answer, at every moment, in both apps — which is
 * exactly why it is worth publishing. The failure it names is silent: after one
 * lighting change in the editor the whole zone was lit by a sun that had been
 * disposed, nothing in the panel moved a pixel again for the rest of the
 * session, and no error was logged because from Babylon's point of view nothing
 * was wrong. A number a test can read turns that into a red line.
 *
 * Cheap enough to ask for: two array lookups per mesh over lists of two or three
 * lights, and the caller decides how often it wants to know.
 */
export function meshesWithStaleLights(scene: Scene): number {
  let stale = 0;
  for (const mesh of scene.meshes) {
    if (hasStaleLights(scene, mesh)) {
      stale += 1;
    }
  }
  return stale;
}

/** Babylon's tone-mapping constants, by the name a world file uses. */
function toneMappingType(mode: ResolvedLightingProfile['postProcessing']['toneMapping']): number {
  switch (mode) {
    case 'standard':
      return ImageProcessingConfiguration.TONEMAPPING_STANDARD;
    case 'neutral':
      return ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
    case 'aces':
    default:
      return ImageProcessingConfiguration.TONEMAPPING_ACES;
  }
}

/** Registers the sky program once per page; re-registering is a no-op write. */
function registerSkyProgram(): string {
  ShaderStore.ShadersStore[`${SKY_SHADER_KEY}VertexShader`] = SKY_VERTEX_SOURCE;
  ShaderStore.ShadersStore[`${SKY_SHADER_KEY}FragmentShader`] = SKY_FRAGMENT_SOURCE;
  return SKY_SHADER_KEY;
}

/**
 * Builds the gradient sky.
 *
 * A box seen from the inside, riding with the camera. `infiniteDistance` moves
 * it to the camera every frame, `backFaceCulling = false` is what lets us look
 * at its inside, and rendering group 0 puts it behind everything else without
 * needing depth tricks. It is explicitly not pickable and not a shadow caster:
 * the editor's surface snapping rays against whatever is pickable, and a prop
 * dropped onto the sky would land a kilometre away.
 */
function createSky(scene: Scene, profile: ResolvedLightingProfile): Mesh {
  const key = registerSkyProgram();
  const sky = CreateBox('lighting-sky', { size: SKY_SIZE }, scene);
  sky.infiniteDistance = true;
  sky.isPickable = false;
  sky.renderingGroupId = 0;
  sky.applyFog = false;

  const material = new ShaderMaterial('lighting-sky-material', scene, key, {
    attributes: [...SKY_ATTRIBUTES],
    uniforms: [...SKY_UNIFORMS],
    needAlphaBlending: false,
    needAlphaTesting: false,
  });
  material.backFaceCulling = false;
  // The sky is behind everything; writing depth would let it win a z-fight with
  // the far edge of the terrain.
  material.disableDepthWrite = true;
  sky.material = material;

  applySkyUniforms(material, profile);
  return sky;
}

/** Copies the sky colours and the sun direction into the sky material. */
function applySkyUniforms(material: ShaderMaterial, profile: ResolvedLightingProfile): void {
  material.setColor3('uZenithColor', Color3.FromHexString(profile.sky.zenithColor));
  material.setColor3('uHorizonColor', Color3.FromHexString(profile.sky.horizonColor));
  material.setColor3('uSunColor', Color3.FromHexString(profile.sky.sunColor));
  material.setVector3('uSunDirection', Vector3.FromArray([...profile.sun.direction]).normalize());
  material.setFloat('uSunSpread', profile.sky.sunSpread);
}

/**
 * Builds the sun's shadow map.
 *
 * Three decisions worth their lines:
 *
 * - **A fixed frustum, not the automatic one.** `autoUpdateExtends` fits the
 *   box to every caster in the list, which for a 300 m village is a 300 m box:
 *   2048 texels then cover 15 cm of ground each and a fence post has a smudge.
 *   `shadowFrustumSize` pins the box to `shadows.distance` and `focusShadows`
 *   drives it along behind the player.
 * - **Full float depth, asked for explicitly.** Babylon prefers a half-float
 *   target, whose eleven mantissa bits over a 280 m depth range leave decimetres
 *   of slop — which is acne on a wall and a floating shadow under a barrel.
 *   The terrain shader reads the type back off the map rather than trusting
 *   this request, because the request can still be refused (`terrain.ts`).
 * - **Poisson or PCF, never unfiltered by default.** One tap gives a stair-step
 *   edge on every diagonal, which is the first thing that reads as "a game
 *   engine demo" rather than as evening light.
 */
function createShadows(sun: DirectionalLight, profile: ResolvedLightingProfile): ShadowGenerator {
  const { shadows } = profile;
  sun.shadowEnabled = true;
  sun.shadowFrustumSize = shadows.distance;
  sun.shadowMinZ = 1;
  // The light is parked `distance` metres back from the focus point, so the
  // far plane has to reach past it to the other side of the box.
  sun.shadowMaxZ = shadows.distance * 2.5;

  const generator = new ShadowGenerator(shadows.mapSize, sun);
  generator.useFloat32TextureType = true;
  generator.bias = shadows.bias;
  generator.normalBias = shadows.normalBias;
  generator.setDarkness(shadows.darkness);
  generator.forceBackFacesOnly = false;
  if (shadows.filter === 'pcf') {
    generator.usePercentageCloserFiltering = true;
  } else if (shadows.filter === 'poisson') {
    generator.usePoissonSampling = true;
  }
  return generator;
}

/** Builds the grading pipeline: FXAA, tone mapping, bloom and the vignette. */
function createPipeline(
  scene: Scene,
  cameras: Camera[],
  profile: ResolvedLightingProfile,
): DefaultRenderingPipeline {
  const post = profile.postProcessing;
  // `true` is the HDR flag: bloom and tone mapping need headroom above 1.0, and
  // without it a warm sun clips to white before the curve ever sees it.
  const pipeline = new DefaultRenderingPipeline('wov-post', true, scene, cameras);
  pipeline.fxaaEnabled = post.fxaa;
  pipeline.samples = 1;

  pipeline.bloomEnabled = post.bloom.enabled;
  pipeline.bloomThreshold = post.bloom.threshold;
  pipeline.bloomWeight = post.bloom.weight;
  pipeline.bloomScale = post.bloom.scale;
  pipeline.bloomKernel = post.bloom.kernel;

  pipeline.imageProcessingEnabled = true;
  const image = pipeline.imageProcessing;
  if (image) {
    image.toneMappingEnabled = post.toneMapping !== 'none';
    image.toneMappingType = toneMappingType(post.toneMapping);
    image.exposure = post.exposure;
    image.contrast = post.contrast;
    // The one control that takes chroma out without taking light out: Babylon's
    // colour curves run last in `applyImageProcessing`, after the tone map and
    // after the contrast, and `globalSaturation` there is exactly a mix towards
    // the pixel's own luminance. `-100…100` is Babylon's range for what this
    // profile states as `0…2`, so 1 is the identity (ADR-0040).
    const curves = new ColorCurves();
    curves.globalSaturation = (post.saturation - 1) * 100;
    image.colorCurves = curves;
    // Guarded, so a world that never asks for a grade never pays for the
    // `COLORCURVES` shader permutation it would compile.
    image.colorCurvesEnabled = post.saturation !== 1;
    image.vignetteEnabled = post.vignette.enabled;
    image.vignetteWeight = post.vignette.weight;
    const vignette = Color3.FromHexString(post.vignette.color);
    image.vignetteColor = new Color4(vignette.r, vignette.g, vignette.b, 0);
    // Multiply, not opaque: the frame is darkened towards the corners rather
    // than painted over, so a bright sky keeps its colour as it dims.
    image.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
  }
  return pipeline;
}

/**
 * Fills a scene with the light a profile describes and hands back what it made.
 *
 * Everything it creates is on the handle, and `dispose()` puts the scene back
 * the way it was — including the fog and the clear colour, which are scene-wide
 * settings rather than objects.
 */
export function applyLighting(scene: Scene, options: LightingOptions = {}): LightingHandle {
  const profile = resolveLightingProfile(...(options.profiles ?? []));
  const direction = Vector3.FromArray([...profile.sun.direction]).normalize();

  const previous = {
    clearColor: scene.clearColor.clone(),
    fogMode: scene.fogMode,
    fogEnabled: scene.fogEnabled,
    fogColor: scene.fogColor.clone(),
    fogStart: scene.fogStart,
    fogEnd: scene.fogEnd,
    fogDensity: scene.fogDensity,
    shadowsEnabled: scene.shadowsEnabled,
  };

  // Behind the sky, the clear colour is never seen. It is still set, because a
  // profile may turn the sky off and a scene with no sky must not clear to
  // Babylon's default grey-blue.
  scene.clearColor = Color3.FromHexString(profile.sky.horizonColor).toColor4(1);

  if (profile.fog.enabled) {
    // `linear` states the near and far edge of the fade in metres, which is
    // what a level designer can pace out; `exp` states haze per metre, which is
    // what aerial perspective actually is (ADR-0041). Both sets of numbers are
    // written whichever curve is active, so switching a world between them does
    // not lose the other's.
    //
    // `exp` and not `exp2`: any exp2 density strong enough to haze the village's
    // own 300 m tile puts the painted range past 99.9 % haze, which is the flat
    // band of fog colour ADR-0031 was written against.
    scene.fogMode = profile.fog.mode === 'exp' ? Scene.FOGMODE_EXP : Scene.FOGMODE_LINEAR;
    scene.fogEnabled = true;
    scene.fogColor = Color3.FromHexString(profile.fog.color);
    scene.fogStart = profile.fog.start;
    scene.fogEnd = profile.fog.end;
    scene.fogDensity = profile.fog.density;
  } else {
    scene.fogMode = Scene.FOGMODE_NONE;
  }

  const ownsSun = options.sun === undefined;
  const sun = options.sun ?? new DirectionalLight('lighting-sun', direction, scene);
  sun.direction = direction;
  sun.diffuse = Color3.FromHexString(profile.sun.color);
  sun.specular = Color3.FromHexString(profile.sun.color);
  sun.intensity = profile.sun.intensity;

  const ownsAmbient = options.ambient === undefined;
  const ambient =
    options.ambient ?? new HemisphericLight('lighting-ambient', new Vector3(0, 1, 0), scene);
  ambient.direction = new Vector3(0, 1, 0);
  ambient.diffuse = Color3.FromHexString(profile.ambient.skyColor);
  ambient.groundColor = Color3.FromHexString(profile.ambient.groundColor);
  ambient.specular = Color3.Black();
  ambient.intensity = profile.ambient.intensity;

  scene.shadowsEnabled = profile.shadows.enabled;
  const shadows = profile.shadows.enabled ? createShadows(sun, profile) : null;
  if (shadows === null) {
    sun.shadowEnabled = false;
  }

  const sky = profile.sky.enabled ? createSky(scene, profile) : null;
  // The ground reflects this sky (ADR-0032). Recorded even when the dome itself
  // is off: a profile can turn the sky box off and still want its colours in
  // what the ground shows, and a terrain built before this call would otherwise
  // keep reflecting the default evening for the life of the scene.
  setSceneSkyGradient(scene, {
    zenithColor: profile.sky.zenithColor,
    horizonColor: profile.sky.horizonColor,
    sunColor: profile.sky.sunColor,
    sunSpread: profile.sky.sunSpread,
    intensity: profile.sky.groundReflection,
  });

  const cameras = [...(options.cameras ?? (scene.activeCamera ? [scene.activeCamera] : []))];
  const firstCamera = cameras[0];
  // Built before the grading pipeline on purpose: the shafts are light in the
  // scene, so they belong in the frame the tone map and the saturation then
  // work on, rather than pasted over a finished picture (ADR-0042).
  const shafts =
    profile.postProcessing.enabled &&
    profile.postProcessing.sunShafts.enabled &&
    firstCamera !== undefined
      ? createSunShafts(scene, firstCamera, profile, direction, sky)
      : null;
  const pipeline =
    profile.postProcessing.enabled && cameras.length > 0
      ? createPipeline(scene, cameras, profile)
      : null;
  const ssao =
    profile.postProcessing.enabled && profile.postProcessing.ssao.enabled && cameras.length > 0
      ? createSsao(scene, cameras, profile)
      : null;
  // Before any camera renders, not on the camera hook: the post-process chain
  // is bound *ahead* of `onBeforeCameraRenderObservable` while the pass's
  // render target is collected after it, so a gate driven from there would
  // switch the two halves on different frames.
  const shaftsFrame =
    shafts === null
      ? null
      : scene.onBeforeRenderObservable.add(() => {
          shafts.update();
        });

  /** Where the shadow box is centred; the light is parked behind it. */
  const focus = new Vector3(0, 0, 0);

  /** Meshes that neither cast nor receive; see `excludeFromShadows`. */
  const excluded = new Set<AbstractMesh>();
  /** Meshes that receive but do not cast; see `excludeFromCasting`. */
  const nonCasters = new Set<AbstractMesh>();
  if (sky !== null) {
    excluded.add(sky);
  }
  if (shafts !== null) {
    // Neither caster nor receiver: it is a stand-in for the sun, and a sun that
    // throws a shadow of its own is a 90 m disc darkening the range behind it.
    excluded.add(shafts.anchor);
  }

  const shadowMap = shadows?.getShadowMap() ?? null;

  /**
   * Whether a mesh belongs in the shadow map at all.
   *
   * The same four questions the per-pass predicate asked, `isVisible` and
   * `isEnabled` included. Babylon does skip a hidden mesh when it walks the
   * list, so they are not strictly needed — but this change is about *when* the
   * list is built, not about what is in it, and a caching change that also
   * quietly widens the set is two changes wearing one coat.
   */
  const casts = (mesh: AbstractMesh): boolean =>
    !excluded.has(mesh) && !nonCasters.has(mesh) && mesh.isVisible && mesh.isEnabled();

  /**
   * Set when the answer to {@link casts} may have changed for some mesh.
   *
   * The list the shadow pass draws from is derived from the scene, and it used
   * to be *re*-derived on every pass: `renderListPredicate` makes Babylon walk
   * `scene.meshes` and call the predicate on each of them before every shadow
   * render (`prepareRenderList` in `objectRenderer.js`). At the village's 2 400
   * casters that is a scan of the whole scene sixty times a second to arrive at
   * the same answer it arrived at last frame.
   *
   * A list built once instead would be the other failure ADR-0024 names: it
   * holds on to every mesh a zone change disposed. So the list is rebuilt from
   * the scene, but only when the scene has changed — a mesh added, a mesh
   * removed, or something excluded — which is what this flag records.
   *
   * A prop switched off *between* rebuilds is still skipped: Babylon checks
   * `isEnabled` and `isVisible` itself when it walks the list. What needs a
   * rebuild is a prop switched back **on**, and in this client nothing is —
   * the one mesh that is ever disabled is the Phase 1 plane, once, before the
   * village arrives.
   */
  let castersStale = true;

  if (shadowMap !== null) {
    // Deliberately *not* culled to the shadow box. Babylon does not frustum-cull
    // a shadow map's render list, so narrowing it to the box the map covers
    // looks like the obvious win — and it was measured and rejected: at the
    // village's density it removed 1 of 2 581 casters, because they all stand
    // inside 140 m of each other. See ADR-0024.
    shadowMap.onBeforeRenderObservable.add(() => {
      if (!castersStale) {
        return;
      }
      // Refilled in place rather than replaced. Babylon hooks the array it was
      // given so that adding to it can resize the map, and handing it a new one
      // every rebuild is a different object for every one of those hooks to
      // follow — the same reason its own `prepareRenderList` clears and refills
      // instead of assigning.
      const list = shadowMap.renderList ?? [];
      list.length = 0;
      for (const mesh of scene.meshes) {
        if (casts(mesh)) {
          list.push(mesh);
        }
      }
      shadowMap.renderList = list;
      castersStale = false;
    });
    const meshChanged = (): void => {
      castersStale = true;
    };
    scene.onNewMeshAddedObservable.add(meshChanged);
    scene.onMeshRemovedObservable.add(meshChanged);
  }

  /**
   * Lets go of a mesh the scene has disposed.
   *
   * Both sets are told about meshes and never asked again, so without this they
   * are a list of every mesh the app ever excluded — and a disposed
   * `AbstractMesh` still holds its submeshes, its bounding info and its
   * material. Measured in the editor: switching zone away and back left the old
   * zone's 5 273 entities in memory, about 25 KB each, while every counter in
   * the debug bridge stayed byte-identical. The rule has to be exact rather
   * than swept now and then, because "now and then" is the difference between
   * a bounded overshoot and a session that grows all day.
   */
  const meshRemoved = scene.onMeshRemovedObservable.add((mesh) => {
    excluded.delete(mesh);
    nonCasters.delete(mesh);
  });

  const receive = (mesh: AbstractMesh): void => {
    if (shadows === null || excluded.has(mesh)) {
      return;
    }
    // An `InstancedMesh` shares its source's material, and `receiveShadows` is
    // a material define: setting it on the instance is refused with a console
    // warning and no effect. Ninety copies of one fence then stand in a scene
    // with shadows and take none — which was exactly the first result this
    // measured. The source mesh lives in the asset container rather than the
    // scene (`world-scene.ts`), so this is the only route to it.
    target(mesh).receiveShadows = true;
  };

  /**
   * Hands this rig's lights to a mesh the scene cannot see.
   *
   * Babylon caches, per mesh, which lights reach it, and it maintains that
   * cache by walking `scene.meshes`: `Scene.addLight` adds the new light to
   * every mesh in the scene, `Light.dispose` removes the dead one from every
   * mesh in the scene. A mesh that is not in the scene is in neither walk.
   *
   * Which is exactly where the meshes that carry a village's materials live.
   * An `InstancedMesh` draws from a `sourceMesh` that sits in the asset
   * container it was loaded from, not in the scene, and that source is what
   * owns the material and therefore the light. It got this rig's lights only by
   * accident, during the moment the loader had it in the scene before moving it
   * into the container — so the *first* rig reaches it and no later one does.
   *
   * Measured consequence, before this: one lighting change in the editor and
   * the whole zone went flat. The sun the sources still pointed at had been
   * disposed, the new one had never been offered to them, and nothing in the
   * Lighting panel moved a pixel again for the rest of the session. Nothing was
   * logged, because from Babylon's point of view nothing was wrong.
   *
   * Only asked when a light is actually missing: this runs once per mesh added
   * during a load — 5 273 of them for the village — and `_resyncLightSources`
   * marks every submesh light-dirty, which is a shader re-evaluation nobody
   * needs 5 273 times for the same 210 sources.
   */
  const relight = (mesh: AbstractMesh): void => {
    if (hasStaleLights(scene, mesh)) {
      target(mesh)._resyncLightSources();
    }
  };

  const lit = (mesh: AbstractMesh): void => {
    receive(mesh);
    relight(mesh);
  };
  for (const mesh of scene.meshes) {
    lit(mesh);
  }
  // Models load for seconds after this call; every mesh one of them adds is a
  // wall something else should be able to darken.
  const meshAdded = scene.onNewMeshAddedObservable.add(lit);

  /**
   * The map's own axes and how much ground one of its texels covers.
   *
   * Both are read here rather than at module scope because both come out of
   * this call's profile: a relight with a different `distance` or `mapSize`
   * builds a fresh handle, and this one must not keep quantising to the old
   * grid.
   */
  const basis = shadowBasis([direction.x, direction.y, direction.z]);
  const texel = profile.shadows.distance / profile.shadows.mapSize;

  const place = (): void => {
    // Snapped onto whole texels of the map before the light is parked behind
    // it (ADR-0039). Without this the 2048² grid slides with the player in
    // arbitrary fractions of a texel and every shadow edge crawls; with it a
    // step smaller than 5.9 cm produces the very same light matrix. The cost
    // is that the map's centre now lags the focus point by up to half a texel,
    // which at 120 m of coverage is under three centimetres.
    const snapped = snapShadowFocus([focus.x, focus.y, focus.z], basis, texel);
    sun.position = new Vector3(
      snapped[0] - basis.forward[0] * profile.shadows.distance,
      snapped[1] - basis.forward[1] * profile.shadows.distance,
      snapped[2] - basis.forward[2] * profile.shadows.distance,
    );
  };
  place();

  let disposed = false;
  return {
    profile,
    sun,
    ambient,
    shadows,
    sky,
    pipeline,
    ssao,
    sunShafts: shafts,
    excludeFromShadows(meshes) {
      for (const mesh of meshes) {
        excluded.add(mesh);
        target(mesh).receiveShadows = false;
      }
      castersStale = true;
    },
    excludeFromCasting(meshes) {
      for (const mesh of meshes) {
        nonCasters.add(mesh);
        // Said again rather than assumed: these meshes may arrive after the
        // rig did, and `receive` is what makes a late mesh a receiver at all.
        receive(mesh);
      }
      castersStale = true;
    },
    focusShadows(x, y, z) {
      focus.set(x, y, z);
      place();
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      scene.onNewMeshAddedObservable.remove(meshAdded);
      scene.onMeshRemovedObservable.remove(meshRemoved);
      if (shaftsFrame !== null) {
        scene.onBeforeRenderObservable.remove(shaftsFrame);
      }
      excluded.clear();
      nonCasters.clear();
      shafts?.dispose();
      ssao?.dispose();
      pipeline?.dispose();
      sky?.material?.dispose();
      sky?.dispose();
      shadows?.dispose();
      if (ownsSun) {
        sun.dispose();
      }
      if (ownsAmbient) {
        ambient.dispose();
      }
      scene.clearColor = previous.clearColor;
      scene.fogMode = previous.fogMode;
      scene.fogEnabled = previous.fogEnabled;
      scene.fogColor = previous.fogColor;
      scene.fogStart = previous.fogStart;
      scene.fogEnd = previous.fogEnd;
      scene.fogDensity = previous.fogDensity;
      scene.shadowsEnabled = previous.shadowsEnabled;
      clearSceneSkyGradient(scene);
    },
  };
}

/** What the rig needs from the shafts on top of what it hands out. */
interface SunShaftsRig extends SunShaftsHandle {
  /** Repositions the anchor and re-decides the gate. Once a frame. */
  update(): void;
  dispose(): void;
}

/**
 * Builds the sun shafts and the gate that decides when they run (ADR-0042).
 *
 * Three things have to be constructed rather than configured, and each of them
 * is a way this effect is quietly wrong without it:
 *
 * - **An anchor.** The profile's sun is a direction; a screen-space effect needs
 *   a place. So a disc rides with the camera at `anchorDistance` metres along
 *   the direction the light comes from — beyond whatever the world paints on
 *   its horizon, so the range eclipses the sun rather than the sun hanging in
 *   front of it, and inside the far plane, so it is not clipped away.
 * - **An anchor that is only visible to the pass.** Babylon renders `mesh` with
 *   its *own* material in the occlusion pass and with the ordinary pipeline in
 *   the camera pass, so one material serving both would put a hard-edged second
 *   sun in the sky next to the sky shader's glow. `disableColorWrite` is
 *   flipped around the pass instead: bright where the shafts are computed,
 *   drawing nothing where the player looks.
 * - **The sky out of the pass.** The sky box does not write depth in the camera
 *   pass, but the occlusion pass does not use its material — it binds its own —
 *   so the sky would write depth at about 1 000 m and bury a 1 400 m anchor
 *   behind a wall. Everything else stays in: the backdrop shells and the clouds
 *   are the occluders that make a shaft read as a shaft.
 *
 * The clear colour needs no help; Babylon's own pass observers already swap the
 * scene to black around it.
 */
function createSunShafts(
  scene: Scene,
  camera: Camera,
  profile: ResolvedLightingProfile,
  sunDirection: Vector3,
  sky: Mesh | null,
): SunShaftsRig {
  const options = profile.postProcessing.sunShafts;

  const anchor = CreateDisc(
    'lighting-sun-anchor',
    { radius: options.anchorSize / 2, tessellation: 24 },
    scene,
  );
  anchor.billboardMode = TransformNode.BILLBOARDMODE_ALL;
  // Never picked (the editor's surface snapping rays whatever is pickable, and
  // a prop dropped onto the sun would land 1.4 km away) and never hazed: at
  // this distance any fog would wash the anchor to the fog colour and the
  // shafts with it.
  anchor.isPickable = false;
  anchor.applyFog = false;

  const material = new StandardMaterial('lighting-sun-anchor-material', scene);
  material.disableLighting = true;
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.emissiveColor = Color3.FromHexString(profile.sky.sunColor);
  // The camera pass draws it and writes nothing — see the note above.
  material.disableColorWrite = true;
  material.disableDepthWrite = true;
  anchor.material = material;

  const effect = new VolumetricLightScatteringPostProcess(
    'wov-sun-shafts',
    { postProcessRatio: options.postScale, passRatio: options.passScale },
    camera,
    anchor,
    options.samples,
  );
  effect.exposure = options.exposure;
  effect.decay = options.decay;
  effect.weight = options.weight;
  effect.density = options.density;
  if (sky !== null) {
    effect.excludedMeshes.push(sky);
  }

  const pass = effect.getPass();
  const beforePass = pass.onBeforeRenderObservable.add(() => {
    material.disableColorWrite = false;
    material.disableDepthWrite = false;
  });
  const afterPass = pass.onAfterRenderObservable.add(() => {
    material.disableColorWrite = true;
    material.disableDepthWrite = true;
  });

  const direction: Vector3Tuple = [sunDirection.x, sunDirection.y, sunDirection.z];

  /** The constructor attached both halves; the gate starts by taking them off. */
  let active = true;
  const detach = (): void => {
    if (!active) {
      return;
    }
    active = false;
    camera.detachPostProcess(effect);
    // Spliced by hand rather than through `effect.dispose(camera)`, which
    // splices `scene.customRenderTargets` — the array `_createPass` did *not*
    // push to when it had a camera. Trusting it leaves the second scene pass
    // running with nothing reading its result.
    const index = camera.customRenderTargets.indexOf(pass);
    if (index !== -1) {
      camera.customRenderTargets.splice(index, 1);
    }
  };
  const attach = (): void => {
    if (active) {
      return;
    }
    active = true;
    // Index 0: the shafts belong in the frame the grade then works on, not
    // painted on top of a finished one.
    camera.attachPostProcess(effect, 0);
    if (!camera.customRenderTargets.includes(pass)) {
      camera.customRenderTargets.push(pass);
    }
  };
  detach();

  const update = (): void => {
    const eye = camera.globalPosition;
    const at = sunAnchorPosition([eye.x, eye.y, eye.z], direction, options.anchorDistance);
    anchor.position.set(at[0], at[1], at[2]);

    // The camera's own forward axis, read off its view matrix rather than from
    // a ray: `LookAtLH` writes the basis into the matrix's third column, and
    // taking it from there needs neither the picking module nor a guess about
    // which camera subclass this is.
    const view = camera.getViewMatrix().m;
    const forward: Vector3Tuple = [view[2] ?? 0, view[6] ?? 0, view[10] ?? 0];
    const gate = sunShaftsGate(
      forward,
      direction,
      options.maxAngleDegrees,
      options.hysteresisDegrees,
      active,
    );
    // Faded rather than switched, so the last few degrees before the gate
    // closes dim the shafts out instead of blinking them off.
    effect.exposure = options.exposure * gate.strength;
    if (gate.active) {
      attach();
    } else {
      detach();
    }
  };

  let disposed = false;
  const rig: SunShaftsRig = {
    effect,
    anchor,
    isActive: () => active,
    update,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      scene.onDisposeObservable.remove(sceneDisposed);
      pass.onBeforeRenderObservable.remove(beforePass);
      pass.onAfterRenderObservable.remove(afterPass);
      detach();
      effect.dispose(camera);
      material.dispose();
      anchor.dispose();
    },
  };

  /**
   * Taken down with the scene as well as with the handle.
   *
   * `Scene.dispose` walks its post-processes and calls `dispose()` on each with
   * no camera; this effect's override then reads `camera.getScene()` and throws
   * on `undefined`, which turns tearing a scene down into an exception nobody
   * can trace back to a light. Disposing here first takes the effect out of the
   * scene's list before that walk reaches it, and the flag above means doing it
   * twice is free.
   */
  const sceneDisposed = scene.onDisposeObservable.add(() => {
    rig.dispose();
  });

  return rig;
}

/**
 * Builds the ambient-occlusion pipeline.
 *
 * Separate from {@link createPipeline} because it is a separate decision: SSAO2
 * is a second full pass plus a blur, and this project measured it before
 * shipping it (ADR-0024). The profile's default is off; this exists so that
 * turning it on in a world file is one line rather than a code change.
 */
function createSsao(
  scene: Scene,
  cameras: Camera[],
  profile: ResolvedLightingProfile,
): SSAO2RenderingPipeline {
  const { ssao } = profile.postProcessing;
  const pipeline = new SSAO2RenderingPipeline(
    'wov-ssao',
    scene,
    { ssaoRatio: ssao.scale, blurRatio: ssao.scale },
    cameras,
    // Bilateral blur: it keeps the occlusion off the far side of an edge, which
    // is the difference between contact shadow and grime.
    true,
    Constants.TEXTURETYPE_HALF_FLOAT,
  );
  pipeline.radius = ssao.radius;
  pipeline.totalStrength = ssao.strength;
  pipeline.samples = ssao.samples;
  return pipeline;
}
