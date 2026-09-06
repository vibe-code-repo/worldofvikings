import { describe, expect, it } from 'vitest';
import { addEntity, addZone, removeEntities } from '@wov/editor-core';
import type { WorldDefinition } from '@wov/world-schema';
import { createSession, editorReducer, type EditorSession } from './store.js';

const world: WorldDefinition = {
  schemaVersion: 1,
  id: 'harbour',
  name: 'Harbour',
  zones: [
    {
      id: 'docks',
      name: 'Docks',
      entities: [{ id: 'barrel_001', prefab: 'barrel_01', position: [0, 0, 0] }],
    },
  ],
};

function run(
  session: EditorSession,
  ...actions: Parameters<typeof editorReducer>[1][]
): EditorSession {
  return actions.reduce(editorReducer, session);
}

describe('editorReducer', () => {
  it('opens a world with the first zone active and nothing selected', () => {
    const session = createSession(world);

    expect(session.state.document.activeZoneId).toBe('docks');
    expect(session.state.document.selection).toEqual([]);
    expect(session.state.document.dirty).toBe(false);
  });

  it('selects what a command created, so the next drag acts on it', () => {
    const session = run(createSession(world), {
      type: 'run',
      command: addEntity('docks', { id: 'barrel_002', prefab: 'barrel_01', position: [2, 0, 0] }),
    });

    expect(session.state.document.selection).toEqual(['barrel_002']);
    expect(session.state.document.dirty).toBe(true);
  });

  it('keeps a failed command out of the document and out of the history', () => {
    const before = createSession(world);
    const after = run(before, {
      type: 'run',
      command: addEntity('no-such-zone', { id: 'x', prefab: 'y', position: [0, 0, 0] }),
    });

    expect(after.state.document).toBe(before.state.document);
    expect(after.state.history.past).toHaveLength(0);
    expect(after.error).toMatch(/no-such-zone/);
  });

  it('undoes and redoes a command', () => {
    const added = run(createSession(world), {
      type: 'run',
      command: addEntity('docks', { id: 'barrel_002', prefab: 'barrel_01', position: [2, 0, 0] }),
    });

    const undone = editorReducer(added, { type: 'undo' });
    expect(undone.state.document.world.zones[0]?.entities).toHaveLength(1);

    const redone = editorReducer(undone, { type: 'redo' });
    expect(redone.state.document.world.zones[0]?.entities).toHaveLength(2);
  });

  it('keeps selection out of the history', () => {
    const selected = run(createSession(world), { type: 'select', entityIds: ['barrel_001'] });

    expect(selected.state.history.past).toHaveLength(0);
    expect(selected.state.document.dirty).toBe(false);
    expect(
      editorReducer(selected, { type: 'toggleSelect', entityId: 'barrel_001' }).state.document
        .selection,
    ).toEqual([]);
  });

  it('copies the selected entities into the session clipboard', () => {
    const copied = run(
      createSession(world),
      { type: 'select', entityIds: ['barrel_001'] },
      { type: 'copy' },
    );

    expect(copied.clipboard.map((entity) => entity.id)).toEqual(['barrel_001']);
    // Deleting the original does not empty the clipboard: pasting after a cut
    // is the whole point.
    const deleted = run(copied, { type: 'run', command: removeEntities('docks', ['barrel_001']) });
    expect(deleted.clipboard).toHaveLength(1);
  });

  it('marks the document saved without touching the history', () => {
    const dirty = run(createSession(world), {
      type: 'run',
      command: addZone({ id: 'town', name: 'Town', entities: [] }),
    });
    const saved = editorReducer(dirty, { type: 'saved', notice: 'saved as "harbour"' });

    expect(saved.state.document.dirty).toBe(false);
    expect(saved.state.history.past).toHaveLength(1);
    expect(saved.notice).toBe('saved as "harbour"');
  });

  it('starts a fresh history when another world is opened', () => {
    const edited = run(createSession(world), {
      type: 'run',
      command: addZone({ id: 'town', name: 'Town', entities: [] }),
    });
    const opened = editorReducer(edited, { type: 'open', world });

    expect(opened.state.history.past).toHaveLength(0);
    expect(opened.state.document.dirty).toBe(false);
  });

  it('clears the error once it has been shown', () => {
    const failed = run(createSession(world), { type: 'fail', error: 'boom' });

    expect(editorReducer(failed, { type: 'dismiss' }).error).toBeNull();
  });
});
