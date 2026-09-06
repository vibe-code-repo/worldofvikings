/**
 * The Babylon binding for the editor camera.
 *
 * It reads pointer, wheel and key events and writes the results of
 * `editor-camera-math.ts` onto an `ArcRotateCamera`. Every rule lives in the
 * arithmetic module; this file owns only the device edge.
 *
 * The button layout resolves the one real conflict in spec §14: `W`, `E` and
 * `R` are gizmo shortcuts *and* flying keys. They fly only while the right
 * mouse button is held — a common editor convention — so a keystroke is never
 * ambiguous, and the tool shortcuts keep working with the mouse at rest.
 *
 * - right button drag: orbit; `WASD` flies, `Q`/`E` drop and lift, `Shift` runs
 * - middle button drag (or `Shift` + right button): pan
 * - wheel: dolly
 * - `F`: frame the selection — driven from the shell, see {@link EditorCamera.focus}
 */
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import {
  CAMERA_FOV,
  defaultOrbitState,
  dollyBy,
  flyBy,
  focusOn,
  noFly,
  orbitBy,
  panBy,
  type Bounds,
  type FlyInput,
  type OrbitState,
} from './editor-camera-math.js';

/** The mouse buttons this controller reacts to, in DOM numbering. */
const MIDDLE_BUTTON = 1;
const RIGHT_BUTTON = 2;

/** Which fly key each `KeyboardEvent.code` drives. */
const FLY_KEYS: Readonly<Record<string, keyof FlyInput>> = {
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
  KeyE: 'up',
  KeyQ: 'down',
};

export interface EditorCamera {
  readonly camera: ArcRotateCamera;
  /** The orbit state the last frame was rendered with. */
  state(): OrbitState;
  /** Advances flying. The viewport calls this once per frame. */
  update(seconds: number): void;
  /** Moves the camera to frame a box, keeping the current view direction. */
  focus(bounds: Bounds): void;
  /** True while a camera gesture owns the mouse, so picking must stand back. */
  isNavigating(): boolean;
  dispose(): void;
}

/**
 * Creates the camera and wires it to `canvas`.
 *
 * Deliberately *not* `camera.attachControl`: Babylon's built-in inputs claim
 * the left mouse button for orbiting, and the left button is what selects and
 * drags gizmos in an editor.
 */
export function createEditorCamera(scene: Scene, canvas: HTMLCanvasElement): EditorCamera {
  let state: OrbitState = defaultOrbitState;
  let fly: FlyInput = noFly;
  let gesture: 'none' | 'orbit' | 'pan' = 'none';
  let pointerId: number | null = null;
  let lastX = 0;
  let lastY = 0;

  const camera = new ArcRotateCamera(
    'editor-camera',
    state.alpha,
    state.beta,
    state.radius,
    new Vector3(...state.target),
    scene,
  );
  camera.fov = CAMERA_FOV;
  camera.minZ = 0.1;
  camera.maxZ = 5000;

  const apply = (next: OrbitState): void => {
    state = next;
    camera.alpha = next.alpha;
    camera.beta = next.beta;
    camera.radius = next.radius;
    camera.target.set(next.target[0], next.target[1], next.target[2]);
  };
  apply(state);

  const onPointerDown = (event: PointerEvent): void => {
    const wantsPan =
      event.button === MIDDLE_BUTTON || (event.button === RIGHT_BUTTON && event.shiftKey);
    if (wantsPan) {
      gesture = 'pan';
    } else if (event.button === RIGHT_BUTTON) {
      gesture = 'orbit';
    } else {
      return;
    }
    pointerId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
    // Without this the middle button scrolls and the right button opens the
    // context menu over the viewport.
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (gesture === 'none' || event.pointerId !== pointerId) {
      return;
    }
    const deltaX = event.clientX - lastX;
    const deltaY = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    apply(
      gesture === 'orbit'
        ? orbitBy(state, deltaX, deltaY)
        : panBy(state, deltaX, deltaY, canvas.clientHeight),
    );
  };

  const endGesture = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) {
      return;
    }
    gesture = 'none';
    pointerId = null;
    fly = noFly;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    apply(dollyBy(state, event.deltaY));
  };

  const onContextMenu = (event: MouseEvent): void => event.preventDefault();

  const setFlyKey = (event: KeyboardEvent, held: boolean): void => {
    // Flying is a mouse-button mode; outside it the same keys are tool
    // shortcuts and must reach the shell untouched.
    if (gesture !== 'orbit') {
      return;
    }
    const key = FLY_KEYS[event.code];
    if (key !== undefined) {
      fly = { ...fly, [key]: held };
      event.preventDefault();
    }
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
      fly = { ...fly, fast: held };
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => setFlyKey(event, true);
  const onKeyUp = (event: KeyboardEvent): void => setFlyKey(event, false);
  // A camera that keeps flying after the tab loses focus is a camera that comes
  // back somewhere else entirely.
  const onBlur = (): void => {
    fly = noFly;
    gesture = 'none';
    pointerId = null;
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', endGesture);
  canvas.addEventListener('pointercancel', endGesture);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return {
    camera,
    state: () => state,
    update(seconds) {
      const flown = flyBy(state, fly, seconds);
      if (flown !== state) {
        apply(flown);
      }
    },
    focus(bounds) {
      apply(focusOn(state, bounds));
    },
    isNavigating: () => gesture !== 'none',
    dispose() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endGesture);
      canvas.removeEventListener('pointercancel', endGesture);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      camera.dispose();
    },
  };
}
