/**
 * The prefab inspector: what the selected asset collides as (ADR-0026, ADR-0033).
 *
 * A prefab's collision shape is decided by `generate:prefabs` from a rule about
 * the asset's *category* — a crate is a box, an archway is mesh, a tree is a box
 * around its trunk. The rules are good and the exceptions are real, and until
 * now an exception meant editing `content/prefabs/imported.json`, which the next
 * regeneration overwrites.
 *
 * So this panel writes into `overrides.json` instead — the overlay the API
 * applies last and the generator never touches (`prefab-store.ts`). A prefab
 * from a hand-written catalogue is edited in its own file, because nothing
 * regenerates that.
 *
 * **This edit is not in the undo history, and that is deliberate.** The history
 * belongs to the open *world document* (ADR-0018); a prefab catalogue is a
 * different file that other worlds also read, and one Ctrl+Z that silently
 * rewrites a shared file behind three other worlds is worse than a save button.
 * So the panel is explicit: change the fields, press Save, see which file it
 * went to.
 */
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import {
  PREFAB_COLLISION_FIELDS,
  catalogForEdit,
  editedPrefab,
  type PrefabEdit,
} from '@wov/editor-core';
import { PREFAB_CATEGORIES } from '@wov/world-schema';
import type { PrefabCategory, PrefabCollision } from '@wov/world-schema';
import type { CatalogedPrefab } from '../api/client.js';
import { SchemaFields } from './SchemaFields.js';

export interface PrefabInspectorProps {
  /** The prefab highlighted in the asset browser, or `null`. */
  readonly prefab: CatalogedPrefab | null;
  /** Saving is in flight. */
  readonly saving: boolean;
  readonly onSave: (prefab: CatalogedPrefab, edit: PrefabEdit) => void;
}

export function PrefabInspector(props: PrefabInspectorProps): JSX.Element {
  const { prefab } = props;
  const [edit, setEdit] = useState<PrefabEdit>({});

  // A different prefab is a different edit. Keyed on the id rather than reset
  // by the parent, so selecting the same prefab twice does not lose typing.
  const prefabId = prefab?.id ?? null;
  useEffect(() => setEdit({}), [prefabId]);

  if (prefab === null) {
    return (
      <aside className="panel" data-testid="editor-prefab-inspector">
        <h2>Prefab</h2>
        <p className="empty" data-testid="prefab-inspector-empty">
          Pick a prefab in the asset browser.
        </p>
      </aside>
    );
  }

  const shown = editedPrefab(prefab, edit);
  const target = catalogForEdit(prefab.catalog);
  const changed = Object.keys(edit).length > 0;

  const setCollision = (path: readonly string[], value: unknown): void => {
    setEdit((current) => {
      const collision = current.collision ?? prefab.collision ?? { kind: 'none' };
      if (path.length === 0) {
        return { ...current, collision: value === null ? null : (value as PrefabCollision) };
      }
      // The collision block is small and flat enough that the panel can keep
      // its own copy while it is being edited; nothing else reads it until Save.
      const next = { ...(collision as Record<string, unknown>) };
      let level = next;
      for (const segment of path.slice(0, -1)) {
        const child = level[segment];
        level[segment] = typeof child === 'object' && child !== null ? { ...child } : {};
        level = level[segment] as Record<string, unknown>;
      }
      const last = path.at(-1) ?? '';
      if (value === null) {
        delete level[last];
      } else {
        level[last] = value;
      }
      return { ...current, collision: next as unknown as PrefabCollision };
    });
  };

  return (
    <aside className="panel" data-testid="editor-prefab-inspector">
      <h2>Prefab</h2>

      <div className="field">
        <span className="field-label">id</span>
        <span className="field-value" data-testid="prefab-inspector-id">
          {prefab.id}
        </span>
      </div>
      <div className="field">
        <span className="field-label">asset</span>
        <span className="field-value" data-testid="prefab-inspector-asset">
          {prefab.asset}
        </span>
      </div>
      <div className="field">
        <span className="field-label">catalogue</span>
        <span className="field-value" data-testid="prefab-inspector-catalog">
          {prefab.catalog}
        </span>
      </div>

      <label className="field">
        <span className="field-label">category</span>
        <select
          data-testid="prefab-inspector-category"
          value={shown.category}
          onChange={(event) =>
            setEdit((current) => ({
              ...current,
              category: event.target.value as PrefabCategory,
            }))
          }
        >
          {PREFAB_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </label>

      <div className="prefab-collision-head">
        <span className="field-label">collision</span>
        <button
          type="button"
          data-testid="prefab-inspector-collision-clear"
          disabled={shown.collision === undefined}
          title="remove the block — the schema reads that as undecided, which a reader must treat as none"
          onClick={() => setEdit((current) => ({ ...current, collision: null }))}
        >
          undecided
        </button>
      </div>

      <div className="schema-fields" data-testid="prefab-collision-fields">
        <SchemaFields
          fields={PREFAB_COLLISION_FIELDS}
          value={shown.collision}
          testId="prefab-collision"
          onChange={setCollision}
        />
      </div>

      <div className="prefab-save">
        <span className="menu-hint" data-testid="prefab-inspector-target">
          saves into {target}.json
        </span>
        <button
          type="button"
          data-testid="prefab-inspector-save"
          disabled={!changed || props.saving}
          onClick={() => props.onSave(prefab, edit)}
        >
          {props.saving ? 'Saving…' : 'Save prefab'}
        </button>
      </div>
    </aside>
  );
}
