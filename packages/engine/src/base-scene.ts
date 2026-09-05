/**
 * The empty outdoor stage every World of Vikings view starts from: a flat
 * ground, two lights, a sky colour and matching fog.
 *
 * This is scene *dressing*, not gameplay and not world data. It exists so the
 * game and the editor open on the same lit, oriented space instead of a black
 * void, and so a renderer change is visible immediately. It holds no entity,
 * no player and no state that a system reads back (spec §25) — everything it
 * creates is handed out on {@link BaseSceneHandle} for the caller to replace.
 *
 * Deliberately separate from `createRenderer`: the bootstrap still owns no
 * scene content (ADR-0006), callers opt in by calling this (ADR-0007). Real
 * terrain is authored in the editor and loaded from `content/` from Phase 5
 * on; this ground is a placeholder, never a generator (agent rule 16).
 */
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
// One specific builder rather than the whole `MeshBuilder` set — see ADR-0006.
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder.js';
import type { GroundMesh } from '@babylonjs/core/Meshes/groundMesh.js';
import { Scene } from '@babylonjs/core/scene.js';

/** A colour as `#rrggbb`, so it can live in JSON world data later. */
export type ColorHex = string;

/** A direction as `[x, y, z]`; normalised on use, so any length is fine. */
export type Vector3Tuple = readonly [number, number, number];

/** A fully resolved base scene description. Plain data, no Babylon types. */
export interface ResolvedBaseSceneOptions {
  /** Edge length of the square ground in metres. */
  readonly groundSize: number;
  /** Diffuse colour of the ground material. */
  readonly groundColor: ColorHex;
  /** Clear colour and, when fog is on, the fog colour. */
  readonly skyColor: ColorHex;
  /** Intensity of the fill (hemispheric) light. */
  readonly ambientIntensity: number;
  /** Intensity of the key (directional) light. */
  readonly sunIntensity: number;
  /** Direction the key light travels in; must point somewhere. */
  readonly sunDirection: Vector3Tuple;
  /** Whether to fade the ground edge into the sky with linear fog. */
  readonly fog: boolean;
  /** Distance at which fog starts. Defaults to 40 % of the ground size. */
  readonly fogStart: number;
  /** Distance at which fog is total. Defaults to 95 % of the ground size. */
  readonly fogEnd: number;
}

export type BaseSceneOptions = Partial<ResolvedBaseSceneOptions>;

/** What {@link createBaseScene} put into the scene, and how to take it out. */
export interface BaseSceneHandle {
  readonly ground: GroundMesh;
  readonly groundMaterial: StandardMaterial;
  readonly ambientLight: HemisphericLight;
  readonly sun: DirectionalLight;
  /** The options actually used, including the derived fog distances. */
  readonly options: ResolvedBaseSceneOptions;
  /** Removes ground, material and lights and restores the previous fog/sky. */
  dispose(): void;
}

const BASE_DEFAULTS = {
  groundSize: 100,
  // Cold moss under an overcast northern sky (spec §23: stylised, not real).
  groundColor: '#3d4a33',
  skyColor: '#4d5b68',
  ambientIntensity: 0.55,
  sunIntensity: 1.1,
  sunDirection: [-0.45, -1, -0.6],
  fog: true,
} as const satisfies Omit<ResolvedBaseSceneOptions, 'fogStart' | 'fogEnd'>;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Colours reach this module from code today and from world JSON later.
 * `Color3.FromHexString` answers black for anything it cannot parse, which
 * shows up as a lighting bug far from the malformed value — so reject it here
 * (agent rule 10: validate external data).
 */
function requireHexColor(value: string, field: string): ColorHex {
  if (!HEX_COLOR.test(value)) {
    throw new Error(`base scene: ${field} must be a #rrggbb colour, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requirePositive(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`base scene: ${field} must be a positive number, got ${value}`);
  }
  return value;
}

function requireNonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`base scene: ${field} must be zero or more, got ${value}`);
  }
  return value;
}

/**
 * Normalises and validates a partial description into a complete one.
 *
 * Fog distances follow the ground size unless they are given, so enlarging the
 * ground does not leave a wall of fog halfway across it.
 */
export function resolveBaseSceneOptions(
  overrides: BaseSceneOptions = {},
): ResolvedBaseSceneOptions {
  const groundSize = requirePositive(
    overrides.groundSize ?? BASE_DEFAULTS.groundSize,
    'groundSize',
  );
  const fogStart = requireNonNegative(overrides.fogStart ?? groundSize * 0.4, 'fogStart');
  const fogEnd = requirePositive(overrides.fogEnd ?? groundSize * 0.95, 'fogEnd');
  if (fogEnd <= fogStart) {
    throw new Error(`base scene: fogEnd (${fogEnd}) must be greater than fogStart (${fogStart})`);
  }

  const sunDirection = overrides.sunDirection ?? BASE_DEFAULTS.sunDirection;
  if (sunDirection.every((component) => component === 0)) {
    throw new Error('base scene: sunDirection must not be the zero vector');
  }
  for (const [axis, component] of sunDirection.entries()) {
    if (!Number.isFinite(component)) {
      throw new Error(`base scene: sunDirection[${axis}] must be finite, got ${component}`);
    }
  }

  return {
    groundSize,
    groundColor: requireHexColor(overrides.groundColor ?? BASE_DEFAULTS.groundColor, 'groundColor'),
    skyColor: requireHexColor(overrides.skyColor ?? BASE_DEFAULTS.skyColor, 'skyColor'),
    ambientIntensity: requireNonNegative(
      overrides.ambientIntensity ?? BASE_DEFAULTS.ambientIntensity,
      'ambientIntensity',
    ),
    sunIntensity: requireNonNegative(
      overrides.sunIntensity ?? BASE_DEFAULTS.sunIntensity,
      'sunIntensity',
    ),
    sunDirection,
    fog: overrides.fog ?? BASE_DEFAULTS.fog,
    fogStart,
    fogEnd,
  };
}

/** The description used when {@link createBaseScene} is called with nothing. */
export const defaultBaseSceneOptions: ResolvedBaseSceneOptions = resolveBaseSceneOptions();

/**
 * Fills `scene` with the base stage and returns what it created.
 *
 * The scene keeps ownership of camera and gameplay; this touches only the
 * ground, the two lights and the scene-wide sky and fog settings.
 */
export function createBaseScene(scene: Scene, overrides: BaseSceneOptions = {}): BaseSceneHandle {
  const options = resolveBaseSceneOptions(overrides);
  const sky = Color3.FromHexString(options.skyColor);

  const previous = {
    clearColor: scene.clearColor.clone(),
    fogMode: scene.fogMode,
    fogColor: scene.fogColor.clone(),
    fogStart: scene.fogStart,
    fogEnd: scene.fogEnd,
  };

  scene.clearColor = sky.toColor4(1);
  if (options.fog) {
    // Linear rather than exponential: the near and far edge of the fade are
    // stated in metres, which is what a level designer can reason about.
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogEnabled = true;
    scene.fogColor = sky;
    scene.fogStart = options.fogStart;
    scene.fogEnd = options.fogEnd;
  } else {
    scene.fogMode = Scene.FOGMODE_NONE;
  }

  const ambientLight = new HemisphericLight('base-ambient', new Vector3(0, 1, 0), scene);
  ambientLight.intensity = options.ambientIntensity;
  // Bounce colour from the ground, so downward faces are not flat black.
  ambientLight.groundColor = Color3.FromHexString(options.groundColor).scale(0.5);

  const sun = new DirectionalLight(
    'base-sun',
    Vector3.FromArray([...options.sunDirection]).normalize(),
    scene,
  );
  sun.intensity = options.sunIntensity;
  // No shadows in Phase 1. Shadows are selective and cost a second pass per
  // caster (spec §38), so they arrive with the content that needs them — and
  // until then this flag keeps any stray ShadowGenerator from taking effect.
  sun.shadowEnabled = false;

  // A flat lit plane needs no tessellation: Babylon interpolates the position
  // and normal varyings perspective-correctly, so lighting and fog are exact
  // per pixel on two triangles. Real terrain is authored in the editor.
  const ground = CreateGround(
    'base-ground',
    { width: options.groundSize, height: options.groundSize, subdivisions: 1 },
    scene,
  );
  ground.receiveShadows = false;
  // The ground never moves; skip its per-frame world matrix computation (§38).
  ground.freezeWorldMatrix();

  const groundMaterial = new StandardMaterial('base-ground-material', scene);
  groundMaterial.diffuseColor = Color3.FromHexString(options.groundColor);
  // Flat stylised surfaces (spec §23) — and one lighting term less per pixel.
  groundMaterial.specularColor = Color3.Black();
  ground.material = groundMaterial;

  let disposed = false;

  return {
    ground,
    groundMaterial,
    ambientLight,
    sun,
    options,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      ground.dispose();
      groundMaterial.dispose();
      ambientLight.dispose();
      sun.dispose();
      scene.clearColor = previous.clearColor;
      scene.fogMode = previous.fogMode;
      scene.fogColor = previous.fogColor;
      scene.fogStart = previous.fogStart;
      scene.fogEnd = previous.fogEnd;
    },
  };
}
