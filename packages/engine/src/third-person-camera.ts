/**
 * The third-person camera of spec §26, bound to Babylon.js.
 *
 * Everything that decides *where* the camera goes is in
 * `./third-person-camera-math.ts`, and everything that decides *whether a
 * mouse movement counts* is in `./camera-input.ts`. What is left here is the
 * binding: keep the current state, read the target point through the getter
 * the app supplies, and copy the result onto a `TargetCamera` once per frame.
 *
 * The camera holds no gameplay state and writes nothing back (spec §25). It
 * follows a `Vector3` it is *shown*, which in Phase 1 is a placeholder capsule
 * and later the player entity's transform — the camera never learns which.
 *
 * Collision avoidance is an interface, not an implementation: pass a
 * {@link CameraObstacleQuery} and the camera stays in front of whatever the
 * query reports. The default is "nothing is ever in the way", so the behaviour
 * is honest until Havok arrives (spec §29).
 */
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Observer } from '@babylonjs/core/Misc/observable.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { createCameraLookInput } from './camera-input.js';
import type { CameraInputSink } from './camera-input.js';
import {
  createThirdPersonCameraState,
  noCameraObstacles,
  resolveThirdPersonCameraSettings,
  stepThirdPersonCamera,
} from './third-person-camera-math.js';
import type {
  CameraObstacleQuery,
  ResolvedThirdPersonCameraSettings,
  ThirdPersonCameraSettings,
  ThirdPersonCameraState,
  Vec3,
} from './third-person-camera-math.js';

export interface ThirdPersonCameraOptions extends ThirdPersonCameraSettings {
  /**
   * The point to follow, read fresh every frame. A getter rather than a mesh
   * so the camera cannot reach into gameplay: it sees a position, nothing else.
   */
  readonly target: () => Vector3;
  /** Node name in the scene. Default `third-person-camera`. */
  readonly name?: string;
  /** Update from `scene.onBeforeRenderObservable`. Default `true`. */
  readonly autoUpdate?: boolean;
  /** How long the last frame took. Defaults to the engine's own delta. */
  readonly deltaSeconds?: () => number;
  /** Collision avoidance. Default {@link noCameraObstacles}. */
  readonly obstacle?: CameraObstacleQuery;
  /** Look around while a mouse button is held, without pointer lock. */
  readonly dragLookFallback?: boolean;
}

export interface ThirdPersonCameraHandle {
  readonly camera: TargetCamera;
  readonly settings: ResolvedThirdPersonCameraSettings;
  /** The state the last {@link ThirdPersonCameraHandle.update} produced. */
  readonly state: ThirdPersonCameraState;
  /** `true` once disposed, by the caller or with the scene. */
  readonly disposed: boolean;
  /** Queues mouse movement in pixels; applied on the next update. */
  look(dx: number, dy: number): void;
  /** Queues normalised wheel ticks; positive pushes the camera out. */
  zoom(ticks: number): void;
  /** Advances the camera by `deltaSeconds` and writes it onto the node. */
  update(deltaSeconds: number): void;
  /** Swaps the collision query, e.g. once physics exists. */
  setObstacleQuery(query: CameraObstacleQuery): void;
  /** Wires pointer lock, drag-look and the wheel to a DOM element. */
  attachControl(host: HTMLElement): void;
  detachControl(): void;
  /** Detaches the input, stops the update and disposes the camera node. */
  dispose(): void;
}

/**
 * Babylon's default near plane is 1 m, which would clip the character exactly
 * when the camera is pushed close by a wall — the one moment it must not.
 */
const NEAR_PLANE = 0.1;

export function createThirdPersonCamera(
  scene: Scene,
  options: ThirdPersonCameraOptions,
): ThirdPersonCameraHandle {
  const settings = resolveThirdPersonCameraSettings(options);
  const readTarget = options.target;
  const readDelta = options.deltaSeconds ?? (() => scene.getEngine().getDeltaTime() / 1000);

  let state = createThirdPersonCameraState(settings, toVec3(readTarget()));
  let obstacle = options.obstacle ?? noCameraObstacles;
  let lookDx = 0;
  let lookDy = 0;
  let zoomTicks = 0;
  let detach: (() => void) | null = null;
  let beforeRender: Observer<Scene> | null = null;
  let disposed = false;

  const camera = new TargetCamera(
    options.name ?? 'third-person-camera',
    new Vector3(state.pivot[0], state.pivot[1], state.pivot[2]),
    scene,
  );
  camera.minZ = NEAR_PLANE;

  /** The queue the DOM input and the public methods both write into. */
  const sink: CameraInputSink = {
    look(dx, dy) {
      lookDx += dx;
      lookDy += dy;
    },
    zoom(ticks) {
      zoomTicks += ticks;
    },
  };

  function advance(deltaSeconds: number): void {
    const step = stepThirdPersonCamera(
      state,
      { target: toVec3(readTarget()), lookDx, lookDy, zoomTicks, deltaSeconds, obstacle },
      settings,
    );
    lookDx = 0;
    lookDy = 0;
    zoomTicks = 0;
    state = step.state;

    camera.position.set(step.position[0], step.position[1], step.position[2]);
    // Aimed by rotation rather than `setTarget`: yaw and pitch are what the
    // camera already knows, while `setTarget` recomputes them from a look-at
    // matrix and nudges `position.z` by an epsilon whenever camera and target
    // share a z. Babylon's yaw-pitch-roll gives the forward vector
    // `(sin y · cos x, −sin x, cos y · cos x)` — exactly the opposite of
    // `orbitDirection(yaw, pitch)`, so the camera looks back down its own orbit.
    camera.rotation.set(state.pitch, state.yaw, 0);
  }

  const handle: ThirdPersonCameraHandle = {
    camera,
    settings,
    get state() {
      return state;
    },
    get disposed() {
      return disposed;
    },
    look: sink.look,
    zoom: sink.zoom,
    update(deltaSeconds) {
      if (!disposed) {
        advance(deltaSeconds);
      }
    },
    setObstacleQuery(query) {
      obstacle = query;
    },
    attachControl(host) {
      handle.detachControl();
      const doc = host.ownerDocument;
      const view = doc.defaultView;
      const input = createCameraLookInput(sink, {
        dragLookFallback: options.dragLookFallback,
        requestPointerLock: () => {
          // A refused or interrupted request rejects in current browsers. That
          // is not an error here: the drag-look fallback covers it.
          const result: unknown = host.requestPointerLock();
          if (result instanceof Promise) {
            result.catch(() => undefined);
          }
        },
      });

      const onPointerDown = (event: PointerEvent): void => input.onPointerDown(event);
      const onPointerUp = (event: PointerEvent): void => input.onPointerUp(event);
      const onPointerMove = (event: PointerEvent): void => input.onPointerMove(event);
      const onWheel = (event: WheelEvent): void => {
        // Without this the page scrolls while the player zooms.
        event.preventDefault();
        input.onWheel(event);
      };
      const onLockChange = (): void => input.onPointerLockChange(doc.pointerLockElement === host);
      const onBlur = (): void => input.onBlur();

      host.addEventListener('pointerdown', onPointerDown);
      host.addEventListener('wheel', onWheel, { passive: false });
      // Movement and release listen on the document: while the button is held
      // the pointer routinely leaves the canvas, and a release out there still
      // has to end the drag.
      doc.addEventListener('pointerup', onPointerUp);
      doc.addEventListener('pointermove', onPointerMove);
      doc.addEventListener('pointerlockchange', onLockChange);
      view?.addEventListener('blur', onBlur);

      detach = (): void => {
        host.removeEventListener('pointerdown', onPointerDown);
        host.removeEventListener('wheel', onWheel);
        doc.removeEventListener('pointerup', onPointerUp);
        doc.removeEventListener('pointermove', onPointerMove);
        doc.removeEventListener('pointerlockchange', onLockChange);
        view?.removeEventListener('blur', onBlur);
      };
    },
    detachControl() {
      detach?.();
      detach = null;
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      handle.detachControl();
      if (beforeRender) {
        scene.onBeforeRenderObservable.remove(beforeRender);
        beforeRender = null;
      }
      camera.dispose();
    },
  };

  // Disposing the scene disposes the camera node, but not the listeners
  // `attachControl` put on the document: those would outlive the page's scene
  // and keep turning a camera nobody renders.
  scene.onDisposeObservable.addOnce(() => handle.dispose());

  if (options.autoUpdate ?? true) {
    // Before the render, not after it: a camera updated on a post-render hook
    // shows every frame the pose that belonged to the previous one.
    beforeRender = scene.onBeforeRenderObservable.add(() => handle.update(readDelta()));
  }

  // Frame the target immediately, so the first rendered frame is already the
  // shot the player is meant to see.
  advance(0);
  return handle;
}

function toVec3(value: Vector3): Vec3 {
  return [value.x, value.y, value.z];
}
