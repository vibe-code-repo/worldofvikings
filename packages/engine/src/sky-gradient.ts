/**
 * The sky a scene is currently lit under, as numbers something other than the
 * sky box can read (ADR-0032).
 *
 * The ground reflects the sky. The sky is a gradient with no texture and no
 * mesh worth sampling — it is four colours and a spread, held in a
 * `ShaderMaterial`'s uniforms, and a `ShaderMaterial` does not hand those back.
 * So `applyLighting` records what it built here and `createTerrainMaterial`
 * reads it, the same way both already read the scene's own lights rather than
 * being told about them twice.
 *
 * A `WeakMap` and not a field on `Scene`: the engine does not own Babylon's
 * types, and a scene that is disposed should take its entry with it without
 * anybody remembering to remove it.
 */
import type { Scene } from '@babylonjs/core/scene.js';
import { defaultLightingProfile } from './lighting-profile.js';

/** The sky as the ground needs to know it: colours, spread, and how much lands. */
export interface SkyGradient {
  /** `#rrggbb` straight up. */
  readonly zenithColor: string;
  /** `#rrggbb` at the horizon. */
  readonly horizonColor: string;
  /** `#rrggbb` of the glow around the sun. */
  readonly sunColor: string;
  /** How far the glow reaches, 0 (a disc) to 1 (the whole hemisphere). */
  readonly sunSpread: number;
  /**
   * How much of that sky reaches the ground, 0…1.
   *
   * Not part of the sky itself but of what the ground does with it: a scene
   * whose sky is off still reflects *something*, and a scene under a lid
   * reflects less. One number, so the effect can be turned down without the
   * colours drifting apart from the dome overhead.
   */
  readonly intensity: number;
}

/** The sky the renderer falls back to: the default profile's, fully lit. */
export const DEFAULT_SKY_GRADIENT: SkyGradient = {
  zenithColor: defaultLightingProfile.sky.zenithColor,
  horizonColor: defaultLightingProfile.sky.horizonColor,
  sunColor: defaultLightingProfile.sky.sunColor,
  sunSpread: defaultLightingProfile.sky.sunSpread,
  intensity: 1,
};

const gradients = new WeakMap<Scene, SkyGradient>();

/** Records the sky a scene is lit under. Called by `applyLighting`. */
export function setSceneSkyGradient(scene: Scene, gradient: SkyGradient): void {
  gradients.set(scene, gradient);
}

/** Forgets a scene's sky, so the next reader gets the default rather than a ghost. */
export function clearSceneSkyGradient(scene: Scene): void {
  gradients.delete(scene);
}

/**
 * The sky a scene is lit under, or {@link DEFAULT_SKY_GRADIENT}.
 *
 * A default rather than `undefined`, because every caller would otherwise write
 * the same fallback — and a terrain tile built before the lights arrive must
 * still reflect a sky, not black.
 */
export function sceneSkyGradient(scene: Scene): SkyGradient {
  return gradients.get(scene) ?? DEFAULT_SKY_GRADIENT;
}
