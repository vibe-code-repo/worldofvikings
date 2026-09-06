/**
 * Build-time constants Vite substitutes through `define` (see
 * `apps/game/vite.config.ts`).
 *
 * Declared rather than imported, deliberately: the value must reach Rollup as a
 * literal so `__WOV_DEBUG_BRIDGE__ && …` folds away in a default build and the
 * debug bridge module leaves the bundle with it (ADR-0030).
 */

/** True only in a build started with `WOV_DEBUG_BRIDGE=1`. */
declare const __WOV_DEBUG_BRIDGE__: boolean;
