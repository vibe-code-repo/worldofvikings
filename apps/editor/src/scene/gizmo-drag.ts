/**
 * Which handles are on screen while a drag is live.
 *
 * A gizmo drag is not one event, it is three: a drag start, an unbounded amount
 * of dragging, and a drag end at which the whole gesture becomes one command
 * (ADR-0018). The editor's other shortcuts keep working in between — `W`/`E`/`R`
 * switch the tool, `Escape` clears the selection, a panel can select something
 * else — so "what are the handles attached to" and "what did the author last
 * ask for" are two different questions the moment the mouse goes down.
 *
 * They used to be one. `setTool` wrote straight onto the gizmos, so pressing
 * `E` mid-drag set the move gizmo's `attachedNode` to `null` while Babylon's
 * drag behaviour was still running. Babylon then never fired its drag end: the
 * viewport stayed "a drag is in progress" for the rest of the session and
 * refused every click, the gesture never became a command, and the prop stayed
 * drawn where the mouse had left it while the document, the inspector and the
 * hierarchy all still said the old place. One keystroke, and the editor was
 * dead to the mouse with a lie on screen.
 *
 * So a request made during a drag is *remembered*, not applied, and the drag
 * end applies it. The gesture always finishes and always commits — which is
 * also the honest reading of the gesture: the author dragged a prop, and then
 * asked for a different tool.
 *
 * Free of Babylon on purpose, and generic in the node type: nothing about
 * "defer this until the drag is over" needs a scene, and the part that can be
 * wrong without a renderer noticing is exactly this bookkeeping.
 */
/**
 * Which handles are on screen. `select` shows none (spec §14: `W`, `E`, `R`,
 * `Q`).
 *
 * Declared here rather than in `gizmos.ts` because this is the module that
 * decides which of them is attached at any moment; `gizmos.ts` re-exports it,
 * so every caller still says `import type { EditorTool } from './gizmos.js'`.
 */
export type EditorTool = 'select' | 'move' | 'rotate' | 'scale';

/** What the handles show: one tool, one node, either of them possibly none. */
export interface GizmoAttachment<TNode> {
  readonly tool: EditorTool;
  readonly node: TNode | null;
}

/** The whole state of the deferral, as one immutable record. */
export interface GizmoDragState<TNode> {
  /** What the author last asked for. */
  readonly wanted: GizmoAttachment<TNode>;
  /** What the handles are showing; the same, unless a drag is live. */
  readonly shown: GizmoAttachment<TNode>;
  /** The node the live drag is moving, or `null` when no drag is live. */
  readonly dragged: TNode | null;
}

/** Nothing selected, no tool, no drag. */
export function noGizmoDrag<TNode>(): GizmoDragState<TNode> {
  const nothing: GizmoAttachment<TNode> = { tool: 'select', node: null };
  return { wanted: nothing, shown: nothing, dragged: null };
}

/** True while a handle is being dragged, so a click must not also select. */
export function isDragging<TNode>(state: GizmoDragState<TNode>): boolean {
  return state.dragged !== null;
}

/**
 * The author asked for a tool, a node, or both.
 *
 * Applied at once when nothing is being dragged, remembered otherwise.
 */
export function wantAttachment<TNode>(
  state: GizmoDragState<TNode>,
  wanted: GizmoAttachment<TNode>,
): GizmoDragState<TNode> {
  return {
    wanted,
    shown: isDragging(state) ? state.shown : wanted,
    dragged: state.dragged,
  };
}

/**
 * A handle was grabbed.
 *
 * The node is captured here rather than read again at the end, because the
 * selection can move to another entity while the mouse is down and the gesture
 * belongs to the node it started on.
 */
export function beganDrag<TNode>(state: GizmoDragState<TNode>): GizmoDragState<TNode> {
  return { ...state, dragged: state.shown.node };
}

/** The handle was let go: the deferred request, if any, becomes the real one. */
export function endedDrag<TNode>(state: GizmoDragState<TNode>): GizmoDragState<TNode> {
  return { wanted: state.wanted, shown: state.wanted, dragged: null };
}
