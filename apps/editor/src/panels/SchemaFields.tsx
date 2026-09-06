/**
 * Drawing a block of world data from its schema (ADR-0033).
 *
 * `describeFields` in `@wov/editor-core` answers *what* controls a block needs;
 * this file is the only place that knows what a control looks like. Between
 * them there is no list of field names anywhere in `apps/editor`, which is the
 * point: when the terrain work adds `normalScale` to a layer, the slider
 * appears here with its own range and nobody edits this file.
 *
 * Everything is uncontrolled in the React sense but controlled by the document:
 * a control reports a *path and a value*, the panel above turns that into a
 * command, and the value comes back down through the document (ADR-0018). No
 * field keeps a private copy, which is why a preset button and a slider cannot
 * disagree.
 */
import type { JSX } from 'react';
import type { FormField, FormGroup, FormList } from '@wov/editor-core';
import { valueAtPath } from '@wov/editor-core';

export interface SchemaFieldsProps {
  /** The controls to draw, from `describeFields`. */
  readonly fields: readonly FormField[];
  /** The block being edited. `undefined` is a block that does not exist yet. */
  readonly value: unknown;
  /** Where this block sits, for the paths the callbacks report. */
  readonly path?: readonly string[];
  /** Prefix for every `data-testid`, so two panels can show the same schema. */
  readonly testId: string;
  /**
   * A field changed. `value` is `null` to remove it — that is how a group is
   * cleared and how "no fog block" is told from "a fog block that says
   * nothing".
   */
  readonly onChange: (path: readonly string[], value: unknown) => void;
  /**
   * Called while a slider is being dragged, with a key naming the gesture, so
   * the whole drag becomes one undo step (see `EditorHistory.coalesceKey`).
   */
  readonly onDrag?: (path: readonly string[], value: unknown, gesture: string) => void;
  readonly disabled?: boolean;
}

/** A value for a field that has none yet, so "add" produces something valid. */
export function defaultValueFor(field: FormField): unknown {
  switch (field.kind) {
    case 'group': {
      const value: Record<string, unknown> = {};
      for (const child of field.fields) {
        if (child.required) {
          value[child.key] = defaultValueFor(child);
        }
      }
      return value;
    }
    case 'number':
      return field.minimum ?? 0;
    case 'boolean':
      return true;
    case 'color':
      return '#ffffff';
    case 'choice':
      return field.options[0] ?? '';
    case 'vector':
      return Array.from({ length: field.length }, () => field.minimum ?? 0);
    case 'list':
      return [];
    default:
      return '';
  }
}

/** Six decimals is what the world format keeps; more would be typing noise. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function SchemaFields(props: SchemaFieldsProps): JSX.Element {
  const base = props.path ?? [];
  return (
    <>
      {props.fields.map((field) => (
        <Field key={field.key} {...props} field={field} path={[...base, field.key]} />
      ))}
    </>
  );
}

interface FieldProps extends SchemaFieldsProps {
  readonly field: FormField;
  readonly path: readonly string[];
}

function Field(props: FieldProps): JSX.Element | null {
  const { field, path, testId, disabled } = props;
  const id = `${testId}-${path.join('-')}`;
  // `path` is always relative to `props.value`, at every depth: a nested group
  // hands its children the same block and a longer path, so there is exactly
  // one rule for where a value comes from and where a change goes.
  const current = valueAtPath(props.value, path);
  const set = (value: unknown): void => props.onChange(path, value);

  switch (field.kind) {
    case 'group':
      return <Group {...props} field={field} id={id} current={current} />;

    case 'boolean':
      return (
        <label className="schema-field" data-testid={id}>
          <span className="field-label">{field.label}</span>
          <input
            type="checkbox"
            disabled={disabled}
            data-testid={`${id}-input`}
            checked={current === true}
            onChange={(event) => set(event.target.checked)}
          />
        </label>
      );

    case 'color': {
      const colour = typeof current === 'string' ? current : '#000000';
      return (
        <label className="schema-field" data-testid={id}>
          <span className="field-label">{field.label}</span>
          <input
            type="color"
            disabled={disabled}
            data-testid={`${id}-input`}
            value={colour}
            onChange={(event) => set(event.target.value)}
          />
          <span className="field-value">{typeof current === 'string' ? current : '—'}</span>
        </label>
      );
    }

    case 'choice':
      return (
        <label className="schema-field" data-testid={id}>
          <span className="field-label">{field.label}</span>
          <select
            disabled={disabled}
            data-testid={`${id}-input`}
            value={typeof current === 'string' ? current : ''}
            onChange={(event) => set(event.target.value === '' ? null : event.target.value)}
          >
            {!field.required && <option value="">— not set —</option>}
            {field.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      );

    case 'number': {
      const bounded = field.minimum !== undefined && field.maximum !== undefined;
      const shown = numberOr(current, field.minimum ?? 0);
      return (
        <div className="schema-field" data-testid={id}>
          <span className="field-label">{field.label}</span>
          {bounded && (
            <input
              type="range"
              disabled={disabled}
              aria-label={`${field.label} slider`}
              data-testid={`${id}-slider`}
              min={field.minimum}
              max={field.maximum}
              step={field.step}
              value={shown}
              onChange={(event) => {
                const next = Number(event.target.value);
                // A drag is one gesture: the panel folds the steps into one
                // undo entry rather than fifty.
                if (props.onDrag) {
                  props.onDrag(path, next, id);
                } else {
                  props.onChange(path, next);
                }
              }}
            />
          )}
          <input
            type="number"
            disabled={disabled}
            aria-label={field.label}
            data-testid={`${id}-input`}
            step={field.step}
            {...(field.minimum === undefined ? {} : { min: field.minimum })}
            {...(field.maximum === undefined ? {} : { max: field.maximum })}
            value={current === undefined ? '' : round(shown)}
            onChange={(event) => {
              if (event.target.value === '') {
                set(field.required ? defaultValueFor(field) : null);
                return;
              }
              const next = Number(event.target.value);
              if (Number.isFinite(next)) {
                set(field.integer ? Math.round(next) : next);
              }
            }}
          />
        </div>
      );
    }

    case 'vector': {
      const values = Array.isArray(current) ? (current as unknown[]) : [];
      return (
        <div className="schema-field" data-testid={id}>
          <span className="field-label">{field.label}</span>
          <div className="schema-vector">
            {Array.from({ length: field.length }, (_unused, axis) => (
              <input
                key={axis}
                type="number"
                disabled={disabled}
                step="0.01"
                aria-label={`${field.label} ${String(axis)}`}
                data-testid={`${id}-${String(axis)}`}
                value={round(numberOr(values[axis], 0))}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (!Number.isFinite(next)) {
                    return;
                  }
                  const updated = Array.from({ length: field.length }, (_ignored, index) =>
                    index === axis ? next : numberOr(values[index], 0),
                  );
                  set(updated);
                }}
              />
            ))}
          </div>
        </div>
      );
    }

    case 'list':
      return <List {...props} field={field} id={id} current={current} />;

    case 'text':
      return (
        <label className="schema-field" data-testid={id}>
          <span className="field-label">{field.label}</span>
          <input
            type="text"
            disabled={disabled}
            data-testid={`${id}-input`}
            value={typeof current === 'string' ? current : ''}
            onChange={(event) =>
              set(event.target.value === '' && !field.required ? null : event.target.value)
            }
          />
        </label>
      );

    default:
      // A shape this renderer has no control for. Shown as JSON rather than
      // hidden: a field nobody can see is a field nobody knows is wrong.
      return (
        <div className="schema-field" data-testid={id}>
          <span className="field-label">{field.label}</span>
          <span className="field-value">{JSON.stringify(current) ?? '—'}</span>
        </div>
      );
  }
}

interface GroupProps extends FieldProps {
  readonly field: FormGroup;
  readonly id: string;
  readonly current: unknown;
}

function Group(props: GroupProps): JSX.Element {
  const { field, id, current, disabled } = props;
  const present = current !== undefined && current !== null;
  return (
    <details className="schema-group" data-testid={id} open={present}>
      <summary>
        {field.label}
        <button
          type="button"
          className="schema-clear"
          disabled={disabled || !present}
          data-testid={`${id}-clear`}
          title={`remove the ${field.label} block, so it falls back to the level above`}
          onClick={(event) => {
            event.preventDefault();
            props.onChange(props.path, null);
          }}
        >
          clear
        </button>
      </summary>
      <div className="schema-group-body">
        <SchemaFields
          fields={field.fields}
          value={props.value}
          path={props.path}
          testId={props.testId}
          onChange={props.onChange}
          {...(props.onDrag === undefined ? {} : { onDrag: props.onDrag })}
          {...(disabled === undefined ? {} : { disabled })}
        />
      </div>
    </details>
  );
}

interface ListProps extends FieldProps {
  readonly field: FormList;
  readonly id: string;
  readonly current: unknown;
}

/**
 * A list with add, remove and reorder.
 *
 * Order is not decoration here: the terrain's layer list is blended by the
 * splat map's colour channels in exactly this order, so moving a layer up moves
 * which channel paints it (ADR-0020). One move is one command and one undo.
 */
function List(props: ListProps): JSX.Element {
  const { field, id, disabled } = props;
  const entries = Array.isArray(props.current) ? (props.current as unknown[]) : [];
  const full = field.maxItems !== undefined && entries.length >= field.maxItems;

  const replace = (next: readonly unknown[]): void => props.onChange(props.path, [...next]);

  const move = (from: number, to: number): void => {
    if (to < 0 || to >= entries.length) {
      return;
    }
    const next = [...entries];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    replace(next);
  };

  return (
    <div className="schema-list" data-testid={id}>
      <div className="schema-list-head">
        <span className="field-label">{field.label}</span>
        <span className="menu-hint" data-testid={`${id}-count`}>
          {entries.length}
          {field.maxItems === undefined ? '' : ` of ${String(field.maxItems)}`}
        </span>
        <button
          type="button"
          disabled={disabled || full}
          data-testid={`${id}-add`}
          onClick={() => replace([...entries, defaultValueFor(field.item)])}
        >
          add
        </button>
      </div>
      <ol className="schema-list-items">
        {entries.map((entry, index) => (
          // The index *is* the identity here: the splat channel a layer is
          // painted by is its position in the list, and two layers may
          // otherwise be identical down to the last field (ADR-0020).
          <li key={index} data-testid={`${id}-${String(index)}`}>
            <div className="schema-list-controls">
              <span className="menu-hint">{index}</span>
              <button
                type="button"
                disabled={disabled || index === 0}
                data-testid={`${id}-${String(index)}-up`}
                title="move up"
                onClick={() => move(index, index - 1)}
              >
                ↑
              </button>
              <button
                type="button"
                disabled={disabled || index === entries.length - 1}
                data-testid={`${id}-${String(index)}-down`}
                title="move down"
                onClick={() => move(index, index + 1)}
              >
                ↓
              </button>
              <button
                type="button"
                disabled={disabled}
                data-testid={`${id}-${String(index)}-remove`}
                title="remove"
                onClick={() => replace(entries.filter((_ignored, at) => at !== index))}
              >
                ✕
              </button>
            </div>
            {field.item.kind === 'group' ? (
              <SchemaFields
                fields={field.item.fields}
                value={entry}
                testId={`${id}-${String(index)}`}
                onChange={(fieldPath, value) =>
                  props.onChange([...props.path, String(index), ...fieldPath], value)
                }
                {...(props.onDrag === undefined
                  ? {}
                  : {
                      onDrag: (fieldPath, value, gesture) =>
                        props.onDrag?.(
                          [...props.path, String(index), ...fieldPath],
                          value,
                          gesture,
                        ),
                    })}
                {...(disabled === undefined ? {} : { disabled })}
              />
            ) : (
              <input
                type="text"
                disabled={disabled}
                aria-label={`${field.label} ${String(index)}`}
                data-testid={`${id}-${String(index)}-input`}
                value={typeof entry === 'string' ? entry : ''}
                onChange={(event) =>
                  props.onChange([...props.path, String(index)], event.target.value)
                }
              />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
