/**
 * @wov/engine — the rendering layer shared by the game and the editor.
 *
 * Phase 0 deliberately contains no Babylon.js code: the game app owns its own
 * bootstrap until Phase 1 extracts the reusable parts here. What already lives
 * here is the configuration contract both apps agree on, so the split does not
 * have to be invented later.
 */
import { clamp } from '@wov/shared';

/** Options both the game and the editor pass when creating a render surface. */
export interface RenderConfig {
  /** Hardware scaling level; 1 = native resolution. Clamped to a sane range. */
  readonly resolutionScale: number;
  /** Whether to prefer WebGPU when the browser supports it (spec §2.1). */
  readonly preferWebGPU: boolean;
  /** Show the Babylon.js inspector-style debug overlay. */
  readonly debugOverlay: boolean;
}

export const defaultRenderConfig: RenderConfig = {
  resolutionScale: 1,
  preferWebGPU: false,
  debugOverlay: false,
};

/** Normalises a partial config into a complete, in-range {@link RenderConfig}. */
export function resolveRenderConfig(overrides: Partial<RenderConfig> = {}): RenderConfig {
  const merged = { ...defaultRenderConfig, ...overrides };
  return { ...merged, resolutionScale: clamp(merged.resolutionScale, 0.25, 2) };
}
