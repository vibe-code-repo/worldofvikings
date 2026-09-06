/**
 * Turning a finished gizmo drag into one command.
 *
 * This is the arithmetic the viewport would otherwise do inside an event
 * handler, where nothing can test it: the delta between where the dragged node
 * started and where it ended, applied to every other selected entity, snapped
 * if snapping is on.
 *
 * Position and rotation deltas add; a scale delta multiplies, because scale is
 * a ratio — dragging the handle to "twice as big" has to make a prop that was
 * already 2 m wide 4 m wide, not 3 m.
 */
import { snapPosition, snapRotation, type TransformChange } from '@wov/editor-core';
import type { Vector3 } from '@wov/world-schema';
import type { GizmoTransform } from './gizmos.js';

export interface DragSnapping {
  readonly enabled: boolean;
  /** Grid step in metres. */
  readonly step: number;
  /** Rotation step in degrees. */
  readonly rotationStepDegrees: number;
}

/**
 * The changes one drag makes.
 *
 * @param selection the selected entity ids, in pick order.
 * @param starts where each of them stood when the drag began.
 * @param primary the entity the handles were attached to — the last picked one.
 * @param finished where `primary` ended up.
 */
export function changesFromDrag(
  selection: readonly string[],
  starts: ReadonlyMap<string, GizmoTransform>,
  primary: string | undefined,
  finished: GizmoTransform,
  snapping: DragSnapping,
): readonly TransformChange[] {
  const start = primary === undefined ? undefined : starts.get(primary);
  if (primary === undefined || start === undefined) {
    // Nothing to measure against: the selection changed mid-drag, or the node
    // was never in the scene. Doing nothing is the only honest answer.
    return [];
  }

  const movedBy = subtract(finished.position, start.position);
  const turnedBy = subtract(finished.rotation, start.rotation);
  const scaledBy = ratio(finished.scale, start.scale);

  const changes: TransformChange[] = [];
  for (const entityId of selection) {
    const from = starts.get(entityId);
    if (from === undefined) {
      continue;
    }
    const position = add(from.position, movedBy);
    const rotation = add(from.rotation, turnedBy);
    changes.push({
      entityId,
      patch: {
        position: snapping.enabled ? snapPosition(position, snapping.step) : position,
        rotation: snapping.enabled
          ? snapRotation(rotation, snapping.rotationStepDegrees)
          : rotation,
        scale: multiply(from.scale, scaledBy),
      },
    });
  }
  return changes;
}

function add(left: Vector3, right: Vector3): Vector3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function subtract(left: Vector3, right: Vector3): Vector3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function multiply(left: Vector3, right: Vector3): Vector3 {
  return [left[0] * right[0], left[1] * right[1], left[2] * right[2]];
}

/** A scale of zero would divide by zero; treat it as "unchanged". */
function ratio(left: Vector3, right: Vector3): Vector3 {
  return [
    right[0] === 0 ? 1 : left[0] / right[0],
    right[1] === 0 ? 1 : left[1] / right[1],
    right[2] === 0 ? 1 : left[2] / right[2],
  ];
}
