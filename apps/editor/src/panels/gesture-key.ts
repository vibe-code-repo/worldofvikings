/**
 * One drag, one undo step — and two drags, two.
 *
 * A slider fires an `input` event per pixel, and the history folds consecutive
 * entries that carry the same `coalesceKey` into one, so a drag from 0.1 to 1.0
 * is one entry instead of fifty (`execute` in `@wov/editor-core`). The key used
 * to be the control's own test id, which is a constant — so two *separate*
 * drags of the same dial were also consecutive entries with the same key, and
 * folded into each other. Measured on the ground panel: drag Smoothness up to
 * 1.0, release, drag it back down to 0, release, press Ctrl+Z once, and the
 * value jumps to 0.1 — the world file's own number, from before the first drag.
 * The value the first gesture settled on was never in the history at all.
 *
 * So the key names the gesture, not the control: `<control>#<n>`, where `n`
 * counts the gestures that control has seen. A gesture begins when the pointer
 * goes down on it or when a key is pressed on it, which are the two ways a
 * person starts changing one, and it needs no end — the next beginning is the
 * end of the last. Holding an arrow key is one gesture; pressing it five times
 * is five, which is what an author who nudges a value five times expects.
 *
 * Free of React and of the DOM, so the counting can be held still by a test;
 * the panels only have to say when a gesture starts.
 */

/** The gesture keys of one editor session. */
export interface GestureKeys {
  /**
   * A new gesture is starting on this control.
   *
   * Called on `pointerdown` and on a key press that is not an auto-repeat.
   * Deliberately not on `focus`: a mouse press on a range input fires focus
   * *between* its own `input` events, which split one drag into two undo
   * entries — measured, before the key was moved off the constant test id.
   */
  begin(control: string): void;
  /** The key of the gesture currently running on this control. */
  key(control: string): string;
}

export function createGestureKeys(): GestureKeys {
  const generations = new Map<string, number>();
  return {
    begin(control) {
      generations.set(control, (generations.get(control) ?? 0) + 1);
    },
    key(control) {
      return `${control}#${String(generations.get(control) ?? 0)}`;
    },
  };
}

/**
 * The editor's own set.
 *
 * One per page rather than one per panel: a key is only ever compared with the
 * key of the entry before it, and every key already carries the control it
 * belongs to, so two panels sharing a counter cannot collide. The alternative —
 * threading an instance through every schema-driven field — is plumbing for a
 * distinction that does not exist.
 */
const shared = createGestureKeys();

/** A new gesture is starting on this control (`pointerdown` or `focus`). */
export function beginGesture(control: string): void {
  shared.begin(control);
}

/** The key of the gesture currently running on this control. */
export function gestureKey(control: string): string {
  return shared.key(control);
}
