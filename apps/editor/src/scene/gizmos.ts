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
 */
import { PositionGizmo } from '@babylonjs/core/Gizmos/positionGizmo';
import { RotationGizmo } from '@babylonjs/core/Gizmos/rotationGizmo';
import { ScaleGizmo } from '@babylonjs/core/Gizmos/scaleGizmo';
import { UtilityLayerRenderer } from '@babylonjs/core/Rendering/utilityLayerRenderer';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import type { Vector3 } from '@wov/world-schema';

/** Which handles are on screen. `select` shows none. */
export type EditorTool = 'select' | 'move' | 'rotate' | 'scale';

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

  let tool: EditorTool = 'select';
  let attached: TransformNode | null = null;
  let dragging = false;

  // World-aligned handles, so dragging the x arrow moves along world x whatever
  // the prop is rotated to. The scale gizmo is the exception: scaling happens in
  // the node's own space and Babylon warns if you ask for anything else.
  move.updateGizmoRotationToMatchAttachedMesh = false;
  rotate.updateGizmoRotationToMatchAttachedMesh = false;

  for (const gizmo of all) {
    gizmo.attachedNode = null;
    gizmo.onDragStartObservable.add(() => {
      dragging = true;
      onDragStart();
    });
    gizmo.onDragEndObservable.add(() => {
      dragging = false;
      if (attached) {
        onDragEnd(readTransform(attached));
      }
    });
  }

  const refresh = (): void => {
    move.attachedNode = tool === 'move' ? attached : null;
    rotate.attachedNode = tool === 'rotate' ? attached : null;
    scale.attachedNode = tool === 'scale' ? attached : null;
  };

  return {
    setTool(next) {
      tool = next;
      refresh();
    },
    attach(node) {
      attached = node;
      refresh();
    },
    setSnapping(snapping) {
      move.snapDistance = snapping.position;
      rotate.snapDistance = snapping.rotation;
      scale.snapDistance = snapping.position;
    },
    isDragging: () => dragging,
    dispose() {
      for (const gizmo of all) {
        gizmo.dispose();
      }
      layer.dispose();
    },
  };
}
