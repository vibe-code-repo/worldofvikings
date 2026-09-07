/**
 * Telling the renderer that a placed world does not move (ADR-0035).
 *
 * Babylon assumes every node is about to move. Once a frame it walks the whole
 * scene graph and asks each node whether its transform, its parent's transform
 * or its pivot changed since last time (`isSynchronized`), and rebuilds the
 * world matrix of anything that answers yes. For a scene of a few dozen movers
 * that is free. For a village of five thousand authored props that never move
 * again it is a quarter of the frame spent proving that nothing happened.
 *
 * `freezeWorldMatrix` is Babylon's word for "stop asking": the matrix is
 * computed once and the node is skipped by every later check. This module is
 * the safe way to say it to a whole zone at once, and the safety is entirely in
 * the order — the matrix has to be *right* before it is frozen, so every node
 * is computed with `force` from the root down before it is pinned.
 *
 * **Why this is not in the scene builder.** The editor moves entities; that is
 * what an editor is. A frozen node in the editor is a prop whose gizmo works,
 * whose document updates and whose picture never changes — the worst kind of
 * bug, because everything except the screen agrees. So the freeze lives here as
 * something an app asks for, `apps/game` asks for it after its zone is placed,
 * and `apps/editor` does not. {@link unfreezeStaticNodes} is the way back for
 * anything that later has to move after all.
 */

/**
 * The part of a Babylon node this module touches.
 *
 * Structural rather than `TransformNode`, like the rest of the pure code in
 * this project: the ordering rule below is the part that can be wrong, and it
 * has to be testable without a renderer. Babylon's `TransformNode`,
 * `AbstractMesh` and `InstancedMesh` all satisfy it as they stand.
 */
export interface StaticNode {
  /** Recomputes the world matrix; `true` forces it even when nothing is dirty. */
  computeWorldMatrix(force?: boolean): unknown;
  /** Pins the world matrix as it stands now. */
  freezeWorldMatrix(): void;
  /** Lets the node be recomputed again. */
  unfreezeWorldMatrix(): void;
  /**
   * Every node below this one, parents before children.
   *
   * Babylon's own walk pushes a child before recursing into it, which is the
   * order this module needs and the reason it does not sort.
   */
  getDescendants(directDescendantsOnly?: boolean): StaticNode[];
  /**
   * Present on a mesh: stop refreshing the bounding box from the world matrix.
   *
   * Only ever set on a node whose matrix has just been frozen, which is what
   * makes it safe — the box was computed from the final matrix and the matrix
   * cannot change again. Set on a node that still moves, it is a mesh that
   * culls against the place it used to be.
   */
  doNotSyncBoundingInfo?: boolean;
}

/** What {@link freezeStaticNodes} did, for the status line and for a test. */
export interface FreezeReport {
  /** Nodes whose world matrix is now pinned. */
  readonly frozen: number;
  /** How many of those also stopped refreshing their bounding box. */
  readonly boundsPinned: number;
}

/**
 * Freezes a placed subtree: every root and everything under it.
 *
 * Roots first and children after, each computed with `force` immediately before
 * it is frozen. The order is the whole correctness argument: a child's world
 * matrix is its local matrix times its parent's, so a child frozen before its
 * parent was computed pins the *old* parent transform into itself and the prop
 * stands where the loader left it rather than where the entity says.
 *
 * Calling it twice is harmless — a frozen node recomputed with `force` is
 * recomputed and frozen again at the same place.
 *
 * @param roots the entity roots of a placed zone. Anything that still moves —
 *   the player, the camera's target, the editor's gizmos — must not be in here.
 */
export function freezeStaticNodes(roots: readonly StaticNode[]): FreezeReport {
  let frozen = 0;
  let boundsPinned = 0;
  for (const root of roots) {
    for (const node of [root, ...root.getDescendants(false)]) {
      // Force, because the node may never have been drawn: an entity placed
      // this frame has a dirty matrix, and freezing a dirty matrix pins
      // whatever the previous value happened to be.
      node.computeWorldMatrix(true);
      node.freezeWorldMatrix();
      frozen += 1;
      // A boolean is what tells a mesh from a bare transform: Babylon's
      // `AbstractMesh` answers one, `TransformNode` has no such property. `in`
      // would not do — a declared-but-unset field is still `in` the object.
      if (typeof node.doNotSyncBoundingInfo === 'boolean') {
        node.doNotSyncBoundingInfo = true;
        boundsPinned += 1;
      }
    }
  }
  return { frozen, boundsPinned };
}

/**
 * Puts a subtree back the way it was, so it can move again.
 *
 * The counterpart exists because "static" is a claim about the world file, not
 * about physics: a door that opens, a prop a later phase picks up, a zone the
 * editor opens for editing. Unfreezing is the cheap half — one flag each — and
 * a node that was never frozen is unaffected.
 */
export function unfreezeStaticNodes(roots: readonly StaticNode[]): number {
  let thawed = 0;
  for (const root of roots) {
    for (const node of [root, ...root.getDescendants(false)]) {
      if (typeof node.doNotSyncBoundingInfo === 'boolean') {
        node.doNotSyncBoundingInfo = false;
      }
      node.unfreezeWorldMatrix();
      node.computeWorldMatrix(true);
      thawed += 1;
    }
  }
  return thawed;
}
