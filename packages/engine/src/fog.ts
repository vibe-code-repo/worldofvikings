/**
 * How much haze sits between the camera and a point, and what may be drawn
 * through it (ADR-0041).
 *
 * Fog is the one lighting term that is computed in four places at once — the
 * PBR materials Babylon's own `fogFragment` shades, the terrain's hand-written
 * shader, the rule that decides whether a painted mountain shell takes fog at
 * all (ADR-0034), and the editor, which has to agree with all three or it shows
 * an author a picture the game will not draw. So the curve lives here, once, in
 * plain numbers, and everything else asks it.
 *
 * No Babylon import: this is arithmetic, and the game, the editor and a test
 * that never opens a scene all need it.
 */

/** Which distance curve haze follows. */
export type FogCurveMode = 'none' | 'linear' | 'exp';

/** A fog curve, stripped to what deciding a haze needs. */
export interface FogCurve {
  readonly mode: FogCurveMode;
  /** Where a `linear` ramp starts, in metres. */
  readonly start: number;
  /** Where a `linear` ramp is total, in metres. */
  readonly end: number;
  /** Extinction per metre under `exp`. */
  readonly density: number;
}

/**
 * The exponent Babylon's `fogFragment` applies to the visibility factor.
 *
 * This is the non-obvious fact the whole of ADR-0041 turns on.
 * `Shaders/ShadersInclude/fogFragment` reads
 *
 * ```glsl
 * float fog = CalcFogFactor();
 * #ifdef PBR
 *   fog = toLinearSpace(fog);   // pow(fog, 2.2)
 * #endif
 * color.rgb = mix(vFogColor, color.rgb, fog);
 * ```
 *
 * Every GLB in this project loads as a `PBRMaterial`, so every prop, house and
 * mountain shell is drawn on the *encoded* curve, while the terrain's own
 * shader used the raw one. Same distance, two different hazes: the ground was
 * the least-hazed surface in the frame and it is the surface that carries most
 * of the depth cue. The terrain shader now applies the same encode, and so does
 * everything here, so that "haze" means one thing in this repository.
 */
export const FOG_ENCODE_POWER = 2.2;

/**
 * How much of a surface's own colour survives at `distance`, 1 clear to 0 gone.
 *
 * The 2.2 encode is included, because what a reader wants to know is what ends
 * up on screen, not what an intermediate factor was before Babylon squared it.
 */
export function fogVisibility(fog: FogCurve, distance: number): number {
  const raw = rawFogFactor(fog, distance);
  return Math.pow(raw, FOG_ENCODE_POWER);
}

/** How much fog colour is laid over a surface at `distance`, 0 none to 1 all. */
export function hazeAt(fog: FogCurve, distance: number): number {
  return 1 - fogVisibility(fog, distance);
}

/**
 * The unencoded fog factor, exactly as Babylon's `CalcFogFactor` computes it.
 *
 * Exported for the tests and for the shader's sake — it is the quantity the
 * GLSL branch has to reproduce — not because anything else should reason in it.
 */
export function rawFogFactor(fog: FogCurve, distance: number): number {
  if (fog.mode === 'none') {
    return 1;
  }
  if (fog.mode === 'exp') {
    return Math.exp(-fog.density * Math.max(distance, 0));
  }
  const span = fog.end - fog.start;
  if (span <= 0) {
    return distance >= fog.end ? 0 : 1;
  }
  return clamp01((fog.end - distance) / span);
}

/**
 * The most haze a painted backdrop may stand in and still be drawn hazed.
 *
 * One part in a hundred of its own colour left. Past that the shell and pure
 * fog colour are no longer distinguishable in eight bits — 1 % of a channel is
 * 2.55 levels, and the difference between the shell's near edge and its far
 * edge is smaller still — which is the flat band across the horizon ADR-0031
 * was written against.
 */
export const MAX_BACKDROP_HAZE = 0.99;

/**
 * Whether a backdrop mesh takes the scene's fog (ADR-0034, restated ADR-0041).
 *
 * `reach` is how far away the farthest point of that mesh can be — its world
 * bounding sphere's centre distance plus its radius. The question the original
 * rule asked was `fog.end > reach`, which has no meaning once the curve is
 * exponential and has no end. The question it was *really* asking is the one
 * asked here: **does this mesh keep enough of its own colour to be worth
 * drawing?** A shell whose far side is in saturated fog is drawn with a band of
 * pure fog colour across it, so it is better left out of the fog entirely.
 *
 * Under `linear` this reduces to the old behaviour, including its refusal of
 * the exact boundary: at `end` the factor is 0, the haze is total, and the
 * answer is no.
 *
 * Under `exp` haze never quite reaches 1, so the rule stops being a wall and
 * becomes what it says — the range hazes with distance for as long as it is
 * still a range, and a density high enough to erase it is still refused.
 */
export function backdropTakesFog(fog: FogCurve, reach: number): boolean {
  if (fog.mode === 'none') {
    return false;
  }
  return hazeAt(fog, reach) < MAX_BACKDROP_HAZE;
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

/**
 * Babylon's own fog-mode codes, so nothing has to import a `Scene` to name one.
 *
 * They are also what the terrain shader receives, rather than a private
 * numbering of our own: one set of numbers for the fog means a uniform can be
 * read against Babylon's documentation instead of against this file.
 */
export const BABYLON_FOGMODE = {
  none: 0,
  exp: 1,
  exp2: 2,
  linear: 3,
} as const;

/**
 * The Babylon mode code for a curve — what the terrain shader is sent.
 *
 * Here rather than in `terrain.ts` so the one number the ground's fog branch
 * turns on can be tested without a renderer. Sending a boolean instead of this
 * is the failure ADR-0041 exists to prevent: the ground silently leaves the fog
 * while everything standing on it goes on hazing.
 */
export function fogModeCode(mode: FogCurveMode): number {
  return mode === 'linear'
    ? BABYLON_FOGMODE.linear
    : mode === 'exp'
      ? BABYLON_FOGMODE.exp
      : BABYLON_FOGMODE.none;
}

/** The fog fields of a Babylon scene, named structurally so this stays engine-free. */
export interface SceneFogFields {
  readonly fogEnabled: boolean;
  readonly fogMode: number;
  readonly fogStart: number;
  readonly fogEnd: number;
  readonly fogDensity: number;
}

/**
 * The curve a scene is currently fogged with.
 *
 * Read off Babylon's own fields rather than kept in a second copy beside them:
 * `applyLighting` writes the scene, `?flat=1` turns the scene's fog off, and
 * the Phase-1 base scene sets its own — three writers, and a cache would be
 * wrong after any of them.
 *
 * `exp2` is reported as `exp`. Nothing in this project asks for it (ADR-0041
 * says why), and reporting it as `none` would silently unfog the ground, which
 * is worse than reporting a curve of the right family and the wrong falloff.
 */
export function sceneFogCurve(scene: SceneFogFields): FogCurve {
  const mode: FogCurveMode = !scene.fogEnabled
    ? 'none'
    : scene.fogMode === BABYLON_FOGMODE.linear
      ? 'linear'
      : scene.fogMode === BABYLON_FOGMODE.exp || scene.fogMode === BABYLON_FOGMODE.exp2
        ? 'exp'
        : 'none';
  return { mode, start: scene.fogStart, end: scene.fogEnd, density: scene.fogDensity };
}
