/**
 * Game entry point (Phase 1).
 *
 * Wiring only. Every piece it connects is tested on its own:
 *
 * ```text
 * DOM events → keyboard-mouse → binder → InputState
 *                                             ↓
 *                              MovementSystem (@wov/gameplay)
 *                                             ↓
 *                                        WorldState
 *                                             ↓
 *                        interpolatePosition → capsule mesh
 * ```
 *
 * The direction of that arrow is the rule: state flows into the renderer and
 * never back (spec §25, ADR-0007). No gameplay decision is made in this file,
 * and no editor code may reach it (spec §10, checked by `pnpm lint:boundaries`).
 */
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
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
  type Transform,
  type WorldState,
} from '@wov/gameplay';
import { resolveRenderConfig } from '@wov/engine';
import { tokens } from '@wov/ui';
import { attachKeyboardMouse } from './input/keyboard-mouse.js';
import { createGameLoop } from './loop.js';
import { interpolatePosition } from './render/interpolate.js';
import { PLAYER_HEIGHT, createScene } from './scene.js';

/** Radians of camera rotation per pixel of mouse movement. */
const LOOK_SENSITIVITY = 0.0025;

/** Keeps the orbit camera away from the poles, where it flips over. */
const MIN_PITCH = 0.15;
const MAX_PITCH = Math.PI / 2 - 0.05;

const PLAYER = toEntityId('player');

const marker = document.querySelector<HTMLElement>('[data-testid="game-marker"]');
const status = document.querySelector<HTMLElement>('[data-testid="game-status"]');
const controls = document.querySelector<HTMLElement>('[data-testid="game-controls"]');

document.body.style.background = tokens.colorBackground;
document.body.style.color = tokens.colorText;
for (const element of [marker, status, controls]) {
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

const canvas = document.querySelector<HTMLCanvasElement>('#render-canvas');
if (!canvas) {
  setStatus('no render canvas found');
} else {
  try {
    const config = resolveRenderConfig({ resolutionScale: 1 });
    const { engine, scene, camera, player } = createScene(canvas, config);

    // One entity, standing on the flat Phase 1 plane. Carrying an Input
    // component is what marks it as the entity the keys steer.
    let world: WorldState = createWorldState([
      {
        id: PLAYER,
        transform: createTransform(vec3(0, 0, 0)),
        movement: createMovement(),
        input: NEUTRAL_INPUT,
      },
    ]);

    const ground = flatGround(0);
    const input = attachKeyboardMouse({ keys: window, pointer: canvas, lockOwner: document });

    // The state the previous step ended in, kept so a frame between two steps
    // can be interpolated instead of snapped.
    let previous: Transform = getTransform(world, PLAYER) ?? createTransform();

    // Two vectors reused for the life of the client. `cameraYaw` runs sixty
    // times a second, and a fresh Vector3 per step is sixty allocations per
    // second for a number (spec §38).
    const localForward = Vector3.Forward();
    const worldForward = Vector3.Zero();

    const cameraYaw = (): number => {
      // The direction the camera looks, flattened onto the ground. Asking the
      // camera keeps this right when the camera type changes (spec §26).
      camera.getDirectionToRef(localForward, worldForward);
      return Math.atan2(worldForward.x, worldForward.z);
    };

    const loop = createGameLoop({
      scheduler: {
        request: (callback) => window.requestAnimationFrame(callback),
        cancel: (handle) => {
          window.cancelAnimationFrame(handle);
        },
      },

      step(fixedDelta) {
        previous = getTransform(world, PLAYER) ?? previous;
        // Sampling once per step is what consumes the edge-triggered actions:
        // a click fires in the first step of a frame and not again in the next.
        world = MovementSystem.update(world, input.sample(cameraYaw()), fixedDelta, ground);
      },

      render(alpha) {
        const look = input.takeLook();
        if (look.dx !== 0 || look.dy !== 0) {
          // Mouse to the right turns the view right; the orbit angle runs the
          // other way round.
          camera.alpha -= look.dx * LOOK_SENSITIVITY;
          camera.beta = Math.min(
            MAX_PITCH,
            Math.max(MIN_PITCH, camera.beta - look.dy * LOOK_SENSITIVITY),
          );
        }

        const current = getTransform(world, PLAYER);
        if (current) {
          const position = interpolatePosition(previous, current, alpha);
          // The gameplay transform sits at the feet, a Babylon capsule is
          // centred: the mesh stands half a body above what the state says.
          player.position.set(position.x, position.y + PLAYER_HEIGHT / 2, position.z);
        }

        scene.render();
      },
    });

    loop.start();
    window.addEventListener('resize', () => {
      engine.resize();
    });

    if (import.meta.env.DEV) {
      // A handle for the smoke test, which has to prove that the input adapter,
      // the loop and the renderer are wired to each other — something no unit
      // test can see. `import.meta.env.DEV` is a compile-time constant, so this
      // block is not in the production bundle.
      (globalThis as { __wovDebug?: unknown }).__wovDebug = { scene, camera, player };
    }

    setStatus(`renderer ready — ${engine.description ?? 'WebGL'} · simulation running at 60 Hz`);
  } catch (error) {
    // A failing renderer must not hide the page: report it instead.
    setStatus(`renderer unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}
