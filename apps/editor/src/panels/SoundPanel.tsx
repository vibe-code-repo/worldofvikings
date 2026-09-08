/**
 * The sound panel (ADR-0062, ADR-0033).
 *
 * A world's sound is world data — which bed a zone lies under, how loud its
 * forge is, and what its paths sound like underfoot — and until this panel it
 * was data with no way in: the file said it, the game played it, and changing
 * it meant a text editor and a reload. This closes that half of the parity gap.
 * The other half is the one a script cannot close at all, and it is the button
 * at the top: an author can **hear** the zone they are editing.
 *
 * **World and zone are the two levels the format has**, and the tabs here are
 * those two and nothing else, exactly as in the lighting panel. A zone
 * overrides its world group by group, so a cellar under a windy village is two
 * blocks in one file.
 *
 * **No list of field names.** Everything below the head is `SchemaFields` over
 * `SoundProfileSchema`, so the bed, the footstep pacing, the surface-to-bank
 * mapping, the banks themselves and the emitter list all appear with their own
 * ranges — and every clip field arrives as a picker filtered to the store's
 * audio rows, because the schema says `assetPathOf('audio')` and not because
 * this file knows which fields are clips. A field added to the schema appears
 * here on the next reload and this file does not change.
 *
 * **Listening is a view setting, not world data.** It is remembered by the
 * shell and never written to the file, the same way the grid is. Muting a forge
 * you are working next to must not change what a player hears.
 */
import type { JSX } from 'react';
import {
  SOUND_FIELDS,
  soundAt,
  worldSound,
  zoneSound,
  type EditorDocument,
  type FieldPatch,
  type SoundScope,
} from '@wov/editor-core';
import type { AssetIndex } from '../api/assets.js';
import { SchemaFields } from './SchemaFields.js';

export interface SoundPanelProps {
  readonly document: EditorDocument;
  /** `null` until the manifest has been read; the clip pickers are empty then. */
  readonly assets: AssetIndex | null;
  /** Which level the panel is editing. The shell owns it so it survives a tab. */
  readonly scope: 'world' | 'zone';
  readonly onScope: (scope: 'world' | 'zone') => void;
  /** One or more fields of the profile at `scope`, as one undoable command. */
  readonly onSound: (scope: SoundScope, patches: readonly FieldPatch[]) => void;
  /** The same, folded into one undo step while a slider is being dragged. */
  readonly onSoundDrag: (scope: SoundScope, patch: FieldPatch, gesture: string) => void;
  /** Whether the viewport is playing this zone. Off when a session starts. */
  readonly listening: boolean;
  readonly onListening: (listening: boolean) => void;
  /** What the viewport's audio reports — a bed, an emitter count, a failure. */
  readonly soundStatus: string;
}

export function SoundPanel(props: SoundPanelProps): JSX.Element {
  const { document } = props;
  const zoneId = document.activeZoneId;
  const scope: SoundScope =
    props.scope === 'zone' && zoneId !== null ? zoneSound(zoneId) : worldSound();
  const profile = soundAt(document.world, scope);
  const clips = props.assets?.ofKind('audio') ?? [];

  return (
    <aside className="panel sound" data-testid="editor-sound">
      <h2>Sound</h2>

      {/*
       * The switch first, because it is the question an author has on opening
       * this panel — and because its click is the user gesture the browser
       * needs before an audio context may start at all.
       */}
      <div className="sound-listen">
        <label className="schema-field" data-testid="sound-listen">
          <span className="field-label">listen</span>
          <input
            type="checkbox"
            data-testid="sound-listen-input"
            checked={props.listening}
            onChange={(event) => props.onListening(event.target.checked)}
          />
        </label>
        <span className="menu-hint" data-testid="sound-status">
          {props.soundStatus}
        </span>
      </div>

      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={props.scope === 'world'}
          className={props.scope === 'world' ? 'tab active' : 'tab'}
          data-testid="sound-scope-world"
          onClick={() => props.onScope('world')}
        >
          World
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={props.scope === 'zone'}
          className={props.scope === 'zone' ? 'tab active' : 'tab'}
          data-testid="sound-scope-zone"
          disabled={zoneId === null}
          onClick={() => props.onScope('zone')}
        >
          Zone
        </button>
      </div>

      <p className="hint" data-testid="sound-scope-hint">
        {props.scope === 'world'
          ? `how "${document.world.name}" sounds, unless a zone says otherwise`
          : zoneId === null
            ? 'this world has no zone'
            : profile === undefined
              ? `"${zoneId}" sounds like its world — set a field to override it`
              : `"${zoneId}" overrides the world, group by group`}
      </p>

      <p className="hint" data-testid="sound-catalog-hint">
        {props.assets === null
          ? 'the asset manifest has not been read yet'
          : `${String(clips.length)} clip(s) in the store`}
      </p>

      <div className="sound-actions">
        <button
          type="button"
          className="tab"
          data-testid="sound-clear"
          disabled={profile === undefined}
          title={
            props.scope === 'world'
              ? "remove the world's sound profile, leaving silence"
              : 'remove this zone override, so the zone sounds like its world'
          }
          onClick={() => props.onSound(scope, [{ path: [], value: null }])}
        >
          Clear
        </button>
      </div>

      <div className="schema-fields" data-testid="sound-fields">
        <SchemaFields
          fields={SOUND_FIELDS}
          value={profile}
          testId="sound"
          assetOptions={(kind) => props.assets?.ofKind(kind) ?? []}
          onChange={(path, value) => props.onSound(scope, [{ path, value }])}
          onDrag={(path, value, gesture) => props.onSoundDrag(scope, { path, value }, gesture)}
        />
      </div>
    </aside>
  );
}
