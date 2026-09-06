/**
 * Starting points for the lighting panel (ADR-0024, ADR-0033).
 *
 * **Why this is not world data.** A preset is not the light of any world; it is
 * the value a button writes *into* one, the same way `DEFAULT_GRID_STEP` is the
 * grid a session starts on and not a property of a place. Nothing reads these
 * at run time — the moment a preset is pressed it becomes an ordinary
 * `setLighting` command, lands in the document, and is written to
 * `content/worlds/` like a hand-typed number (agent rule 9, rule 17: editor
 * convenience is allowed when its result is persisted).
 *
 * **Why a preset replaces the whole profile.** A half-applied preset is the
 * worst of both: an evening sun over a noon sky reads as a bug in the renderer.
 * Each preset is therefore one command with one patch at the empty path, and
 * one Ctrl+Z puts the previous look back exactly.
 *
 * The numbers are the ones this project measured. `evening` is the village's
 * own profile from `content/worlds/village1.json` (ADR-0024) — pressing it on
 * the village is a no-op, which is the honest test of a preset. `flat` is what
 * `?flat=1` gives the game client: no shadows, no grade, nothing to hide a
 * geometry problem behind.
 */
import type { LightingProfile } from '@wov/world-schema';

export interface LightingPreset {
  /** Stable id — the button's `data-testid` and the key in a test. */
  readonly id: string;
  readonly name: string;
  /** One line saying what it is for, shown as the button's title. */
  readonly description: string;
  readonly profile: LightingProfile;
}

export const LIGHTING_PRESETS: readonly LightingPreset[] = [
  {
    id: 'evening',
    name: 'Evening',
    description: 'The low warm sun the village was authored under (ADR-0024).',
    profile: {
      sun: { direction: [0.58, -0.45, 0.68], color: '#ffd2a1', intensity: 2.3 },
      ambient: { skyColor: '#8fb3d8', groundColor: '#4a4032', intensity: 0.62 },
      sky: {
        enabled: true,
        zenithColor: '#17478f',
        horizonColor: '#dfa974',
        sunColor: '#ffd9a8',
        sunSpread: 0.2,
      },
      fog: { enabled: true, start: 80, end: 420 },
      shadows: {
        enabled: true,
        mapSize: 2048,
        distance: 120,
        bias: 0.006,
        normalBias: 0.012,
        darkness: 0.25,
        filter: 'poisson',
      },
      postProcessing: {
        enabled: true,
        fxaa: true,
        toneMapping: 'aces',
        exposure: 1.15,
        contrast: 1.1,
        bloom: { enabled: true, threshold: 0.85, weight: 0.22, scale: 0.5, kernel: 32 },
        vignette: { enabled: true, weight: 1.2, color: '#0d0a08' },
        ssao: { enabled: false },
      },
    },
  },
  {
    id: 'noon',
    name: 'Noon',
    description: 'A high, white sun with short shadows — for reading a silhouette.',
    profile: {
      sun: { direction: [0.25, -0.94, 0.22], color: '#fff4e0', intensity: 3 },
      ambient: { skyColor: '#c3d9f2', groundColor: '#6b6250', intensity: 0.9 },
      sky: {
        enabled: true,
        zenithColor: '#2a6fd6',
        horizonColor: '#bcd6f0',
        sunColor: '#ffffff',
        sunSpread: 0.08,
      },
      fog: { enabled: true, start: 160, end: 700 },
      shadows: {
        enabled: true,
        mapSize: 2048,
        distance: 100,
        bias: 0.005,
        normalBias: 0.01,
        darkness: 0.4,
        filter: 'pcf',
      },
      postProcessing: {
        enabled: true,
        fxaa: true,
        toneMapping: 'aces',
        exposure: 1,
        contrast: 1,
        bloom: { enabled: false },
        vignette: { enabled: false },
        ssao: { enabled: false },
      },
    },
  },
  {
    id: 'flat',
    name: 'Flat',
    description: 'No shadow map and no grade — the light `?flat=1` gives the client.',
    profile: {
      sun: { direction: [0.3, -0.8, 0.5], color: '#ffffff', intensity: 1.6 },
      ambient: { skyColor: '#ffffff', groundColor: '#b0b0b0', intensity: 1.1 },
      sky: { enabled: false },
      fog: { enabled: false },
      shadows: { enabled: false },
      postProcessing: { enabled: false },
    },
  },
];

/** The preset with this id, or `undefined`. */
export function lightingPreset(id: string): LightingPreset | undefined {
  return LIGHTING_PRESETS.find((preset) => preset.id === id);
}
