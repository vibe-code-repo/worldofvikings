/**
 * Key and mouse bindings as a table of data (ADR-0008).
 *
 * The table is deliberately a plain JSON-shaped array and not a `switch`
 * statement: a rebinding screen edits rows, a profile stores them, and a
 * gamepad later adds a third `device` without touching the code that reads
 * intent. Nothing in this module knows about the DOM — it maps a *source*
 * (a `KeyboardEvent.code`, a `MouseEvent.button`) to an *action*.
 */

/**
 * Every action the Phase 1 desktop controls can produce (spec §27).
 *
 * Movement is four separate actions rather than two axes so that a rebinding
 * row stays a single key: an axis row would have to name a direction anyway.
 * `@wov/gameplay` receives the axes, not these actions.
 */
export const INPUT_ACTIONS = [
  'moveForward',
  'moveBackward',
  'strafeLeft',
  'strafeRight',
  'sprint',
  'dodge',
  'interact',
  'attack',
  'block',
  'slot1',
  'slot2',
  'slot3',
  'slot4',
  'slot5',
] as const;

/** One of {@link INPUT_ACTIONS}. */
export type InputAction = (typeof INPUT_ACTIONS)[number];

const ACTION_SET: ReadonlySet<string> = new Set<string>(INPUT_ACTIONS);

/** Where a binding comes from. Layout-independent: `code`, never `key`. */
export type BindingSource =
  | {
      readonly device: 'keyboard';
      /** `KeyboardEvent.code` — physical position, so WASD stays WASD on AZERTY. */
      readonly code: string;
    }
  | {
      readonly device: 'mouse';
      /** `MouseEvent.button` — 0 left, 1 middle, 2 right. */
      readonly button: number;
    };

/** One row of the table. */
export interface InputBinding {
  readonly action: InputAction;
  readonly source: BindingSource;
}

/** The whole table. Several rows may name the same action. */
export type BindingTable = readonly InputBinding[];

/** A table turned into the lookups the adapter uses per event. */
export interface CompiledBindings {
  readonly keyboard: ReadonlyMap<string, InputAction>;
  readonly mouse: ReadonlyMap<number, InputAction>;
}

/**
 * The shipped defaults, exactly the desktop controls of spec §27.
 *
 * Arrow keys, the right Shift and the numeric keypad are extra rows, not extra
 * code — which is the point of the table.
 */
export const DEFAULT_BINDINGS: BindingTable = Object.freeze([
  { action: 'moveForward', source: { device: 'keyboard', code: 'KeyW' } },
  { action: 'moveForward', source: { device: 'keyboard', code: 'ArrowUp' } },
  { action: 'moveBackward', source: { device: 'keyboard', code: 'KeyS' } },
  { action: 'moveBackward', source: { device: 'keyboard', code: 'ArrowDown' } },
  { action: 'strafeLeft', source: { device: 'keyboard', code: 'KeyA' } },
  { action: 'strafeLeft', source: { device: 'keyboard', code: 'ArrowLeft' } },
  { action: 'strafeRight', source: { device: 'keyboard', code: 'KeyD' } },
  { action: 'strafeRight', source: { device: 'keyboard', code: 'ArrowRight' } },
  { action: 'sprint', source: { device: 'keyboard', code: 'ShiftLeft' } },
  { action: 'sprint', source: { device: 'keyboard', code: 'ShiftRight' } },
  { action: 'dodge', source: { device: 'keyboard', code: 'Space' } },
  { action: 'interact', source: { device: 'keyboard', code: 'KeyE' } },
  { action: 'attack', source: { device: 'mouse', button: 0 } },
  { action: 'block', source: { device: 'mouse', button: 2 } },
  { action: 'slot1', source: { device: 'keyboard', code: 'Digit1' } },
  { action: 'slot1', source: { device: 'keyboard', code: 'Numpad1' } },
  { action: 'slot2', source: { device: 'keyboard', code: 'Digit2' } },
  { action: 'slot2', source: { device: 'keyboard', code: 'Numpad2' } },
  { action: 'slot3', source: { device: 'keyboard', code: 'Digit3' } },
  { action: 'slot3', source: { device: 'keyboard', code: 'Numpad3' } },
  { action: 'slot4', source: { device: 'keyboard', code: 'Digit4' } },
  { action: 'slot4', source: { device: 'keyboard', code: 'Numpad4' } },
  { action: 'slot5', source: { device: 'keyboard', code: 'Digit5' } },
  { action: 'slot5', source: { device: 'keyboard', code: 'Numpad5' } },
] satisfies BindingTable);

function describeSource(source: BindingSource): string {
  return source.device === 'keyboard'
    ? `keyboard "${source.code}"`
    : `mouse button ${source.button}`;
}

function checkRow(row: InputBinding, index: number): void {
  const where = `binding ${index}`;

  if (!ACTION_SET.has(row.action)) {
    throw new Error(`compileBindings: ${where} names unknown action "${row.action}"`);
  }

  const source: BindingSource | undefined = row.source;
  if (source === null || typeof source !== 'object') {
    throw new Error(`compileBindings: ${where} has no source`);
  }

  if (source.device === 'keyboard') {
    if (typeof source.code !== 'string' || source.code.length === 0) {
      throw new Error(`compileBindings: ${where} has an empty keyboard code`);
    }
    return;
  }

  if (source.device === 'mouse') {
    if (!Number.isInteger(source.button) || source.button < 0) {
      throw new Error(
        `compileBindings: ${where} has an invalid mouse button "${String(source.button)}"`,
      );
    }
    return;
  }

  throw new Error(
    `compileBindings: ${where} names unknown device "${String((source as { device: unknown }).device)}"`,
  );
}

/**
 * Validates a table and turns it into per-device lookups.
 *
 * A table can arrive from a stored profile, so it is treated as external data
 * (agent rule 10): unknown actions, unknown devices and malformed sources
 * throw here rather than turning into a key that quietly does nothing.
 *
 * Binding one source to two actions is rejected as well. It is always a
 * mistake, and the alternative — last row wins — makes a broken table behave
 * differently depending on where the duplicate sits.
 */
export function compileBindings(table: BindingTable): CompiledBindings {
  const keyboard = new Map<string, InputAction>();
  const mouse = new Map<number, InputAction>();

  for (const [index, row] of table.entries()) {
    checkRow(row, index);

    if (row.source.device === 'keyboard') {
      const existing = keyboard.get(row.source.code);
      if (existing !== undefined) {
        throw new Error(
          `compileBindings: ${describeSource(row.source)} is bound to both "${existing}" and "${row.action}"`,
        );
      }
      keyboard.set(row.source.code, row.action);
    } else {
      const existing = mouse.get(row.source.button);
      if (existing !== undefined) {
        throw new Error(
          `compileBindings: ${describeSource(row.source)} is bound to both "${existing}" and "${row.action}"`,
        );
      }
      mouse.set(row.source.button, row.action);
    }
  }

  return { keyboard, mouse };
}

/**
 * Actions no row binds, in the order of {@link INPUT_ACTIONS}.
 *
 * A rebinding screen shows them as "unbound"; a test asserts the shipped table
 * leaves none, so a renamed action cannot silently unbind a feature.
 */
export function unboundActions(table: BindingTable): readonly InputAction[] {
  const bound = new Set<InputAction>(table.map((row) => row.action));
  return INPUT_ACTIONS.filter((action) => !bound.has(action));
}
