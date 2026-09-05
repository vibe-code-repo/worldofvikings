/**
 * Game entry point (Phase 1).
 *
 * Wiring only — every piece it connects is tested on its own:
 *
 * ```text
 * DOM events → keyboard-mouse → binder → InputState
 *                                             ↓
 *                              MovementSystem (@wov/gameplay)
 *                                             ↓
 *                                        WorldState
 *                                             ↓
 *                        interpolatePosition → placeholder capsule
 *                                             ↓
 *                              third-person camera (@wov/engine)
 * ```
 *
 * The direction of that arrow is the rule: state flows into the renderer and
 * never back (spec §25, ADR-0009). No gameplay decision is made in this file,
 * and no editor code may reach it (spec §10, checked by `pnpm lint:boundaries`).
 *
 * There is exactly **one** loop (ADR-0010): `createGameLoop` owns the frame,
 * runs the simulation on a fixed step and calls `renderer.renderFrame()` once
 * per frame. The renderer is therefore created with `autoStart: false` — a
 * second, engine-driven render loop would render frames the simulation never
 * saw.
 *
 * The environment probe is started next to the loop and never awaited by it: a
 * slow model delays the barrel appearing, not the player walking (spec §38).
 */
import {
  MovementSystem,
  NEUTRAL_INPUT,
  createMovement,
  createTransform,
  createWorldState,
  flatGround,
  getTransform,
  toEntityId,
  vec3,
  type GroundQuery,
  type Transform,
  type WorldState,
} from '@wov/gameplay';
import { summarizePlacement } from '@wov/asset-system';
import type { AssetEnv } from '@wov/asset-system';
import { tokens } from '@wov/ui';
import { installDevDebugBridge } from './dev-debug.js';
import { loadEnvironment } from './environment.js';
import { attachKeyboardMouse } from './input/keyboard-mouse.js';
import { createGameLoop } from './loop.js';
import { interpolatePosition } from './render/interpolate.js';
import { createGameScene } from './scene.js';

/** The one entity the keys steer in Phase 1. */
const PLAYER = toEntityId('player');

/**
 * The one environment variable the asset system reads, picked out explicitly.
 * `import.meta.env` carries Vite's own keys too, and handing the whole object
 * over would let a typo in `AssetEnv` pass unnoticed.
 */
const assetEnv: AssetEnv = { VITE_ASSET_URL: import.meta.env.VITE_ASSET_URL };

const marker = document.querySelector<HTMLElement>('[data-testid="game-marker"]');
const status = document.querySelector<HTMLElement>('[data-testid="game-status"]');
const controls = document.querySelector<HTMLElement>('[data-testid="game-controls"]');
const assetStatus = document.querySelector<HTMLElement>('[data-testid="game-assets"]');

document.body.style.background = tokens.colorBackground;
document.body.style.color = tokens.colorText;
for (const element of [marker, status, controls, assetStatus]) {
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

/**
 * Brings the client up.
 *
 * Asynchronous because `createRenderer` may have to initialise WebGPU before
 * it can hand back a scene (ADR-0006).
 */
async function start(canvas: HTMLCanvasElement): Promise<void> {
  const { renderer, camera, player } = await createGameScene(canvas, {
    // The game loop below drives the frames; see the module comment.
    render: { resolutionScale: 1, autoStart: false },
  });

  // The device edge (ADR-0010) owns keys and mouse buttons. Look and zoom stay
  // with the camera's own input (ADR-0008), which also carries the drag-look
  // fallback for browsers that refuse pointer lock — hence `ownsLook: false`,
  // so the mouse is not read twice and pointer lock is not requested twice.
  const input = attachKeyboardMouse({
    keys: window,
    pointer: canvas,
    lockOwner: document,
    ownsLook: false,
  });

  // One entity, standing on the Phase 1 plane. Carrying an Input component is
  // what marks it as the entity the keys steer.
  let world: WorldState = createWorldState([
    {
      id: PLAYER,
      transform: createTransform(vec3(0, 0, 0)),
      movement: createMovement(),
      // Present, not absent: the Input component is what tells the movement
      // system this entity follows the keys instead of coasting to a stop.
      input: NEUTRAL_INPUT,
    },
  ]);

  /** The ground the movement system adheres to. */
  const ground: GroundQuery = flatGround(0);

  // The state the previous step ended in, kept so a frame between two steps can
  // be interpolated instead of snapped.
  let previous: Transform = getTransform(world, PLAYER) ?? createTransform();

  const loop = createGameLoop({
    scheduler: {
      request: (callback) => window.requestAnimationFrame(callback),
      cancel: (handle) => {
        window.cancelAnimationFrame(handle);
      },
    },

    step(fixedDelta) {
      previous = getTransform(world, PLAYER) ?? previous;
      // Sampling once per step is what consumes the edge-triggered actions: a
      // click fires in the first step of a frame and not again in the next.
      // The camera's own yaw is the frame the axes are rotated into, so "W"
      // means "away from the camera" whichever way the player turned it.
      world = MovementSystem.update(world, input.sample(camera.state.yaw), fixedDelta, ground);
    },

    render(alpha) {
      const current = getTransform(world, PLAYER);
      if (current) {
        const position = interpolatePosition(previous, current, alpha);
        // The placeholder's root sits at the feet, exactly like the gameplay
        // transform, so the position is copied across without an offset.
        player.root.position.set(position.x, position.y, position.z);
      }
      // The camera updates on the scene's before-render hook, so it reads the
      // position written just above — this frame's, not the previous one's.
      renderer.renderFrame();
    },
  });

  loop.start();
  setStatus(`renderer ready — ${renderer.backend} · simulation 60 Hz`);

  if (import.meta.env.DEV) {
    // Vite replaces the condition with `false` when building for production,
    // so Rollup drops this call and `./dev-debug.js` with it.
    installDevDebugBridge(renderer, marker, { camera, player });
  }

  // Started after the loop and deliberately not awaited: a slow model delays
  // the barrel appearing, not the scene showing up (spec §38).
  void loadEnvironment(renderer.scene, assetEnv).then(
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
}

const canvas = document.querySelector<HTMLCanvasElement>('#render-canvas');
if (!canvas) {
  setStatus('no render canvas found');
  setAssetStatus('assets: no scene to load into');
} else {
  void start(canvas).catch((error: unknown) => {
    // A failing bootstrap must not hide the page: report it instead.
    setStatus(`renderer unavailable: ${describe(error)}`);
  });
}
