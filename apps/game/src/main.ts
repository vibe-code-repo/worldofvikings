/**
 * Game entry point (Phase 1).
 *
 * Renders a placeholder Babylon.js scene — camera, light, ground — plus the
 * first licensed asset loaded over the asset server, and a DOM marker per
 * concern. No gameplay, no editor code: `apps/game` must never import
 * `apps/editor` or `@wov/editor-core` (spec §10, enforced by
 * `pnpm lint:boundaries`).
 *
 * The markers are plain DOM and are shown even when WebGL is unavailable, so
 * the smoke test can tell "app served" apart from "renderer failed" apart from
 * "asset did not load".
 */
import { tokens } from '@wov/ui';
import { resolveRenderConfig } from '@wov/engine';
import { summarizePlacement } from '@wov/asset-system';
import type { AssetEnv } from '@wov/asset-system';
import { createScene } from './scene.js';
import { loadEnvironment } from './environment.js';

/**
 * The one environment variable the asset system reads, picked out explicitly.
 * `import.meta.env` carries Vite's own keys too, and handing the whole object
 * over would let a typo in `AssetEnv` pass unnoticed.
 */
const assetEnv: AssetEnv = { VITE_ASSET_URL: import.meta.env.VITE_ASSET_URL };

const marker = document.querySelector<HTMLElement>('[data-testid="game-marker"]');
const status = document.querySelector<HTMLElement>('[data-testid="game-status"]');
const assetStatus = document.querySelector<HTMLElement>('[data-testid="game-assets"]');

document.body.style.background = tokens.colorBackground;
document.body.style.color = tokens.colorText;
for (const element of [marker, status, assetStatus]) {
  if (element) {
    element.style.background = tokens.colorSurface;
    element.style.borderRadius = tokens.radius;
  }
}
if (marker) {
  marker.style.color = tokens.colorAccent;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function setStatus(text: string): void {
  if (status) {
    status.textContent = text;
  }
}

function setAssetStatus(text: string): void {
  if (assetStatus) {
    assetStatus.textContent = text;
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#render-canvas');
if (!canvas) {
  setStatus('no render canvas found');
  setAssetStatus('assets: no scene to load into');
} else {
  try {
    const config = resolveRenderConfig({ resolutionScale: 1 });
    const { engine, scene } = createScene(canvas, config);
    engine.runRenderLoop(() => scene.render());
    window.addEventListener('resize', () => engine.resize());
    setStatus(`renderer ready — ${engine.description ?? 'WebGL'}`);

    // Started after the render loop and never awaited by the bootstrap: a slow
    // model delays the barrel appearing, not the scene showing up (spec §38).
    void loadEnvironment(scene, assetEnv).then(
      (result) => {
        setAssetStatus(summarizePlacement(result));
        for (const failure of result.failures) {
          console.error(`asset "${failure.placement.asset}" could not be placed`, failure.error);
        }
      },
      (error: unknown) => {
        setAssetStatus(`assets: loader unavailable — ${describe(error)}`);
      },
    );
  } catch (error) {
    // A failing renderer must not hide the page: report it instead.
    setStatus(`renderer unavailable: ${describe(error)}`);
    setAssetStatus('assets: no renderer to load into');
  }
}
