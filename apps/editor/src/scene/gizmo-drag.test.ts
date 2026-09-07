/**
 * The deferral that keeps a drag finishable (see `gizmo-drag.ts`).
 *
 * Every case here is a thing an author can do with the mouse still down.
 */
import { describe, expect, it } from 'vitest';
import {
  beganDrag,
  endedDrag,
  isDragging,
  noGizmoDrag,
  wantAttachment,
  type GizmoDragState,
} from './gizmo-drag.js';

/** Stand-ins for `TransformNode`; the module never looks inside them. */
const barrel = { name: 'barrel' };
const bush = { name: 'bush' };

type State = GizmoDragState<typeof barrel>;

/** Selected the barrel with the move tool, nothing dragged yet. */
function ready(): State {
  return wantAttachment(noGizmoDrag<typeof barrel>(), { tool: 'move', node: barrel });
}

describe('what the handles show while nothing is being dragged', () => {
  it('shows nothing until something is selected', () => {
    const state = noGizmoDrag<typeof barrel>();
    expect(state.shown).toEqual({ tool: 'select', node: null });
    expect(isDragging(state)).toBe(false);
  });

  it('applies a tool change at once', () => {
    const state = wantAttachment(ready(), { tool: 'rotate', node: barrel });
    expect(state.shown).toEqual({ tool: 'rotate', node: barrel });
  });

  it('applies a selection change at once', () => {
    const state = wantAttachment(ready(), { tool: 'move', node: null });
    expect(state.shown.node).toBeNull();
  });
});

describe('what the handles show while a drag is live', () => {
  it('keeps the dragged handles attached when the tool changes mid-drag', () => {
    // The whole bug: this used to detach the move gizmo, and Babylon then
    // never fired the drag end that turns the gesture into a command.
    const dragging = beganDrag(ready());
    const switched = wantAttachment(dragging, { tool: 'rotate', node: barrel });

    expect(switched.shown).toEqual({ tool: 'move', node: barrel });
    expect(isDragging(switched)).toBe(true);
  });

  it('keeps them attached when the selection is cleared mid-drag', () => {
    // `Escape` while the mouse is down.
    const cleared = wantAttachment(beganDrag(ready()), { tool: 'move', node: null });
    expect(cleared.shown).toEqual({ tool: 'move', node: barrel });
    expect(isDragging(cleared)).toBe(true);
  });

  it('remembers the node the drag started on, not the one selected since', () => {
    const moved = wantAttachment(beganDrag(ready()), { tool: 'move', node: bush });
    expect(moved.dragged).toBe(barrel);
  });

  it('has nothing to drag when a drag somehow starts with nothing attached', () => {
    const state = beganDrag(noGizmoDrag<typeof barrel>());
    expect(state.dragged).toBeNull();
    expect(isDragging(state)).toBe(false);
  });
});

describe('what the handles show once the drag is over', () => {
  it('applies the request that was made mid-drag', () => {
    const switched = wantAttachment(beganDrag(ready()), { tool: 'rotate', node: barrel });
    const done = endedDrag(switched);

    expect(done.shown).toEqual({ tool: 'rotate', node: barrel });
    expect(isDragging(done)).toBe(false);
  });

  it('applies a mid-drag deselection once the gesture is finished', () => {
    const done = endedDrag(wantAttachment(beganDrag(ready()), { tool: 'move', node: null }));
    expect(done.shown.node).toBeNull();
  });

  it('leaves an untouched attachment exactly as it was', () => {
    const done = endedDrag(beganDrag(ready()));
    expect(done.shown).toEqual({ tool: 'move', node: barrel });
    expect(done.dragged).toBeNull();
  });

  it('lets the next drag start again', () => {
    const again = beganDrag(endedDrag(beganDrag(ready())));
    expect(isDragging(again)).toBe(true);
    expect(again.dragged).toBe(barrel);
  });
});
