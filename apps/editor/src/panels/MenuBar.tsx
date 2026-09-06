import type { JSX } from 'react';
import { tokens } from '@wov/ui';
import type { EditorTool } from '../scene/gizmos.js';
import type { WorldSummary } from '../api/client.js';

export interface MenuBarProps {
  readonly worldName: string;
  readonly dirty: boolean;
  readonly worlds: readonly WorldSummary[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly hasSelection: boolean;
  readonly saving: boolean;
  readonly tool: EditorTool;
  readonly gridVisible: boolean;
  readonly snapping: boolean;
  readonly snapStep: number;
  readonly onNew: () => void;
  readonly onOpen: (worldId: string) => void;
  readonly onSave: () => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onDuplicate: () => void;
  readonly onDelete: () => void;
  readonly onTool: (tool: EditorTool) => void;
  readonly onToggleGrid: () => void;
  readonly onToggleSnapping: () => void;
  readonly onSnapStep: (step: number) => void;
}

/** The grid steps the View menu offers, in metres. */
const SNAP_STEPS = [0.25, 0.5, 1, 2, 5];

const TOOLS: readonly {
  readonly tool: EditorTool;
  readonly label: string;
  readonly key: string;
}[] = [
  { tool: 'select', label: 'Select', key: 'Q' },
  { tool: 'move', label: 'Move', key: 'W' },
  { tool: 'rotate', label: 'Rotate', key: 'E' },
  { tool: 'scale', label: 'Scale', key: 'R' },
];

/**
 * The menu bar (spec §13).
 *
 * The menus are `<details>` elements: they open on click and on Enter, close on
 * Escape, and are readable by a screen reader, without a dropdown library and
 * without a single line of open/close state. Clicking an item closes its menu
 * by removing `open` — the one piece of behaviour a `<details>` does not have.
 */
export function MenuBar(props: MenuBarProps): JSX.Element {
  const closeMenus = (): void => {
    for (const menu of window.document.querySelectorAll<HTMLDetailsElement>('details.menu[open]')) {
      menu.open = false;
    }
  };

  const item = (
    testId: string,
    label: string,
    onClick: () => void,
    disabled = false,
  ): JSX.Element => (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={() => {
        closeMenus();
        onClick();
      }}
    >
      {label}
    </button>
  );

  return (
    <header className="menubar" style={{ background: tokens.colorSurface }}>
      <span data-testid="editor-marker" style={{ color: tokens.colorAccent }}>
        World of Vikings &ndash; world editor dev build
      </span>

      <details className="menu">
        <summary data-testid="menu-file">File</summary>
        <div className="menu-items">
          {item('menu-file-new', 'New world', props.onNew)}
          {item('menu-file-save', props.saving ? 'Saving…' : 'Save', props.onSave, props.saving)}
          <hr />
          <span className="menu-label">Open</span>
          <ul data-testid="menu-file-worlds">
            {props.worlds.length === 0 ? (
              <li className="menu-empty">no worlds yet</li>
            ) : (
              props.worlds.map((world) => (
                <li key={world.id}>
                  <button
                    type="button"
                    data-testid={`menu-open-${world.id}`}
                    onClick={() => {
                      closeMenus();
                      props.onOpen(world.id);
                    }}
                  >
                    {world.name}
                    <span className="menu-hint">
                      {world.zones} {world.zones === 1 ? 'zone' : 'zones'}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      </details>

      <details className="menu">
        <summary data-testid="menu-edit">Edit</summary>
        <div className="menu-items">
          {item('menu-edit-undo', 'Undo  Ctrl+Z', props.onUndo, !props.canUndo)}
          {item('menu-edit-redo', 'Redo  Ctrl+Y', props.onRedo, !props.canRedo)}
          <hr />
          {item('menu-edit-duplicate', 'Duplicate  Ctrl+D', props.onDuplicate, !props.hasSelection)}
          {item('menu-edit-delete', 'Delete  Del', props.onDelete, !props.hasSelection)}
        </div>
      </details>

      <details className="menu">
        <summary data-testid="menu-view">View</summary>
        <div className="menu-items">
          <label>
            <input
              type="checkbox"
              data-testid="menu-view-grid"
              checked={props.gridVisible}
              onChange={props.onToggleGrid}
            />
            Grid
          </label>
          <label>
            <input
              type="checkbox"
              data-testid="menu-view-snapping"
              checked={props.snapping}
              onChange={props.onToggleSnapping}
            />
            Snap to grid
          </label>
          <label>
            Step
            <select
              data-testid="menu-view-step"
              value={props.snapStep}
              onChange={(event) => props.onSnapStep(Number(event.target.value))}
            >
              {SNAP_STEPS.map((step) => (
                <option key={step} value={step}>
                  {step} m
                </option>
              ))}
            </select>
          </label>
        </div>
      </details>

      <div className="toolbar" role="group" aria-label="Tools">
        {TOOLS.map(({ tool, label, key }) => (
          <button
            key={tool}
            type="button"
            data-testid={`tool-${tool}`}
            aria-pressed={props.tool === tool}
            className={props.tool === tool ? 'tool active' : 'tool'}
            onClick={() => props.onTool(tool)}
          >
            {label} <span className="menu-hint">{key}</span>
          </button>
        ))}
      </div>

      <span className="spacer" />
      <span data-testid="editor-world-name">{props.worldName}</span>
      <span data-testid="editor-dirty" className={props.dirty ? 'dirty' : 'clean'}>
        {props.dirty ? 'unsaved changes' : 'saved'}
      </span>
    </header>
  );
}
