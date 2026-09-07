/**
 * The lighting of a world or a zone, as data (ADR-0024).
 *
 * A time of day is a look, and a look is authored: which way the sun comes
 * from, how warm it is, how dark the shade gets, where the fog swallows the
 * hills, whether the picture is graded at all. None of that belongs in a
 * renderer constant, because then the evening in one zone and the overcast
 * morning in the next would be one `if` in TypeScript instead of two lines in
 * two files (agent rule 9).
 *
 * Every field is optional and every group is optional. A world file that says
 * nothing about light still opens, lit by the defaults `@wov/engine` resolves;
 * a file that says `{"fog": {"end": 180}}` changes exactly that one distance.
 * That is what makes this a purely additive format change (see `migrations.ts`,
 * v2 → v3) rather than a rewrite of every world on disk.
 *
 * Zone beats world: a zone with its own `lighting` overrides the world's, group
 * by group, so an interior can be dark under a world that is not. Merging is
 * the renderer's job (`resolveLightingProfile` in `@wov/engine`); this module
 * only says what may be written down.
 */
import { z } from 'zod';
import { HexColorSchema, Vector3Schema } from './common.js';

/** A distance in metres that is real and forward. */
const PositiveMetres = z.number().positive().finite();
/** A distance in metres that is real and not behind the camera. */
const NonNegativeMetres = z.number().min(0).finite();
/** A light intensity or weight: real, never negative, no upper opinion. */
const Gain = z.number().min(0).finite();
/** A fraction of one, for the values that are genuinely a proportion. */
const Fraction = z.number().min(0).max(1);

/**
 * The key light: one directional sun.
 *
 * `direction` is the direction the light **travels**, matching Babylon's
 * `DirectionalLight` and `createBaseScene` — an evening sun therefore points
 * downwards and sideways, never up.
 */
export const SunLightSchema = z
  .strictObject({
    direction: Vector3Schema,
    color: HexColorSchema,
    intensity: Gain,
  })
  .partial();

/**
 * The fill light: one hemispheric term, sky above and bounce below.
 *
 * It is what keeps a north-facing wall from being a black silhouette. Low
 * values are what make a sunset read as a sunset — the reference picture's
 * shadows are dark, not merely darker.
 */
export const AmbientLightSchema = z
  .strictObject({
    skyColor: HexColorSchema,
    groundColor: HexColorSchema,
    intensity: Gain,
  })
  .partial();

/**
 * The sky: a vertical gradient with a warm glow around the sun.
 *
 * A gradient rather than a panorama on purpose. It needs no asset, so a clean
 * clone gets the same sky as a machine with the private store (ADR-0015), and
 * the horizon colour is a number the fog can be tied to instead of a pixel
 * someone would have to sample.
 */
export const SkySchema = z
  .strictObject({
    enabled: z.boolean(),
    /** Straight up. */
    zenithColor: HexColorSchema,
    /** At eye level, all the way round. */
    horizonColor: HexColorSchema,
    /** The glow the sun sits in. */
    sunColor: HexColorSchema,
    /** How far the glow spreads, 0 = a point, 1 = the whole sky. */
    sunSpread: Fraction,
    /**
     * How much of this sky the ground reflects, 0…1 (ADR-0032).
     *
     * The terrain shader reflects the same gradient the dome draws, which is
     * what makes a metallic ground layer read as cool sky rather than as a
     * colour someone picked. This is the one dial over that: 0 turns the
     * reflection off and leaves the ground purely diffuse, 1 is the full sky.
     * It lives with the sky and not with the terrain because it is a property
     * of the light in the zone, not of the ground in it.
     */
    groundReflection: Fraction,
  })
  .partial();

/** The distance curves the fog offers. */
export const FOG_MODES = ['linear', 'exp'] as const;
export const FogModeSchema = z.enum(FOG_MODES);

/**
 * Distance fog.
 *
 * Two curves, because they answer two different questions (ADR-0041).
 *
 * `linear` is the one `createBaseScene` uses and the default: the near and far
 * edge of the fade are stated in metres, which is the unit a level designer can
 * pace out on the tile. It is a straight ramp, so it says exactly where the
 * horizon dissolves — and says almost nothing over the first fifth of it.
 *
 * `exp` is aerial perspective: haze accumulates along the line of sight at a
 * constant rate, `density` per metre, so it is already visible a hundred metres
 * out and never quite reaches full, which leaves a distant range some colour of
 * its own instead of a flat band. `start`/`end` are unused under `exp` and
 * `density` is unused under `linear`; both stay writable, so a world can be
 * switched between the curves without losing the numbers for the other.
 *
 * `color` defaults to the sky's horizon colour, because fog that does not match
 * the horizon is a grey wall standing in front of it.
 */
export const FogSchema = z
  .strictObject({
    enabled: z.boolean(),
    mode: FogModeSchema,
    start: NonNegativeMetres,
    end: PositiveMetres,
    /**
     * Extinction per metre under `exp`. The working range is small — 0.0005 is
     * a clear evening, 0.003 a wall of haze — so it carries its own upper bound
     * rather than being a `Gain`: the editor derives a control's range from the
     * schema (ADR-0033), and an unbounded number gets a box instead of a slider.
     */
    density: z.number().min(0).max(0.005).finite(),
    color: HexColorSchema,
  })
  .partial();

/** The shadow-map filters the renderer offers. */
export const SHADOW_FILTERS = ['none', 'poisson', 'pcf'] as const;
export const ShadowFilterSchema = z.enum(SHADOW_FILTERS);

/**
 * Shadows: one shadow map, following the player.
 *
 * `distance` is the edge length in metres of the square the map covers. It is
 * the only quality knob that matters: `mapSize` divided by `distance` is the
 * ground each shadow texel covers, and that number — not the resolution alone —
 * is what decides whether a fence post has a shadow or a smudge.
 *
 * `bias` and `normalBias` are the acne controls, in the units Babylon's
 * `ShadowGenerator` uses (a fraction of the light's depth range, and metres
 * along the surface normal). They are here rather than hard-coded because they
 * scale with `distance`, which is world data.
 */
export const ShadowsSchema = z
  .strictObject({
    enabled: z.boolean(),
    /** Edge length of the shadow map in texels; a power of two, 256…4096. */
    mapSize: z
      .number()
      .int()
      .min(256)
      .max(4096)
      .refine((size) => (size & (size - 1)) === 0, { message: 'must be a power of two' }),
    distance: PositiveMetres,
    bias: z.number().min(0).finite(),
    normalBias: z.number().min(0).finite(),
    /** How dark full shade is: 0 = black, 1 = no shadow at all. */
    darkness: Fraction,
    filter: ShadowFilterSchema,
  })
  .partial();

/** The tone-mapping curves the renderer offers. */
export const TONE_MAPPINGS = ['none', 'standard', 'aces', 'neutral'] as const;
export const ToneMappingSchema = z.enum(TONE_MAPPINGS);

/** Bloom: the glow on embers, torches and the red gems. */
export const BloomSchema = z
  .strictObject({
    enabled: z.boolean(),
    /** Luminance above which a pixel starts to glow. */
    threshold: Gain,
    /** How much of the glow is added back. */
    weight: Gain,
    /** Resolution the glow is computed at, as a fraction of the frame. */
    scale: Fraction,
    /** Blur kernel in pixels — how wide the glow spreads. */
    kernel: z.number().min(1).max(256).finite(),
  })
  .partial();

/** Vignette: the frame darkening that pulls the eye to the middle. */
export const VignetteSchema = z
  .strictObject({
    enabled: z.boolean(),
    weight: Gain,
    color: HexColorSchema,
  })
  .partial();

/**
 * Screen-space ambient occlusion.
 *
 * Off by default, and measured before it is ever turned on: SSAO2 is a second
 * full-resolution pass plus a blur, and the frame budget is 60 FPS on a
 * mid-range GPU (spec §38). See ADR-0024 for the numbers this project measured.
 */
export const SsaoSchema = z
  .strictObject({
    enabled: z.boolean(),
    /** Sampling radius in metres. */
    radius: PositiveMetres,
    /** How dark the occlusion gets. */
    strength: Gain,
    /** Samples per pixel — the cost knob. */
    samples: z.number().int().min(1).max(64),
    /** Fraction of the frame the effect is computed at. */
    scale: Fraction,
  })
  .partial();

/** The grade applied to the finished frame. */
export const PostProcessingSchema = z
  .strictObject({
    enabled: z.boolean(),
    fxaa: z.boolean(),
    toneMapping: ToneMappingSchema,
    exposure: Gain,
    contrast: Gain,
    /**
     * How much colour survives the grade: 0 greyscale, 1 untouched, 2 twice as
     * colourful. Bounded above rather than left open like the other gains, so
     * the editor's control derives a range to step in and a mistyped number
     * cannot ask for a look no screen can show (ADR-0040).
     */
    saturation: z.number().min(0).max(2).finite(),
    bloom: BloomSchema,
    vignette: VignetteSchema,
    ssao: SsaoSchema,
  })
  .partial();

/** Everything a world or a zone may say about how it is lit. */
export const LightingProfileSchema = z
  .strictObject({
    sun: SunLightSchema,
    ambient: AmbientLightSchema,
    sky: SkySchema,
    fog: FogSchema,
    shadows: ShadowsSchema,
    postProcessing: PostProcessingSchema,
  })
  .partial();

export type SunLight = z.infer<typeof SunLightSchema>;
export type AmbientLight = z.infer<typeof AmbientLightSchema>;
export type Sky = z.infer<typeof SkySchema>;
export type Fog = z.infer<typeof FogSchema>;
export type ShadowFilter = z.infer<typeof ShadowFilterSchema>;
export type Shadows = z.infer<typeof ShadowsSchema>;
export type ToneMapping = z.infer<typeof ToneMappingSchema>;
export type Bloom = z.infer<typeof BloomSchema>;
export type Vignette = z.infer<typeof VignetteSchema>;
export type Ssao = z.infer<typeof SsaoSchema>;
export type PostProcessing = z.infer<typeof PostProcessingSchema>;
export type LightingProfile = z.infer<typeof LightingProfileSchema>;
