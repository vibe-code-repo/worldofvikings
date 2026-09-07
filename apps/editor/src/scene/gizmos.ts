/**
 * Move, rotate and scale handles (spec §14: `W`, `E`, `R`; `Q` is the plain
 * select tool with no handles).
 *
 * Three separate gizmos rather than Babylon's `GizmoManager`, for two reasons:
 * the manager also brings the bounding-box gizmo and its own attachment
 * policy, neither of which this editor uses, and importing the three modules
 * by name keeps the bundle to what is actually on screen (ADR-0006).
 *
 * The contract with the document (ADR-0018): a drag moves the Babylon node
 * freely, and **on drag end** the whole gesture becomes one command. Not one
 * per frame — an undo stack with four hundred entries for one drag is not an
 * undo stack — and not never, which is what a viewport that edits the scene
 * instead of the document would produce.
 *
 * Which handles are attached *while* a drag is live is not decided here but in
 * `gizmo-drag.ts`, and that is worth its own file: a tool change or a
 * deselection that reaches the gizmos during a drag detaches the handle Babylon
 * is dragging, and Babylon then never fires its drag end. The gesture never
 * becomes a command, `isDragging()` never goes false again, and the viewport —
 * which refuses to select anything while a drag is live — is dead to the mouse
 * for the rest of the session, with the prop drawn where the document does not
 * have it.
 */
import { PositionGizmo } from '@babylonjs/core/Gizmos/positionGizmo.js';
import { RotationGizmo } from '@babylonjs/core/Gizmos/rotationGizmo.js';
import { ScaleGizmo } from '@babylonjs/core/Gizmos/scaleGizmo.js';
import { UtilityLayerRenderer } from '@babylonjs/core/Rendering/utilityLayerRenderer.js';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { Vector3 } from '@wov/world-schema';
import {
  beganDrag,
  endedDrag,
  isDragging,
  noGizmoDrag,
  wantAttachment,
  type EditorTool,
  type GizmoDragState,
} from './gizmo-drag.js';

/**
 * Which handles are on screen. `select` shows none.
 *
 * Declared in `gizmo-drag.ts` — the module that decides which of them is
 * attached at any moment — and re-exported here, because this is the module
 * every caller means when it says "the gizmos".
 */
export type { EditorTool } from './gizmo-drag.js';

/** The tool each shortcut selects (spec §14). */
export const TOOL_KEYS: Readonly<Record<string, EditorTool>> = {
  KeyQ: 'select',
  KeyW: 'move',
  KeyE: 'rotate',
  KeyR: 'scale',
};

/**
 * What a finished drag changed, as three plain vectors.
 *
 * The mutable tuple of `@wov/world-schema`, not the readonly `Vec3` of the
 * camera maths: these numbers go straight into a `TransformPatch` and from
 * there into a world file.
 */
export interface GizmoTransform {
  readonly position: Vector3;
  readonly rotation: Vector3;
  readonly scale: Vector3;
}

export interface GizmoSnapping {
  /** Grid step in metres; `0` turns position snapping off. */
  readonly position: number;
  /** Rotation step in radians; `0` turns rotation snapping off. */
  readonly rotation: number;
}

export interface GizmoSetOptions {
  readonly scene: Scene;
  /** Called with the node's transform when a drag starts and when it ends. */
  readonly onDragStart: () => void;
  readonly onDragEnd: (transform: GizmoTransform) => void;
}

export interface GizmoSet {
  /** Shows the handles for one tool, or none. */
  setTool(tool: EditorTool): void;
  /** Attaches the handles to a node, or detaches them with `null`. */
  attach(node: TransformNode | null): void;
  setSnapping(snapping: GizmoSnapping): void;
  /** True while a handle is being dragged, so a click must not also select. */
  isDragging(): boolean;
  dispose(): void;
}

function readTransform(node: TransformNode): GizmoTransform {
  return {
    position: [node.position.x, node.position.y, node.position.z],
    rotation: [node.rotation.x, node.rotation.y, node.rotation.z],
    scale: [node.scaling.x, node.scaling.y, node.scaling.z],
  };
}

export function createGizmos(options: GizmoSetOptions): GizmoSet {
  const { scene, onDragStart, onDragEnd } = options;
  // Its own layer, so the handles are never hidden inside the model they are
  // attached to and never appear in a pick against the world.
  const layer = new UtilityLayerRenderer(scene);

  const move = new PositionGizmo(layer);
  // `useEulerRotation`, because the entity's rotation in a world file is three
  // Euler angles; a quaternion on the node would have to be converted back on
  // every drag, and the two representations would drift.
  const rotate = new RotationGizmo(layer, 32, true);
  const scale = new ScaleGizmo(layer);
  const all = [move, rotate, scale];

  let state: GizmoDragState<TransformNode> = noGizmoDrag<TransformNode>();

  // World-aligned handles, so dragging the x arrow moves along world x whatever
  // the prop is rotated to. The scale gizmo is the exception: scaling happens in
  // the node's own space and Babylon warns if you ask for anything else.
  move.updateGizmoRotationToMatchAttachedMesh = false;
  rotate.updateGizmoRotationToMatchAttachedMesh = false;

  /** Puts `state.shown` onto the three gizmos; idempotent, so it can be re-said. */
  const refresh = (): void => {
    const { tool, node } = state.shown;
    move.attachedNode = tool === 'move' ? node : null;
    rotate.attachedNode = tool === 'rotate' ? node : null;
    scale.attachedNode = tool === 'scale' ? node : null;
  };

  for (const gizmo of all) {
    gizmo.attachedNode = null;
    gizmo.onDragStartObservable.add(() => {
      state = beganDrag(state);
      onDragStart();
    });
    gizmo.onDragEndObservable.add(() => {
      const dragged = state.dragged;
      state = endedDrag(state);
      // Whatever the author asked for mid-drag happens now, and before the
      // commit: the commit replaces the document, which attaches the handles
      // again, and the two must not race to say different things.
      refresh();
      if (dragged !== null && !dragged.isDisposed()) {
        onDragEnd(readTransform(dragged));
      }
    });
  }

  const want = (next: { tool: EditorTool; node: TransformNode | null }): void => {
    state = wantAttachment(state, next);
    refresh();
  };

  return {
    setTool(next) {
      want({ tool: next, node: state.wanted.node });
    },
    attach(node) {
      want({ tool: state.wanted.tool, node });
    },
    setSnapping(snapping) {
      move.snapDistance = snapping.position;
      rotate.snapDistance = snapping.rotation;
      scale.snapDistance = snapping.position;
    },
    isDragging: () => isDragging(state),
    dispose() {
      // Belt and braces: a gizmo disposed mid-drag never fires its drag end, so
      // the state is cleared here rather than left saying a drag is live.
      state = noGizmoDrag<TransformNode>();
      for (const gizmo of all) {
        gizmo.dispose();
      }
      layer.dispose();
    },
  };
}
