/**
 * The small state machine between raw mouse events and the camera.
 *
 * Deliberately free of the DOM: it takes plain `{ button }`,
 * `{ movementX, movementY }` and `{ deltaY, deltaMode }` records, so the rules
 * that decide *whether a movement counts* are testable without a browser. The
 * event wiring itself is twenty lines in `./third-person-camera.ts` and is
 * proved by `pnpm smoke`, not by a mock.
 *
 * The rules are not obvious, which is the reason they live in their own file:
 *
 * - Pointer lock needs a user gesture and can be refused. A camera that only
 *   turns while locked simply does not turn on those pages, with nothing on
 *   screen saying why — hence the held-button fallback.
 * - A release that lands in another window never reaches this page, so a drag
 *   has to be cancelled on blur as well as on pointer-up.
 * - The wheel works whether or not the player is looking around; zoom is not
 *   part of the look gesture.
 */
import { wheelTicks } from './third-person-camera-math.js';

/** What the decoded input drives — the camera handle satisfies this. */
export interface CameraInputSink {
  /** Mouse movement in pixels since the previous event. */
  look(dx: number, dy: number): void;
  /** Normalised wheel ticks; positive pushes the camera out. */
  zoom(ticks: number): void;
}

export interface CameraLookInputOptions {
  /**
   * Asks the browser for pointer lock. Called on the first press only; the
   * caller supplies it because only it knows which element is being locked.
   */
  readonly requestPointerLock?: (() => void) | undefined;
  /** Mouse button that starts a look. Default `0` (primary). */
  readonly lookButton?: number | undefined;
  /** Look around while the button is held even without pointer lock. */
  readonly dragLookFallback?: boolean | undefined;
}

/** The mouse-button fields this module reads. */
export interface CameraButtonEvent {
  readonly button: number;
}

/** The relative-movement fields this module reads. */
export interface CameraMoveEvent {
  readonly movementX: number;
  readonly movementY: number;
}

/** The wheel fields this module reads. */
export interface CameraWheelEvent {
  readonly deltaY: number;
  readonly deltaMode?: number | undefined;
}

/** Handlers to hang on the real events, plus what they currently believe. */
export interface CameraLookInput {
  onPointerDown(event: CameraButtonEvent): void;
  onPointerUp(event: CameraButtonEvent): void;
  onPointerMove(event: CameraMoveEvent): void;
  onWheel(event: CameraWheelEvent): void;
  /** Call from `pointerlockchange` with whether *this* element is locked. */
  onPointerLockChange(locked: boolean): void;
  /** Call when the window loses focus, so a drag cannot get stuck on. */
  onBlur(): void;
  /** `true` while mouse movement is being turned into camera rotation. */
  isLooking(): boolean;
}

export function createCameraLookInput(
  sink: CameraInputSink,
  options: CameraLookInputOptions = {},
): CameraLookInput {
  const lookButton = options.lookButton ?? 0;
  const dragLookFallback = options.dragLookFallback ?? true;
  const requestPointerLock = options.requestPointerLock;

  let locked = false;
  let dragging = false;

  const isLooking = (): boolean => locked || (dragging && dragLookFallback);

  return {
    onPointerDown(event) {
      if (event.button !== lookButton) {
        return;
      }
      dragging = true;
      if (!locked) {
        requestPointerLock?.();
      }
    },
    onPointerUp(event) {
      if (event.button === lookButton) {
        dragging = false;
      }
    },
    onPointerMove(event) {
      if (!isLooking()) {
        return;
      }
      sink.look(event.movementX, event.movementY);
    },
    onWheel(event) {
      sink.zoom(wheelTicks(event.deltaY, event.deltaMode ?? 0));
    },
    onPointerLockChange(value) {
      locked = value;
    },
    onBlur() {
      dragging = false;
    },
    isLooking,
  };
}
