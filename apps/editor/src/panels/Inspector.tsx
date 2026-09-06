import { useId } from 'react';
import type { JSX } from 'react';
import type { EditorDocument, TransformPatch } from '@wov/editor-core';
import { activeZone } from '@wov/editor-core';
import type { EntityDefinition, Vector3 } from '@wov/world-schema';

export interface InspectorProps {
  readonly document: EditorDocument;
  readonly onRename: (entityId: string, nextId: string) => void;
  readonly onTransform: (entityId: string, patch: TransformPatch) => void;
}

/** Radians on disk, degrees in the panel: nobody authors a rotation in radians. */
const TO_DEGREES = 180 / Math.PI;

const AXES = ['x', 'y', 'z'] as const;

/** The entity the inspector edits: the last one picked, as everywhere else. */
function primaryEntity(document: EditorDocument): EntityDefinition | undefined {
  const id = document.selection.at(-1);
  if (id === undefined) {
    return undefined;
  }
  return activeZone(document)?.entities.find((entity) => entity.id === id);
}

/**
 * The property panel (spec §13).
 *
 * Every field here produces a *command*, exactly like a gizmo drag — the panel
 * has no private copy of the entity. That is what makes typing a number into
 * `y` undoable with the same Ctrl+Z as dragging the handle, and why the fields
 * update by themselves while a gizmo is being dragged.
 *
 * The values are written on `change` rather than on every keystroke, so typing
 * `-1` does not first produce the command "move to `-`".
 */
export function Inspector(props: InspectorProps): JSX.Element {
  const { document } = props;
  const entity = primaryEntity(document);
  const idField = useId();

  if (entity === undefined) {
    return (
      <aside className="panel" data-testid="editor-inspector">
        <h2>Inspector</h2>
        <p className="empty" data-testid="inspector-empty">
          Nothing selected.
        </p>
      </aside>
    );
  }

  const vector = (
    label: string,
    field: 'position' | 'rotation' | 'scale',
    value: Vector3,
    toDisplay: (raw: number) => number,
    fromDisplay: (shown: number) => number,
  ): JSX.Element => (
    <div className="field-row" data-testid={`inspector-${field}`}>
      <span className="field-label">{label}</span>
      {AXES.map((axis, index) => (
        <input
          key={axis}
          type="number"
          step="0.1"
          aria-label={`${label} ${axis}`}
          data-testid={`inspector-${field}-${axis}`}
          value={round(toDisplay(value[index] ?? 0))}
          onChange={(event) => {
            const shown = Number(event.target.value);
            if (!Number.isFinite(shown)) {
              return;
            }
            const next: Vector3 = [...value] as unknown as Vector3;
            const mutable = next as unknown as number[];
            mutable[index] = fromDisplay(shown);
            props.onTransform(entity.id, { [field]: next } as TransformPatch);
          }}
        />
      ))}
    </div>
  );

  return (
    <aside className="panel" data-testid="editor-inspector">
      <h2>Inspector</h2>

      <label className="field" htmlFor={idField}>
        <span className="field-label">id</span>
        <input
          id={idField}
          data-testid="inspector-id"
          defaultValue={entity.id}
          key={entity.id}
          onBlur={(event) => {
            if (event.target.value !== entity.id) {
              props.onRename(entity.id, event.target.value);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
        />
      </label>

      <div className="field">
        <span className="field-label">prefab</span>
        <span data-testid="inspector-prefab" className="field-value">
          {entity.prefab}
        </span>
      </div>

      {vector('position', 'position', entity.position, identity, identity)}
      {vector(
        'rotation°',
        'rotation',
        entity.rotation ?? [0, 0, 0],
        (raw) => raw * TO_DEGREES,
        (shown) => shown / TO_DEGREES,
      )}
      {vector('scale', 'scale', entity.scale ?? [1, 1, 1], identity, identity)}

      {document.selection.length > 1 && (
        <p className="hint" data-testid="inspector-multi">
          {document.selection.length} selected — editing {entity.id}
        </p>
      )}
    </aside>
  );
}

function identity(value: number): number {
  return value;
}

/** Six decimals is what the world format keeps; more would be typing noise. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
