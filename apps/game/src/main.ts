/**
 * Game entry point (Phase 0).
 *
 * Renders an empty Babylon.js scene: camera, light, ground and a DOM marker.
 * No gameplay, no editor code — `apps/game` must never import `apps/editor` or
 * `@wov/editor-core` (spec §10, enforced by `pnpm lint:boundaries`).
 *
 * The marker is plain DOM and is shown even when WebGL is unavailable, so the
 * smoke test can tell "app served" apart from "renderer failed".
 */
import { tokens } from '@wov/ui';
import { createGameRenderer } from './scene.js';

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
    const renderer = await createGameRenderer(canvas, { resolutionScale: 1 });
    setStatus(`renderer ready — ${renderer.backend}`);
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
