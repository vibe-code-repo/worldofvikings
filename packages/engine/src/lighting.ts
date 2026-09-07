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
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';
// One specific builder rather than the whole `MeshBuilder` set — see ADR-0006.
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline.js';
import { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline.js';
import { Scene } from '@babylonjs/core/scene.js';
import {
  SKY_ATTRIBUTES,
  SKY_FRAGMENT_SOURCE,
  SKY_UNIFORMS,
  SKY_VERTEX_SOURCE,
} from './sky-shader.js';
import { clearSceneSkyGradient, setSceneSkyGradient } from './sky-gradient.js';
import { resolveLightingProfile } from './lighting-profile.js';
import type { LightingProfileOptions, ResolvedLightingProfile } from './lighting-profile.js';

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
    shadowsEnabled: scene.shadowsEnabled,
  };

  // Behind the sky, the clear colour is never seen. It is still set, because a
  // profile may turn the sky off and a scene with no sky must not clear to
  // Babylon's default grey-blue.
  scene.clearColor = Color3.FromHexString(profile.sky.horizonColor).toColor4(1);

  if (profile.fog.enabled) {
    // Linear, like `createBaseScene`: the near and far edge of the fade are
    // stated in metres, which is what a level designer can pace out.
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogEnabled = true;
    scene.fogColor = Color3.FromHexString(profile.fog.color);
    scene.fogStart = profile.fog.start;
    scene.fogEnd = profile.fog.end;
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
  const pipeline =
    profile.postProcessing.enabled && cameras.length > 0
      ? createPipeline(scene, cameras, profile)
      : null;
  const ssao =
    profile.postProcessing.enabled && profile.postProcessing.ssao.enabled && cameras.length > 0
      ? createSsao(scene, cameras, profile)
      : null;

  /** Where the shadow box is centred; the light is parked behind it. */
  const focus = new Vector3(0, 0, 0);

  /** Meshes that neither cast nor receive; see `excludeFromShadows`. */
  const excluded = new Set<AbstractMesh>();
  /** Meshes that receive but do not cast; see `excludeFromCasting`. */
  const nonCasters = new Set<AbstractMesh>();
  if (sky !== null) {
    excluded.add(sky);
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
  for (const mesh of scene.meshes) {
    receive(mesh);
  }
  // Models load for seconds after this call; every mesh one of them adds is a
  // wall something else should be able to darken.
  const meshAdded = scene.onNewMeshAddedObservable.add(receive);

  const place = (): void => {
    sun.position = focus.subtract(direction.scale(profile.shadows.distance));
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
      excluded.clear();
      nonCasters.clear();
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
      scene.shadowsEnabled = previous.shadowsEnabled;
      clearSceneSkyGradient(scene);
    },
  };
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
