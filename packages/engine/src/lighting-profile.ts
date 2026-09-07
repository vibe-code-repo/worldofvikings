/**
 * The lighting profile as plain data: defaults, merging and validation
 * (ADR-0024).
 *
 * Free of Babylon.js on purpose, exactly like `render-config.ts` and
 * `third-person-camera-math.ts`. A profile is read out of a world file, may be
 * overridden by a zone, and has to be complete before anything is created —
 * and all three of those are decisions a test can watch without a GPU.
 *
 * It deliberately does **not** import `@wov/world-schema`. That package
 * describes data files and must stay free of a renderer; this one is the
 * renderer and must stay free of Zod (the boundary rules in
 * `.dependency-cruiser.cjs` say so both ways). The shapes are structurally
 * identical, so `zone.lighting ?? world.lighting` from a parsed world file is
 * accepted here with no conversion — the same arrangement `TerrainOptions`
 * already has with `TerrainDefinition`.
 */
import type { ColorHex, Vector3Tuple } from './base-scene.js';

/** How the finished frame is graded before it reaches the screen. */
export type ToneMappingMode = 'none' | 'standard' | 'aces' | 'neutral';

/** How the shadow map is sampled. */
export type ShadowFilterMode = 'none' | 'poisson' | 'pcf';

/** The key light: one directional sun. */
export interface SunOptions {
  /** The direction the light travels; normalised on use. */
  readonly direction: Vector3Tuple;
  readonly color: ColorHex;
  readonly intensity: number;
}

/** The fill light: sky above, bounce below. */
export interface AmbientOptions {
  readonly skyColor: ColorHex;
  readonly groundColor: ColorHex;
  readonly intensity: number;
}

/** The gradient sky. */
export interface SkyOptions {
  readonly enabled: boolean;
  readonly zenithColor: ColorHex;
  readonly horizonColor: ColorHex;
  readonly sunColor: ColorHex;
  /** How far the glow around the sun spreads: 0 a point, 1 the whole sky. */
  readonly sunSpread: number;
  /** How much of this sky the ground reflects, 0…1 (ADR-0032). */
  readonly groundReflection: number;
}

/** Linear distance fog, in metres. */
export interface FogOptions {
  readonly enabled: boolean;
  readonly start: number;
  readonly end: number;
  /**
   * `null` means "whatever the horizon is", which is what it should almost
   * always be. Resolved to a colour by {@link resolveLightingProfile}, so
   * nothing downstream has to know about the default twice.
   */
  readonly color: ColorHex;
}

/** One shadow map, following the player. */
export interface ShadowOptions {
  readonly enabled: boolean;
  readonly mapSize: number;
  /** Edge length in metres of the square the map covers. */
  readonly distance: number;
  readonly bias: number;
  readonly normalBias: number;
  /** 0 = full shade is black, 1 = no shadow at all. */
  readonly darkness: number;
  readonly filter: ShadowFilterMode;
}

/** The glow on embers, torches and gems. */
export interface BloomOptions {
  readonly enabled: boolean;
  readonly threshold: number;
  readonly weight: number;
  readonly scale: number;
  readonly kernel: number;
}

/** The frame darkening that pulls the eye to the middle. */
export interface VignetteOptions {
  readonly enabled: boolean;
  readonly weight: number;
  readonly color: ColorHex;
}

/** Screen-space ambient occlusion. Off unless it was measured and paid for. */
export interface SsaoOptions {
  readonly enabled: boolean;
  readonly radius: number;
  readonly strength: number;
  readonly samples: number;
  readonly scale: number;
}

/** The grade applied to the finished frame. */
export interface PostProcessingOptions {
  readonly enabled: boolean;
  readonly fxaa: boolean;
  readonly toneMapping: ToneMappingMode;
  readonly exposure: number;
  readonly contrast: number;
  /**
   * How much colour survives the grade: 0 greyscale, 1 untouched, 2 twice as
   * colourful. The one knob in the profile that changes chroma without
   * changing brightness or the lit-to-shaded ratio — see ADR-0040 for why
   * neither the contrast nor the tone-mapping curve can do this job.
   */
  readonly saturation: number;
  readonly bloom: BloomOptions;
  readonly vignette: VignetteOptions;
  readonly ssao: SsaoOptions;
}

/** A complete description of how a scene is lit. */
export interface ResolvedLightingProfile {
  readonly sun: SunOptions;
  readonly ambient: AmbientOptions;
  readonly sky: SkyOptions;
  readonly fog: FogOptions;
  readonly shadows: ShadowOptions;
  readonly postProcessing: PostProcessingOptions;
}

/** One group of a profile, with every field optional. */
type Partialise<T> = { readonly [K in keyof T]?: T[K] | undefined };

/**
 * What a world file, a zone or a caller may state. Every group and every field
 * inside it is optional, which is what makes `{"fog": {"end": 180}}` a legal
 * profile that changes one distance and nothing else.
 */
export interface LightingProfileOptions {
  readonly sun?: Partialise<SunOptions> | undefined;
  readonly ambient?: Partialise<AmbientOptions> | undefined;
  readonly sky?: Partialise<SkyOptions> | undefined;
  readonly fog?: Partialise<FogOptions> | undefined;
  readonly shadows?: Partialise<ShadowOptions> | undefined;
  readonly postProcessing?:
    | (Partialise<Omit<PostProcessingOptions, 'bloom' | 'vignette' | 'ssao'>> & {
        readonly bloom?: Partialise<BloomOptions> | undefined;
        readonly vignette?: Partialise<VignetteOptions> | undefined;
        readonly ssao?: Partialise<SsaoOptions> | undefined;
      })
    | undefined;
}

/**
 * The look a world gets when it says nothing: the late afternoon of the
 * reference picture, not a black void and not the flat noon of Phase 1.
 *
 * These are the numbers `content/worlds/village1.json` was authored against and
 * they are the fallback for every world without a profile, so a new world is
 * *lit* the moment it opens. They are stated here rather than in the world file
 * because a default has to exist somewhere a file cannot reach.
 */
export const defaultLightingProfile: ResolvedLightingProfile = {
  sun: {
    // Low and from the side: about 21° above the horizon, which is what makes
    // a house cast a shadow two and a half times its own height.
    direction: [0.62, -0.36, 0.7],
    color: '#ffd2a1',
    intensity: 3.1,
  },
  ambient: {
    skyColor: '#7ea8d8',
    groundColor: '#4a4032',
    // Low, deliberately. A bright fill is what makes the current staging build
    // look flat: it fills the shadow back in as fast as the sun digs it.
    intensity: 0.45,
  },
  sky: {
    enabled: true,
    zenithColor: '#2f66a8',
    horizonColor: '#e8c79a',
    sunColor: '#ffd9a8',
    sunSpread: 0.35,
    // Full sky by default: the ground reflecting less than the dome shows is a
    // decision a world makes, not a renderer default.
    groundReflection: 1,
  },
  fog: {
    enabled: true,
    // The village tile is 300 m across (ADR-0020): the fade starts beyond the
    // far side of the square and is total just past the tile's diagonal, so the
    // horizon dissolves instead of ending at an edge.
    start: 110,
    end: 340,
    color: '#e8c79a',
  },
  shadows: {
    enabled: true,
    mapSize: 2048,
    // 2048 texels over 140 m is 6.8 cm of ground per texel — a fence post is
    // still a post rather than a smudge, and the map fits the view distance a
    // third-person camera actually shows.
    distance: 140,
    bias: 0.006,
    normalBias: 0.012,
    darkness: 0.32,
    filter: 'poisson',
  },
  postProcessing: {
    enabled: true,
    fxaa: true,
    toneMapping: 'aces',
    exposure: 1.15,
    contrast: 1.45,
    // 1 is "leave the colour alone", the same convention `exposure` and
    // `contrast` use, so a world that never heard of this field renders exactly
    // as it did before the field existed (ADR-0040).
    saturation: 1,
    bloom: { enabled: true, threshold: 0.82, weight: 0.35, scale: 0.5, kernel: 48 },
    vignette: { enabled: true, weight: 2.4, color: '#0d0a08' },
    // Measured before it was decided, not assumed — see ADR-0024.
    ssao: { enabled: false, radius: 1.6, strength: 1.1, samples: 12, scale: 0.75 },
  },
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function requireHexColor(value: string, field: string): ColorHex {
  if (!HEX_COLOR.test(value)) {
    throw new Error(`lighting: ${field} must be a #rrggbb colour, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requireFinite(value: number, field: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`lighting: ${field} must be a finite number, got ${String(value)}`);
  }
  return value;
}

function requireNonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`lighting: ${field} must be zero or more, got ${String(value)}`);
  }
  return value;
}

function requirePositive(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`lighting: ${field} must be a positive number, got ${String(value)}`);
  }
  return value;
}

/** Clamps into `0…1` after checking it is a number at all. */
function requireFraction(value: number, field: string): number {
  const finite = requireFinite(value, field);
  return Math.min(1, Math.max(0, finite));
}

function requireDirection(value: Vector3Tuple, field: string): Vector3Tuple {
  for (const [axis, component] of value.entries()) {
    if (!Number.isFinite(component)) {
      throw new Error(
        `lighting: ${field}[${String(axis)}] must be finite, got ${String(component)}`,
      );
    }
  }
  if (value.every((component) => component === 0)) {
    throw new Error(`lighting: ${field} must not be the zero vector`);
  }
  return value;
}

/** Merges a group of overrides over a resolved group, field by field. */
function merge<T extends object>(base: T, ...overrides: (Partialise<T> | undefined)[]): T {
  let result = base;
  for (const override of overrides) {
    if (override === undefined) {
      continue;
    }
    const defined: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(override)) {
      if (value !== undefined) {
        defined[key] = value;
      }
    }
    result = { ...result, ...defined };
  }
  return result;
}

/**
 * Fills a chain of partial profiles into one complete description.
 *
 * Later arguments win, group by group and field by field, which is exactly the
 * "zone overrides world" rule of the world format: `resolveLightingProfile(
 * world.lighting, zone.lighting)`. Passing nothing at all resolves to
 * {@link defaultLightingProfile}.
 *
 * Fog colour is the one derived value: unless it is stated, it follows the
 * horizon of whatever sky won the merge, because fog in a different colour from
 * the horizon is a grey wall standing in front of it.
 *
 * @throws {Error} on a malformed colour, a non-finite number or a zero sun
 * direction. This is world data arriving from a file, so it is validated at the
 * edge rather than rendered as black (agent rule 10).
 */
export function resolveLightingProfile(
  ...profiles: (LightingProfileOptions | undefined)[]
): ResolvedLightingProfile {
  const base = defaultLightingProfile;
  const sun = merge(base.sun, ...profiles.map((profile) => profile?.sun));
  const ambient = merge(base.ambient, ...profiles.map((profile) => profile?.ambient));
  const sky = merge(base.sky, ...profiles.map((profile) => profile?.sky));
  const shadows = merge(base.shadows, ...profiles.map((profile) => profile?.shadows));

  // The fog's default colour is the resolved horizon, so a world that changes
  // only its sky gets fog to match without restating the colour.
  const fogOverrides = profiles.map((profile) => profile?.fog);
  const fogStated = fogOverrides.some((override) => override?.color !== undefined);
  const fog = merge({ ...base.fog, color: sky.horizonColor }, ...fogOverrides);

  const postOverrides = profiles.map((profile) => profile?.postProcessing);
  const post = merge(
    {
      enabled: base.postProcessing.enabled,
      fxaa: base.postProcessing.fxaa,
      toneMapping: base.postProcessing.toneMapping,
      exposure: base.postProcessing.exposure,
      contrast: base.postProcessing.contrast,
      saturation: base.postProcessing.saturation,
    },
    ...postOverrides.map((override) =>
      override === undefined
        ? undefined
        : {
            enabled: override.enabled,
            fxaa: override.fxaa,
            toneMapping: override.toneMapping,
            exposure: override.exposure,
            contrast: override.contrast,
            saturation: override.saturation,
          },
    ),
  );
  const bloom = merge(base.postProcessing.bloom, ...postOverrides.map((o) => o?.bloom));
  const vignette = merge(base.postProcessing.vignette, ...postOverrides.map((o) => o?.vignette));
  const ssao = merge(base.postProcessing.ssao, ...postOverrides.map((o) => o?.ssao));

  const fogStart = requireNonNegative(fog.start, 'fog.start');
  const fogEnd = requirePositive(fog.end, 'fog.end');
  if (fogEnd <= fogStart) {
    throw new Error(
      `lighting: fog.end (${String(fogEnd)}) must be greater than fog.start (${String(fogStart)})`,
    );
  }

  return {
    sun: {
      direction: requireDirection(sun.direction, 'sun.direction'),
      color: requireHexColor(sun.color, 'sun.color'),
      intensity: requireNonNegative(sun.intensity, 'sun.intensity'),
    },
    ambient: {
      skyColor: requireHexColor(ambient.skyColor, 'ambient.skyColor'),
      groundColor: requireHexColor(ambient.groundColor, 'ambient.groundColor'),
      intensity: requireNonNegative(ambient.intensity, 'ambient.intensity'),
    },
    sky: {
      enabled: sky.enabled,
      zenithColor: requireHexColor(sky.zenithColor, 'sky.zenithColor'),
      horizonColor: requireHexColor(sky.horizonColor, 'sky.horizonColor'),
      sunColor: requireHexColor(sky.sunColor, 'sky.sunColor'),
      sunSpread: requireFraction(sky.sunSpread, 'sky.sunSpread'),
      groundReflection: requireFraction(sky.groundReflection, 'sky.groundReflection'),
    },
    fog: {
      enabled: fog.enabled,
      start: fogStart,
      end: fogEnd,
      color: requireHexColor(fogStated ? fog.color : sky.horizonColor, 'fog.color'),
    },
    shadows: {
      enabled: shadows.enabled,
      mapSize: requirePositive(shadows.mapSize, 'shadows.mapSize'),
      distance: requirePositive(shadows.distance, 'shadows.distance'),
      bias: requireNonNegative(shadows.bias, 'shadows.bias'),
      normalBias: requireNonNegative(shadows.normalBias, 'shadows.normalBias'),
      darkness: requireFraction(shadows.darkness, 'shadows.darkness'),
      filter: shadows.filter,
    },
    postProcessing: {
      enabled: post.enabled,
      fxaa: post.fxaa,
      toneMapping: post.toneMapping,
      exposure: requireNonNegative(post.exposure, 'postProcessing.exposure'),
      contrast: requireNonNegative(post.contrast, 'postProcessing.contrast'),
      saturation: requireNonNegative(post.saturation, 'postProcessing.saturation'),
      bloom: {
        enabled: bloom.enabled,
        threshold: requireNonNegative(bloom.threshold, 'bloom.threshold'),
        weight: requireNonNegative(bloom.weight, 'bloom.weight'),
        scale: requireFraction(bloom.scale, 'bloom.scale'),
        kernel: requirePositive(bloom.kernel, 'bloom.kernel'),
      },
      vignette: {
        enabled: vignette.enabled,
        weight: requireNonNegative(vignette.weight, 'vignette.weight'),
        color: requireHexColor(vignette.color, 'vignette.color'),
      },
      ssao: {
        enabled: ssao.enabled,
        radius: requirePositive(ssao.radius, 'ssao.radius'),
        strength: requireNonNegative(ssao.strength, 'ssao.strength'),
        samples: Math.round(requirePositive(ssao.samples, 'ssao.samples')),
        scale: requireFraction(ssao.scale, 'ssao.scale'),
      },
    },
  };
}
