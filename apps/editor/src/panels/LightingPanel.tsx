/**
 * The lighting panel (ADR-0024, ADR-0033).
 *
 * A world's light was world data with no way into the editor: the file said
 * evening, the viewport drew evening, and changing it meant editing JSON. This
 * panel closes that — and it does it through the ordinary command path, which
 * is what makes the change live in the viewport for free. `EditorViewport`
 * already relights whenever the open world's profile differs from the one it
 * last used (ADR-0018), so a slider that produces a `setLighting` command is a
 * slider that repaints the picture.
 *
 * **World and zone are the two levels the format has.** A zone overrides its
 * world group by group, so an interior can be dark under a world that is not.
 * The tabs here are those two levels and nothing else; the panel invents no
 * third one.
 *
 * **A preset is not a mode.** Pressing one writes the whole profile as one
 * command and is then over — the fields are ordinary fields again, one Ctrl+Z
 * puts the old look back, and saving writes what is on screen (agent rule 17).
 */
import type { JSX } from 'react';
import {
  LIGHTING_FIELDS,
  LIGHTING_PRESETS,
  lightingAt,
  worldLighting,
  zoneLighting,
  type FieldPatch,
  type LightingScope,
} from '@wov/editor-core';
import type { EditorDocument } from '@wov/editor-core';
import { SchemaFields } from './SchemaFields.js';

export interface LightingPanelProps {
  readonly document: EditorDocument;
  /** Which level the panel is editing. The shell owns it so it survives a tab. */
  readonly scope: 'world' | 'zone';
  readonly onScope: (scope: 'world' | 'zone') => void;
  /** One or more fields of the profile at `scope`, as one undoable command. */
  readonly onLighting: (scope: LightingScope, patches: readonly FieldPatch[]) => void;
  /** The same, but folded into one undo step while a slider is being dragged. */
  readonly onLightingDrag: (scope: LightingScope, patch: FieldPatch, gesture: string) => void;
}

export function LightingPanel(props: LightingPanelProps): JSX.Element {
  const { document } = props;
  const zoneId = document.activeZoneId;
  const scope: LightingScope =
    props.scope === 'zone' && zoneId !== null ? zoneLighting(zoneId) : worldLighting();
  const profile = lightingAt(document.world, scope);

  return (
    <aside className="panel lighting" data-testid="editor-lighting">
      <h2>Lighting</h2>

      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={props.scope === 'world'}
          className={props.scope === 'world' ? 'tab active' : 'tab'}
          data-testid="lighting-scope-world"
          onClick={() => props.onScope('world')}
        >
          World
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={props.scope === 'zone'}
          className={props.scope === 'zone' ? 'tab active' : 'tab'}
          data-testid="lighting-scope-zone"
          disabled={zoneId === null}
          onClick={() => props.onScope('zone')}
        >
          Zone
        </button>
      </div>

      <p className="hint" data-testid="lighting-scope-hint">
        {props.scope === 'world'
          ? `the light of "${document.world.name}", unless a zone says otherwise`
          : zoneId === null
            ? 'this world has no zone'
            : profile === undefined
              ? `"${zoneId}" is lit like its world — set a field to override it`
              : `"${zoneId}" overrides the world, group by group`}
      </p>

      <div className="lighting-presets">
        {LIGHTING_PRESETS.map((preset) => (
          <button
            type="button"
            key={preset.id}
            className="tab"
            data-testid={`lighting-preset-${preset.id}`}
            title={preset.description}
            onClick={() => props.onLighting(scope, [{ path: [], value: preset.profile }])}
          >
            {preset.name}
          </button>
        ))}
        <button
          type="button"
          className="tab"
          data-testid="lighting-clear"
          disabled={profile === undefined}
          title={
            props.scope === 'world'
              ? "remove the world's profile, leaving the renderer's defaults"
              : 'remove this zone override, so the zone is lit like its world'
          }
          onClick={() => props.onLighting(scope, [{ path: [], value: null }])}
        >
          Clear
        </button>
      </div>

      <div className="schema-fields" data-testid="lighting-fields">
        <SchemaFields
          fields={LIGHTING_FIELDS}
          value={profile}
          testId="lighting"
          onChange={(path, value) => props.onLighting(scope, [{ path, value }])}
          onDrag={(path, value, gesture) => props.onLightingDrag(scope, { path, value }, gesture)}
        />
      </div>
    </aside>
  );
}
