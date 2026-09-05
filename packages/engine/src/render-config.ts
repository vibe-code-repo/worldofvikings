/**
 * The render configuration contract the game and the editor agree on.
 *
 * Kept free of Babylon.js so it can be read, validated and persisted by code
 * that never touches the renderer (settings menu, editor preferences).
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
