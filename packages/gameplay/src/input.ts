import { clamp } from '@wov/shared';

/**
 * One frame of player intent, already free of devices.
 *
 * Derived from the desktop bindings of spec §27 — WASD, Shift, Space, E, LMB,
 * RMB — but expressed as axes and booleans so a gamepad or a replay file can
 * feed the same systems later. Nothing here knows about the DOM.
 *
 * Axes are camera-relative in the caller and world-relative here: the input
 * binding in `apps/game` rotates the raw WASD axes by the camera yaw before
 * handing them over. `moveX` is right-positive, `moveZ` is forward-positive.
 */
export interface InputState {
  /** Strafe axis in `[-1, 1]`, positive to the right. */
  readonly moveX: number;
  /** Forward axis in `[-1, 1]`, positive forward. */
  readonly moveZ: number;
  /** Shift — raises the speed cap by the sprint factor. */
  readonly sprint: boolean;
  /** Space — edge-triggered dodge, consumed by a later combat system. */
  readonly dodge: boolean;
  /** E — edge-triggered interaction. */
  readonly interact: boolean;
  /** LMB — light attack. */
  readonly attack: boolean;
  /** RMB — block / secondary action. */
  readonly block: boolean;
  /**
   * Quick slot triggered this tick: `1`…{@link QUICK_SLOT_COUNT}, or `0` for
   * none (spec §27, the number row).
   *
   * One number rather than five booleans, because a slot activation is
   * exclusive — pressing 1 and 2 within the same tick fires one skill, not two
   * — and the skill system this feeds will look up a slot index anyway. `0` is
   * the empty value, so the neutral state stays a record of zeroes and falses.
   */
  readonly slot: number;
}

/** How many quick slots the desktop bindings expose (spec §27: keys 1–5). */
export const QUICK_SLOT_COUNT = 5;

/** No movement, no action. The state an entity has before anything is pressed. */
export const NEUTRAL_INPUT: InputState = Object.freeze({
  moveX: 0,
  moveZ: 0,
  sprint: false,
  dodge: false,
  interact: false,
  attack: false,
  block: false,
  slot: 0,
});

/**
 * Field-by-field comparison.
 *
 * Systems use it to notice that an intent did not change and to hand back the
 * state object they were given — cheaper than a deep clone every frame.
 */
export function inputEquals(a: InputState, b: InputState): boolean {
  return (
    a.moveX === b.moveX &&
    a.moveZ === b.moveZ &&
    a.sprint === b.sprint &&
    a.dodge === b.dodge &&
    a.interact === b.interact &&
    a.attack === b.attack &&
    a.block === b.block &&
    a.slot === b.slot
  );
}

function axis(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`createInputState: ${name} must be finite, got ${value}`);
  }
  return clamp(value, -1, 1);
}

/**
 * Validates a quick slot.
 *
 * Unlike an axis this is not clamped: an out-of-range slot means a binding
 * table names a slot that does not exist, and quietly firing slot 5 instead of
 * the requested slot 9 would be a wrong skill at a wrong moment.
 */
function quickSlot(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > QUICK_SLOT_COUNT) {
    throw new RangeError(
      `createInputState: slot must be an integer in [0, ${QUICK_SLOT_COUNT}], got ${value}`,
    );
  }
  return value;
}

/**
 * Builds an {@link InputState}, clamping the axes into `[-1, 1]`.
 *
 * Clamping happens once, at the edge, so no system downstream has to defend
 * itself against a device that reports 1.4.
 */
export function createInputState(overrides: Partial<InputState> = {}): InputState {
  return {
    moveX: axis(overrides.moveX ?? 0, 'moveX'),
    moveZ: axis(overrides.moveZ ?? 0, 'moveZ'),
    sprint: overrides.sprint ?? false,
    dodge: overrides.dodge ?? false,
    interact: overrides.interact ?? false,
    attack: overrides.attack ?? false,
    block: overrides.block ?? false,
    slot: quickSlot(overrides.slot ?? 0),
  };
}
