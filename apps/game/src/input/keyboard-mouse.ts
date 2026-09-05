import { createInputBinder, type InputBinder } from './binder.js';
import { type BindingTable } from './bindings.js';

/**
 * The DOM half of the input adapter (ADR-0010).
 *
 * It translates browser events into {@link InputBinder} calls and owns pointer
 * lock. It holds no intent of its own — everything interesting lives in the
 * binder, which is why this file is thin and its test is about wiring
 * (listeners added, listeners removed, defaults suppressed) rather than about
 * gameplay.
 *
 * The DOM arrives through three narrow ports instead of the `window` and
 * `document` globals. `window`, `document` and an `HTMLCanvasElement` satisfy
 * them, and so does a stub of a few lines — that is what keeps this testable
 * without a simulated browser.
 */

/**
 * The `addEventListener` pair of any DOM event target.
 *
 * `window`, `document` and every element satisfy it, and so does a stub of a
 * few lines — which is the whole reason the DOM arrives as a parameter here
 * instead of being read off the globals.
 */
export interface DomEventSource {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

/** The element the game renders into: it can ask for pointer lock. */
export interface PointerLockSurface extends DomEventSource {
  requestPointerLock(): unknown;
}

/** The document: it reports who currently holds the pointer lock. */
export interface PointerLockOwner extends DomEventSource {
  readonly pointerLockElement: object | null;
}

/** What {@link attachKeyboardMouse} needs to be wired to. */
export interface KeyboardMouseOptions {
  /** Keyboard, mouse release and focus loss — normally `window`. */
  readonly keys: DomEventSource;
  /** Mouse press and context menu — normally the render canvas. */
  readonly pointer: PointerLockSurface;
  /** Pointer lock state — normally `document`. */
  readonly lockOwner: PointerLockOwner;
  /** Starting table; defaults to the shipped bindings. */
  readonly bindings?: BindingTable;
  /**
   * Whether this adapter reads mouse *movement* and asks for pointer lock.
   * Default `true`.
   *
   * The game client sets it to `false`: there the third-person camera brings
   * its own look input (ADR-0008), including a drag fallback for browsers that
   * refuse pointer lock, and two readers of the same `mousemove` would turn the
   * view twice as fast while two lock requests fight over the same canvas. Keys
   * and mouse buttons stay here either way, and so does releasing everything
   * when the lock is lost — Escape must not leave a key stuck down whoever owns
   * the look.
   */
  readonly ownsLook?: boolean;
}

/** A binder wired to a DOM, plus pointer lock and teardown. */
export interface KeyboardMouseAdapter extends InputBinder {
  /** Whether the render surface currently owns the mouse. */
  readonly pointerLocked: boolean;
  /** Removes every listener. Safe to call twice. */
  dispose(): void;
}

/**
 * The parts of a `KeyboardEvent` a binding needs.
 *
 * Declared structurally rather than as `KeyboardEvent` so a stub can produce
 * one: `instanceof` would be false for anything the tests build, and the two
 * members below are the entire dependency on the real class.
 *
 * `repeat` is deliberately absent. Auto-repeat is not filtered here — the
 * binder already ignores a press of a key it holds — and filtering it here
 * would skip the `preventDefault` the repeat still needs.
 */
interface KeyEventLike {
  readonly code: string;
  preventDefault(): void;
}

interface ButtonEventLike {
  readonly button: number;
}

interface MoveEventLike {
  readonly movementX: number;
  readonly movementY: number;
}

interface PreventableLike {
  preventDefault(): void;
}

/** Wires a binder to a DOM and returns it. */
export function attachKeyboardMouse(options: KeyboardMouseOptions): KeyboardMouseAdapter {
  const binder = createInputBinder(options.bindings);
  const { keys, pointer, lockOwner, ownsLook = true } = options;

  // Every registration is recorded so `dispose` can undo exactly what it did,
  // instead of a hand-maintained list that drifts as handlers are added.
  const registered: (() => void)[] = [];

  function on<E>(target: DomEventSource, type: string, handler: (event: E) => void): void {
    // The handlers below declare the few members they read (`KeyEventLike` and
    // friends) rather than the full `KeyboardEvent`, so that a stub can produce
    // one. That is the one place where the two views have to be reconciled, and
    // the per-event interfaces above are what keeps the reconciliation honest.
    const listener = handler as unknown as (event: Event) => void;
    target.addEventListener(type, listener);
    registered.push(() => {
      target.removeEventListener(type, listener);
    });
  }

  function isLocked(): boolean {
    return lockOwner.pointerLockElement !== null;
  }

  on<KeyEventLike>(keys, 'keydown', (event) => {
    if (!binder.bindsKey(event.code)) {
      // F5, the dev tools and every browser shortcut belong to the browser.
      // Only a key the game actually uses may have its default suppressed.
      return;
    }
    // Before the press, and on every auto-repeat too: Space scrolls the page
    // and the number row drives browser shortcuts, and the OS keeps sending
    // keydown for as long as the key is held. The binder ignores the repeated
    // press by itself, so only the default has to be dealt with here.
    event.preventDefault();
    binder.pressKey(event.code);
  });

  on<KeyEventLike>(keys, 'keyup', (event) => {
    binder.releaseKey(event.code);
  });

  on<ButtonEventLike>(pointer, 'mousedown', (event) => {
    binder.pressButton(event.button);
    if (ownsLook && !isLocked()) {
      requestLock();
    }
  });

  // Release is watched on the window, not on the canvas: a button pressed over
  // the canvas and released over the HUD would otherwise stay held for good.
  on<ButtonEventLike>(keys, 'mouseup', (event) => {
    binder.releaseButton(event.button);
  });

  on<PreventableLike>(pointer, 'contextmenu', (event) => {
    // The right mouse button blocks (spec §27); the context menu must not open.
    event.preventDefault();
  });

  if (ownsLook) {
    on<MoveEventLike>(keys, 'mousemove', (event) => {
      if (isLocked()) {
        binder.addLook(event.movementX, event.movementY);
      }
    });
  }

  on<unknown>(lockOwner, 'pointerlockchange', () => {
    if (!isLocked()) {
      // Escape leaves pointer lock and the pending keyup never arrives, so a
      // held key would keep the character running forever.
      binder.releaseAll();
    }
  });

  on<unknown>(keys, 'blur', () => {
    binder.releaseAll();
  });

  function requestLock(): void {
    try {
      const result = pointer.requestPointerLock();
      if (result instanceof Promise) {
        // Chrome rejects when the document is not focused. Losing the lock is
        // not an error worth crashing a frame over — the click that follows
        // asks again.
        result.catch(() => undefined);
      }
    } catch {
      // Older browsers throw synchronously instead of rejecting.
    }
  }

  return {
    ...binder,
    get pointerLocked(): boolean {
      return isLocked();
    },
    dispose(): void {
      for (const undo of registered.splice(0)) {
        undo();
      }
      binder.releaseAll();
    },
  };
}
