import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Scene } from '@babylonjs/core/scene.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createThirdPersonCamera } from './third-person-camera.js';
import type { ThirdPersonCameraHandle } from './third-person-camera.js';
import type { CameraObstacleQuery } from './third-person-camera-math.js';

const scenes: Scene[] = [];

/** A NullEngine runs the real Babylon camera without a GPU or a DOM. */
function scene(): Scene {
  const engine = new NullEngine({
    renderWidth: 64,
    renderHeight: 64,
    textureSize: 64,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });
  const created = new Scene(engine);
  scenes.push(created);
  return created;
}

afterEach(() => {
  for (const created of scenes.splice(0)) {
    const engine = created.getEngine();
    created.dispose();
    engine.dispose();
  }
});

const FRAME = 1 / 60;

/**
 * Where the camera node actually looks, taken out of the computed view matrix
 * rather than out of the numbers that produced it.
 *
 * This is the one assertion that catches a wrong rotation convention: the maths
 * module can be perfectly right about yaw and pitch while the binding aims the
 * Babylon camera somewhere else entirely, and no unit test of the maths would
 * ever notice.
 */
function aimPoint(handle: ThirdPersonCameraHandle): Vector3 {
  const camera = handle.camera;
  camera.getViewMatrix(true);
  const forward = camera.getTarget().subtract(camera.position).normalize();
  return camera.position.add(forward.scale(handle.state.distance));
}

function pivotOf(handle: ThirdPersonCameraHandle): Vector3 {
  return new Vector3(handle.state.pivot[0], handle.state.pivot[1], handle.state.pivot[2]);
}

describe('createThirdPersonCamera', () => {
  it('becomes the active camera and opens behind and above its target', () => {
    const host = scene();
    const target = new Vector3(4, 0, 4);
    const handle = createThirdPersonCamera(host, { target: () => target });

    expect(host.activeCamera).toBe(handle.camera);
    expect(handle.camera.position.y).toBeGreaterThan(target.y);
    expect(handle.camera.position.z).toBeLessThan(target.z);
    expect(Vector3.Distance(handle.camera.position, pivotOf(handle))).toBeCloseTo(
      handle.settings.distance,
      6,
    );
  });

  it('aims the Babylon camera at the pivot it computed', () => {
    const handle = createThirdPersonCamera(scene(), { target: () => new Vector3(2, 0, -3) });
    expect(Vector3.Distance(aimPoint(handle), pivotOf(handle))).toBeLessThan(1e-4);

    handle.look(400, 120);
    handle.update(FRAME);
    expect(Vector3.Distance(aimPoint(handle), pivotOf(handle))).toBeLessThan(1e-4);
  });

  /**
   * The near plane defaults to 1 m in Babylon. A camera that may legitimately
   * sit 0.8 m from the pivot in a corridor would then clip the character it is
   * supposed to be filming — and only ever in the corridor.
   */
  it('keeps a near plane that survives the closest allowed distance', () => {
    const handle = createThirdPersonCamera(scene(), { target: () => Vector3.Zero() });
    expect(handle.camera.minZ).toBeLessThan(handle.settings.minObstructedDistance);
  });

  it('reads the target getter afresh on every update', () => {
    const target = new Vector3(0, 0, 0);
    const handle = createThirdPersonCamera(scene(), {
      target: () => target,
      followSmoothing: 0,
    });

    target.set(0, 0, 20);
    handle.update(FRAME);

    expect(handle.state.pivot[2]).toBeCloseTo(20, 6);
    expect(Vector3.Distance(aimPoint(handle), pivotOf(handle))).toBeLessThan(1e-4);
  });

  it('applies queued mouse movement once and then forgets it', () => {
    const handle = createThirdPersonCamera(scene(), { target: () => Vector3.Zero() });

    handle.look(200, 0);
    handle.update(FRAME);
    const turned = handle.state.yaw;
    expect(turned).toBeCloseTo(200 * handle.settings.yawSensitivity, 12);

    handle.update(FRAME);
    expect(handle.state.yaw).toBe(turned);
  });

  it('zooms out on positive wheel ticks, inside the configured range', () => {
    const handle = createThirdPersonCamera(scene(), { target: () => Vector3.Zero() });

    handle.zoom(1);
    handle.update(FRAME);
    expect(handle.state.desiredDistance).toBeCloseTo(
      handle.settings.distance + handle.settings.zoomStep,
      12,
    );

    handle.zoom(1000);
    handle.update(FRAME);
    expect(handle.state.desiredDistance).toBe(handle.settings.maxDistance);
  });

  it('pulls in front of an obstacle the query reports', () => {
    const handle = createThirdPersonCamera(scene(), { target: () => Vector3.Zero() });
    const wall: CameraObstacleQuery = () => 2.5;

    handle.update(FRAME);
    const open = handle.state.distance;
    handle.setObstacleQuery(wall);
    handle.update(FRAME);

    expect(handle.state.distance).toBeLessThan(open);
    expect(handle.state.distance).toBeCloseTo(2.5 - handle.settings.obstaclePadding, 12);
    expect(Vector3.Distance(handle.camera.position, pivotOf(handle))).toBeCloseTo(
      handle.state.distance,
      6,
    );
  });

  /**
   * The camera has to move before the frame it belongs to is drawn, so it runs
   * on `onBeforeRenderObservable` rather than on a hook that fires after
   * `scene.render()` — that would show every pose one frame late. The delta is
   * injected because a `NullEngine` outside a render loop reports none; the
   * engine's own delta is what `pnpm smoke` exercises.
   */
  it('updates itself before each render, and stops when disposed', () => {
    const host = scene();
    const target = new Vector3(0, 0, 0);
    const handle = createThirdPersonCamera(host, {
      target: () => target,
      deltaSeconds: () => FRAME,
      followSmoothing: 0.2,
    });

    target.set(0, 0, 30);
    host.render();
    const followed = handle.state.pivot[2];
    expect(followed).toBeGreaterThan(0);
    expect(followed).toBeLessThan(30);

    // A spare camera so the scene can still be rendered afterwards: Babylon
    // throws "No camera defined" on a scene without one, which would hide
    // whether the observer is really gone.
    const spare = new TargetCamera('spare', Vector3.Zero(), host);
    handle.dispose();
    host.render();

    expect(handle.state.pivot[2]).toBe(followed);
    expect(host.cameras).not.toContain(handle.camera);
    expect(host.activeCamera).toBe(spare);
  });

  /**
   * `attachControl` hangs listeners on the document, which the scene knows
   * nothing about. Disposing the scene without taking them down leaves a camera
   * nobody renders reacting to every mouse move on the page.
   */
  it('goes down with the scene it was created in', () => {
    const host = scene();
    const handle = createThirdPersonCamera(host, { target: () => Vector3.Zero() });

    expect(handle.disposed).toBe(false);
    host.dispose();
    expect(handle.disposed).toBe(true);
  });

  it('can be driven by the caller instead', () => {
    const host = scene();
    const target = new Vector3(0, 0, 0);
    const handle = createThirdPersonCamera(host, {
      target: () => target,
      autoUpdate: false,
      followSmoothing: 0,
    });

    target.set(0, 0, 8);
    host.render();
    expect(handle.state.pivot[2]).toBe(0);

    handle.update(FRAME);
    expect(handle.state.pivot[2]).toBeCloseTo(8, 6);
  });

  it('rejects a malformed setting instead of framing something unwatchable', () => {
    expect(() =>
      createThirdPersonCamera(scene(), { target: () => Vector3.Zero(), maxPitch: 2 }),
    ).toThrow(/maxPitch/);
  });
});
