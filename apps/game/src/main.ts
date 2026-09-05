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
import type { Scene } from '@babylonjs/core/scene';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { tokens } from '@wov/ui';
import { resolveRenderConfig } from '@wov/engine';
import { createScene } from './scene.js';
import { createGamePhysicsWorld, toStaticMeshData } from './physics-backend.js';

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
 * Brings the physics world up and proves it is simulating (spec §29).
 *
 * Nothing here mentions Havok: the backend is loaded lazily behind
 * `createGamePhysicsWorld` (ADR-0008), and everything below talks to the
 * `PhysicsWorld` contract. There is no player yet — this drops one capsule onto
 * the placeholder ground and reports where it came to rest, so "physics runs in
 * the browser" is something the smoke test can read instead of something we
 * claim.
 */
async function startPhysics(scene: Scene, ground: AbstractMesh, renderer: string): Promise<void> {
  try {
    const world = await createGamePhysicsWorld(scene);
    world.addStaticMesh(toStaticMeshData(ground));
    const character = world.createCharacterController({ position: { x: 0, y: 6, z: 0 } });

    let settledReported = false;
    scene.onBeforeRenderObservable.add(() => {
      world.step(scene.getEngine().getDeltaTime() / 1000);
      if (!settledReported && character.isGrounded()) {
        settledReported = true;
        const height = character.getPosition().y.toFixed(2);
        setStatus(`renderer ready — ${renderer}; physics ready — capsule resting at y=${height}`);
      }
    });
  } catch (error) {
    setStatus(
      `renderer ready — ${renderer}; physics unavailable: ` +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#render-canvas');
if (!canvas) {
  setStatus('no render canvas found');
} else {
  try {
    const config = resolveRenderConfig({ resolutionScale: 1 });
    const { engine, scene, ground } = createScene(canvas, config);
    engine.runRenderLoop(() => scene.render());
    window.addEventListener('resize', () => engine.resize());
    setStatus(`renderer ready — ${engine.description ?? 'WebGL'}`);
    void startPhysics(scene, ground, engine.description ?? 'WebGL');
  } catch (error) {
    // A failing renderer must not hide the page: report it instead.
    setStatus(`renderer unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}
