/**
 * The editor session as one reducer.
 *
 * `@wov/editor-core` owns what an edit *is* — commands, undo, selection — and
 * every one of its functions is a pure function of a value. This module is the
 * React-shaped wrapper around that: one `EditorSession` in one `useReducer`, so
 * there is exactly one place a panel, a keystroke or a gizmo can change the
 * world, and the viewport can derive itself from a single value (ADR-0018).
 *
 * It adds three things `@wov/editor-core` deliberately does not have, because
 * they are shell concerns rather than document ones: what to do with the ids a
 * command created, the last error to show in the status bar, and the in-session
 * clipboard.
 */
import {
  clearSelection,
  createEditorState,
  execute,
  markSaved,
  redo,
  setActiveZone,
  setSelection,
  toggleSelection,
  undo,
  type EditorCommand,
  type EditorState,
} from '@wov/editor-core';
import type { EntityDefinition, WorldDefinition } from '@wov/world-schema';

export interface EditorSession {
  readonly state: EditorState;
  /** Entities copied with Ctrl+C, kept for the session only. */
  readonly clipboard: readonly EntityDefinition[];
  /** The last thing that went wrong, or `null`. Shown, then cleared. */
  readonly error: string | null;
  /** What the last save said, e.g. `saved as "harbour"`. */
  readonly notice: string | null;
}

export type EditorAction =
  | { readonly type: 'open'; readonly world: WorldDefinition }
  | { readonly type: 'run'; readonly command: EditorCommand; readonly selectCreated?: boolean }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  | { readonly type: 'select'; readonly entityIds: readonly string[] }
  | { readonly type: 'toggleSelect'; readonly entityId: string }
  | { readonly type: 'clearSelection' }
  | { readonly type: 'activateZone'; readonly zoneId: string | null }
  | { readonly type: 'copy' }
  | { readonly type: 'saved'; readonly notice: string }
  | { readonly type: 'fail'; readonly error: string }
  | { readonly type: 'dismiss' };

export function createSession(world: WorldDefinition): EditorSession {
  return { state: createEditorState(world), clipboard: [], error: null, notice: null };
}

/** Replaces the document inside a session, leaving the shell's own state alone. */
function withDocument(session: EditorSession, state: EditorState): EditorSession {
  return { ...session, state, error: null };
}

export function editorReducer(session: EditorSession, action: EditorAction): EditorSession {
  switch (action.type) {
    case 'open':
      // A new world starts a new history: undoing across an open would apply a
      // command to a world it was never made against.
      return { ...createSession(action.world), clipboard: session.clipboard };

    case 'run': {
      const result = execute(session.state, action.command);
      if (!result.ok) {
        return { ...session, error: result.error };
      }
      // Placing or duplicating selects what was made, the way every editor
      // does: the next gizmo drag then acts on it without a second click.
      const select = action.selectCreated !== false && result.createdEntityIds.length > 0;
      const state = select
        ? {
            ...result.state,
            document: setSelection(result.state.document, result.createdEntityIds),
          }
        : result.state;
      return { ...session, state, error: null, notice: null };
    }

    case 'undo':
      return withDocument(session, undo(session.state));

    case 'redo':
      return withDocument(session, redo(session.state));

    case 'select':
      return withDocument(session, {
        ...session.state,
        document: setSelection(session.state.document, action.entityIds),
      });

    case 'toggleSelect':
      return withDocument(session, {
        ...session.state,
        document: toggleSelection(session.state.document, action.entityId),
      });

    case 'clearSelection':
      return withDocument(session, {
        ...session.state,
        document: clearSelection(session.state.document),
      });

    case 'activateZone':
      return withDocument(session, {
        ...session.state,
        document: setActiveZone(session.state.document, action.zoneId),
      });

    case 'copy':
      return { ...session, clipboard: selectedEntitiesOf(session.state), error: null };

    case 'saved':
      return {
        ...session,
        state: { ...session.state, document: markSaved(session.state.document) },
        error: null,
        notice: action.notice,
      };

    case 'fail':
      return { ...session, error: action.error };

    case 'dismiss':
      return { ...session, error: null, notice: null };
  }
}

/** The selected entities of the active zone, in the order they were picked. */
function selectedEntitiesOf(state: EditorState): readonly EntityDefinition[] {
  const zone = state.document.world.zones.find((each) => each.id === state.document.activeZoneId);
  if (zone === undefined) {
    return [];
  }
  const selected: EntityDefinition[] = [];
  for (const id of state.document.selection) {
    const entity = zone.entities.find((each) => each.id === id);
    if (entity !== undefined) {
      selected.push(entity);
    }
  }
  return selected;
}
