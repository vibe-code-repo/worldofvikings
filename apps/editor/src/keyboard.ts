/**
 * Which element a keystroke belongs to.
 *
 * The editor listens for shortcuts on `window`, so every key pressed anywhere
 * in the shell reaches it — including the keys someone is typing into a field.
 * A field that takes text has to win: `z` in the world-name box is a letter,
 * not the undo tool.
 *
 * A checkbox is the counter-example, and it is why this is a module with a test
 * rather than a line in the shell. It is an `<input>`, but it takes no text: the
 * only key it consumes is the space bar. Counting it as a text field means the
 * ground panel's facets switch swallows the Ctrl+Z that should take it back,
 * because ticking a box leaves the focus on it — measured, in the smoke test
 * that drives that panel (ADR-0032).
 *
 * The predicate is written over a description of the focused element rather
 * than over the element itself, so it can be tested without a DOM.
 */

/** What the shell knows about the element a `keydown` came from. */
export interface FocusedElement {
  /** As the DOM reports it: upper case, e.g. `INPUT`. */
  readonly tagName: string;
  /** The effective `type` of an `<input>`, lower case; `undefined` otherwise. */
  readonly inputType?: string | undefined;
  /** `isContentEditable`. */
  readonly contentEditable: boolean;
}

/**
 * Input types that consume no text, so a shortcut may pass through them.
 *
 * The list is of the quiet types rather than of the text ones on purpose: an
 * input type nobody here knows then counts as text, which is also what a
 * browser does with one.
 */
const QUIET_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/**
 * Does this element consume the keystroke itself?
 *
 * True for text fields, text areas, selects and anything content-editable;
 * false for buttons, checkboxes, radios, ranges and the canvas.
 */
export function swallowsKeystrokes(element: FocusedElement | null): boolean {
  if (element === null) {
    return false;
  }
  if (element.contentEditable) {
    return true;
  }
  switch (element.tagName) {
    case 'TEXTAREA':
    case 'SELECT':
      return true;
    case 'INPUT':
      return !QUIET_INPUT_TYPES.has(element.inputType ?? 'text');
    default:
      return false;
  }
}

/** The same question, asked about a live event target. */
export function targetSwallowsKeystrokes(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return swallowsKeystrokes({
    tagName: target.tagName,
    inputType: target instanceof HTMLInputElement ? target.type : undefined,
    contentEditable: target.isContentEditable,
  });
}
