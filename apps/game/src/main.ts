/**
 * Game entry point (Phase 1).
 *
 * Renders the base scene — ground, lights, sky and fog from `@wov/engine` —
 * with a camera looking at it, plus a DOM marker. No gameplay, no editor code:
 * `apps/game` must never import `apps/editor` or `@wov/editor-core` (spec §10,
 * enforced by `pnpm lint:boundaries`).
 *
 * The marker is plain DOM and is shown even when WebGL is unavailable, so the
 * smoke test can tell "app served" apart from "renderer failed". In the dev
 * build it also carries the live frame counter (see `./dev-debug.ts`).
 */
import { tokens } from '@wov/ui';
import { installDevDebugBridge } from './dev-debug.js';
import { createGameScene } from './scene.js';

const marker = document.querySelector<HTMLElement>('[data-testid="game-marker"]');
const status = document.querySelector<HTMLElement>('[data-testid="game-status"]');

document.body.style.background = tokens.colorBackground;
document.body.style.color = tokens.colorText;
for (const element of [marker, status]) {
  if (element) {
    element.style.background = tokens.colorSurface;
    element.style.borderRadius = tokens.radius;
  }
}
if (marker) {
  marker.style.color = tokens.colorAccent;
}

function setStatus(text: string): void {
  if (status) {
    status.textContent = text;
  }
}

/**
 * Asynchronous because `createRenderer` may have to initialise WebGPU before
 * it can hand back a scene (ADR-0006).
 */
async function start(canvas: HTMLCanvasElement): Promise<void> {
  try {
    const { renderer, camera } = await createGameScene(canvas, { render: { resolutionScale: 1 } });
    setStatus(`renderer ready — ${renderer.backend}`);
    if (import.meta.env.DEV) {
      // Vite replaces the condition with `false` when building for production,
      // so Rollup drops this call and `./dev-debug.js` with it.
      installDevDebugBridge(renderer, marker, { camera });
    }
  } catch (error) {
    // A failing renderer must not hide the page: report it instead.
    setStatus(`renderer unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#render-canvas');
if (!canvas) {
  setStatus('no render canvas found');
} else {
  void start(canvas);
}
