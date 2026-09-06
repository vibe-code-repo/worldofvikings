/**
 * Undo and redo (spec §14: Ctrl+Z / Ctrl+Y).
 *
 * The history stores commands, not worlds: one step is the command, its
 * inverse, and the view state (selection, active zone) before and after it. A
 * thousand steps therefore cost a thousand small objects instead of a thousand
 * copies of the world.
 *
 * Everything here is a pure function of a state value, so the React shell can
 * keep one `EditorState` in a store and never worry about who mutated what.
 */
import type { WorldDefinition } from '@wov/world-schema';
import { activeZone, createDocument, type EditorDocument } from './document.js';
import { applyCommand, type EditorCommand } from './commands.js';

/** The view state a command was made in — restored when it is undone. */
export interface DocumentView {
  readonly selection: readonly string[];
  readonly activeZoneId: string | null;
}

export interface HistoryEntry {
  readonly command: EditorCommand;
  readonly inverse: EditorCommand;
  readonly before: DocumentView;
  readonly after: DocumentView;
  /**
   * What this step is *of*, when several of them are one gesture.
   *
   * A slider dragged across a lighting value produces one command per step,
   * because the viewport relights from the document and there is no other way
   * to show the change while it is being made. Fifty of those in the undo stack
   * would mean fifty Ctrl+Z to get back to where the drag started, which is not
   * an undo anybody wants. Two consecutive steps with the same key are folded
   * into one: the first one's inverse is kept — it is what the drag started
   * from — and the last one's command is what is redone.
   *
   * Only *consecutive* steps fold. Anything else in between (a placement, a
   * gizmo drag, a different slider) ends the gesture, so the fold can never
   * swallow an unrelated edit.
   */
  readonly coalesceKey?: string;
}

export interface EditorHistory {
  /** Oldest first; the last entry is what {@link undo} takes back. */
  readonly past: readonly HistoryEntry[];
  /** Oldest first; the last entry is what {@link redo} puts back. */
  readonly future: readonly HistoryEntry[];
  /** How many steps are kept. */
  readonly limit: number;
}

export interface EditorState {
  readonly document: EditorDocument;
  readonly history: EditorHistory;
}

export type ExecuteResult =
  | {
      readonly ok: true;
      readonly state: EditorState;
      readonly createdEntityIds: readonly string[];
    }
  | { readonly ok: false; readonly error: string };

/**
 * Deep enough for a working session, small enough that the tab does not grow
 * without bound. The shell may choose another limit.
 */
export const DEFAULT_HISTORY_LIMIT = 200;

export function createHistory(limit: number = DEFAULT_HISTORY_LIMIT): EditorHistory {
  return { past: [], future: [], limit: Math.max(0, Math.trunc(limit)) };
}

export function createEditorState(
  world: WorldDefinition,
  options: { readonly historyLimit?: number } = {},
): EditorState {
  return {
    document: createDocument(world),
    history: createHistory(options.historyLimit),
  };
}

export function canUndo(state: EditorState): boolean {
  return state.history.past.length > 0;
}

export function canRedo(state: EditorState): boolean {
  return state.history.future.length > 0;
}

/**
 * Applies a command and records it.
 *
 * A failing command changes nothing — not the document, not the history — so a
 * rejected keystroke cannot leave a hole in the undo stack.
 */
export function execute(
  state: EditorState,
  command: EditorCommand,
  options: { readonly coalesceKey?: string } = {},
): ExecuteResult {
  const applied = applyCommand(state.document, command);
  if (!applied.ok) {
    return { ok: false, error: applied.error };
  }

  const previous = state.history.past.at(-1);
  const folds = options.coalesceKey !== undefined && previous?.coalesceKey === options.coalesceKey;

  const entry: HistoryEntry = {
    command,
    // Folding keeps the *first* inverse of the gesture: that is the state the
    // drag started from, and it is what one Ctrl+Z has to return to.
    inverse: folds && previous !== undefined ? previous.inverse : applied.value.inverse,
    before: folds && previous !== undefined ? previous.before : viewOf(state.document),
    after: viewOf(applied.value.document),
    ...(options.coalesceKey === undefined ? {} : { coalesceKey: options.coalesceKey }),
  };

  const past = folds ? state.history.past.slice(0, -1) : state.history.past;

  return {
    ok: true,
    state: {
      document: applied.value.document,
      history: {
        ...state.history,
        past: trim([...past, entry], state.history.limit),
        // Redoing after a new edit would replay a change that no longer follows
        // from this world, so the branch is dropped.
        future: [],
      },
    },
    createdEntityIds: applied.value.createdEntityIds,
  };
}

/** Takes back the last command. Returns the state unchanged when there is none. */
export function undo(state: EditorState): EditorState {
  const entry = state.history.past.at(-1);
  if (entry === undefined) {
    return state;
  }

  const applied = applyCommand(state.document, entry.inverse);
  if (!applied.ok) {
    // The inverse was computed from this very document; if it no longer fits,
    // the history is not describing this world any more. Refuse rather than
    // half-apply it.
    return state;
  }

  return {
    document: restoreView(applied.value.document, entry.before),
    history: {
      ...state.history,
      past: state.history.past.slice(0, -1),
      future: [...state.history.future, entry],
    },
  };
}

/** Reapplies the last undone command. Returns the state unchanged when there is none. */
export function redo(state: EditorState): EditorState {
  const entry = state.history.future.at(-1);
  if (entry === undefined) {
    return state;
  }

  const applied = applyCommand(state.document, entry.command);
  if (!applied.ok) {
    return state;
  }

  return {
    document: restoreView(applied.value.document, entry.after),
    history: {
      ...state.history,
      past: trim([...state.history.past, entry], state.history.limit),
      future: state.history.future.slice(0, -1),
    },
  };
}

function viewOf(document: EditorDocument): DocumentView {
  return { selection: document.selection, activeZoneId: document.activeZoneId };
}

/**
 * Puts the remembered view back, minus whatever no longer exists — an undone
 * "add" leaves a selection that has lost its entity.
 */
function restoreView(document: EditorDocument, view: DocumentView): EditorDocument {
  const restored: EditorDocument = {
    ...document,
    activeZoneId:
      view.activeZoneId !== null &&
      document.world.zones.some((zone) => zone.id === view.activeZoneId)
        ? view.activeZoneId
        : document.activeZoneId,
    selection: view.selection,
    // Undoing does not restore the saved file, it moves away from it again.
    dirty: true,
  };
  const known = new Set((activeZone(restored)?.entities ?? []).map((entity) => entity.id));
  return { ...restored, selection: restored.selection.filter((id) => known.has(id)) };
}

function trim(entries: readonly HistoryEntry[], limit: number): readonly HistoryEntry[] {
  return entries.length <= limit ? entries : entries.slice(entries.length - limit);
}
