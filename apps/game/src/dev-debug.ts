/**
 * The dev build's debug bridge: a frame counter on `window.__wov` and the same
 * number rendered into the on-screen marker.
 *
 * Why it exists: a loaded page proves nothing about a running renderer. The
 * marker is there whether the render loop ticks, stalls or throws after the
 * first frame. A counter that keeps climbing is the cheapest honest witness,
 * and `pnpm smoke` asserts exactly that.
 *
 * Why it is dev-only: `window.__wov` is a handle into the running client. It
 * is called behind `import.meta.env.DEV`, which Vite replaces with `false` in
 * a production build, so Rollup drops the branch and this whole module with
 * it. Verify with `pnpm --filter @wov/game build && grep -r __wov dist/` —
 * that must find nothing.
 */
import type { RendererBackend, RendererHandle } from '@wov/engine';

/** The read-only view other dev tooling (and the smoke test) may rely on. */
export interface WovDebugBridge {
  /** Which engine implementation the renderer ended up on. */
  readonly backend: RendererBackend;
  /** Index of the last rendered frame; `-1` before the first one. */
  readonly frameId: number;
}

declare global {
  interface Window {
    /** Present in the dev build only — see `apps/game/src/dev-debug.ts`. */
    __wov?: WovDebugBridge;
  }
}

/** Shown until the first frame lands, so `frame <digits>` never lies. */
const NO_FRAME_YET = 'frame …';

/**
 * Publishes the bridge and starts writing the frame counter into `marker`.
 *
 * There is no teardown: the bridge lives as long as the page, and the renderer
 * disposing takes the frame listener with it. A teardown nobody calls would be
 * untested code pretending to be a feature.
 */
export function installDevDebugBridge(renderer: RendererHandle, marker: HTMLElement | null): void {
  const bridge: { backend: RendererBackend; frameId: number } = {
    backend: renderer.backend,
    frameId: -1,
  };
  window.__wov = bridge;

  const frameElement = document.createElement('span');
  frameElement.dataset['testid'] = 'game-frame';
  frameElement.style.marginLeft = '0.6em';
  frameElement.style.opacity = '0.75';
  frameElement.textContent = NO_FRAME_YET;
  marker?.append(frameElement);

  renderer.onFrame((frame) => {
    bridge.frameId = frame.index;
    // One small text write per frame, and only in the dev build: the string
    // changes every frame, so caching it would never hit (spec §38).
    frameElement.textContent = `frame ${frame.index}`;
  });
}
