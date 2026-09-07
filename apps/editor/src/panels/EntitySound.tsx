/**
 * The emitter of the selected entity, inside the entity inspector (ADR-0052,
 * ADR-0033).
 *
 * The sound panel edits a zone's whole profile; this edits the one question an
 * author has with a brazier selected: *does this thing make a noise, and how
 * loud does it carry*. Both write the same block through the same `setSound`
 * command, so a radius changed here and a radius changed there are one undo
 * step apart and cannot disagree.
 *
 * **Two ways an entity can sound, and the panel says which.** An emitter that
 * names this entity is about this placement. An emitter that names its *prefab*
 * is a rule over every placement of it — eleven braziers on one line — and
 * editing it from one of them changes all eleven. That is stated in the panel
 * with the count, because an author who quietens "the brazier" and silences ten
 * others has been lied to by their own editor.
 *
 * **The three anchor fields are not offered here**, and not because this file
 * lists them: the schema marks them `emitterAnchor` (`turnedBy` in
 * `@wov/world-schema`) and `SchemaFields` is told to leave that command's fields
 * alone — the same mechanism that keeps the terrain block one panel with two
 * commands. With an entity selected the anchor is already answered, and three
 * boxes to contradict it with is how a sound ends up bound to nothing.
 */
import type { JSX } from 'react';
import {
  SOUND_EMITTER_FIELDS,
  addEntityEmitter,
  emitterForEntity,
  removeEmitterAt,
  zoneScopeOf,
  zoneSoundProfile,
  type EditorDocument,
  type FieldPatch,
  type SoundScope,
} from '@wov/editor-core';
import type { AssetIndex } from '../api/assets.js';
import { SchemaFields } from './SchemaFields.js';

/** The command that owns the anchor fields; see the module note. */
const ANCHOR_COMMAND = 'emitterAnchor';

/**
 * Everything this section needs that the inspector does not already have.
 *
 * One object rather than three props, so the inspector carries one line about
 * sound instead of four. `RightPanel.tsx` and `Inspector.tsx` are being
 * rewritten by other work; the fewer lines this change puts in them, the fewer
 * of them come back as a conflict.
 */
export interface EntitySoundBinding {
  readonly assets: AssetIndex | null;
  readonly onSound: (scope: SoundScope, patches: readonly FieldPatch[]) => void;
  readonly onSoundDrag: (scope: SoundScope, patch: FieldPatch, gesture: string) => void;
}

export interface EntitySoundProps extends EntitySoundBinding {
  readonly document: EditorDocument;
  /** The entity the inspector is showing. */
  readonly entityId: string;
}

export function EntitySound(props: EntitySoundProps): JSX.Element {
  const scope = zoneScopeOf(props.document);
  const profile = zoneSoundProfile(props.document);
  const found = emitterForEntity(props.document, props.entityId);
  const clips = props.assets?.ofKind('audio') ?? [];

  if (scope === null) {
    return (
      <section className="panel-section" data-testid="entity-sound">
        <h3>Sound</h3>
        <p className="empty" data-testid="entity-sound-empty">
          This world has no zone to hold an emitter.
        </p>
      </section>
    );
  }

  if (found === null) {
    const clip = clips[0];
    return (
      <section className="panel-section" data-testid="entity-sound">
        <h3>Sound</h3>
        <p className="empty" data-testid="entity-sound-empty">
          This entity makes no sound.
        </p>
        <button
          type="button"
          data-testid="entity-sound-add"
          // Not a "helpful" empty clip: `clip` is the one emitter field the
          // schema refuses blank, so an add with nothing to play would be a
          // button that produces a validation error.
          disabled={clip === undefined}
          title={
            clip === undefined
              ? 'the asset store holds no audio to point an emitter at'
              : 'give this entity an emitter, bound to it by id'
          }
          onClick={() =>
            props.onSound(scope, [
              addEntityEmitter({ profile, entityId: props.entityId, clip: String(clip) }),
            ])
          }
        >
          Add emitter here
        </button>
      </section>
    );
  }

  const path = ['emitters', String(found.index)];
  return (
    <section className="panel-section" data-testid="entity-sound">
      <h3>Sound</h3>
      <div className="field">
        <span className="field-label">emitter</span>
        <span className="field-value" data-testid="entity-sound-id">
          {found.emitter.id}
        </span>
      </div>
      <p className="hint" data-testid="entity-sound-scope">
        {found.via === 'entity'
          ? 'bound to this entity'
          : `a rule over "${String(found.emitter.prefab)}" — ${String(found.matches)} placement(s) in this zone`}
      </p>

      <div className="schema-fields" data-testid="entity-sound-fields">
        <SchemaFields
          fields={SOUND_EMITTER_FIELDS}
          value={profile}
          path={path}
          testId="entity-sound"
          omitCommands={[ANCHOR_COMMAND]}
          assetOptions={(kind) => props.assets?.ofKind(kind) ?? []}
          onChange={(fieldPath, value) => props.onSound(scope, [{ path: fieldPath, value }])}
          onDrag={(fieldPath, value, gesture) =>
            props.onSoundDrag(scope, { path: fieldPath, value }, gesture)
          }
        />
      </div>

      <button
        type="button"
        data-testid="entity-sound-remove"
        title={
          found.via === 'entity'
            ? 'take this emitter out of the zone'
            : 'take the whole prefab rule out of the zone — every placement falls silent'
        }
        onClick={() => props.onSound(scope, [removeEmitterAt(profile, found.index)])}
      >
        Remove emitter
      </button>
    </section>
  );
}
