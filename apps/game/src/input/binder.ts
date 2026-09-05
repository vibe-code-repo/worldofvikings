import { createInputState, horizontalLength, type InputState } from '@wov/gameplay';
import {
  DEFAULT_BINDINGS,
  compileBindings,
  type BindingTable,
  type CompiledBindings,
  type InputAction,
} from './bindings.js';

/**
 * The device-free half of the input adapter (ADR-0008).
 *
 * It knows presses, releases and the binding table, and turns them into the
 * `InputState` of `@wov/gameplay`. It does *not* know the DOM: `keyboard-mouse.ts`
 * translates browser events into these calls, and a gamepad or a replay file
 * could call the same methods. That split is why the interesting behaviour —
 * edge triggers, diagonals, camera-relative axes, rebinding — is testable with
 * plain function calls and no DOM at all.
 */

/** Mouse movement collected since the last read, in raw device pixels. */
export interface LookDelta {
  readonly dx: number;
  readonly dy: number;
}

/** Turns presses into intent. */
export interface InputBinder {
  /** A physical key went down. `code`, not `key`: layout-independent. */
  pressKey(code: string): void;
  /** A physical key came up. */
  releaseKey(code: string): void;
  /** A mouse button went down. */
  pressButton(button: number): void;
  /** A mouse button came up. */
  releaseButton(button: number): void;
  /** Forgets every held source and every pending edge (focus or lock lost). */
  releaseAll(): void;
  /** Adds mouse movement to the pending look delta. */
  addLook(dx: number, dy: number): void;
  /** Returns the accumulated look delta and starts a new one. */
  takeLook(): LookDelta;
  /**
   * The intent of this tick, with the movement axes rotated into the camera
   * frame by `cameraYaw` (radians, the yaw the camera looks along).
   *
   * Sampling *consumes* the edge-triggered actions, so call it once per
   * simulation step. Whether the source is still held does not matter to them.
   */
  sample(cameraYaw: number): InputState;
  /** Replaces the whole table. Throws — and changes nothing — on a bad table. */
  rebind(table: BindingTable): void;
  /**
   * Whether the current table binds this key at all.
   *
   * The DOM layer asks before it suppresses a browser default: a key the game
   * ignores must keep working as the browser intends.
   */
  bindsKey(code: string): boolean;
}

/** Whether an action is reported while held, or once per press. */
const EDGE_TRIGGERED: ReadonlySet<InputAction> = new Set<InputAction>([
  'dodge',
  'interact',
  'attack',
  'slot1',
  'slot2',
  'slot3',
  'slot4',
  'slot5',
]);

/** Slot number of a `slotN` action, or 0. */
function slotOf(action: InputAction): number {
  return action.startsWith('slot') ? Number(action.slice(4)) : 0;
}

/** True while `action` is bound to something currently held. */
function isHeld(
  action: InputAction,
  compiled: CompiledBindings,
  keys: ReadonlySet<string>,
  buttons: ReadonlySet<number>,
): boolean {
  for (const code of keys) {
    if (compiled.keyboard.get(code) === action) {
      return true;
    }
  }
  for (const button of buttons) {
    if (compiled.mouse.get(button) === action) {
      return true;
    }
  }
  return false;
}

/** Creates a binder over `table`, the shipped defaults by default. */
export function createInputBinder(table: BindingTable = DEFAULT_BINDINGS): InputBinder {
  let compiled = compileBindings(table);

  // Held state is keyed by the physical source, not by the action it currently
  // means. Rebinding while a key is down therefore resolves to the new action
  // instead of leaving the old one stuck on.
  const heldKeys = new Set<string>();
  const heldButtons = new Set<number>();

  // Edge triggers are collected in press order and cleared by `sample`, so a
  // click that begins and ends between two steps is still seen exactly once.
  let edges: InputAction[] = [];

  let lookX = 0;
  let lookY = 0;

  function armEdge(action: InputAction | undefined): void {
    if (action !== undefined && EDGE_TRIGGERED.has(action)) {
      edges.push(action);
    }
  }

  return {
    pressKey(code: string): void {
      if (heldKeys.has(code)) {
        return;
      }
      heldKeys.add(code);
      armEdge(compiled.keyboard.get(code));
    },

    releaseKey(code: string): void {
      heldKeys.delete(code);
    },

    pressButton(button: number): void {
      if (heldButtons.has(button)) {
        return;
      }
      heldButtons.add(button);
      armEdge(compiled.mouse.get(button));
    },

    releaseButton(button: number): void {
      heldButtons.delete(button);
    },

    releaseAll(): void {
      heldKeys.clear();
      heldButtons.clear();
      // Pending edges go too: a dodge queued just before the window lost focus
      // must not fire when the player comes back.
      edges = [];
      lookX = 0;
      lookY = 0;
    },

    addLook(dx: number, dy: number): void {
      lookX += dx;
      lookY += dy;
    },

    takeLook(): LookDelta {
      const delta = { dx: lookX, dy: lookY };
      lookX = 0;
      lookY = 0;
      return delta;
    },

    sample(cameraYaw: number): InputState {
      const held = (action: InputAction): boolean =>
        isHeld(action, compiled, heldKeys, heldButtons);

      // Opposing keys cancel: pressing W and S is standing still, not the last
      // key winning, which would depend on the order the keyboard reported.
      let rawX = (held('strafeRight') ? 1 : 0) - (held('strafeLeft') ? 1 : 0);
      let rawZ = (held('moveForward') ? 1 : 0) - (held('moveBackward') ? 1 : 0);

      // Normalise *before* rotating. The axes are clamped to [-1, 1] downstream,
      // so a rotated diagonal of length 1.41 would lose one component and point
      // somewhere the player did not aim.
      const length = horizontalLength(rawX, rawZ);
      if (length > 1) {
        rawX /= length;
        rawZ /= length;
      }

      // Left-handed Y-up (Babylon): a yaw of θ takes +z to (sin θ, cos θ).
      const sin = Math.sin(cameraYaw);
      const cos = Math.cos(cameraYaw);

      let slot = 0;
      let dodge = false;
      let interact = false;
      let attack = false;
      for (const action of edges) {
        switch (action) {
          case 'dodge':
            dodge = true;
            break;
          case 'interact':
            interact = true;
            break;
          case 'attack':
            attack = true;
            break;
          default: {
            // A slot is exclusive, so the last one pressed in this tick wins.
            const pressed = slotOf(action);
            if (pressed > 0) {
              slot = pressed;
            }
          }
        }
      }
      edges = [];

      return createInputState({
        moveX: rawX * cos + rawZ * sin,
        moveZ: rawZ * cos - rawX * sin,
        sprint: held('sprint'),
        block: held('block'),
        dodge,
        interact,
        attack,
        slot,
      });
    },

    rebind(next: BindingTable): void {
      // Compile first: a table that throws leaves the working one in place.
      compiled = compileBindings(next);
    },

    bindsKey(code: string): boolean {
      return compiled.keyboard.has(code);
    },
  };
}
