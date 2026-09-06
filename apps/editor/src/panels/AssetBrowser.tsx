import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import type { PrefabCategory } from '@wov/world-schema';
import type { CatalogedPrefab } from '../api/client.js';
import { PREFAB_DRAG_TYPE } from '../EditorViewport.js';
import { formatBounds, type PrefabIndex } from '../scene/prefab-index.js';

export interface AssetBrowserProps {
  readonly prefabs: PrefabIndex | null;
  /** What went wrong loading the catalogue, if anything. */
  readonly error: string | null;
  readonly selectedPrefabId: string | null;
  readonly onSelectPrefab: (prefabId: string | null) => void;
}

/**
 * The asset browser (spec §13): the prefab catalogue, in tabs by category.
 *
 * Two ways to get a prefab into the world, because both are what an author
 * reaches for: click a prefab and then click in the viewport, or drag the row
 * straight onto the canvas. The drag carries only the prefab id — the viewport
 * decides *where*, since only it knows what is under the cursor.
 *
 * The size column comes from the manifest's measured hull, never from an
 * assumption: height, origin and units differ per source file and per exporting
 * tool, and "size unknown" is a more useful answer than a made-up one.
 */
export function AssetBrowser(props: AssetBrowserProps): JSX.Element {
  const { prefabs } = props;
  const [category, setCategory] = useState<PrefabCategory | 'all'>('all');
  const [search, setSearch] = useState('');

  const shown = useMemo<readonly CatalogedPrefab[]>(() => {
    if (prefabs === null) {
      return [];
    }
    const pool = category === 'all' ? prefabs.all() : prefabs.inCategory(category);
    const needle = search.trim().toLowerCase();
    if (needle === '') {
      return pool;
    }
    return pool.filter(
      (prefab) =>
        prefab.name.toLowerCase().includes(needle) || prefab.id.toLowerCase().includes(needle),
    );
  }, [prefabs, category, search]);

  return (
    <section className="assets" data-testid="editor-assets">
      <div className="assets-head">
        <h2>Assets</h2>
        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={category === 'all'}
            data-testid="assets-tab-all"
            className={category === 'all' ? 'tab active' : 'tab'}
            onClick={() => setCategory('all')}
          >
            All
          </button>
          {(prefabs?.categories() ?? []).map((each) => (
            <button
              key={each}
              type="button"
              role="tab"
              aria-selected={category === each}
              data-testid={`assets-tab-${each}`}
              className={category === each ? 'tab active' : 'tab'}
              onClick={() => setCategory(each)}
            >
              {each}
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Search prefabs"
          data-testid="assets-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <span className="menu-hint" data-testid="assets-count">
          {shown.length} of {prefabs?.all().length ?? 0}
        </span>
      </div>

      {props.error !== null && (
        <p className="error" data-testid="assets-error">
          {props.error}
        </p>
      )}

      <ul className="asset-list" data-testid="assets-list">
        {shown.slice(0, 400).map((prefab) => (
          <li key={prefab.id}>
            <button
              type="button"
              draggable
              data-testid={`asset-${prefab.id}`}
              className={props.selectedPrefabId === prefab.id ? 'asset selected' : 'asset'}
              aria-pressed={props.selectedPrefabId === prefab.id}
              onClick={() =>
                props.onSelectPrefab(props.selectedPrefabId === prefab.id ? null : prefab.id)
              }
              onDragStart={(event) => {
                event.dataTransfer.setData(PREFAB_DRAG_TYPE, prefab.id);
                event.dataTransfer.effectAllowed = 'copy';
              }}
            >
              <span className="asset-name">{prefab.name}</span>
              <span className="menu-hint">{formatBounds(prefab)}</span>
              <span className={prefab.visibility === 'private' ? 'badge private' : 'badge'}>
                {prefab.visibility}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {shown.length > 400 && (
        <p className="hint" data-testid="assets-truncated">
          showing the first 400 — narrow the search to see the rest
        </p>
      )}
    </section>
  );
}
