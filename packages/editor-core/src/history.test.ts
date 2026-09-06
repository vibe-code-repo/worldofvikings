import { describe, expect, it } from 'vitest';
import { addEntity, removeEntities, updateTransform } from './commands.js';
import { setSelection } from './selection.js';
import {
  canRedo,
  canUndo,
  createEditorState,
  execute,
  redo,
  undo,
  type EditorState,
} from './history.js';
import { entity, entityIds, villageWorld } from './test-support.js';

const start = createEditorState(villageWorld());

function run(
  state: EditorState,
  ...commands: readonly Parameters<typeof execute>[1][]
): EditorState {
  return commands.reduce((current, command) => {
    const result = execute(current, command);
    if (!result.ok) {
      throw new Error(`command failed: ${result.error}`);
    }
    return result.state;
  }, state);
}

describe('createEditorState', () => {
  it('starts with nothing to undo or redo', () => {
    expect(canUndo(start)).toBe(false);
    expect(canRedo(start)).toBe(false);
  });
});

describe('execute', () => {
  it('applies the command and records it', () => {
    const next = run(start, addEntity('village', entity('barrel_004')));
    expect(entityIds(next.document.world, 'village')).toHaveLength(4);
    expect(canUndo(next)).toBe(true);
    expect(next.document.dirty).toBe(true);
  });

  it('reports a failing command and changes nothing', () => {
    const result = execute(start, removeEntities('village', ['ghost']));
    expect(result.ok).toBe(false);
    expect(canUndo(start)).toBe(false);
  });

  it('hands the created ids to the caller so the editor can select them', () => {
    const result = execute(start, addEntity('village', entity('barrel_004')));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.createdEntityIds).toEqual(['barrel_004']);
    }
  });

  it('drops the redo stack, because the future no longer follows from the past', () => {
    const undone = undo(run(start, addEntity('village', entity('barrel_004'))));
    expect(canRedo(undone)).toBe(true);
    const diverged = run(undone, addEntity('village', entity('barrel_005')));
    expect(canRedo(diverged)).toBe(false);
  });

  it('forgets the oldest step once the limit is reached', () => {
    let state = createEditorState(villageWorld(), { historyLimit: 2 });
    state = run(
      state,
      addEntity('village', entity('barrel_004')),
      addEntity('village', entity('barrel_005')),
      addEntity('village', entity('barrel_006')),
    );
    const rewound = undo(undo(undo(state)));
    // Three commands, two remembered: the first one cannot be undone any more.
    expect(entityIds(rewound.document.world, 'village')).toEqual([
      'barrel_001',
      'barrel_002',
      'barrel_003',
      'barrel_004',
    ]);
  });
});

describe('undo and redo', () => {
  const moved = run(
    start,
    updateTransform('village', [{ entityId: 'barrel_001', patch: { position: [5, 0, 5] } }]),
  );

  it('undo restores the previous world, redo puts the change back', () => {
    const undone = undo(moved);
    expect(undone.document.world).toEqual(start.document.world);
    expect(canRedo(undone)).toBe(true);
    expect(redo(undone).document.world).toEqual(moved.document.world);
  });

  it('walks a whole stack of commands back and forward again', () => {
    const state = run(
      start,
      addEntity('village', entity('barrel_004')),
      removeEntities('village', ['barrel_001']),
      updateTransform('village', [{ entityId: 'barrel_002', patch: { scale: [2, 2, 2] } }]),
    );
    const rewound = undo(undo(undo(state)));
    expect(rewound.document.world).toEqual(start.document.world);
    expect(canUndo(rewound)).toBe(false);
    expect(redo(redo(redo(rewound))).document.world).toEqual(state.document.world);
  });

  it('restores the selection that belonged to the state, not just the world', () => {
    const selected: EditorState = {
      ...start,
      document: setSelection(start.document, ['barrel_001', 'barrel_002']),
    };
    const removed = run(selected, removeEntities('village', ['barrel_001']));
    expect(removed.document.selection).toEqual(['barrel_002']);
    expect(undo(removed).document.selection).toEqual(['barrel_001', 'barrel_002']);
  });

  it('marks the document dirty, because it no longer matches the saved file', () => {
    expect(undo(moved).document.dirty).toBe(true);
  });

  it('does nothing at the ends of the stack', () => {
    expect(undo(start)).toBe(start);
    expect(redo(start)).toBe(start);
  });
});
